const cron = require('node-cron');
const config = require('../config');
const db = require('../core/db');
const acl = require('../acl');
const wa = require('../core/whatsapp');
const { callOrinthia } = require('../core/claude');
const { buildSystemPrompt } = require('../orinthia/promptBuilder');
const { buildMessagePrompt } = require('../orinthia/contextManager');
const { parseToolCalls } = require('../moss/toolParser');
const { executeTools, formatFollowUpData, logToolResults } = require('../moss/toolExecutor');
const { runPipeline } = require('../moss/pipeline');
const { getDueEvaluationLevels } = require('../moss/retention');
const { isBotActive } = require('../moss/messageHandler');
const logger = require('../utils/logger');

async function triggerEvaluation(ctx) {
  if (!isBotActive()) { logger.info('Scheduler: bot inactive, skipping evaluasi'); return; }
  logger.info('Scheduler: 19.30 — evaluasi dimulai');
  const levels = getDueEvaluationLevels();
  const today = new Date().toISOString().split('T')[0];

  try {
    const contacts = db.getAllContacts();
    const teamMembers = contacts.filter(c => c.jabatan !== 'Stakeholder (Hieren)');

    for (const member of teamMembers) {
      db.updateEvaluasiStatus(today, member.nomor, 'belum');
    }

    const levelText = levels.join(', ');
    const prompt = `[MOSS SCHEDULER — Evaluasi ${levelText}]\n\n` +
      `Tugas: Kirim pertanyaan evaluasi ${levelText} ke seluruh anggota tim Scio melalui PC masing-masing.\n\n` +
      `Anggota tim yang perlu dikirimi evaluasi:\n` +
      teamMembers.map(m => `- ${m.nama} (${m.jabatan}): ${m.nomor}`).join('\n') +
      `\n\nGunakan <<MOSS|REPLY|nomor|pesan>> untuk mengirim ke masing-masing.`;

    const sp = buildSystemPrompt(ctx);
    const result = await callOrinthia(sp, prompt);

    if (result.text) {
      const toolCalls = parseToolCalls(result.text);
      if (toolCalls.length > 0) {
        const execResult = await executeTools(toolCalls, { ...ctx, senderName: 'Scheduler' });
        logToolResults(execResult.results, { job: 'evaluasi_1930' });
      } else {
        logger.warn({ textPreview: result.text.slice(0, 500) }, 'Scheduler: evaluasi tidak menghasilkan tool call');
      }
    }

    db.updateSchedulerStatus('evaluasi_1930', 'success');
    logger.info('Scheduler: evaluasi terkirim');
  } catch (err) {
    db.updateSchedulerStatus('evaluasi_1930', 'failed', err.message);
    logger.error({ err }, 'Scheduler evaluasi error');
  }
}

async function triggerReminder(ctx, round) {
  if (!isBotActive()) { logger.info(`Scheduler: bot inactive, skipping pengingat ${round}`); return; }
  logger.info(`Scheduler: ${round === 1 ? '20.30' : '21.30'} — pengingat ${round}`);
  const today = new Date().toISOString().split('T')[0];

  try {
    const unanswered = db.getUnansweredEvaluasi(today);
    if (unanswered.length === 0) {
      logger.info('Semua sudah menjawab, skip pengingat');
      db.updateSchedulerStatus(`reminder_${round}_${today}`, 'skipped');
      return;
    }

    const prompt = `[MOSS SCHEDULER — Pengingat ${round}]\n\n` +
      `Tugas: Kirim pengingat evaluasi ke anggota tim yang belum menjawab atau jawabannya belum lengkap.\n\n` +
      `Yang perlu diingatkan:\n` +
      unanswered.map(m => `- ${m.nama} (${m.jabatan}): ${m.nomor}`).join('\n') +
      `\n\nGunakan <<MOSS|REPLY|nomor|pesan>> untuk mengirim pengingat. Gunakan nada yang sopan namun tegas.`;

    const sp = buildSystemPrompt(ctx);
    const result = await callOrinthia(sp, prompt);

    if (result.text) {
      const toolCalls = parseToolCalls(result.text);
      if (toolCalls.length > 0) {
        const execResult = await executeTools(toolCalls, { ...ctx, senderName: 'Scheduler' });
        logToolResults(execResult.results, { job: `reminder_${round}` });
      } else {
        logger.warn({ round, textPreview: result.text.slice(0, 500) }, 'Scheduler: pengingat tidak menghasilkan tool call');
      }
    }

    db.updateSchedulerStatus(`reminder_${round}_${today}`, 'success');
  } catch (err) {
    db.updateSchedulerStatus(`reminder_${round}_${today}`, 'failed', err.message);
    logger.error({ err }, `Scheduler reminder ${round} error`);
  }
}

async function triggerPipelineScheduler(ctx) {
  if (!isBotActive()) { logger.info('Scheduler: bot inactive, skipping pipeline'); return; }
  logger.info('Scheduler: 22.00 — pipeline dimulai');
  try {
    await runPipeline(ctx);
    const today = new Date().toISOString().split('T')[0];
    db.updateSchedulerStatus(`pipeline_${today}`, 'success');
    logger.info('Scheduler: pipeline selesai');
  } catch (err) {
    const today = new Date().toISOString().split('T')[0];
    db.updateSchedulerStatus(`pipeline_${today}`, 'failed', err.message);
    logger.error({ err }, 'Scheduler pipeline error');
  }
}

function startScheduler(ctx) {
  const tz = { timezone: config.TIMEZONE };

  cron.schedule(config.SCHEDULE_TIMES.daily_eval, () => triggerEvaluation(ctx), tz);
  cron.schedule(config.SCHEDULE_TIMES.reminder_1, () => triggerReminder(ctx, 1), tz);
  cron.schedule(config.SCHEDULE_TIMES.reminder_2, () => triggerReminder(ctx, 2), tz);
  cron.schedule(config.SCHEDULE_TIMES.pipeline, () => triggerPipelineScheduler(ctx), tz);

  logger.info({
    daily_eval: config.SCHEDULE_TIMES.daily_eval,
    reminder_1: config.SCHEDULE_TIMES.reminder_1,
    reminder_2: config.SCHEDULE_TIMES.reminder_2,
    pipeline: config.SCHEDULE_TIMES.pipeline,
    timezone: config.TIMEZONE,
  }, 'Scheduler started');
}

module.exports = { startScheduler, getDueEvaluationLevels };
