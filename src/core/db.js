const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let db;

function initDatabase() {
  const dbPath = path.join(__dirname, '..', '..', 'data', 'orinthia.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  migrateSchema();
  dedupeGroups();
  seedData();
  return db;
}

// Handles upgrading a database created before a column existed.
// CREATE TABLE IF NOT EXISTS above is a no-op on an existing table.
function migrateSchema() {
  const kontakColumns = db.prepare(`PRAGMA table_info(kontak)`).all().map(c => c.name);
  if (!kontakColumns.includes('last_jid')) {
    db.exec(`ALTER TABLE kontak ADD COLUMN last_jid TEXT`);
  }
  const grupColumns = db.prepare(`PRAGMA table_info(grup)`).all().map(c => c.name);
  if (!grupColumns.includes('nama_asli')) {
    db.exec(`ALTER TABLE grup ADD COLUMN nama_asli TEXT`);
  }
  const laporanColumns = db.prepare(`PRAGMA table_info(laporan)`).all().map(c => c.name);
  if (!laporanColumns.includes('tier')) {
    db.exec(`ALTER TABLE laporan ADD COLUMN tier TEXT NOT NULL DEFAULT 'standar'`);
  }
}

function getDb() {
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pesan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isi TEXT NOT NULL,
      waktu DATETIME NOT NULL,
      nomor_pengirim TEXT NOT NULL,
      nama_pengirim TEXT,
      sumber TEXT NOT NULL CHECK(sumber IN ('pc', 'grup')),
      sumber_id TEXT,
      sumber_nama TEXT,
      status_baca INTEGER DEFAULT 0,
      dibekukan INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rangkuman (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('harian','mingguan','bulanan','kuartalan','tahunan')),
      scope TEXT NOT NULL,
      nama_scope TEXT,
      konten TEXT NOT NULL,
      periode_start DATE NOT NULL,
      periode_end DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rangkuman_level_scope ON rangkuman(level, scope, periode_end DESC);

    CREATE TABLE IF NOT EXISTS laporan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('harian','mingguan','bulanan','kuartalan','tahunan')),
      tier TEXT NOT NULL DEFAULT 'standar' CHECK(tier IN ('detail','standar','umum')),
      konten TEXT NOT NULL,
      periode_start DATE NOT NULL,
      periode_end DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memori_orinthia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunci TEXT UNIQUE NOT NULL,
      nilai TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS kontak (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nomor TEXT UNIQUE NOT NULL,
      jabatan TEXT,
      tupoksi TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS grup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nama_asli TEXT,
      group_id TEXT UNIQUE NOT NULL,
      anggota TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduler_status (
      job_name TEXT PRIMARY KEY,
      last_run DATETIME,
      last_status TEXT CHECK(last_status IN ('success','failed','skipped')),
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluasi_harian (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal DATE NOT NULL,
      nomor TEXT NOT NULL,
      status TEXT DEFAULT 'belum' CHECK(status IN ('belum','sebagian','selesai')),
      jawaban TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tanggal, nomor)
    );

    CREATE TABLE IF NOT EXISTS revisi_hardcode (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipe TEXT NOT NULL CHECK(tipe IN ('system_prompt','kontak','grup','jadwal','evaluasi','aturan_acl','persona','lainnya')),
      target TEXT NOT NULL,
      deskripsi TEXT NOT NULL,
      konten_baru TEXT NOT NULL,
      diminta_oleh TEXT NOT NULL,
      waktu_diminta DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','diterapkan','ditolak')),
      waktu_diterapkan DATETIME,
      catatan TEXT
    );

    CREATE TABLE IF NOT EXISTS pesan_keluar (
      hash TEXT PRIMARY KEY,
      target TEXT,
      waktu DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_state (
      kunci TEXT PRIMARY KEY,
      nilai TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pengingat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipe TEXT NOT NULL CHECK(tipe IN ('sekali','berulang')),
      jadwal TEXT NOT NULL,
      pesan TEXT NOT NULL,
      status TEXT DEFAULT 'aktif' CHECK(status IN ('aktif','selesai','dibatalkan')),
      dibuat_oleh TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_run DATETIME
    );
  `);
}

function seedData() {
  const insertKontak = db.prepare(`INSERT OR IGNORE INTO kontak (nama, nomor, jabatan, tupoksi) VALUES (?, ?, ?, ?)`);
  for (const c of config.WHITELISTED_NUMBERS) {
    insertKontak.run(c.nama, c.nomor, c.jabatan, c.tupoksi);
  }

  // nama has no UNIQUE constraint (group_id does), so a plain INSERT OR
  // IGNORE only guards against re-inserting the exact same group_id — it
  // does NOT stop a fresh row from being created for a nama that already
  // exists under a different group_id. That happened for real: a group
  // whose group_id had been auto-repaired to its real WhatsApp ID got a
  // second, duplicate row re-seeded from the still-unfixed .env value on
  // the next restart, and the two rows sharing one nama then broke the
  // by-nama repair UPDATE. Skip entirely if a row for this nama exists —
  // never let a stale .env placeholder overwrite or duplicate real data.
  const getGrupByNama = db.prepare(`SELECT id FROM grup WHERE nama = ?`);
  const insertGrup = db.prepare(`INSERT INTO grup (nama, group_id, anggota) VALUES (?, ?, ?)`);
  for (const g of config.WHITELISTED_GROUPS) {
    if (!g.group_id) continue;
    if (getGrupByNama.get(g.nama)) continue;
    try {
      insertGrup.run(g.nama, g.group_id, JSON.stringify(g.anggota));
    } catch {} // group_id collision (e.g. placeholder reused) — leave existing row alone
  }
}

// One-off cleanup for rows created by the seedData bug above, before it was
// fixed: keeps the row with the most complete/valid data per nama (a
// numeric-looking group_id wins, then nama_asli set, then lowest id — the
// original), deletes the rest.
function dedupeGroups() {
  const groups = db.prepare(`SELECT * FROM grup`).all();
  const byNama = new Map();
  for (const g of groups) {
    const existing = byNama.get(g.nama);
    if (!existing) { byNama.set(g.nama, g); continue; }
    const gLooksValid = /^\d+(-\d+)?$/.test(g.group_id);
    const existingLooksValid = /^\d+(-\d+)?$/.test(existing.group_id);
    const better = gLooksValid !== existingLooksValid
      ? (gLooksValid ? g : existing)
      : (!!g.nama_asli !== !!existing.nama_asli ? (g.nama_asli ? g : existing) : (g.id < existing.id ? g : existing));
    byNama.set(g.nama, better);
  }
  const keepIds = new Set([...byNama.values()].map(g => g.id));
  const toDelete = groups.filter(g => !keepIds.has(g.id));
  if (toDelete.length > 0) {
    const del = db.prepare(`DELETE FROM grup WHERE id = ?`);
    for (const g of toDelete) del.run(g.id);
  }
  return toDelete;
}

// ─── Pesan ───

function insertMessage({ isi, waktu, nomor_pengirim, nama_pengirim, sumber, sumber_id, sumber_nama, dibekukan = 0 }) {
  return db.prepare(`
    INSERT INTO pesan (isi, waktu, nomor_pengirim, nama_pengirim, sumber, sumber_id, sumber_nama, dibekukan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(isi, waktu, nomor_pengirim, nama_pengirim, sumber, sumber_id, sumber_nama, dibekukan);
}

function getUnreadMessages() {
  return db.prepare(`SELECT * FROM pesan WHERE status_baca = 0 AND dibekukan = 0 ORDER BY waktu ASC`).all();
}

function markAsRead(ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pesan SET status_baca = 1 WHERE id IN (${placeholders})`).run(...ids);
}

function freezeIncoming() {
  db.prepare(`UPDATE pesan SET dibekukan = 1 WHERE status_baca = 0 AND dibekukan = 0`).run();
}

function getQueuedFrozenMessages() {
  return db.prepare(`SELECT * FROM pesan WHERE dibekukan = 1 ORDER BY waktu ASC`).all();
}

function unfreezeMessages() {
  db.prepare(`UPDATE pesan SET dibekukan = 0 WHERE dibekukan = 1`).run();
}

function deleteTodaysMessages() {
  db.prepare(`DELETE FROM pesan WHERE DATE(created_at) = DATE('now')`).run();
}

function getAllTodaysMessages() {
  return db.prepare(`SELECT * FROM pesan WHERE DATE(created_at) = DATE('now') ORDER BY waktu ASC`).all();
}

// ─── Rangkuman ───

function insertSummary(level, scope, nama_scope, konten, periode_start, periode_end) {
  return db.prepare(`
    INSERT INTO rangkuman (level, scope, nama_scope, konten, periode_start, periode_end)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(level, scope, nama_scope, konten, periode_start, periode_end);
}

function getLatestSummaries(level, limit = 50) {
  return db.prepare(`
    SELECT * FROM rangkuman WHERE level = ?
    ORDER BY periode_end DESC LIMIT ?
  `).all(level, limit);
}

function getLatestSummary(level, scope) {
  return db.prepare(`
    SELECT * FROM rangkuman WHERE level = ? AND scope = ?
    ORDER BY periode_end DESC LIMIT 1
  `).get(level, scope);
}

function deleteOldSummaries(level, before_date) {
  return db.prepare(`DELETE FROM rangkuman WHERE level = ? AND periode_end < ?`).run(level, before_date);
}

// ─── Laporan ───

function insertReport(level, tier, konten, periode_start, periode_end) {
  return db.prepare(`
    INSERT INTO laporan (level, tier, konten, periode_start, periode_end)
    VALUES (?, ?, ?, ?, ?)
  `).run(level, tier, konten, periode_start, periode_end);
}

function getLatestReports(level, limit = 5) {
  return db.prepare(`
    SELECT * FROM laporan WHERE level = ?
    ORDER BY periode_end DESC LIMIT ?
  `).all(level, limit);
}

// One row per tier (detail/standar/umum) — plain getLatestReports(level, 1)
// would only surface whichever tier happens to sort first for the same
// periode_end, since all three are written moments apart in the same run.
function getLatestReportByTier(level, tier) {
  return db.prepare(`
    SELECT * FROM laporan WHERE level = ? AND tier = ?
    ORDER BY periode_end DESC LIMIT 1
  `).get(level, tier);
}

function getReport(level, periode_end, tier = 'standar') {
  return db.prepare(`
    SELECT * FROM laporan WHERE level = ? AND periode_end = ? AND tier = ?
  `).get(level, periode_end, tier);
}

// ─── Memori Orinthia ───

function setMemory(kunci, nilai) {
  return db.prepare(`
    INSERT INTO memori_orinthia (kunci, nilai, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = CURRENT_TIMESTAMP
  `).run(kunci, nilai);
}

function getMemory(kunci) {
  return db.prepare(`SELECT * FROM memori_orinthia WHERE kunci = ?`).get(kunci);
}

function getAllMemory() {
  return db.prepare(`SELECT * FROM memori_orinthia ORDER BY kunci ASC`).all();
}

function deleteMemory(kunci) {
  return db.prepare(`DELETE FROM memori_orinthia WHERE kunci = ?`).run(kunci);
}

// ─── Kontak & Grup ───

function getAllContacts() {
  return db.prepare(`SELECT * FROM kontak ORDER BY nama ASC`).all();
}

function getContactByNumber(nomor) {
  return db.prepare(`SELECT * FROM kontak WHERE nomor = ?`).get(nomor);
}

// Records the exact JID WhatsApp used to deliver this contact's last message
// (which can be @lid instead of @s.whatsapp.net under phone-number privacy)
// so replies address the same session rather than a reconstructed JID.
function updateContactJid(nomor, jid) {
  return db.prepare(`UPDATE kontak SET last_jid = ? WHERE nomor = ?`).run(jid, nomor);
}

function getAllGroups() {
  return db.prepare(`SELECT * FROM grup ORDER BY nama ASC`).all();
}

function getGroupByName(nama) {
  return db.prepare(`SELECT * FROM grup WHERE nama = ?`).get(nama);
}

function getGroupById(group_id) {
  return db.prepare(`SELECT * FROM grup WHERE group_id = ?`).get(group_id);
}

function registerGroup(nama, group_id, anggota = [], nama_asli = null) {
  const existing = db.prepare(`SELECT * FROM grup WHERE nama = ?`).get(nama);
  if (existing) {
    return db.prepare(`UPDATE grup SET group_id = ?, anggota = ?, nama_asli = COALESCE(?, nama_asli) WHERE nama = ?`).run(group_id, JSON.stringify(anggota), nama_asli, nama);
  }
  return db.prepare(`INSERT INTO grup (nama, group_id, anggota, nama_asli) VALUES (?, ?, ?, ?)`).run(nama, group_id, JSON.stringify(anggota), nama_asli);
}

// Backfills the real WhatsApp group title for groups registered before this
// field existed, or seeded manually via .env without ever calling groupMetadata.
function updateGroupSubject(group_id, nama_asli) {
  return db.prepare(`UPDATE grup SET nama_asli = ? WHERE group_id = ?`).run(nama_asli, group_id);
}

// Repairs a group row whose group_id was mistakenly set to a display name
// (e.g. GROUP_P2MW_HIEREN in .env holding the group's title instead of its
// real numeric WhatsApp ID), found by matching that name against the bot's
// actual participating groups.
function repairGroupId(id, group_id, nama_asli) {
  // Targeted by row id, not nama — an UPDATE ... WHERE nama = ? would touch
  // every row sharing that name at once (this broke in exactly that way
  // when a duplicate nama existed: it tried to give two rows the same
  // group_id in one statement and hit the UNIQUE constraint).
  return db.prepare(`UPDATE grup SET group_id = ?, nama_asli = ? WHERE id = ?`).run(group_id, nama_asli, id);
}

// ─── Scheduler ───

function updateSchedulerStatus(job_name, status, error_message = null) {
  return db.prepare(`
    INSERT INTO scheduler_status (job_name, last_run, last_status, error_message)
    VALUES (?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT(job_name) DO UPDATE SET
      last_run = CURRENT_TIMESTAMP, last_status = excluded.last_status, error_message = excluded.error_message
  `).run(job_name, status, error_message);
}

function getSchedulerStatus(job_name) {
  return db.prepare(`SELECT * FROM scheduler_status WHERE job_name = ?`).get(job_name);
}

// ─── Evaluasi ───

function updateEvaluasiStatus(tanggal, nomor, status, jawaban = null) {
  return db.prepare(`
    INSERT INTO evaluasi_harian (tanggal, nomor, status, jawaban, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tanggal, nomor) DO UPDATE SET
      status = excluded.status, jawaban = COALESCE(excluded.jawaban, jawaban), updated_at = CURRENT_TIMESTAMP
  `).run(tanggal, nomor, status, jawaban);
}

// Full status for every contact on a given date (defaults 'belum' when no
// row exists yet), so Orinthia can decide herself who still needs a
// follow-up reminder via GET_EVAL_STATUS rather than that logic being
// hardcoded in the scheduler.
function getEvaluasiStatusForDate(tanggal) {
  return db.prepare(`
    SELECT k.nama, k.nomor, k.jabatan, COALESCE(e.status, 'belum') AS status, e.jawaban
    FROM kontak k
    LEFT JOIN evaluasi_harian e ON k.nomor = e.nomor AND e.tanggal = ?
    ORDER BY k.nama ASC
  `).all(tanggal);
}

// ─── Revisi Hardcode ───

function addRevision(tipe, target, deskripsi, konten_baru, diminta_oleh) {
  return db.prepare(`
    INSERT INTO revisi_hardcode (tipe, target, deskripsi, konten_baru, diminta_oleh)
    VALUES (?, ?, ?, ?, ?)
  `).run(tipe, target, deskripsi, konten_baru, diminta_oleh);
}

function getPendingRevisions() {
  return db.prepare(`SELECT * FROM revisi_hardcode WHERE status = 'pending' ORDER BY waktu_diminta ASC`).all();
}

function markRevisionApplied(id, catatan = null) {
  return db.prepare(`
    UPDATE revisi_hardcode SET status = 'diterapkan', waktu_diterapkan = CURRENT_TIMESTAMP, catatan = ?
    WHERE id = ?
  `).run(catatan, id);
}

function markRevisionRejected(id, catatan = null) {
  return db.prepare(`
    UPDATE revisi_hardcode SET status = 'ditolak', catatan = ? WHERE id = ?
  `).run(catatan, id);
}

// ─── Pengingat ───

function createReminder(tipe, jadwal, pesan, dibuat_oleh) {
  return db.prepare(`
    INSERT INTO pengingat (tipe, jadwal, pesan, dibuat_oleh)
    VALUES (?, ?, ?, ?)
  `).run(tipe, jadwal, pesan, dibuat_oleh);
}

function getActiveReminders() {
  return db.prepare(`SELECT * FROM pengingat WHERE status = 'aktif' ORDER BY created_at ASC`).all();
}

function getReminderById(id) {
  return db.prepare(`SELECT * FROM pengingat WHERE id = ?`).get(id);
}

function getDueOneTimeReminders(nowStr) {
  return db.prepare(`
    SELECT * FROM pengingat WHERE tipe = 'sekali' AND status = 'aktif' AND jadwal <= ?
  `).all(nowStr);
}

function markReminderDone(id) {
  return db.prepare(`UPDATE pengingat SET status = 'selesai', last_run = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

function markReminderRun(id) {
  return db.prepare(`UPDATE pengingat SET last_run = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

function cancelReminder(id) {
  return db.prepare(`UPDATE pengingat SET status = 'dibatalkan' WHERE id = ?`).run(id);
}

// ─── Idempotensi ───

function wasMessageSent(hash) {
  return db.prepare(`SELECT 1 FROM pesan_keluar WHERE hash = ?`).get(hash) != null;
}

function recordSentMessage(hash, target) {
  db.prepare(`INSERT OR IGNORE INTO pesan_keluar (hash, target) VALUES (?, ?)`).run(hash, target);
}

function getSystemState(kunci, defaultVal = null) {
  const row = db.prepare(`SELECT nilai FROM system_state WHERE kunci = ?`).get(kunci);
  return row ? row.nilai : defaultVal;
}

function setSystemState(kunci, nilai) {
  return db.prepare(`
    INSERT INTO system_state (kunci, nilai, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = CURRENT_TIMESTAMP
  `).run(kunci, nilai);
}

function closeDatabase() {
  if (db) db.close();
}

module.exports = {
  initDatabase,
  getDb,
  insertMessage,
  getUnreadMessages,
  markAsRead,
  freezeIncoming,
  getQueuedFrozenMessages,
  unfreezeMessages,
  deleteTodaysMessages,
  getAllTodaysMessages,
  insertSummary,
  getLatestSummaries,
  getLatestSummary,
  deleteOldSummaries,
  insertReport,
  getLatestReports,
  getLatestReportByTier,
  getReport,
  setMemory,
  getMemory,
  getAllMemory,
  deleteMemory,
  getAllContacts,
  getContactByNumber,
  updateContactJid,
  getAllGroups,
  getGroupByName,
  getGroupById,
  registerGroup,
  updateGroupSubject,
  repairGroupId,
  updateSchedulerStatus,
  getSchedulerStatus,
  updateEvaluasiStatus,
  getEvaluasiStatusForDate,
  addRevision,
  getPendingRevisions,
  markRevisionApplied,
  markRevisionRejected,
  createReminder,
  getActiveReminders,
  getReminderById,
  getDueOneTimeReminders,
  markReminderDone,
  markReminderRun,
  cancelReminder,
  wasMessageSent,
  recordSentMessage,
  getSystemState,
  setSystemState,
  closeDatabase,
};
