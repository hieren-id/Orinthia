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

**Orinthia** — persona AI yang berinteraksi dengan pengguna. Dijalankan di atas Claude Code CLI. Tidak dapat mengirim pesan langsung — semua keluaran ke WhatsApp hanya melalui tool calling.

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
SYSTEM_START_DATE=2026-07-29
```

| Variable | Keterangan |
|---|---|
| `OWNER_NUMBER` | Nomor WhatsApp Karel (CEO) |
| `TZ` | Timezone untuk scheduler |
| `SYSTEM_START_DATE` | Tanggal nol untuk perhitungan siklus evaluasi (7/28/84/336 hari) |

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
- **Typing indicator** selama Orinthia memproses
- **Indikator freeze** selama pipeline berjalan

### Evaluasi Terjadwal
- **19.30** — pertanyaan evaluasi dikirim ke seluruh anggota tim
- **20.30** — pengingat pertama ke yang belum menjawab
- **21.30** — pengingat terakhir
- **22.00** — pipeline otomatis: laporan → condense → flush → restore

### Pipeline Berjenjang
Sistem evaluasi dan laporan berjenjang berdasarkan siklus kalender:

| Tingkat | Periode | Sumber data |
|---|---|---|
| Harian | 1 hari | Percakapan hari itu |
| Mingguan | 7 hari | Rangkuman harian |
| Bulanan | 28 hari | Rangkuman mingguan |
| Kuartalan | 84 hari | Rangkuman bulanan |
| Tahunan | 336 hari | Rangkuman kuartalan |

### Tool Calling
Orinthia berkomunikasi dengan dunia luar melalui format teks khusus:

```
<<MOSS|COMMAND|param1|param2>>
```

| Command | Keterangan |
|---|---|
| `REPLY` | Kirim pesan ke target |
| `STORE_REPORT` | Simpan laporan |
| `STORE_SUMMARY` | Simpan rangkuman |
| `GET_SUMMARY` | Ambil rangkuman dari DB |
| `GET_REPORT` | Ambil laporan dari DB |
| `STORE_MEMORY` | Simpan memori permanen |
| `GET_MEMORY` | Ambil memori permanen |
| `DELETE_MEMORY` | Hapus memori permanen |
| `REQUEST_REVISION` | Ajukan revisi hardcode |
| `FLUSH` | Flush data sesuai retensi |

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

Laporan dan memori Orinthia bersifat **permanen**.

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
    ├── scheduler/index.js           ← cron jobs
    ├── acl/index.js                 ← access control
    └── utils/
        ├── logger.js                ← logging
        └── errors.js                ← error message templates
```

## Dokumen Referensi

- **SRS_Orinthia_v1.md** — Software Requirements Specification lengkap
- **Orinthia_Persona_dan_Konteks.md** — persona, latar belakang Scio/Hieren/tim, karakter Orinthia
- **Sistem_Evaluasi_Scio.md** — pertanyaan evaluasi harian/mingguan/bulanan/kuartalan/tahunan per peran
