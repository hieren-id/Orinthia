const client = require('../core/whatsapp');
const {
    saveUrgentNote,
    deleteUrgentNote,
    getUrgentNote,
    getMessageBuffer,
    addMessageToBuffer,
    clearMessageBuffer,
    getMessagesByChat,
    clearMessagesByChat,
    addConversationSummary
} = require('../database/db');
const { generateAIResponse, generateGroqSummary, generateVisionResponse, transcribeVoiceNote } = require('../services/aiService');
const { searchRelevantContext } = require('../services/ragService');
const { getSpecialContact } = require('../services/contactService');
const { setBotStatus, getBotStatus } = require('../utils/state');

const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 10000; // kumpulkan pesan 15 detik sebelum merespons
const statusCooldowns = new Map();
const COOLDOWN_DURATION = 60 * 60 * 1000;
const summaryTimers = new Map();
const SUMMARY_WINDOW_MS = 60 * 60 * 1000;

function recordIncoming(chatId, senderName, text) {
    addMessageToBuffer({
        chatId,
        text: `[${senderName}]: ${text}`,
        timestamp: Date.now()
    });
}

function buildHistoryLogs(chatId) {
    return getMessageBuffer()
        .filter(item => item.chatId === chatId)
        .slice(-20)
        .map(item => item.text)
        .join('\n');
}

function getMentionedIds(msg) {
    if (Array.isArray(msg.mentionedIds)) {
        return msg.mentionedIds.filter(id => typeof id === 'string');
    }
    if (Array.isArray(msg._data?.mentionedJidList)) {
        return msg._data.mentionedJidList.filter(id => typeof id === 'string');
    }
    return [];
}

function isBotMentioned(chat, mentionedIds) {
    if (!chat.isGroup) return false;
    const myId = client?.info?.wid?._serialized;
    return !!(myId && mentionedIds.includes(myId));
}

function stripPrefix(messageBody) {
    return messageBody.replace(/^!reika\s*/i, '').trim();
}

function buildGroupMeta(chat) {
    return {
        name: chat?.name || 'Grup',
        phones: [],
        raw: null,
        senderNumber: chat?.id?._serialized || ''
    };
}

function applyHeader(replyText) {
    const header = '*Reika (Asisten AI Pribadi Karel)*';
    if (!replyText) return header;
    const trimmed = replyText.trim();
    if (trimmed.startsWith(header)) return trimmed;
    return `${header}\n\n${trimmed}`;
}

function buildContactMeta(specialContact, senderName, senderNumber) {
    const phones = Array.isArray(specialContact?.phone) ? specialContact.phone : [];
    return {
        name: specialContact?.name || senderName || 'Kontak',
        phones,
        raw: specialContact || null,
        senderNumber
    };
}

function scheduleChatSummary(chatId, contactMeta) {
    if (summaryTimers.has(chatId)) {
        clearTimeout(summaryTimers.get(chatId));
    }

    const timer = setTimeout(() => flushChatSummary(chatId, contactMeta), SUMMARY_WINDOW_MS);
    summaryTimers.set(chatId, timer);
}

async function flushChatSummary(chatId, contactMeta) {
    const logs = getMessagesByChat(chatId);
    if (!logs.length) {
        summaryTimers.delete(chatId);
        return;
    }

    const fullLogText = logs.map(item => item.text).join('\n');

    try {
        const summary = await generateGroqSummary(fullLogText);

        addConversationSummary({
            chatId,
            contactName: contactMeta?.name || 'Kontak',
            phones: contactMeta?.phones || [],
            senderNumber: contactMeta?.senderNumber || '',
            timestamp: Date.now(),
            summary
        });
    } catch (err) {
        console.error('Gagal membuat ringkasan dinamis:', err);
    }

    clearMessagesByChat(chatId);
    summaryTimers.delete(chatId);
}

async function handleMessage(msg) {
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return;

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const messageBody = (msg.body || '').trim();
    const lowerBody = messageBody.toLowerCase();
    const senderId = isGroup ? (msg.author || msg.from) : msg.from;
    const senderNumber = senderId ? senderId.replace('@c.us', '') : '';
    const senderName = msg._data?.notifyName || senderNumber || 'Pengirim';
    const chatIdContext = chat.id._serialized;
    const mentionedIds = getMentionedIds(msg);
    const botMentioned = isBotMentioned(chat, mentionedIds);
    const isFromMe = msg.fromMe === true;
    const isVoiceNote = msg.type === 'ptt' || msg._data?.isVoice === true;

    const specialContact = isGroup ? null : getSpecialContact(senderId, senderName);
    const promptContact = specialContact?.instruction ? specialContact : null;
    const contactMeta = isGroup ? buildGroupMeta(chat) : buildContactMeta(specialContact, senderName, senderNumber);

    // Commands (always available)
    if (lowerBody === '!aktif') {
        setBotStatus(true);
        await msg.reply('Bot diaktifkan.');
        return;
    }

    if (lowerBody === '!mati') {
        setBotStatus(false);
        await msg.reply('Bot dijeda.');
        return;
    }

    if (lowerBody === '!help') {
        const helpText = [
            '*Reika (Asisten AI Pribadi Karel)*',
            'Daftar perintah:',
            '- !aktif : Mengaktifkan balasan Reika.',
            '- !mati : Menjeda balasan Reika.',
            '- !ctt <teks> : Simpan catatan mendesak.',
            '- !hpsctt : Hapus catatan mendesak.',
            '- !cekctt : Lihat catatan mendesak aktif.',
            '- !ringkasan : Buat ringkasan riwayat chat tersimpan.',
            '- !reika <pesan> : Paksa Reika merespons (wajib di grup).'
        ].join('\n');
        await msg.reply(helpText);
        return;
    }

    if (lowerBody.startsWith('!ctt')) {
        const note = messageBody.replace(/^!ctt\s*/i, '').trim();
        if (note) {
            saveUrgentNote(note);
            await msg.reply(`Catatan mendesak disimpan: ${note}`);
        } else {
            await msg.reply('Isi catatan tidak boleh kosong.');
        }
        return;
    }

    if (lowerBody === '!hpsctt') {
        deleteUrgentNote();
        await msg.reply('Catatan mendesak dihapus.');
        return;
    }

    if (lowerBody === '!cekctt') {
        const note = getUrgentNote();
        await msg.reply(note ? `Catatan aktif: ${note}` : 'Tidak ada catatan aktif.');
        return;
    }

    if (!getBotStatus()) return;

    const hasPrefix = lowerBody.startsWith('!reika');
    const shouldRespond = isGroup
        ? (botMentioned || hasPrefix)
        : (!isFromMe || hasPrefix);
    if (!shouldRespond) return;

    const cleanedText = hasPrefix ? stripPrefix(messageBody) : messageBody;
    let userText = cleanedText || (msg.hasMedia ? '[media]' : '');

    let downloadedMedia = null;
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            downloadedMedia = media ? { data: media.data, mimetype: media.mimetype } : null;
        } catch (err) {
            console.error('Gagal mengunduh media:', err);
        }
    }

    let mediaData = null;
    if (downloadedMedia) {
        const mimeType = downloadedMedia.mimetype || '';
        const isAudioMedia = mimeType.startsWith('audio/');

        if (isVoiceNote || isAudioMedia) {
            const transcription = await transcribeVoiceNote(downloadedMedia);
            if (transcription) {
                userText = `[Voice Note]\n${transcription}`;
            } else {
                userText = '[Voice Note] (gagal ditranskripsi)';
            }
        } else if (mimeType.startsWith('image/')) {
            mediaData = downloadedMedia;
        }
    }

    recordIncoming(chatIdContext, senderName, userText);
    scheduleChatSummary(chatIdContext, contactMeta);

    const payload = {
        msgInstance: msg,
        senderName,
        textInput: userText,
        chatIdContext,
        specialContact: promptContact,
        mediaData
    };

    enqueuePrivateMessage(payload);
}

function enqueuePrivateMessage(payload) {
    const queue = privateMessageQueues.get(payload.chatIdContext) || [];
    queue.push(payload);
    privateMessageQueues.set(payload.chatIdContext, queue);

    if (privateDebounceTimers.has(payload.chatIdContext)) {
        clearTimeout(privateDebounceTimers.get(payload.chatIdContext));
    }

    const timer = setTimeout(() => flushPrivateQueue(payload.chatIdContext), DEBOUNCE_TIME);
    privateDebounceTimers.set(payload.chatIdContext, timer);
}

async function flushPrivateQueue(chatId) {
    const queue = privateMessageQueues.get(chatId) || [];
    privateMessageQueues.delete(chatId);

    if (privateDebounceTimers.has(chatId)) {
        clearTimeout(privateDebounceTimers.get(chatId));
        privateDebounceTimers.delete(chatId);
    }

    if (!queue.length) return;

    const latest = queue[queue.length - 1];
    const combinedText = queue.map(item => item.textInput).filter(Boolean).join('\n');
    const mediaData = queue.map(item => item.mediaData).find(Boolean) || null;

    await processAIResponse(
        latest.msgInstance,
        latest.senderName,
        combinedText || (mediaData ? '[media]' : ''),
        chatId,
        latest.specialContact,
        mediaData
    );
}

async function processAIResponse(msgInstance, senderName, textInput, chatIdContext, specialContact, mediaData) {
    const chat = await msgInstance.getChat();
    const historyLogs = buildHistoryLogs(chatIdContext);
    const retrievedContext = await searchRelevantContext(textInput);

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }

    await new Promise(resolve => setTimeout(resolve, mediaData ? 3000 : 2000));

    let fullResponse;
    if (mediaData) {
        fullResponse = await generateVisionResponse(textInput, mediaData);
    } else {
        fullResponse = await generateAIResponse(senderName, textInput, historyLogs, specialContact, getUrgentNote(), retrievedContext);
    }

    const parts = typeof fullResponse === 'string' ? fullResponse.split('|||') : [''];
    const chatReply = applyHeader(parts[0] ? parts[0].trim() : '');

    if (chatReply) {
        try {
            await msgInstance.reply(chatReply);
            console.log(`Reika membalas ke ${senderName}: "${chatReply.substring(0, 50)}..."`);
        } catch (err) {
            console.error('Gagal mengirim balasan:', err);
        }
    }

    // Tandai sebagai belum dibaca supaya terlihat belum disimak oleh Karel
    try {
        const chat = await msgInstance.getChat();
        if (typeof chat.markUnread === 'function') {
            await chat.markUnread();
        }
    } catch (err) {
        console.error('Gagal menandai chat sebagai belum dibaca:', err);
    }

    if (parts.length > 1) {
        const chatId = msgInstance.from;
        const now = Date.now();
        const lastSentTime = statusCooldowns.get(chatId) || 0;

        if (now - lastSentTime > COOLDOWN_DURATION) {
            const infoStatus = parts[1].trim();
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await client.sendMessage(chatId, infoStatus);
                statusCooldowns.set(chatId, now);
                console.log(`Info status dikirim ke ${senderName}`);
            } catch (err) {
                console.error('Gagal mengirim status tambahan:', err);
            }
        }
    }

    if (chatReply) {
        addMessageToBuffer({
            chatId: chatIdContext,
            text: `[Reika]: ${chatReply}`,
            timestamp: Date.now()
        });
    }
}

module.exports = handleMessage;
