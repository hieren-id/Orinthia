const cron = require('node-cron');
const config = require('../config');
const db = require('../core/db');
const { callOrinthia } = require('../core/claude');
const { buildSystemPrompt } = require('../orinthia/promptBuilder');
const { parseToolCalls } = require('../moss/toolParser');
const { executeTools, logToolResults } = require('../moss/toolExecutor');
const { isBotActive } = require('../moss/messageHandler');
const logger = require('../utils/logger');

// Live node-cron tasks for 'berulang' reminders, keyed by pengingat.id, so a
// CANCEL_REMINDER call can stop the right one. Only holds tasks registered by
// *this* process — on restart, initReminders() re-registers everything
// that's still 'aktif' from the database, which is what makes recurring
// reminders restart-resilient rather than living only in memory.
const liveTasks = new Map();

function formatDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fireReminder(ctx, reminder) {
  if (!isBotActive()) {
    logger.info({ id: reminder.id }, 'Reminder skipped, bot inactive');
    return;
  }
  logger.info({ id: reminder.id, tipe: reminder.tipe, pesan: reminder.pesan }, 'Reminder fired');

  try {
    const prompt = `[MOSS SYSTEM — Pengingat]\n\n` +
      `Pengingat berikut yang kamu buat sendiri sudah waktunya:\n"${reminder.pesan}"\n\n` +
      `Lakukan sesuai instruksi ini menggunakan tool calling yang sesuai (misal <<MOSS|REPLY|target|pesan>> bila perlu memberi tahu seseorang). ` +
      `Jika instruksi ini tidak lagi relevan atau sudah tidak perlu ditindaklanjuti, boleh diabaikan.`;

    const sp = buildSystemPrompt(ctx);
    const result = await callOrinthia(sp, prompt);

    if (result.error && !result.text) {
      // callOrinthia resolves (doesn't throw) on failure, so without this
      // check a Claude CLI error — timeout, dead --resume session, etc. —
      // fell straight through to markReminderDone/markReminderRun below as
      // if the reminder had fired normally: no delivery, no log, no trace.
      logger.error({ id: reminder.id, error: result.error }, 'Reminder: Claude call failed — nothing sent');
    } else if (result.text) {
      const toolCalls = parseToolCalls(result.text);
      if (toolCalls.length > 0) {
        const execResult = await executeTools(toolCalls, { ...ctx, senderName: 'Reminder' });
        logToolResults(execResult.results, { reminderId: reminder.id });
      } else {
        logger.warn({ id: reminder.id, textPreview: result.text.slice(0, 500) }, 'Reminder response had no tool call');
      }
    }

    if (reminder.tipe === 'sekali') {
      db.markReminderDone(reminder.id);
    } else {
      db.markReminderRun(reminder.id);
    }
  } catch (err) {
    logger.error({ err, id: reminder.id }, 'Reminder execution error');
  }
}

function registerRecurringTask(ctx, reminder) {
  const task = cron.schedule(reminder.jadwal, () => fireReminder(ctx, reminder), { timezone: config.TIMEZONE });
  liveTasks.set(reminder.id, task);
}

async function checkOneTimeReminders(ctx) {
  const now = formatDateTimeLocal(new Date());
  const due = db.getDueOneTimeReminders(now);
  for (const reminder of due) {
    await fireReminder(ctx, reminder);
  }
}

// The old scheduler asked whichever levels getDueEvaluationLevels() returned
// in ONE combined prompt ("Kirim pertanyaan evaluasi harian, mingguan ke...")
// — on a day when multiple levels were due, that left it up to the model to
// keep every level straight in a single response, which is exactly where it
// went wrong (asked mingguan, skipped harian). Splitting each level into its
// own reminder with its own precise cron expression removes that ambiguity
// entirely: the schedule itself — not model judgment — decides which levels
// fire on a given day, and they can coincide (e.g. 28 Desember fires all
// five independently) without either being lost in the other's prompt.
const DEFAULT_REMINDERS = [
  {
    jadwal: '30 19 * * *',
    pesan: 'Saatnya evaluasi HARIAN. Untuk setiap anggota tim (kecuali Mas Rafi/Stakeholder Hieren): pertama reset status evaluasinya hari ini ke \'belum\' via <<MOSS|UPDATE_EVAL|nomor|belum|>>, lalu kirim pertanyaan evaluasi harian ke PC masing-masing. Daftar anggota tim beserta nomornya ada di konteks (Daftar Putih Personal Chat).',
  },
  {
    jadwal: '30 19 * * 0',
    pesan: 'Hari ini juga terjadwal evaluasi MINGGUAN (di luar harian, yang ditanyakan lewat pengingat terpisah). Kirim pertanyaan evaluasi mingguan ke seluruh anggota tim (kecuali Mas Rafi) lewat PC masing-masing.',
  },
  {
    jadwal: '30 19 28 * *',
    pesan: 'Hari ini juga terjadwal evaluasi BULANAN (di luar harian, yang ditanyakan lewat pengingat terpisah). Kirim pertanyaan evaluasi bulanan ke seluruh anggota tim (kecuali Mas Rafi) lewat PC masing-masing.',
  },
  {
    jadwal: '30 19 28 3,6,9,12 *',
    pesan: 'Hari ini juga terjadwal evaluasi KUARTALAN (di luar harian, yang ditanyakan lewat pengingat terpisah). Kirim pertanyaan evaluasi kuartalan ke seluruh anggota tim (kecuali Mas Rafi) lewat PC masing-masing.',
  },
  {
    jadwal: '30 19 28 12 *',
    pesan: 'Hari ini juga terjadwal evaluasi TAHUNAN (di luar harian, yang ditanyakan lewat pengingat terpisah). Kirim pertanyaan evaluasi tahunan ke seluruh anggota tim (kecuali Mas Rafi) lewat PC masing-masing.',
  },
  {
    jadwal: '30 20 * * *',
    pesan: 'Pengingat evaluasi pertama. Cek <<MOSS|GET_EVAL_STATUS>> untuk hari ini. Kirim pengingat yang sopan hanya ke anggota tim yang statusnya masih \'belum\' atau \'sebagian\'. Kalau semua sudah \'selesai\', tidak perlu kirim apa pun.',
  },
  {
    jadwal: '30 21 * * *',
    pesan: 'Pengingat evaluasi TERAKHIR untuk hari ini. Cek <<MOSS|GET_EVAL_STATUS>>. Kirim pengingat dengan nada sopan namun tegas hanya ke anggota tim yang masih \'belum\' atau \'sebagian\'. Kalau semua sudah \'selesai\', tidak perlu kirim apa pun.',
  },
];

// Runs exactly once, ever (guarded by system_state) — after that, these are
// ordinary rows in `pengingat` and Karel/Orinthia can edit, retime, or
// cancel them the same way as any reminder created through CREATE_REMINDER.
function seedDefaultReminders() {
  if (db.getSystemState('default_reminders_seeded') === 'true') return;
  for (const r of DEFAULT_REMINDERS) {
    db.createReminder('berulang', r.jadwal, r.pesan, 'system');
  }
  db.setSystemState('default_reminders_seeded', 'true');
  logger.info({ count: DEFAULT_REMINDERS.length }, 'Default evaluation reminders seeded');
}

// Re-hydrates every still-active reminder into a live scheduler on process
// start (recurring ones as real cron tasks; one-time ones are picked up by
// the minute-by-minute poller below) and keeps checking for due one-time
// reminders going forward. Call once at startup — calling it again would
// register duplicate cron tasks for the same recurring reminders.
function initReminders(ctx) {
  seedDefaultReminders();

  const active = db.getActiveReminders();
  for (const reminder of active) {
    if (reminder.tipe === 'berulang') {
      registerRecurringTask(ctx, reminder);
    }
  }
  logger.info({ count: active.length }, 'Reminders loaded from database');

  cron.schedule('* * * * *', () => checkOneTimeReminders(ctx), { timezone: config.TIMEZONE });
}

function createReminder(ctx, tipe, jadwal, pesan, dibuatOleh) {
  if (tipe === 'berulang') {
    if (!cron.validate(jadwal)) {
      return { error: `Ekspresi cron tidak valid: "${jadwal}"` };
    }
  } else if (tipe === 'sekali') {
    const parsed = new Date(jadwal.replace(' ', 'T'));
    if (isNaN(parsed.getTime())) {
      return { error: `Format waktu tidak valid: "${jadwal}". Gunakan YYYY-MM-DD HH:MM.` };
    }
    if (parsed.getTime() <= Date.now()) {
      return { error: `Waktu pengingat "${jadwal}" sudah lewat.` };
    }
    jadwal = formatDateTimeLocal(parsed);
  } else {
    return { error: `Tipe pengingat tidak dikenal: "${tipe}". Gunakan "sekali" atau "berulang".` };
  }

  const result = db.createReminder(tipe, jadwal, pesan, dibuatOleh);
  const id = result.lastInsertRowid;

  if (tipe === 'berulang') {
    registerRecurringTask(ctx, db.getReminderById(id));
  }

  return { id };
}

function cancelReminder(id) {
  const reminder = db.getReminderById(id);
  if (!reminder || reminder.status !== 'aktif') {
    return { error: `Pengingat #${id} tidak ditemukan atau sudah tidak aktif` };
  }
  const task = liveTasks.get(id);
  if (task) {
    task.stop();
    liveTasks.delete(id);
  }
  db.cancelReminder(id);
  return { id };
}

module.exports = { initReminders, createReminder, cancelReminder, fireReminder };
