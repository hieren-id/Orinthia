const client = require('../core/whatsapp');
const { saveUrgentNote, deleteUrgentNote, getUrgentNote, getMessageBuffer, addMessageToBuffer, clearMessageBuffer } = require('../database/db');
const { generateAIResponse, generateGroqSummary, generateVisionResponse, transcribeVoiceNote } = require('../services/aiService');
const { getSpecialContact } = require('../services/contactService');
const { setBotStatus, getBotStatus } = require('../utils/state');

const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 5000;
const statusCooldowns = new Map();
const COOLDOWN_DURATION = 60 * 60 * 1000;

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
    const isVoiceNote = msg.type === 'ptt' || msg._data?.isVoice === true;

    const specialContact = getSpecialContact(senderId, senderName);

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

    if (lowerBody.startsWith('!ctt ')) {
        const note = messageBody.slice(5).trim();
        if (note) {
            saveUrgentNote(note);
            await msg.reply(`Catatan mendesak disimpan: ${note}`);
        } else {
            await msg.reply('Isi catatan tidak boleh kosong.');
        }
        return;
    }

    if (lowerBody === '!hapusctt') {
        deleteUrgentNote();
        await msg.reply('Catatan mendesak dihapus.');
        return;
    }

    if (lowerBody === '!lihatctt') {
        const note = getUrgentNote();
        await msg.reply(note ? `Catatan aktif: ${note}` : 'Tidak ada catatan aktif.');
        return;
    }

    if (lowerBody === '!ringkasan') {
        const messageBuffer = getMessageBuffer();
        if (messageBuffer.length === 0) {
            await msg.reply('Belum ada pesan tersimpan.');
            return;
        }
        await msg.reply('Sedang menyusun ringkasan...');
        const fullLogText = messageBuffer.map(item => item.text).join('\n');
        const summary = await generateGroqSummary(fullLogText);
        await msg.reply(`RINGKASAN:\n\n${summary}`);
        clearMessageBuffer();
        return;
    }

    if (!getBotStatus()) return;

    // Only respond in groups when explicitly pinged
    const shouldRespond = !isGroup || botMentioned || lowerBody.startsWith('!reika');
    if (!shouldRespond) return;

    const cleanedText = lowerBody.startsWith('!reika') ? stripPrefix(messageBody) : messageBody;
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

    const payload = {
        msgInstance: msg,
        senderName,
        textInput: userText,
        chatIdContext,
        specialContact,
        mediaData
    };

    if (!isGroup) {
        enqueuePrivateMessage(payload);
        return;
    }

    await processAIResponse(msg, senderName, userText, chatIdContext, specialContact, mediaData);
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

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }

    await new Promise(resolve => setTimeout(resolve, mediaData ? 3000 : 2000));

    let fullResponse;
    if (mediaData) {
        fullResponse = await generateVisionResponse(textInput, mediaData);
    } else {
        fullResponse = await generateAIResponse(senderName, textInput, historyLogs, specialContact, getUrgentNote(), null);
    }

    const parts = typeof fullResponse === 'string' ? fullResponse.split('|||') : [''];
    const chatReply = parts[0].trim();

    if (chatReply) {
        try {
            await msgInstance.reply(chatReply);
            console.log(`Reika membalas ke ${senderName}: "${chatReply.substring(0, 50)}..."`);
        } catch (err) {
            console.error('Gagal mengirim balasan:', err);
        }
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
