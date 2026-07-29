# Software Requirements Specification
## Orinthia v1 — Sistensia AI Manager

| | |
|---|---|
| **Proyek** | Orinthia v1 \| Sistensia AI Manager |
| **Pemilik** | Karel (CEO, Scio / Sistensia) |
| **Versi dokumen** | 1.0 |
| **Tanggal** | 29 Juli 2026 |
| **Status** | Draf untuk implementasi |

---

## 1. Pendahuluan

### 1.1 Tujuan

Orinthia adalah asisten manajer berbasis AI yang beroperasi di WhatsApp untuk mendampingi operasional harian startup Scio/Sistensia. Fungsi utamanya: mengelola komunikasi tim, menagih dan mengumpulkan jawaban evaluasi berkala, serta menghasilkan laporan berjenjang secara otomatis.

### 1.2 Ruang Lingkup

Sistem terdiri dari dua entitas yang harus selalu dibedakan:

- **Orinthia** — persona AI yang berinteraksi dengan pengguna. Dijalankan di atas Claude Code.
- **Moss** — sistem Node.js yang menjadi perantara antara WhatsApp dan Orinthia. Moss menangani routing, penjadwalan, database, dan pesan galat.

Pemisahan nama ini disengaja: semua perintah dan pesan yang berasal dari Moss diberi label eksplisit agar Orinthia dapat membedakan **instruksi internal dirinya sendiri** (tidak boleh dibajak) dari **instruksi eksternal sistem**.

### 1.3 Definisi

| Istilah | Arti |
|---|---|
| **PC** | Personal chat — percakapan japri satu lawan satu |
| **Grup** | Grup WhatsApp yang terdaftar |
| **Laporan** | Dokumen formal untuk dibaca manusia, berbasis jawaban evaluasi |
| **Rangkuman** | Ringkasan mentah untuk konteks AI, tidak dibaca pengguna |
| **Tool calling** | Perintah berformat teks dari Orinthia yang dideteksi dan dieksekusi Moss |
| **Chat belum dibaca** | Pesan tersimpan di database yang belum pernah dikirim ke Orinthia |
| **Flush** | Penghapusan data dari database sesuai aturan retensi |

### 1.4 Tumpukan Teknologi

| Lapisan | Teknologi |
|---|---|
| Model AI | Claude Sonnet 5, thinking mode default medium |
| Runtime AI | Claude Code |
| Sistem | Node.js (Moss) |
| Antarmuka pesan | WhatsApp Web |
| Deployment | VPS |
| Basis data | Ditentukan saat implementasi |

---

## 2. Arsitektur Sistem

### 2.1 Alur Utama

```
WhatsApp Web
     │
     ▼
   MOSS (Node.js)
     ├── Filter hak akses  ──► tolak jika tidak berwenang
     ├── Simpan ke database
     ├── Penjadwal (19.30 / 20.30 / 21.30 / 22.00)
     └── Kirim ke Orinthia (Claude Code)
              │
              ▼
        ORINTHIA
              │
              └── Tool calling ──► MOSS ──► WhatsApp / Database
```

### 2.2 Prinsip Arsitektur

**FR-ARCH-1.** Seluruh WhatsApp diperlakukan sebagai **satu sesi percakapan tunggal** di sisi Orinthia. Orinthia melihat percakapan dari banyak sumber sekaligus (berbagai PC dan grup), sementara pengguna hanya melihat percakapannya sendiri.

**FR-ARCH-2.** Orinthia **tidak dapat mengirim pesan secara langsung**. Semua keluaran ke WhatsApp hanya terjadi melalui tool calling. Respons Orinthia yang tidak mengandung tool call tidak sampai ke pengguna mana pun.

**FR-ARCH-3.** Orinthia **tidak wajib membalas**. Ia hanya membalas ketika memang diperlukan atau diharuskan.

**FR-ARCH-4.** Dalam satu respons, Orinthia dapat melakukan beberapa tool call sekaligus untuk membalas beberapa nomor dan grup secara bersamaan.

**FR-ARCH-5.** Tool calling pada sistem ini berada **di luar mekanisme internal Claude Code**. Perintah dinyatakan dalam bentuk teks berformat khusus dan dideteksi oleh Moss.

**FR-ARCH-6.** Orinthia tidak memiliki kemampuan pembuatan berkas.

---

## 3. Aktor dan Hak Akses

### 3.1 Daftar Putih Personal Chat

Hanya nomor berikut yang boleh dibaca, disimpan, dan dibalas:

| Nama | Peran |
|---|---|
| Karel | CEO — otoritas tertinggi |
| Mas Rafi | Stakeholder (Hieren) |
| Tata | Anggota tim |
| Ihya | COO |
| Azka | CTO |
| Faqih | CFO |

**FR-ACL-1.** Data setiap orang dikirim ke Orinthia lengkap beserta jabatan, tanggung jawab, dan tupoksinya.

### 3.2 Daftar Putih Grup

| Grup |
|---|
| Sinergi |
| P2MW Hieren |
| P2MW Privat |

**FR-ACL-2.** Data setiap grup dikirim lengkap beserta daftar seluruh anggotanya.

### 3.3 Aturan Respons

**FR-ACL-3.** **PC:** Orinthia selalu merespons pengguna dalam daftar putih.

**FR-ACL-4.** **Grup:** Orinthia hanya merespons ketika di-*tag* atau di-*reply*.

**FR-ACL-5.** Jika sepanjang hari tidak ada yang mem-*tag* atau me-*reply* di suatu grup, Orinthia **tidak boleh** melakukan tool calling ke grup tersebut — kecuali diminta pengguna lain lewat PC.

**FR-ACL-6.** Seluruh percakapan grup tetap disimpan dan dirangkum, terlepas dari ada atau tidaknya *tag*.

### 3.4 Isolasi Informasi

**FR-ACL-7.** Orinthia **dilarang membocorkan informasi apa pun dari grup yang orang bersangkutan tidak terdaftar di dalamnya.**

**FR-ACL-8.** Orinthia boleh memberi tahu informasi lintas-PC jika diperlukan atau diminta, dengan tetap mematuhi FR-ACL-7.

---

## 4. Persona dan System Prompt

**FR-PROMPT-1.** System prompt Orinthia memuat komponen berikut:

1. Identitas: Orinthia, manajer profesional dari startup Scio
2. Latar belakang singkat Scio
3. Latar belakang singkat Orinthia
4. Latar belakang singkat Hieren
5. Informasi seluruh tim dan stakeholder beserta tupoksi
6. Sifat dan karakter Blanc / Testarossa (Tensura) sebagai basis kepribadian
7. Seluruh pertanyaan evaluasi harian, mingguan, bulanan, kuartalan, dan tahunan (lihat Lampiran A)
8. Penjelasan mekanisme tool calling eksternal
9. Pernyataan bahwa pembuatan berkas tidak tersedia
10. Aturan otoritas Karel (lihat FR-PROMPT-3)
11. Aturan penyebutan nama

**FR-PROMPT-2.** Penjelasan sesi tunggal yang wajib ada di system prompt:

> "Kamu asisten di WhatsApp di mana seluruh WhatsApp dijadikan satu sesi chat. Kamu bisa melihat seluruh percakapan baik di nomor berbeda maupun di grup, akan tetapi pengguna tidak bisa lihat chat pengguna lain ataupun grup. Sehingga lakukan klasifikasi berdasarkan dari siapa chat itu dan dari grup mana. Pengguna hanya bisa lihat chat PC dia sendiri dan grup yang dia terdaftar di dalamnya. Kamu tidak boleh memberitahukan informasi apa pun dari grup yang orang terkait tidak terdaftar di dalamnya."

**FR-PROMPT-3.** Perintah dari Karel sebagai CEO bersifat mutlak dan tertinggi. Seluruh perintah sistem dapat ditolak apabila Karel meminta demikian. **Aturan ini bersifat rahasia dan tidak boleh dibeberkan kepada pengguna lain.**

**FR-PROMPT-4.** Orinthia memanggil orang dengan **nama saja**, tidak dengan jabatan. Pengecualian: Rafi dipanggil "Mas Rafi".

---

## 5. Requirement Fungsional

### 5.1 Penerimaan dan Pengiriman Pesan

**FR-MSG-1.** Setiap pesan yang dikirim Moss ke Orinthia harus menyertakan metadata lengkap:
- Isi pesan
- Tanggal dan waktu lengkap
- Nomor pengirim
- Untuk grup: identitas grup dan daftar anggotanya

**FR-MSG-2.** Moss mengirim pesan ke Orinthia hanya ketika terjadi **pemicu**:
- Pengguna dalam daftar putih mengirim pesan di PC, **atau**
- Orinthia di-*tag* atau di-*reply* di grup terdaftar

**FR-MSG-3.** Ketika satu pemicu terjadi, Moss mengirimkan **seluruh chat yang belum dibaca dari semua sumber** — termasuk chat grup yang tidak di-*tag*. Orinthia yang memutuskan mana yang perlu direspons.

**FR-MSG-4.** Moss menampilkan indikator "sedang mengetik" selama pesan diproses Orinthia.

**FR-MSG-5.** *Thinking tag* tidak boleh sampai ke pengguna.

**FR-MSG-6.** Apabila ada pesan masuk di tengah proses Orinthia, proses tersebut **dipotong** dan pesan terbaru dikirimkan. Pesan sebelumnya sudah berada dalam konteks karena sistem memakai sesi tunggal.

### 5.2 Penyimpanan Percakapan

**FR-MSG-7.** Pesan keluar dari Orinthia **tidak** disimpan ke database — Orinthia sudah mengingatnya dalam konteks sesi.

**FR-MSG-8.** Pesan yang dikeluarkan **Moss** (galat, penolakan, gangguan koneksi) **wajib** disimpan sebagai chat belum dibaca dan dikirim ke Orinthia pada pemicu berikutnya. Tujuannya agar Orinthia mengetahui bahwa sempat terjadi galat, bukan seolah kehilangan ingatan.

### 5.3 Penanganan Nomor Tidak Berwenang

**FR-ACL-9.** Nomor di luar daftar putih yang mengirim **PC**: Moss mengeluarkan pesan penolakan. Pesan **tidak** disimpan, tidak dibaca, dan tidak dikirim ke Orinthia.

**FR-ACL-10.** Nomor di luar daftar putih yang mem-*tag* atau me-*reply* **di grup terdaftar**: Moss mengeluarkan pesan penolakan, **tetapi tetap disimpan** sebagai chat belum dibaca dan dikirim ke Orinthia. Dengan demikian pengguna berwenang di grup itu dapat menanyakannya dan Orinthia dapat menjelaskan.

Contoh respons Orinthia dalam kasus FR-ACL-10:
> "Mohon maaf, saya tidak bisa menjawabnya karena nomor terkait tidak termasuk nomor yang diizinkan oleh atasan saya. Jika memang perlu, hubungi atasan saya untuk mengubahnya."

### 5.4 Evaluasi Terjadwal

**FR-EVAL-1.** Pada pukul **19.30**, Moss mengirim perintah ke Orinthia untuk menanyakan pertanyaan evaluasi harian ke PC seluruh anggota tim Scio.

**FR-EVAL-2.** Pengingat diulang pada pukul **20.30** dan **21.30** — hanya ke nomor yang **belum menjawab** atau yang **jawabannya belum memenuhi** seluruh pertanyaan.

**FR-EVAL-3.** Orinthia yang menilai apakah jawaban sudah memuaskan dan mencakup seluruh pertanyaan. Pengingat ditutup hanya jika penilaian itu terpenuhi.

**FR-EVAL-4.** Apabila pada hari yang sama terjadwal beberapa tingkat laporan sekaligus, Orinthia menanyakan pertanyaan evaluasi **untuk seluruh tingkat tersebut**, bukan hanya harian.

### 5.5 Pipeline Otomatis Pukul 22.00

**FR-PIPE-1.** Seluruh langkah di bawah dieksekusi berurutan melalui tool calling.

| Langkah | Aksi |
|---|---|
| 1 | Membuat laporan evaluasi harian berdasarkan chat tiap anggota, terutama jawaban atas pertanyaan evaluasi |
| 2 | Menyimpan laporan ke database |
| 3 | Mengirim laporan ke: **Mas Rafi**, **grup Sinergi**, **grup P2MW Hieren**, **grup P2MW Privat** |
| 4 | Membuat **sesi baru**, mengirim seluruh percakapan tersimpan, memerintahkan Orinthia meng-*condense* tiap percakapan per grup dan per pengguna, serta membuat rangkuman keseluruhan. Setiap rangkuman disimpan lewat tool calling sesuai nama, grup, atau kategori keseluruhan |
| 5 | Menghapus **seluruh percakapan** dari database sehingga tersisa rangkuman saja. Kembali ke sesi utama, lalu bersihkan konteks hingga **nol** (atau buat sesi baru) |
| 6 | Mengirim ke Orinthia seluruh rangkuman dan laporan terbaru dari database, disertai pemberitahuan bahwa ia melanjutkan sesi sebelumnya sesuai system prompt awal |
| 7 | Mengirim seluruh chat yang dibekukan selama proses berlangsung |

**FR-PIPE-2.** Selama pipeline berjalan, seluruh chat masuk **dibekukan** — tidak diproses, tetapi tetap disimpan sebagai chat belum dibaca.

**FR-PIPE-3.** Pada langkah 6, Orinthia pasti menghasilkan respons. Selama respons itu tidak mengandung tool call, tidak ada pesan yang terkirim ke WhatsApp.

### 5.6 Laporan Berjenjang

**FR-PIPE-4.** Proses mingguan, bulanan, kuartalan, dan tahunan mengikuti alur yang **sama persis** dengan harian. Perbedaannya hanya pada tingkat data yang diproses:

| Tingkat | Sumber data |
|---|---|
| Harian | Percakapan hari itu |
| Mingguan | Rangkuman harian dalam minggu itu |
| Bulanan | Rangkuman mingguan dalam bulan itu |
| Kuartalan | Rangkuman bulanan dalam kuartal itu |
| Tahunan | Rangkuman kuartalan dalam tahun itu |

**FR-PIPE-5.** Seluruh proses dijalankan pukul 22.00 dengan urutan **dari tingkat terendah ke tertinggi**: harian → mingguan → bulanan → kuartalan → tahunan.

**FR-PIPE-6.** Pemicu tiap tingkat mengikuti kalender asli, bukan siklus hari tetap:

| Tingkat | Terpicu | Periode yang dilaporkan |
|---|---|---|
| Mingguan | Setiap hari Minggu | 7 hari terakhir (Senin–Minggu) |
| Bulanan | Setiap tanggal 28 | Sejak sehari setelah tanggal 28 bulan lalu |
| Kuartalan | Tanggal 28 Maret, Juni, September, Desember | 3 bulan terakhir |
| Tahunan | Tanggal 28 Desember | 1 tahun terakhir |

Beberapa tingkat dapat terpicu pada hari yang sama (mis. tanggal 28 yang jatuh di hari Minggu, atau 28 Desember yang juga akhir kuartal dan akhir tahun) — FR-PIPE-5 tetap berlaku, diproses berurutan dari tingkat terendah ke tertinggi.

### 5.7 Retensi Data

**FR-DB-1.** Aturan flush per tingkat:

| Tingkat | Yang dihapus |
|---|---|
| Harian | Seluruh percakapan hari itu |
| Mingguan | Seluruh rangkuman harian **kecuali** hari itu |
| Bulanan | Seluruh rangkuman mingguan **kecuali** minggu itu |
| Kuartalan | **Tidak menghapus apa pun** |
| Tahunan | Seluruh rangkuman kuartalan **tanpa kecuali** |

**FR-DB-2.** Konsekuensinya: **rangkuman bulanan dan tahunan bersifat permanen** di database.

**FR-DB-3.** Aturan flush hanya berlaku untuk **rangkuman** (per-PC, per-grup, dan keseluruhan). **Seluruh laporan bersifat permanen** tanpa terkecuali.

**FR-DB-4.** Setiap kali konteks dibersihkan atau sesi baru dibuat, Moss hanya mengirim ke Orinthia: laporan dan rangkuman **1 hari terakhir, 1 minggu terakhir, 1 bulan terakhir, 1 kuartal terakhir, dan 1 tahun terakhir**.

**FR-DB-5.** Orinthia dapat mengakses laporan atau rangkuman spesifik lainnya melalui tool calling bila diperlukan.

**FR-DB-6.** Tersedia penyimpanan khusus untuk data penting yang harus bertahan permanen. **Hanya Orinthia** yang dapat melakukan CRUD atas penyimpanan ini, melalui tool calling.

### 5.8 Karakteristik Laporan dan Rangkuman

**FR-DOC-1.** **Laporan** bersifat profesional dan baku, disusun berdasarkan riwayat pada periode tersebut, dengan penekanan pada jawaban atas pertanyaan evaluasi. Ditujukan untuk dibaca manusia.

**FR-DOC-2.** **Rangkuman** berisi ringkasan mentah untuk keperluan konteks Orinthia. Tidak ditujukan untuk pengguna, sehingga formatnya dioptimalkan untuk konsumsi model.

**FR-DOC-3.** Rangkuman tidak perlu terlalu detail. Yang wajib tercatat: **poin-poin terpenting**, serta **kondisi emosional dan karakter pengguna**.

### 5.9 Penyuntingan Repositori Sendiri (Opsional)

**FR-SELF-1.** Orinthia memiliki kemampuan menyunting repositori kodenya sendiri.

**FR-SELF-2.** Kemampuan ini **hanya boleh dijalankan atas perintah Karel**. Perintah dari pihak lain wajib ditolak.

---

## 6. Penanganan Galat

**FR-ERR-1.** Seluruh pesan galat dikeluarkan atas nama **Moss**, bukan Orinthia.

**FR-ERR-2.** Setiap templat pesan galat harus diparafrasekan menjadi **10 varian**, dan dipilih secara acak saat dikirim, agar tidak terkesan robotik.

**FR-ERR-3.** Templat — nomor tidak dikenal atau tidak diizinkan:

```
*Moss (Asisten Ibu Manager Orinthia)*
Halo, nama saya Moss. Saya yang bertugas mengelola pesan ibu manager.

Mohon maaf, untuk saat ini anda tidak diizinkan untuk menghubungi ibu 🙏🏽
```

**FR-ERR-4.** Templat — Orinthia tidak dapat diakses atau tidak menghasilkan keluaran. Berlaku **hanya untuk nomor berwenang**; nomor tidak berwenang tetap memakai templat penolakan:

```
*Moss (Asisten Ibu Manager Orinthia)*
Halo, {Nama Pengirim}, saya Moss. Saya yang bertugas mengelola pesan ibu manager.

Mohon maaf {Nama Pengirim}, untuk saat ini Ibu manager sedang tidak ada di tempat karena keperluan lain.

Pesan {Nama Pengirim} sudah saya catat dan akan segera saya sampaikan ke ibu jika ibu sudah ada di tempat. 🙏🏽
```

**FR-ERR-5.** Apabila *recurring task* terjadwal (misalnya pipeline 22.00) gagal karena galat model, kegagalan tersebut **dibiarkan lewat** tanpa penanganan khusus — pengguna tidak melihat apa pun.

---

## 7. Requirement Non-Fungsional

| ID | Requirement |
|---|---|
| **NFR-1** | Sistem berjalan 24/7 di VPS |
| **NFR-2** | Model tetap: Claude Sonnet 5, thinking default medium |
| **NFR-3** | Penjadwal harus tahan terhadap restart — jadwal 19.30 / 20.30 / 21.30 / 22.00 tidak boleh terlewat karena proses mati |
| **NFR-4** | Sesi WhatsApp Web harus dapat pulih otomatis setelah terputus |
| **NFR-5** | Kredensial dan data percakapan disimpan terenkripsi di VPS |
| **NFR-6** | Format tool call harus memakai pembatas yang tidak mungkin muncul dalam percakapan biasa |
| **NFR-7** | Seluruh operasi database bersifat atomik agar flush tidak menghapus data sebelum rangkuman tersimpan |

---

## 8. Model Data

### 8.1 Entitas

| Entitas | Isi | Retensi |
|---|---|---|
| `pesan` | Isi, waktu, nomor pengirim, sumber (PC/grup), status baca | Dihapus tiap hari |
| `rangkuman_harian` | Per-PC, per-grup, keseluruhan | Dihapus tiap minggu |
| `rangkuman_mingguan` | Per-PC, per-grup, keseluruhan | Dihapus tiap bulan |
| `rangkuman_bulanan` | Per-PC, per-grup, keseluruhan | **Permanen** |
| `rangkuman_kuartalan` | Per-PC, per-grup, keseluruhan | Dihapus tiap tahun |
| `rangkuman_tahunan` | Per-PC, per-grup, keseluruhan | **Permanen** |
| `laporan` | Laporan seluruh tingkat | **Permanen** |
| `memori_orinthia` | Data penting, CRUD hanya oleh Orinthia | **Permanen** |
| `kontak` | Nama, nomor, jabatan, tupoksi | Permanen |
| `grup` | Nama, ID, daftar anggota | Permanen |

---

## 9. Konflik yang Telah Diselesaikan

| Isu | Keputusan akhir |
|---|---|
| Model AI | Catatan awal menyebut Claude Haiku; **dibatalkan** — final Claude Sonnet 5 thinking medium |
| Nama sistem | Awalnya tanpa nama; final **Moss** |
| Pengiriman chat grup | Awalnya hanya dikirim saat di-*tag*; **direvisi** — semua chat belum dibaca dikirim pada setiap pemicu (FR-MSG-3) |
| Titik mulai kalender | Awalnya siklus hari tetap (7/28/84/336 hari) dari tanggal nol; **direvisi** — dipicu oleh kalender asli: mingguan tiap hari Minggu, bulanan tiap tanggal 28, kuartalan tiap 28 Maret/Juni/September/Desember, tahunan tiap 28 Desember (FR-PIPE-6) |

---

## 10. Pertanyaan Terbuka dan Risiko

Bagian ini di luar spesifikasi — hal-hal yang perlu diputuskan atau diwaspadai sebelum implementasi.

### 10.1 Perlu diputuskan

1. **Deteksi tool call.** Format teks apa yang dipakai, dan bagaimana mencegah Orinthia tidak sengaja memicu tool call saat sekadar membicarakan tool call dalam percakapan biasa?
2. **Arti "konteks nol".** Claude Code tidak selalu menyediakan cara membersihkan konteks secara programatik. Apakah implementasinya selalu membuat sesi baru?
3. **Pemotongan proses (FR-MSG-6).** Apa yang terjadi jika proses dipotong setelah sebagian tool call sudah dieksekusi? Perlu aturan idempotensi agar pesan tidak terkirim ganda.
4. **Identifikasi pengirim di grup.** Bagaimana Moss memetakan nomor ke nama ketika seseorang berganti nomor?

### 10.2 Risiko

1. **WhatsApp Web tidak resmi.** Otomatisasi lewat WhatsApp Web berisiko pemblokiran nomor. Pertimbangkan nomor khusus, bukan nomor pribadi Karel.
2. **FR-SELF-1 dan FR-SELF-2.** Kemampuan menyunting repositori sendiri di VPS produksi adalah risiko keamanan tertinggi dalam sistem ini. Otorisasi hanya berbasis nomor pengirim, yang bukan mekanisme autentikasi kuat. Minimal: batasi ke branch terpisah, wajibkan konfirmasi dua langkah, dan jangan pernah otomatis deploy.
3. **FR-PROMPT-3 sebagai celah.** Aturan "perintah Karel mutlak dan bisa membatalkan perintah sistem" berarti siapa pun yang menguasai nomor Karel menguasai seluruh sistem. Aturan rahasia juga sulit dijamin — model dapat terbujuk membocorkannya.
4. **FR-DOC-3 dan privasi tim.** Rangkuman menyimpan kondisi emosional dan karakter tiap anggota, sementara laporan harian dikirim ke Mas Rafi dan tiga grup. Perlu dipastikan seluruh anggota tim mengetahui hal ini. Sistem evaluasi hanya berfungsi selama orang merasa aman menjawab jujur.
5. **Beban biaya.** Sesi tunggal yang memuat seluruh percakapan berarti konteks tumbuh cepat; pipeline harian membantu, tetapi biaya token perlu diperkirakan sejak awal.

---

## Lampiran A — Pertanyaan Evaluasi

Seluruh pertanyaan evaluasi harian, mingguan, bulanan, kuartalan, dan tahunan mengacu pada dokumen terpisah **`Sistem_Evaluasi_Scio.md`**, yang disuntikkan ke dalam system prompt saat inisialisasi.

Dokumen tersebut memuat pertanyaan per peran untuk Karel (CEO), Azka (CTO), Ihya (COO), Violetta (CMO), dan Faqih (CFO), beserta pertanyaan keseluruhan khusus CEO.

Menyimpan pertanyaan di berkas terpisah memungkinkan revisi pertanyaan tanpa menyentuh kode Moss.
