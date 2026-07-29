const db = require('../core/db');
const acl = require('../acl');

function buildMessagePrompt(unreadMessages, ctx) {
  const sections = [];

  sections.push(`Waktu sekarang: ${formatDateTime(new Date())}`);

  const summariesSection = buildRecentSummaries();
  if (summariesSection) sections.push(summariesSection);

  const reportsSection = buildRecentReports();
  if (reportsSection) sections.push(reportsSection);

  const memorySection = buildMemorySection();
  if (memorySection) sections.push(memorySection);

  const revisionSection = buildPendingRevisions();
  if (revisionSection) sections.push(revisionSection);

  const contactsSection = buildContactsSection();
  if (contactsSection) sections.push(contactsSection);

  const groupsSection = buildGroupsSection();
  if (groupsSection) sections.push(groupsSection);

  if (unreadMessages.length > 0) {
    sections.push(buildUnreadSection(unreadMessages));
  }

  return sections.join('\n\n---\n\n');
}

function buildRecentSummaries() {
  const levels = ['harian', 'mingguan', 'bulanan', 'kuartalan', 'tahunan'];
  const parts = [];
  for (const level of levels) {
    const summaries = db.getLatestSummaries(level, 5);
    if (summaries.length > 0) {
      const formatted = summaries.map(s =>
        `[${s.nama_scope || s.scope}] ${s.periode_start} — ${s.periode_end}\n${s.konten}`
      ).join('\n\n');
      parts.push(`### Rangkuman ${level}\n${formatted}`);
    }
  }
  return parts.length > 0 ? `## Rangkuman Terbaru\n${parts.join('\n\n')}` : '';
}

function buildRecentReports() {
  // Each level now has up to 3 tier variants (detail/standar/umum) stored
  // moments apart with the same periode_end, so a plain "latest report"
  // query would return whichever tier happens to sort first — ambiguous.
  // Show her the "detail" tier specifically: the most complete version, and
  // the one she'd want as her own context regardless of what each external
  // recipient was shown.
  const levels = ['harian', 'mingguan', 'bulanan', 'kuartalan', 'tahunan'];
  const parts = [];
  for (const level of levels) {
    const report = db.getLatestReportByTier(level, 'detail');
    if (report) {
      parts.push(`### Laporan ${level} terakhir (${report.periode_start} — ${report.periode_end})\n${report.konten}`);
    }
  }
  return parts.length > 0 ? `## Laporan Terbaru\n${parts.join('\n\n')}` : '';
}

function buildMemorySection() {
  const memories = db.getAllMemory();
  if (memories.length === 0) return '';
  const formatted = memories.map(m => `- **${m.kunci}**: ${m.nilai}`).join('\n');
  return `## Memori Orinthia\n${formatted}`;
}

function buildPendingRevisions() {
  const revisions = db.getPendingRevisions();
  if (revisions.length === 0) return '';
  const formatted = revisions.map(r =>
    `- [${r.tipe}] ${r.target}: ${r.deskripsi}\n  Konten baru: ${r.konten_baru}`
  ).join('\n');
  return `## Revisi Pending\n${formatted}`;
}

function buildContactsSection() {
  const contacts = db.getAllContacts();
  const formatted = contacts.map(c =>
    `- ${c.nama} (${c.jabatan}): ${c.nomor}\n  Tupoksi: ${c.tupoksi}`
  ).join('\n');
  return `## Daftar Putih Personal Chat\n${formatted}`;
}

function buildGroupsSection() {
  const groups = db.getAllGroups();
  const formatted = groups.map(g => {
    let anggota = '[]';
    try {
      const parsed = typeof g.anggota === 'string' ? JSON.parse(g.anggota) : g.anggota;
      anggota = parsed.map(a => `${a.nama} (${a.nomor})`).join(', ') || 'belum ada anggota';
    } catch {}
    const namaAsli = g.nama_asli && g.nama_asli !== g.nama ? ` (nama asli WhatsApp: "${g.nama_asli}")` : '';
    return `- ${g.nama}${namaAsli} [ID: ${g.group_id}]\n  Anggota: ${anggota}`;
  }).join('\n');
  return `## Daftar Putih Grup\n${formatted}`;
}

function buildUnreadSection(messages) {
  const bySource = {};
  for (const msg of messages) {
    const key = msg.sumber === 'pc'
      ? `PC: ${msg.nama_pengirim || msg.nomor_pengirim}`
      : `Grup: ${msg.sumber_nama || msg.sumber_id}`;
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(msg);
  }

  const parts = [];
  for (const [source, msgs] of Object.entries(bySource)) {
    const formatted = msgs.map(m =>
      `[${formatTime(new Date(m.waktu))}] ${m.nama_pengirim || m.nomor_pengirim}: ${m.isi}`
    ).join('\n');
    parts.push(`### ${source}\n${formatted}`);
  }

  return `## Pesan Belum Dibaca\n${parts.join('\n\n')}`;
}

function formatDateTime(d) {
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' });
}

function formatTime(d) {
  return d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
}

module.exports = { buildMessagePrompt };
