const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const path = require('path');
const pino = require('pino');

const baileysLogger = pino({ level: 'silent' });
const logger = require('../utils/logger');
let sock = null;

async function initializeWhatsApp(messageHandler) {
  const authDir = path.join(__dirname, '..', '..', 'baileys_auth');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    browser: ['Orinthia', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => initializeWhatsApp(messageHandler), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (messageHandler) {
        try {
          await messageHandler(msg);
        } catch (err) {
          logger.error({ err, sender: msg.key.remoteJid }, 'Message handler error');
        }
      }
    }
  });

  return sock;
}

function getClient() {
  return sock;
}

async function sendMessage(jid, text) {
  if (!sock) throw new Error('WhatsApp not connected');
  return sock.sendMessage(jid, { text });
}

async function sendTyping(jid) {
  if (!sock) return;
  await sock.sendPresenceUpdate('composing', jid);
}

async function stopTyping(jid) {
  if (!sock) return;
  await sock.sendPresenceUpdate('paused', jid);
}

function isGroupJid(jid) {
  return jid.endsWith('@g.us');
}

function normalizeNumber(jid) {
  if (!jid) return '';
  return jid.replace(/@s\.whatsapp\.net|@g\.us/g, '');
}

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  return '';
}

function getMentionedJids(msg) {
  const m = msg.message;
  if (!m) return [];
  const ext = m.extendedTextMessage;
  if (ext?.contextInfo?.mentionedJid) return ext.contextInfo.mentionedJid;
  return [];
}

function isReplyToBot(msg, botJid) {
  const m = msg.message;
  if (!m) return false;
  const ext = m.extendedTextMessage;
  if (!ext?.contextInfo?.participant) return false;
  return ext.contextInfo.participant === botJid;
}

function getReplyTarget(msg) {
  const m = msg.message;
  if (!m) return null;
  const ext = m.extendedTextMessage;
  if (!ext?.contextInfo?.participant) return null;
  return ext.contextInfo.participant;
}

module.exports = {
  initializeWhatsApp,
  getClient,
  sendMessage,
  sendTyping,
  stopTyping,
  isGroupJid,
  normalizeNumber,
  extractMessageText,
  getMentionedJids,
  isReplyToBot,
  getReplyTarget,
};
