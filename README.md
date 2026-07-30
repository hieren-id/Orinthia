# Orinthia v1 — Sistensia AI Manager

Asisten manajer berbasis AI yang beroperasi di WhatsApp untuk mendampingi operasional harian startup Scio/Sistensia.

## Arsitektur

```
WhatsApp Web
     │
     ▼
   MOSS (Node.js)
     ├── Filter hak akses  ──► tolak jika tidak berwenang
     ├── Simpan ke database (SQLite)
     ├── Penjadwal (19.30 / 20.30 / 21.30 / 22.00)
     └── Kirim ke Orinthia (Claude Code CLI)
              │
              ▼
        ORINTHIA (Claude Sonnet 5)
              │
              └── Tool calling ──► MOSS ──► WhatsApp / Database
```

**Moss** — sistem Node.js yang menjadi perantara antara WhatsApp dan Orinthia. Menangani routing, penjadwalan, database, dan pesan galat.

**Orinthia** — persona AI yang berinteraksi dengan pengguna. Dijalankan di atas Claude Code CLI dengan **sesi sungguhan** (`--session-id` saat pertama kali, `--resume` untuk melanjutkan) yang bertahan lintas pemicu — bukan proses baru yang disusun ulang dari database tiap kali, supaya Orinthia benar-benar mengingat percakapan hari itu, bukan cuma rangkuman. Sesi direset otomatis oleh pipeline 22.00 setiap kali suatu tingkat selesai di-flush (lihat `src/core/claude.js`). Tidak dapat mengirim pesan langsung — semua keluaran ke WhatsApp hanya melalui tool calling.

## Tech Stack

| Lapisan | Teknologi |
|---|---|
| Model AI | Claude Sonnet 5, thinking mode medium |
| Runtime AI | Claude Code CLI (v2.1.177+) |
| Sistem | Node.js (Moss) |
| Antarmuka pesan | WhatsApp Web (Baileys) |
| Basis data | SQLite (better-sqlite3) |
| Penjadwal | node-cron |
| Deployment | VPS |

## Instalasi

```bash
git clone <repo-url>
cd Orinthia
npm install
```

## Konfigurasi

### 1. Environment Variables

Salin `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

Isi nilai di `.env`:

```env
OWNER_NUMBER=628978535411
TZ=Asia/Jakarta
```

| Variable | Keterangan |
|---|---|
| `OWNER_NUMBER` | Nomor WhatsApp Karel (CEO) |
| `TZ` | Timezone untuk scheduler |

### 2. Kontak dan Grup

Edit `src/config/index.js` untuk mengubah daftar putih kontak dan grup. Nomor harus dalam format internasional (628xxx).

Group ID diisi setelah scan QR dan terhubung ke WhatsApp. ID bisa didapat dari log Baileys saat pesan grup masuk.

### 3. Claude Code CLI

Pastikan Claude Code CLI sudah terinstall dan terlogin:

```bash
claude --version
claude login
```

## Menjalankan

```bash
npm start
```

Scan QR code yang muncul di terminal menggunakan WhatsApp.

Mode development (auto-restart saat file berubah):

```bash
npm run dev
```

## Kontrol Sistem

Karel (CEO) dapat mengontrol sistem langsung dari WhatsApp:

| Command | Fungsi |
|---|---|
| `/on` | Mengaktifkan Orinthia — pesan diproses dan diteruskan ke Claude |
| `/off` | Menonaktifkan Orinthia — pesan tetap disimpan tetapi tidak diproses |

Sistem dalam keadaan **aktif** secara default saat pertama kali dijalankan. Status aktif/nonaktif tersimpan di database dan bertahan meski proses di-restart — kirim `/off` untuk menjeda seluruh pemrosesan (termasuk evaluasi terjadwal, pengingat, dan pipeline 22.00), `/on` untuk mengaktifkan kembali. Pesan yang masuk selama nonaktif tetap disimpan, tidak diproses.

## Fitur

### Pesan
- **PC dari nomor berwenang** → diterima, disimpan, diteruskan ke Orinthia
- **PC dari nomor tidak berwenang** → ditolak oleh Moss, tidak disimpan
- **Grup (tag/reply)** → diterima jika pengirim berwenang
- **Grup (tanpa tag)** → disimpan saja, tidak ada respons
- **Indikator freeze** selama pipeline berjalan

### Evaluasi Terjadwal
Hanya pipeline **22.00** yang hardcoded (laporan → condense → flush → restore) — langkahnya bukan sesuatu yang aman diserahkan ke instruksi bahasa natural.

Penanyaan/pengingat evaluasi (dulunya hardcoded jam 19.30/20.30/21.30) sekarang adalah baris `berulang` di tabel `pengingat`, di-seed otomatis sekali saat pertama kali dijalankan (lihat `src/scheduler/reminders.js`, `DEFAULT_REMINDERS`):

| Jadwal (cron) | Terpicu | Isi |
|---|---|---|
| `30 19 * * *` | tiap hari 19.30 | reset status hari ini, tanya evaluasi harian |
| `30 19 * * 0` | tiap Minggu 19.30 | tanya evaluasi mingguan (tambahan) |
| `30 19 28 * *` | tiap tanggal 28, 19.30 | tanya evaluasi bulanan (tambahan) |
| `30 19 28 3,6,9,12 *` | 28 Maret/Jun/Sep/Des, 19.30 | tanya evaluasi kuartalan (tambahan) |
| `30 19 28 12 *` | 28 Desember, 19.30 | tanya evaluasi tahunan (tambahan) |
| `30 20 * * *` | tiap hari 20.30 | cek GET_EVAL_STATUS, ingatkan yang belum selesai |
| `30 21 * * *` | tiap hari 21.30 | pengingat terakhir, sama seperti di atas |

Karena tiap tingkat evaluasi punya jadwal cron sendiri (bukan satu pengingat gabungan yang minta Orinthia menghitung sendiri tingkat mana yang jatuh tempo), tidak ada ambiguitas soal tingkat mana yang seharusnya ditanyakan hari itu — jadwalnya sendiri yang menentukan, bukan penilaian model.

Karel (lewat Orinthia) bisa mengubah, menambah, atau membatalkan pengingat ini kapan saja lewat `CREATE_REMINDER`/`CANCEL_REMINDER`/`LIST_REMINDERS` — lihat bagian Tool Calling di bawah.

### Pipeline Berjenjang
Sistem evaluasi dan laporan berjenjang, dipicu berdasarkan kalender asli (bukan siklus hari tetap):

| Tingkat | Terpicu | Sumber data |
|---|---|---|
| Harian | Setiap hari, pukul 22.00 | Percakapan hari itu |
| Mingguan | Setiap hari Minggu | Rangkuman harian |
| Bulanan | Setiap tanggal 28 | Rangkuman mingguan |
| Kuartalan | Tanggal 28 Maret/Juni/September/Desember | Rangkuman bulanan |
| Tahunan | Tanggal 28 Desember | Rangkuman kuartalan |

Beberapa tingkat bisa terpicu di hari yang sama (mis. tanggal 28 yang jatuh di hari Minggu, atau 28 Desember yang juga akhir kuartal dan akhir tahun) — pipeline tetap memprosesnya berurutan dari tingkat terendah ke tertinggi.

**Laporan 3 tier.** Tiap laporan dibuat dalam 3 versi sekaligus (isi sama secara garis besar, beda tingkat detail/nada), dikirim ke penerima berbeda — deterministik lewat `config.REPORT_RECIPIENTS`, bukan bergantung pada Orinthia mengingat siapa saja yang perlu di-REPLY:

| Tier | Detail | Nada | Penerima |
|---|---|---|---|
| `detail` | Paling rinci | Bebas | Grup P2MW Privat |
| `standar` | Rinci | Formal/profesional | Mas Rafi, grup P2MW Hieren |
| `umum` | Garis besar saja | — | Grup Sinergi |

### Tool Calling
Orinthia berkomunikasi dengan dunia luar melalui format teks khusus:

```
<<MOSS|COMMAND|param1|param2>>
```

| Command | Keterangan |
|---|---|
| `REPLY` | Kirim pesan ke target |
| `STORE_REPORT` | Simpan laporan (3 tier: detail/standar/umum — lihat Pipeline Berjenjang) |
| `STORE_SUMMARY` | Simpan rangkuman |
| `GET_SUMMARY` | Ambil rangkuman dari DB |
| `GET_REPORT` | Ambil laporan dari DB |
| `STORE_MEMORY` | Simpan memori permanen |
| `GET_MEMORY` | Ambil memori permanen |
| `DELETE_MEMORY` | Hapus memori permanen |
| `REQUEST_REVISION` | Ajukan revisi hardcode |
| `UPDATE_EVAL` | Perbarui status evaluasi seseorang |
| `GET_EVAL_STATUS` | Cek status evaluasi seluruh tim untuk suatu tanggal |
| `FLUSH` | Flush data sesuai retensi |
| `CREATE_REMINDER` | Buat pengingat untuk diri sendiri (sekali atau berulang/cron) |
| `LIST_REMINDERS` | Lihat daftar pengingat aktif |
| `CANCEL_REMINDER` | Batalkan pengingat aktif |

### Revisi Hardcode
Ketika Karel meminta perubahan yang menyangkut data hardcode (system prompt, kontak, grup, jadwal), Orinthia menyimpannya ke tabel `revisi_hardcode`. Revisi diterapkan pada update berikutnya.

### Retensi Data

| Tingkat | Yang dihapus |
|---|---|
| Harian | Seluruh percakapan hari itu |
| Mingguan | Rangkuman harian kecuali hari ini |
| Bulanan | Rangkuman mingguan kecuali minggu ini |
| Kuartalan | Tidak menghapus apa pun |
| Tahunan | Seluruh rangkuman kuartalan |

Memori Orinthia bersifat **permanen**. Laporan: hanya tier **`detail`** yang permanen (acuan utama) — tier `standar` dan `umum` dihapus segera setelah terkirim, karena isinya sudah terwakili oleh tier `detail`.

## Struktur File

```
├── index.js                         ← entry point
├── package.json
├── .env                             ← environment variables (gitignored)
├── SRS_Orinthia_v1.md               ← spesifikasi sistem
├── Orinthia_Persona_dan_Konteks.md  ← persona & system prompt static
├── Sistem_Evaluasi_Scio.md          ← pertanyaan evaluasi
└── src/
    ├── config/index.js              ← whitelist kontak/grup, jadwal, kalender
    ├── core/
    │   ├── db.js                    ← SQLite schema & CRUD
    │   ├── whatsapp.js              ← Baileys client
    │   └── claude.js                ← Claude Code CLI wrapper
    ├── moss/
    │   ├── messageHandler.js        ← routing pesan masuk
    │   ├── toolParser.js            ← parse tool calls
    │   ├── toolExecutor.js          ← eksekusi tool calls
    │   ├── pipeline.js              ← pipeline 22.00
    │   └── retention.js             ← retensi data & period calculation
    ├── orinthia/
    │   ├── promptBuilder.js         ← assemble system prompt
    │   └── contextManager.js        ← manage conversation context
    ├── scheduler/
    │   ├── index.js                  ← cron: pipeline 22.00 (satu-satunya jadwal tetap)
    │   └── reminders.js              ← pengingat sekali/berulang, CRUD via tool calling
    ├── acl/index.js                 ← access control
    └── utils/
        ├── logger.js                ← logging
        └── errors.js                ← error message templates
```

## Dokumen Referensi

- **SRS_Orinthia_v1.md** — Software Requirements Specification lengkap
- **Orinthia_Persona_dan_Konteks.md** — persona, latar belakang Scio/Hieren/tim, karakter Orinthia
- **Sistem_Evaluasi_Scio.md** — pertanyaan evaluasi harian/mingguan/bulanan/kuartalan/tahunan per peran
