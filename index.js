const db = require('./src/core/db');
const wa = require('./src/core/whatsapp');
const { buildSystemPrompt } = require('./src/orinthia/promptBuilder');
const { handleMessage, setSystemPromptCache, initBotState } = require('./src/moss/messageHandler');
const { startScheduler } = require('./src/scheduler');
const { initReminders } = require('./src/scheduler/reminders');
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

  // Independent of WhatsApp connection state — a recurring reminder should
  // keep ticking regardless; if it fires while disconnected, the REPLY just
  // fails and logs like any other send attempt would.
  initReminders(ctx);

  let schedulerStarted = false;

  // ctx.client is set exactly once to a stable proxy (see core/whatsapp.js)
  // that always forwards to whatever the live socket currently is — it never
  // needs reassigning after a reconnect. The connection-update handler is
  // passed in (rather than attached externally via ctx.client.ev.on) because
  // a reconnect creates a brand-new socket with its own event emitter; a
  // listener attached once to the original socket would never see events
  // from any socket that replaces it.
  ctx.client = await wa.initializeWhatsApp(
    async (msg) => { await handleMessage(msg, ctx); },
    (update) => {
      if (update.connection === 'open') {
        logger.info('WhatsApp connected');
        if (!schedulerStarted) {
          schedulerStarted = true;
          startScheduler(ctx);
        }
        repairMisconfiguredGroupIds(ctx)
          .then(() => backfillGroupSubjects(ctx))
          .catch((err) => logger.error({ err }, 'Group registration repair/backfill error'));
        backfillContactJids(ctx).catch((err) => logger.error({ err }, 'Contact JID backfill error'));
      }
      if (update.qr) {
        logger.info('QR code received — scan with WhatsApp');
        qrcode.generate(update.qr, { small: true });
      }
    }
  );

  process.on('SIGINT', () => shutdown(ctx));
  process.on('SIGTERM', () => shutdown(ctx));

  logger.info('Orinthia is running');
}

// group_id is meant to hold the group's real numeric WhatsApp ID, but it's
// easy to instead paste the group's display name in .env (as happened here:
// GROUP_P2MW_HIEREN etc. held titles like "P2MW [Sistensia]"). A name in
// that column can never resolve to a real destination. Detect anything that
// doesn't look like a WhatsApp group ID and try to repair it by matching
// that name against the bot's actual participating groups.
function looksLikeGroupId(id) {
  return /^\d+(-\d+)?$/.test(id || '');
}

async function repairMisconfiguredGroupIds(ctx) {
  const misconfigured = db.getAllGroups().filter((g) => g.group_id && !looksLikeGroupId(g.group_id));
  if (misconfigured.length === 0) return;

  logger.warn({ count: misconfigured.length, groups: misconfigured.map(g => g.nama) },
    'Group(s) have a non-numeric group_id (likely a name was pasted into .env instead of the real WhatsApp group ID) — attempting to auto-repair');

  let participating;
  try {
    participating = await ctx.client.groupFetchAllParticipating();
  } catch (err) {
    logger.error({ err: err.message }, 'Could not fetch participating groups for repair');
    return;
  }

  const bySubject = new Map();
  for (const meta of Object.values(participating)) {
    if (meta?.subject) bySubject.set(meta.subject.toLowerCase(), meta);
  }

  for (const g of misconfigured) {
    try {
      const match = bySubject.get(g.group_id.toLowerCase());
      if (match) {
        const realId = wa.normalizeNumber(match.id);
        db.repairGroupId(g.id, realId, match.subject);
        logger.info({ groupName: g.nama, realId, subject: match.subject }, 'Group ID auto-repaired');
      } else {
        logger.warn({ groupName: g.nama, badValue: g.group_id },
          'Could not find a matching WhatsApp group to repair — is Orinthia actually a member of this group?');
      }
    } catch (err) {
      // Don't let one bad match abort repair attempts for the rest of the batch.
      logger.error({ err: err.message, groupName: g.nama }, 'Failed to repair this group, continuing with the rest');
    }
  }
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

// A contact's last_jid is normally only learned reactively, from an inbound
// message — so a contact who has never successfully messaged Orinthia since
// last_jid tracking was added stays stuck on the reconstructed
// <number>@s.whatsapp.net JID, which is wrong for any account using
// WhatsApp's phone-number privacy (confirmed: Karel, Mas Rafi, and Tata all
// actually message under an @lid). That's a deadlock — they can't read a
// reply sent to the wrong session, so they have no working way to reply and
// let Orinthia learn the right one. Resolve it proactively via onWhatsApp's
// LID lookup, which doesn't require any message from them first.
async function backfillContactJids(ctx) {
  const contacts = db.getAllContacts().filter((c) => c.nomor && !c.last_jid);
  for (const c of contacts) {
    try {
      const results = await ctx.client.onWhatsApp(c.nomor);
      const result = results?.[0];
      if (!result) {
        logger.warn({ contact: c.nama, nomor: c.nomor }, 'onWhatsApp lookup returned nothing — number may not be reachable on WhatsApp');
        continue;
      }
      const lidJid = result.lid ? (String(result.lid).includes('@') ? result.lid : `${result.lid}@lid`) : null;
      const jid = lidJid || result.jid;
      if (jid) {
        db.updateContactJid(c.nomor, jid);
        logger.info({ contact: c.nama, jid }, 'Contact JID backfilled via onWhatsApp lookup');
      }
    } catch (err) {
      logger.debug({ err: err.message, contact: c.nama }, 'Could not backfill contact JID via onWhatsApp');
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
