const db = require('../core/db');
const acl = require('../acl');
const wa = require('../core/whatsapp');
const { callOrinthia } = require('../core/claude');
const { buildSystemPrompt } = require('../orinthia/promptBuilder');
const { buildMessagePrompt } = require('../orinthia/contextManager');
const { parseToolCalls } = require('./toolParser');
const { executeTools, formatFollowUpData } = require('./toolExecutor');
const { getRejectionMessage, getUnavailableMessage } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

let processingLock = false;
let systemPromptCache = '';
let botActive = true;

function initBotState() {
  const saved = db.getSystemState('bot_active', 'true');
  botActive = saved === 'true';
  logger.info({ botActive }, 'Bot state loaded from DB');
}

function setSystemPromptCache(sp) { systemPromptCache = sp; }
function isBotActive() { return botActive; }

async function handleMessage(msg, ctx) {
  const { isFrozen } = ctx;

  const rawSenderJid = msg.key.participant || msg.key.remoteJid;
  // WhatsApp's phone-number privacy feature can address a chat/participant by an
  // opaque @lid instead of the real number; Baileys surfaces the real number
  // alongside it as participantPn/senderPn — prefer that when present.
  const senderJid = msg.key.participantPn || msg.key.senderPn || rawSenderJid;
  if (rawSenderJid?.endsWith('@lid') && senderJid !== rawSenderJid) {
    logger.debug({ lid: rawSenderJid, pn: senderJid }, 'Resolved @lid sender via senderPn/participantPn');
  }
  const chatJid = msg.key.remoteJid;
  const isGroup = wa.isGroupJid(chatJid);
  const senderNumber = wa.normalizeNumber(senderJid);
  const senderName = msg.pushName || '';
  const messageText = wa.extractMessageText(msg).trim();
  const messageTime = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000);

  if (!messageText) return;

  const isOwner = senderNumber === acl.normalizeNumber(config.OWNER_NUMBER);

  if (!isGroup && isOwner && messageText === '/on') {
    botActive = true;
    db.setSystemState('bot_active', 'true');
    await wa.sendMessage(chatJid, '*Moss*\nSistem Orinthia diaktifkan.');
    logger.info({ senderNumber }, 'Bot activated by owner');
    return;
  }

  if (!isGroup && isOwner && messageText === '/off') {
    botActive = false;
    db.setSystemState('bot_active', 'false');
    await wa.sendMessage(chatJid, '*Moss*\nSistem Orinthia dinonaktifkan. Pesan tetap disimpan tetapi tidak diproses.');
    logger.info({ senderNumber }, 'Bot deactivated by owner');
    return;
  }

  if (!botActive) {
    const isSenderWhitelisted = acl.isWhitelistedNumber(senderNumber);

    if (!isGroup) {
      if (!isSenderWhitelisted) return;
      db.insertMessage({
        isi: messageText, waktu: messageTime.toISOString(),
        nomor_pengirim: senderNumber, nama_pengirim: senderName,
        sumber: 'pc', sumber_id: senderNumber, sumber_nama: senderName,
      });
      logger.debug({ senderNumber }, 'PC stored (bot inactive)');
      return;
    }

    const groupInfo = acl.getGroup(chatJid);
    if (!acl.isWhitelistedGroup(chatJid) && !groupInfo) return;
    const groupName = groupInfo?.nama || wa.normalizeNumber(chatJid);
    db.insertMessage({
      isi: messageText, waktu: messageTime.toISOString(),
      nomor_pengirim: senderNumber, nama_pengirim: senderName,
      sumber: 'grup', sumber_id: wa.normalizeNumber(chatJid), sumber_nama: groupName,
    });
    logger.debug({ senderNumber, groupName }, 'Group stored (bot inactive)');
    return;
  }

  const isSenderWhitelisted = acl.isWhitelistedNumber(senderNumber);

  if (!isGroup) {
    if (!isSenderWhitelisted) {
      try {
        await wa.sendMessage(chatJid, getRejectionMessage(senderName));
      } catch {}
      logger.info({ senderNumber }, 'Rejected: unauthorized PC');
      return;
    }

    db.insertMessage({
      isi: messageText, waktu: messageTime.toISOString(),
      nomor_pengirim: senderNumber, nama_pengirim: senderName,
      sumber: 'pc', sumber_id: senderNumber, sumber_nama: senderName,
      dibekukan: isFrozen ? 1 : 0,
    });

    if (isFrozen) {
      logger.info({ senderNumber }, 'Message queued (frozen)');
      return;
    }

    await triggerOrinthia(ctx, senderNumber, senderName);
    return;
  }

  const mentionedJids = wa.getMentionedJids(msg);
  const botJid = ctx.client?.user?.id?.replace(/:.*@/, '@') || '';
  const isMentioned = mentionedJids.some(j => wa.normalizeNumber(j) === wa.normalizeNumber(botJid));
  const isReplyToBot = wa.isReplyToBot(msg, botJid);
  const isTagged = isMentioned || isReplyToBot;

  let groupInfo = acl.getGroup(chatJid);
  let groupName = groupInfo?.nama || '';

  if (!groupInfo && isGroup && ctx.client) {
    try {
      const meta = await ctx.client.groupMetadata(chatJid);
      const metaName = meta?.subject || '';
      const configGroup = config.WHITELISTED_GROUPS.find(g => g.nama.toLowerCase() === metaName.toLowerCase());
      if (configGroup) {
        db.registerGroup(configGroup.nama, wa.normalizeNumber(chatJid));
        groupInfo = acl.getGroup(chatJid);
        groupName = configGroup.nama;
        logger.info({ groupName, chatJid }, 'Group auto-registered');
      }
    } catch {}
  }

  if (!groupName) groupName = wa.normalizeNumber(chatJid);

  if (!acl.isWhitelistedGroup(chatJid) && !groupInfo) {
    return;
  }

  if (!isSenderWhitelisted && isTagged) {
    db.insertMessage({
      isi: messageText, waktu: messageTime.toISOString(),
      nomor_pengirim: senderNumber, nama_pengirim: senderName,
      sumber: 'grup', sumber_id: wa.normalizeNumber(chatJid), sumber_nama: groupName,
      dibekukan: isFrozen ? 1 : 0,
    });
    try {
      await wa.sendMessage(chatJid, getRejectionMessage(senderName));
    } catch {}
    logger.info({ senderNumber, groupName }, 'Rejected: unauthorized in group (tagged)');
    return;
  }

  db.insertMessage({
    isi: messageText, waktu: messageTime.toISOString(),
    nomor_pengirim: senderNumber, nama_pengirim: senderName,
    sumber: 'grup', sumber_id: wa.normalizeNumber(chatJid), sumber_nama: groupName,
    dibekukan: isFrozen ? 1 : 0,
  });

  if (!isTagged) {
    logger.debug({ senderNumber, groupName }, 'Group message stored (no tag)');
    return;
  }

  if (isFrozen) {
    logger.info({ senderNumber, groupName }, 'Group tagged message queued (frozen)');
    return;
  }

  await triggerOrinthia(ctx, senderNumber, senderName);
}

async function triggerOrinthia(ctx, triggerNumber, triggerName) {
  if (processingLock) {
    logger.info('Orinthia already processing, skipping trigger');
    return;
  }

  processingLock = true;
  logger.info({ triggerNumber, triggerName }, 'Triggering Orinthia');

  try {
    const unread = db.getUnreadMessages();
    if (unread.length === 0) {
      processingLock = false;
      return;
    }

    const messagePrompt = buildMessagePrompt(unread, ctx);
    const sp = systemPromptCache || buildSystemPrompt(ctx);

    const contact = acl.getContact(triggerNumber);

    let fullResponse = '';
    let followUpCount = 0;
    const MAX_FOLLOW_UPS = 3;
    let currentPrompt = messagePrompt;

    while (followUpCount <= MAX_FOLLOW_UPS) {
      const result = await callOrinthia(sp, currentPrompt);

      if (result.error && !result.text) {
        logger.error({ error: result.error }, 'Claude error');
        if (contact) {
          const jid = `${acl.normalizeNumber(contact.nomor)}@s.whatsapp.net`;
          try { await wa.sendMessage(jid, getUnavailableMessage(contact.nama)); } catch {}
        }
        const errText = `[MOSS ERROR] ${result.error}`;
        db.insertMessage({
          isi: errText, waktu: new Date().toISOString(),
          nomor_pengirim: 'moss', nama_pengirim: 'Moss',
          sumber: 'pc', sumber_id: 'system', sumber_nama: 'System',
        });
        break;
      }

      fullResponse += result.text;
      const toolCalls = parseToolCalls(result.text);

      if (toolCalls.length === 0) break;

      const execResult = await executeTools(toolCalls, {
        ...ctx, senderName: triggerName,
      });

      if (execResult.needsFollowUp && followUpCount < MAX_FOLLOW_UPS) {
        const followUpMsg = formatFollowUpData(execResult.followUpData);
        currentPrompt = `${currentPrompt}\n\n${followUpMsg}`;
        followUpCount++;
        continue;
      }

      break;
    }

    const readIds = unread.map(m => m.id);
    db.markAsRead(readIds);

    logger.info({ triggerNumber, responseLength: fullResponse.length }, 'Orinthia response processed');
  } catch (err) {
    logger.error({ err }, 'triggerOrinthia error');
  } finally {
    processingLock = false;
  }
}

module.exports = { handleMessage, setSystemPromptCache, isBotActive, initBotState };
