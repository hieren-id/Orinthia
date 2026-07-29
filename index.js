const db = require('./src/core/db');
const wa = require('./src/core/whatsapp');
const { buildSystemPrompt } = require('./src/orinthia/promptBuilder');
const { handleMessage, setSystemPromptCache, initBotState } = require('./src/moss/messageHandler');
const { startScheduler } = require('./src/scheduler');
const logger = require('./src/utils/logger');
const qrcode = require('qrcode-terminal');

async function main() {
  logger.info('Orinthia v1 — Sistensia AI Manager starting...');

  db.initDatabase();
  logger.info('Database initialized');

  initBotState();

  const ctx = {
    client: null,
    isFrozen: false,
    config: require('./src/config'),
  };

  const sp = buildSystemPrompt(ctx);
  setSystemPromptCache(sp);
  logger.info({ promptLength: sp.length }, 'System prompt built');

  ctx.client = await wa.initializeWhatsApp(async (msg) => {
    await handleMessage(msg, ctx);
  });

  ctx.client.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      logger.info('WhatsApp connected');
      startScheduler(ctx);
      backfillGroupSubjects(ctx).catch((err) => logger.error({ err }, 'Group subject backfill error'));
    }
    if (update.qr) {
      logger.info('QR code received — scan with WhatsApp');
      qrcode.generate(update.qr, { small: true });
    }
  });

  process.on('SIGINT', () => shutdown(ctx));
  process.on('SIGTERM', () => shutdown(ctx));

  logger.info('Orinthia is running');
}

// Registered groups whose real WhatsApp title was never captured (e.g.
// group_id set directly in .env instead of via message-driven auto-register)
// otherwise only get backfilled reactively, the next time someone happens to
// post in that group. Do it proactively on connect instead, so REPLY targets
// using the real title resolve immediately rather than waiting on traffic.
async function backfillGroupSubjects(ctx) {
  const groups = db.getAllGroups().filter((g) => !g.nama_asli);
  for (const g of groups) {
    try {
      const meta = await ctx.client.groupMetadata(`${g.group_id}@g.us`);
      if (meta?.subject) {
        db.updateGroupSubject(g.group_id, meta.subject);
        logger.info({ groupName: g.nama, namaAsli: meta.subject }, 'Group real name backfilled at startup');
      }
    } catch (err) {
      logger.debug({ err: err.message, groupName: g.nama }, 'Could not fetch group metadata for backfill');
    }
  }
}

async function shutdown(ctx) {
  logger.info('Shutting down...');
  try { ctx.client?.end?.(); } catch {}
  // Baileys writes session/key updates to baileys_auth/*.json asynchronously;
  // exiting immediately can cut a write mid-flight and corrupt the Signal
  // session, making future messages undecryptable for the recipient.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try { db.closeDatabase(); } catch {}
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
