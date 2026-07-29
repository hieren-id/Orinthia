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

    if (result.text) {
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

// Re-hydrates every still-active reminder into a live scheduler on process
// start (recurring ones as real cron tasks; one-time ones are picked up by
// the minute-by-minute poller below) and keeps checking for due one-time
// reminders going forward. Call once at startup — calling it again would
// register duplicate cron tasks for the same recurring reminders.
function initReminders(ctx) {
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
