const db = require('../core/db');
const config = require('../config');
const wa = require('../core/whatsapp');
const { callOrinthia } = require('../core/claude');
const { buildSystemPrompt } = require('../orinthia/promptBuilder');
const { buildMessagePrompt } = require('../orinthia/contextManager');
const { parseToolCalls } = require('./toolParser');
const { executeTools, formatFollowUpData } = require('./toolExecutor');
const { flushByLevel, getCurrentPeriode, getDueEvaluationLevels } = require('./retention');
const logger = require('../utils/logger');

async function runPipeline(ctx) {
  logger.info('Pipeline 22.00 dimulai');

  db.freezeIncoming();
  ctx.isFrozen = true;

  try {
    const levels = getDueEvaluationLevels();
    const sp = buildSystemPrompt(ctx);

    for (const level of levels) {
      await runPipelineForLevel(ctx, sp, level);
    }

    const frozenMessages = db.getQueuedFrozenMessages();
    if (frozenMessages.length > 0) {
      await sendFrozenToOrinthia(ctx, sp, frozenMessages);
    }
  } catch (err) {
    logger.error({ err }, 'Pipeline error');
  } finally {
    db.unfreezeMessages();
    ctx.isFrozen = false;
    logger.info('Pipeline selesai');
  }
}

async function runPipelineForLevel(ctx, sp, level) {
  logger.info({ level }, `Pipeline: memproses level ${level}`);

  const periode = getCurrentPeriode(level);

  const todayMsgs = db.getAllTodaysMessages();
  const msgContext = todayMsgs.map(m =>
    `[${m.waktu}] ${m.nama_pengirim || m.nomor_pengirim} (${m.sumber === 'pc' ? 'PC' : m.sumber_nama}): ${m.isi}`
  ).join('\n');

  const reportPrompt = `[MOSS PIPELINE — Laporan ${level}]\n\n` +
    `Buat laporan evaluasi ${level} berdasarkan percakapan hari ini dan jawaban evaluasi.\n` +
    `Periode: ${periode.start} — ${periode.end}\n\n` +
    `Percakapan hari ini:\n${msgContext}\n\n` +
    `Gunakan:\n` +
    `<<MOSS|STORE_REPORT|${level}|{konten laporan}>>\n` +
    `<<MOSS|REPLY|{target}|{pesan laporan untuk manusia}>>\n\n` +
    `Kirim laporan ke: Mas Rafi (PC), grup Sinergi, grup P2MW Hieren, grup P2MW Privat.`;

  const reportResult = await callOrinthia(sp, reportPrompt);
  if (reportResult.text) {
    const toolCalls = parseToolCalls(reportResult.text);
    if (toolCalls.length > 0) {
      await executeTools(toolCalls, { ...ctx, senderName: 'Pipeline' });
    }
  }

  logger.info({ level }, `Pipeline: laporan ${level} selesai`);

  const condensePrompt = `[MOSS PIPELINE — Condense ${level}]\n\n` +
    `Ini adalah sesi condensing. Seluruh percakapan ${level === 'harian' ? 'hari ini' : `periode ${periode.start} — ${periode.end}`} perlu dirangkum.\n\n` +
    `Buat rangkuman untuk:\n` +
    `1. Setiap PC secara terpisah\n` +
    `2. Setiap grup secara terpisah\n` +
    `3. Rangkuman keseluruhan\n\n` +
    `Format tool call:\n` +
    `<<MOSS|STORE_SUMMARY|${level}|pc:{nomor}|{nama}|{konten rangkuman}>>\n` +
    `<<MOSS|STORE_SUMMARY|${level}|grup:{id}|{nama grup}|{konten rangkuman}>>\n` +
    `<<MOSS|STORE_SUMMARY|${level}|keseluruhan|Keseluruhan|{konten rangkuman}>>\n\n` +
    `Rangkuman berisi poin-poin terpenting dan kondisi emosional/karakter pengguna. ` +
    `Tidak perlu terlalu detail. Optimalkan untuk konsumsi model, bukan untuk dibaca manusia.\n\n` +
    `Percakapan:\n${msgContext}`;

  const condenseResult = await callOrinthia(sp, condensePrompt);
  let condenseSucceeded = false;
  if (condenseResult.error && !condenseResult.text) {
    logger.error({ level, error: condenseResult.error }, `Pipeline: condense ${level} GAGAL — flush dibatalkan untuk menjaga atomisitas (NFR-7)`);
  } else if (condenseResult.text) {
    const toolCalls = parseToolCalls(condenseResult.text);
    if (toolCalls.length > 0) {
      await executeTools(toolCalls, { ...ctx, senderName: 'Pipeline' });
    }
    condenseSucceeded = true;
  }

  if (!condenseSucceeded) {
    logger.warn({ level }, `Pipeline: condense ${level} tidak menghasilkan output — flush dibatalkan`);
    return;
  }

  logger.info({ level }, `Pipeline: condense ${level} selesai`);

  flushByLevel(level);
  logger.info({ level }, `Pipeline: flush ${level} selesai`);

  await restoreOrinthiaSession(ctx, sp);
}

async function restoreOrinthiaSession(ctx, sp) {
  const restorePrompt = `[MOSS SYSTEM — Sesi Dipulihkan]\n\n` +
    `Pipeline telah selesai. Konteks telah dibersihkan dan sesi baru dimulai.\n` +
    `Kamu melanjutkan sesi sebelumnya. Berikut rangkuman dan laporan terbaru dari database.\n\n`;

  const restoreResult = await callOrinthia(sp, restorePrompt);

  if (restoreResult.text) {
    const toolCalls = parseToolCalls(restoreResult.text);
    if (toolCalls.length > 0) {
      await executeTools(toolCalls, { ...ctx, senderName: 'Pipeline' });
    }
  }
}

async function sendFrozenToOrinthia(ctx, sp, frozenMessages) {
  const bySource = {};
  for (const msg of frozenMessages) {
    const key = msg.sumber === 'pc'
      ? `PC: ${msg.nama_pengirim || msg.nomor_pengirim}`
      : `Grup: ${msg.sumber_nama || msg.sumber_id}`;
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(msg);
  }

  const sections = [];
  for (const [source, msgs] of Object.entries(bySource)) {
    const formatted = msgs.map(m =>
      `[${new Date(m.waktu).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}] ${m.nama_pengirim || m.nomor_pengirim}: ${m.isi}`
    ).join('\n');
    sections.push(`### ${source}\n${formatted}`);
  }

  const frozenPrompt = `[MOSS SYSTEM — Chat Selama Pipeline]\n\n` +
    `Berikut chat yang masuk selama pipeline berlangsung:\n\n${sections.join('\n\n')}\n\n` +
    `Proses seperti biasa. Jika perlu merespons, gunakan <<MOSS|REPLY>>.`;

  const result = await callOrinthia(sp, frozenPrompt);
  if (result.error && !result.text) {
    logger.error({ error: result.error, count: frozenMessages.length }, 'Pipeline: gagal mengirim frozen messages ke Orinthia — pesan TIDAK ditandai dibaca, akan diproses trigger berikutnya');
    return;
  }

  if (result.text) {
    const toolCalls = parseToolCalls(result.text);
    if (toolCalls.length > 0) {
      await executeTools(toolCalls, { ...ctx, senderName: 'Pipeline' });
    }
  }

  const readIds = frozenMessages.map(m => m.id);
  db.markAsRead(readIds);
  logger.info({ count: readIds.length }, 'Pipeline: frozen messages diproses dan ditandai dibaca');
}

module.exports = { runPipeline };
