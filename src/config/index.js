require('dotenv').config();

const TIMEZONE = process.env.TZ || 'Asia/Jakarta';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';

const WHITELISTED_NUMBERS = [
  { nama: 'Karel', nomor: process.env.NO_KAREL || '', jabatan: 'CEO', tupoksi: 'Otoritas tertinggi, riset dan pengembangan AI, pengajuan CSR, legalitas, evaluasi laporan. Satu-satunya yang bekerja penuh waktu.' },
  { nama: 'Mas Rafi', nomor: process.env.NO_RAFI || '', jabatan: 'Stakeholder (Hieren)', tupoksi: 'Penghubung utama dari PT Hieren Astara Daya. Penerima laporan berkala.' },
  { nama: 'Tata', nomor: process.env.NO_TATA || '', jabatan: 'CMO', tupoksi: 'Validasi pasar, promosi, konten media sosial, penyusunan company profile.' },
  { nama: 'Ihya', nomor: process.env.NO_IHYA || '', jabatan: 'COO', tupoksi: 'Pengujian alat, prototipe, dan produksi. Sedang KKN + magang, hanya manajerial jarak jauh.' },
  { nama: 'Azka', nomor: process.env.NO_AZKA || '', jabatan: 'CTO', tupoksi: 'Pengembangan perangkat lunak full-stack, integrasi perangkat, pemeliharaan. Bekerja sambil kuliah.' },
  { nama: 'Faqih', nomor: process.env.NO_FAQIH || '', jabatan: 'CFO', tupoksi: 'Keuangan, pembukuan, pelaporan penggunaan dana P2MW.' },
].filter(c => c.nomor);

// Tidak difilter berdasarkan group_id: entri tanpa group_id tetap perlu ada di sini
// agar auto-registrasi grup (messageHandler.js) bisa mencocokkan nama grup WhatsApp
// terhadap daftar putih sebelum group_id-nya diketahui.
const WHITELISTED_GROUPS = [
  { nama: 'Sinergi', group_id: process.env.GROUP_SINERGI || '', anggota: [] },
  { nama: 'P2MW Hieren', group_id: process.env.GROUP_P2MW_HIEREN || '', anggota: [] },
  { nama: 'P2MW Privat', group_id: process.env.GROUP_P2MW_PRIVAT || '', anggota: [] },
];

// Evaluasi harian/mingguan/bulanan/kuartalan/tahunan dan pengingatnya bukan
// lagi jadwal tetap di sini — itu sekarang baris di tabel `pengingat`
// (lihat scheduler/reminders.js: DEFAULT_REMINDERS, di-seed sekali saat
// pertama kali dijalankan), supaya bisa diubah lewat CREATE_REMINDER/
// CANCEL_REMINDER tanpa deploy kode. Pipeline 22.00 tetap hardcoded di sini
// karena langkahnya (laporan → condense → flush → restore) bukan sesuatu
// yang aman diserahkan ke instruksi bahasa natural.
const SCHEDULE_TIMES = {
  pipeline: '0 22 * * *',
};

// Laporan yang sama isinya secara garis besar, tapi ditulis dalam 3 tingkat
// detail berbeda per audiens: P2MW Privat (internal) dapat versi paling
// rinci; Mas Rafi dan P2MW Hieren dapat versi standar formal/profesional;
// Sinergi dapat versi umum (tidak rinci). Lihat FR-PIPE-1 di SRS dan
// promptBuilder.js untuk instruksi lengkap ke Orinthia soal masing-masing.
const REPORT_RECIPIENTS = {
  detail: ['P2MW Privat'],
  standar: ['Mas Rafi', 'P2MW Hieren'],
  umum: ['Sinergi'],
};

module.exports = {
  TIMEZONE,
  OWNER_NUMBER,
  WHITELISTED_NUMBERS,
  WHITELISTED_GROUPS,
  SCHEDULE_TIMES,
  REPORT_RECIPIENTS,
};
