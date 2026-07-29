const db = require('./src/core/db');
const wa = require('./src/core/whatsapp');
const { buildSystemPrompt } = require('./src/orinthia/promptBuilder');
const { handleMessage, setSystemPromptCache } = require('./src/moss/messageHandler');
const { startScheduler } = require('./src/scheduler');
const logger = require('./src/utils/logger');
const qrcode = require('qrcode-terminal');

async function main() {
  logger.info('Orinthia v1 — Sistensia AI Manager starting...');

  db.initDatabase();
  logger.info('Database initialized');

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

async function shutdown(ctx) {
  logger.info('Shutting down...');
  try { db.closeDatabase(); } catch {}
  try { ctx.client?.end?.(); } catch {}
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
