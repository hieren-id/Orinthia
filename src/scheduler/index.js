const cron = require('node-cron');
const config = require('../config');
const db = require('../core/db');
const { runPipeline } = require('../moss/pipeline');
const { isBotActive } = require('../moss/messageHandler');
const logger = require('../utils/logger');

// Evaluation asking/reminding used to be hardcoded here (19:30/20:30/21:30).
// It's now driven entirely by rows in `pengingat` (see scheduler/reminders.js)
// so the schedule and wording can be changed via CREATE_REMINDER/
// CANCEL_REMINDER instead of a code deploy. Only the 22:00 pipeline stays a
// fixed cron job — its steps (report -> condense -> flush -> restore) aren't
// something to hand to natural-language judgment.
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

  cron.schedule(config.SCHEDULE_TIMES.pipeline, () => triggerPipelineScheduler(ctx), tz);

  logger.info({
    pipeline: config.SCHEDULE_TIMES.pipeline,
    timezone: config.TIMEZONE,
  }, 'Scheduler started');
}

module.exports = { startScheduler };
