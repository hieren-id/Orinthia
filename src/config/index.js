require('dotenv').config();

const TIMEZONE = process.env.TZ || 'Asia/Jakarta';
const SYSTEM_START_DATE = process.env.SYSTEM_START_DATE || new Date().toISOString().split('T')[0];
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';

const WHITELISTED_NUMBERS = [
  { nama: 'Karel', nomor: process.env.NO_KAREL || '', jabatan: 'CEO', tupoksi: 'Otoritas tertinggi, riset dan pengembangan AI, pengajuan CSR, legalitas, evaluasi laporan. Satu-satunya yang bekerja penuh waktu.' },
  { nama: 'Mas Rafi', nomor: process.env.NO_RAFI || '', jabatan: 'Stakeholder (Hieren)', tupoksi: 'Penghubung utama dari PT Hieren Astara Daya. Penerima laporan berkala.' },
  { nama: 'Tata', nomor: process.env.NO_TATA || '', jabatan: 'CMO', tupoksi: 'Validasi pasar, promosi, konten media sosial, penyusunan company profile.' },
  { nama: 'Ihya', nomor: process.env.NO_IHYA || '', jabatan: 'COO', tupoksi: 'Pengujian alat, prototipe, dan produksi. Sedang KKN + magang, hanya manajerial jarak jauh.' },
  { nama: 'Azka', nomor: process.env.NO_AZKA || '', jabatan: 'CTO', tupoksi: 'Pengembangan perangkat lunak full-stack, integrasi perangkat, pemeliharaan. Bekerja sambil kuliah.' },
  { nama: 'Faqih', nomor: process.env.NO_FAQIH || '', jabatan: 'CFO', tupoksi: 'Keuangan, pembukuan, pelaporan penggunaan dana P2MW.' },
].filter(c => c.nomor);

const WHITELISTED_GROUPS = [
  { nama: 'Sinergi', group_id: process.env.GROUP_SINERGI || '', anggota: [] },
  { nama: 'P2MW Hieren', group_id: process.env.GROUP_P2MW_HIEREN || '', anggota: [] },
  { nama: 'P2MW Privat', group_id: process.env.GROUP_P2MW_PRIVAT || '', anggota: [] },
].filter(g => g.group_id);

const SCHEDULE_TIMES = {
  daily_eval: '30 19 * * *',
  reminder_1: '30 20 * * *',
  reminder_2: '30 21 * * *',
  pipeline: '0 22 * * *',
};

const REPORT_RECIPIENTS = {
  pc: ['Mas Rafi'],
  groups: ['Sinergi', 'P2MW Hieren', 'P2MW Privat'],
};

const CALENDAR = {
  week: 7,
  month: 28,
  quarter: 84,
  year: 336,
};

module.exports = {
  TIMEZONE,
  SYSTEM_START_DATE,
  OWNER_NUMBER,
  WHITELISTED_NUMBERS,
  WHITELISTED_GROUPS,
  SCHEDULE_TIMES,
  REPORT_RECIPIENTS,
  CALENDAR,
};
