const crypto = require('crypto');
const db = require('../core/db');
const acl = require('../acl');
const { getCurrentPeriode } = require('./retention');
const logger = require('../utils/logger');

function hashMessage(target, message) {
  const today = new Date().toISOString().split('T')[0];
  return crypto.createHash('sha256').update(`${target}|${message}|${today}`).digest('hex').slice(0, 16);
}

// Baileys is a reverse-engineered client, not the official app — sending
// back-to-back with no pacing has repeatedly shown up in practice (and is a
// commonly reported Baileys issue) as intermittent "Waiting for this
// message" on the recipient's side, specifically for bot-sent messages
// (manually-sent messages from the same number don't show the same
// pattern). A short breather after each send gives the session/ratchet
// state time to settle before the next one.
const SEND_PACING_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveJid(target, client) {
  if (!target) return null;
  if (target.includes('@')) return target;
  const contact = acl.getContact(target);
  // Prefer the JID this contact's messages actually arrive on (can be @lid
  // under WhatsApp's phone-number privacy) over reconstructing @s.whatsapp.net,
  // which can address a different session than the one they're viewing.
  if (contact) return contact.last_jid || `${acl.normalizeNumber(contact.nomor)}@s.whatsapp.net`;
  const group = acl.getGroupByName(target);
  // group_id can hold a display name instead of a real WhatsApp ID (e.g. a
  // group whose .env-configured value was never repaired because the bot
  // isn't a member yet) — that builds a JID-shaped string that silently
  // goes nowhere instead of erroring, so refuse to use it as a target.
  if (group && group.group_id && acl.looksLikeGroupId(group.group_id)) return `${group.group_id}@g.us`;
  if (/^\d+$/.test(target)) return `${target}@s.whatsapp.net`;
  return null;
}

async function executeTools(toolCalls, ctx) {
  const { client } = ctx;
  const results = [];
  let needsFollowUp = false;
  const followUpData = [];

  for (const tc of toolCalls) {
    try {
      switch (tc.command) {
        case 'REPLY': {
          const [target, message] = tc.params;
          if (!target || !message) { results.push({ command: 'REPLY', status: 'error', error: 'missing params' }); break; }
          const jid = resolveJid(target, client);
          if (!jid) { results.push({ command: 'REPLY', status: 'error', error: `cannot resolve ${target}` }); break; }
          const hash = hashMessage(jid, message);
          if (db.wasMessageSent(hash)) { results.push({ command: 'REPLY', status: 'skipped', reason: 'duplicate' }); break; }
          try {
            await client.sendMessage(jid, { text: message });
            db.recordSentMessage(hash, jid);
            results.push({ command: 'REPLY', status: 'sent', target: jid });
            await sleep(SEND_PACING_MS);
          } catch (err) {
            results.push({ command: 'REPLY', status: 'error', error: err.message });
          }
          break;
        }
        case 'STORE_REPORT': {
          const [level, tier, content] = tc.params;
          if (!['detail', 'standar', 'umum'].includes(tier)) {
            results.push({ command: 'STORE_REPORT', status: 'error', error: `invalid tier: ${tier}` });
            break;
          }
          const periode = getCurrentPeriode(level);
          db.insertReport(level, tier, content, periode.start, periode.end);
          results.push({ command: 'STORE_REPORT', status: 'stored', tier });
          break;
        }
        case 'STORE_SUMMARY': {
          const [level, scope, namaScope, content] = tc.params;
          const periode = getCurrentPeriode(level);
          db.insertSummary(level, scope, namaScope, content, periode.start, periode.end);
          results.push({ command: 'STORE_SUMMARY', status: 'stored' });
          break;
        }
        case 'GET_SUMMARY': {
          const [level, scope] = tc.params;
          const data = scope ? db.getLatestSummary(level, scope) : db.getLatestSummaries(level, 10);
          followUpData.push({ type: 'summary', level, scope, data });
          needsFollowUp = true;
          break;
        }
        case 'GET_REPORT': {
          const [level, periode, tier] = tc.params;
          const data = periode ? db.getReport(level, periode, tier || 'detail') : db.getLatestReports(level, 5);
          followUpData.push({ type: 'report', level, periode, tier, data });
          needsFollowUp = true;
          break;
        }
        case 'GET_MEMORY': {
          const [key] = tc.params;
          const data = key === '*'
            ? Object.fromEntries(db.getAllMemory().map(m => [m.kunci, m.nilai]))
            : db.getMemory(key);
          followUpData.push({ type: 'memory', key, data });
          needsFollowUp = true;
          break;
        }
        case 'STORE_MEMORY': {
          const [key, value] = tc.params;
          db.setMemory(key, value);
          results.push({ command: 'STORE_MEMORY', status: 'stored' });
          break;
        }
        case 'DELETE_MEMORY': {
          const [key] = tc.params;
          db.deleteMemory(key);
          results.push({ command: 'DELETE_MEMORY', status: 'deleted' });
          break;
        }
        case 'REQUEST_REVISION': {
          const [tipe, target, deskripsi, kontenBaru] = tc.params;
          const pengirim = ctx.senderName || 'Orinthia';
          db.addRevision(tipe, target, deskripsi, kontenBaru, pengirim);
          results.push({ command: 'REQUEST_REVISION', status: 'queued' });
          break;
        }
        case 'UPDATE_EVAL': {
          const [nomor, status, jawaban] = tc.params;
          const today = new Date().toISOString().split('T')[0];
          if (!['belum', 'sebagian', 'selesai'].includes(status)) {
            results.push({ command: 'UPDATE_EVAL', status: 'error', error: `invalid status: ${status}` });
            break;
          }
          db.updateEvaluasiStatus(today, nomor, status, jawaban || null);
          results.push({ command: 'UPDATE_EVAL', status: 'updated', nomor, newStatus: status });
          break;
        }
        case 'GET_EVAL_STATUS': {
          const [tanggal] = tc.params;
          const today = new Date().toISOString().split('T')[0];
          const data = db.getEvaluasiStatusForDate(tanggal || today);
          followUpData.push({ type: 'eval_status', tanggal: tanggal || today, data });
          needsFollowUp = true;
          break;
        }
        case 'FLUSH': {
          const [level] = tc.params;
          const { flushByLevel } = require('./retention');
          flushByLevel(level);
          results.push({ command: 'FLUSH', status: 'flushed' });
          break;
        }
        case 'CREATE_REMINDER': {
          const [tipe, jadwal, pesan] = tc.params;
          if (!tipe || !jadwal || !pesan) { results.push({ command: 'CREATE_REMINDER', status: 'error', error: 'missing params' }); break; }
          const { createReminder } = require('../scheduler/reminders');
          const outcome = createReminder(ctx, tipe.trim(), jadwal.trim(), pesan, ctx.senderName || 'Orinthia');
          if (outcome.error) {
            results.push({ command: 'CREATE_REMINDER', status: 'error', error: outcome.error });
          } else {
            results.push({ command: 'CREATE_REMINDER', status: 'created', id: outcome.id });
          }
          break;
        }
        case 'LIST_REMINDERS': {
          const data = db.getActiveReminders();
          followUpData.push({ type: 'reminders', data });
          needsFollowUp = true;
          break;
        }
        case 'CANCEL_REMINDER': {
          const [idStr] = tc.params;
          const id = parseInt(idStr, 10);
          if (!idStr || isNaN(id)) { results.push({ command: 'CANCEL_REMINDER', status: 'error', error: 'invalid id' }); break; }
          const { cancelReminder } = require('../scheduler/reminders');
          const outcome = cancelReminder(id);
          if (outcome.error) {
            results.push({ command: 'CANCEL_REMINDER', status: 'error', error: outcome.error });
          } else {
            results.push({ command: 'CANCEL_REMINDER', status: 'cancelled', id });
          }
          break;
        }
        default:
          results.push({ command: tc.command, status: 'unknown' });
      }
    } catch (err) {
      logger.error({ err, command: tc.command }, 'Tool execution error');
      results.push({ command: tc.command, status: 'error', error: err.message });
    }
  }

  return { results, needsFollowUp, followUpData };
}

function formatFollowUpData(followUpData) {
  if (!followUpData.length) return '';
  const sections = [];
  for (const item of followUpData) {
    const json = JSON.stringify(item.data, null, 2);
    sections.push(`[MOSS SYSTEM] Data yang diminta (${item.type}):\n${json}`);
  }
  return sections.join('\n\n');
}

// executeTools' results were previously never inspected by any caller, so a
// failed/skipped REPLY (bad target, duplicate hash, send error) was silently
// indistinguishable from a successful run in the logs.
function logToolResults(results, context = {}) {
  for (const r of results) {
    if (r.status === 'error') {
      logger.warn({ ...context, ...r }, 'Tool call did not succeed');
    } else {
      logger.debug({ ...context, ...r }, 'Tool call result');
    }
  }
}

module.exports = { executeTools, formatFollowUpData, resolveJid, logToolResults };
