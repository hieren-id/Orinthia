const client = require('../core/whatsapp');
const { saveDatabase, saveUrgentNote, deleteUrgentNote, getUrgentNote, getMessageBuffer, addMessageToBuffer, clearMessageBuffer } = require('../database/db');
const { generateGroqResponse, generateGeminiSummary, generateVisionResponse } = require('../services/aiService');
const { getSpecialContact } = require('../services/contactService');
const { setBotStatus, getBotStatus, getActivationTimestamp } = require('../utils/state');

let isWaitingForNote = false;
const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 10000; // Updated to 5000 from user's code
const statusCooldowns = new Map();
const COOLDOWN_DURATION = 60 * 60 * 1000;

async function handleMessage(msg) {
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return;

    const chat = await msg.getChat();
    let senderName = msg._data.notifyName || msg.from.split('@')[0];
    if (!senderName) senderName = "Seseorang";
    const messageBody = msg.body;

    // --- LOGIKA COMMANDS OWNER ---
    if (msg.fromMe) {
        await handleOwnerCommands(msg, messageBody, chat);
        return;
    }

    // --- LOGIKA UTAMA (AUTO REPLY) ---
    const isBotActive = getBotStatus();

    // 1. DOWNLOAD MEDIA (VISION)
    let incomingMedia = null;
    if (isBotActive && msg.hasMedia) {
        try {
            const attachment = await msg.downloadMedia();
            if (attachment && attachment.mimetype.startsWith('image/')) {
                incomingMedia = attachment;
                console.log(`📸 Gambar diterima dari ${senderName}`);
            }
        } catch (err) {
            console.log("Gagal mendownload media:", err.message);
        }
    }

    if (isBotActive) {
        let shouldBuffer = false;
        if (chat.isGroup) {
            // Buffer semua pesan grup jika grup TIDAK diarsipkan
            if (!chat.archived) {
                shouldBuffer = true;
            }
        } else {
            shouldBuffer = true;
        }

        if (shouldBuffer && !messageBody.startsWith('!')) {
            const nameLabel = msg.fromMe ? "Anda (Owner)" : senderName;
            const chatIdContext = msg.fromMe ? msg.to : msg.from;
            const textContent = incomingMedia ? `[MENGIRIM GAMBAR] ${messageBody}` : messageBody;

            addMessageToBuffer({
                chatId: chatIdContext,
                text: `[${nameLabel}]: ${textContent}`,
                timestamp: Date.now()
            });
            console.log(`📝 Buffered [${senderName}]: ${textContent.substring(0, 30)}...`);
        }
    }

    if (isBotActive && !msg.fromMe) {
        const specialContact = getSpecialContact(msg.from, senderName);

        if (chat.isGroup) {
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(c => c.id._serialized === client.info.wid._serialized);
            let isReplyingToMe = false;
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.fromMe) isReplyingToMe = true;
            }

            if (!isBotMentioned && !isReplyingToMe) return;

            console.log(`Bot merespon di Grup ${chat.name}`);
            await processAIResponse(msg, senderName, messageBody, chat.id._serialized, specialContact, incomingMedia);
        }

        else {
            const chatId = msg.from;

            if (incomingMedia) {
                if (privateDebounceTimers.has(chatId)) clearTimeout(privateDebounceTimers.get(chatId));
                privateMessageQueues.delete(chatId);

                await processAIResponse(msg, senderName, messageBody, chatId, specialContact, incomingMedia);
                return;
            }

            if (privateDebounceTimers.has(chatId)) clearTimeout(privateDebounceTimers.get(chatId));

            const currentQueue = privateMessageQueues.get(chatId) || [];
            currentQueue.push(msg);
            privateMessageQueues.set(chatId, currentQueue);

            const timer = setTimeout(async () => {
                const queue = privateMessageQueues.get(chatId);
                if (!queue || queue.length === 0) return;
                const lastMsg = queue[queue.length - 1];

                privateMessageQueues.delete(chatId);
                privateDebounceTimers.delete(chatId);

                await processAIResponse(lastMsg, senderName, "", chatId, specialContact, null);

            }, DEBOUNCE_TIME);

            privateDebounceTimers.set(chatId, timer);
        }
    }
}

async function handleOwnerCommands(msg, messageBody, chat) {
    // 1. CHAT REIKA (!reika)
    if (messageBody.toLowerCase().startsWith('!reika')) {
        const userQuery = messageBody.replace(/^!reika\s*/i, '');
        const chatIdContext = msg.to;

        // Cek Media untuk !reika
        let media = null;
        if (msg.hasMedia) {
            try {
                const attachment = await msg.downloadMedia();
                if (attachment && attachment.mimetype.startsWith('image/')) {
                    media = attachment;
                    console.log(`[Owner] Mengirim gambar ke Reika`);
                }
            } catch (e) {
                console.error("Gagal download media owner:", e);
            }
        }

        // Simpan ke buffer & Save DB
        addMessageToBuffer({
            chatId: chatIdContext,
            text: `[Karel (Owner)]: ${userQuery} ${media ? '[MENGIRIM GAMBAR]' : ''}`,
            timestamp: Date.now()
        });

        const messageBuffer = getMessageBuffer();
        const activationTime = getActivationTimestamp();

        let relevantMessages = messageBuffer;

        // Filter berdasarkan waktu aktivasi jika ada
        if (activationTime) {
            relevantMessages = relevantMessages.filter(item => item.timestamp >= activationTime);
        }

        // Ambil SEMUA pesan yang relevan (Global Context) tanpa limit 50
        const historyLogs = relevantMessages
            .map(item => item.text)
            .join('\n');

        let responseText;
        if (media) {
            responseText = await generateVisionResponse(userQuery, media);
        } else {
            responseText = await generateGroqResponse("Karel (Owner)", userQuery, historyLogs, null, null, getUrgentNote());
        }

        const parts = responseText.split('|||');
        const chatReply = parts[0].trim();

        if (chatReply) {
            await msg.reply(chatReply);
            console.log(`🤖 Reika Membalas (Owner): "${chatReply.substring(0, 50)}..."`);
            addMessageToBuffer({
                chatId: chatIdContext,
                text: `[Reika]: ${chatReply}`,
                timestamp: Date.now()
            });
        }
        return;
    }

    // 2. MANAJEMEN COMMANDS
    if (messageBody.toLowerCase() === '!ctt') {
        isWaitingForNote = true;
        await msg.reply('✍️ Mode Manual: Kirim pesan catatan.');
        return;
    }

    if (messageBody.toLowerCase() === '!ctthps') {
        deleteUrgentNote();
        isWaitingForNote = false;
        await msg.reply('🗑️ Catatan dihapus (Manual).');
        return;
    }

    if (messageBody.toLowerCase() === '!cekctt') {
        const note = getUrgentNote();
        await msg.reply(note ? `📝 Catatan Aktif: "${note}"` : '✅ Tidak ada catatan.');
        return;
    }

    if (isWaitingForNote) {
        if (messageBody.includes('Mode Manual')) return;
        saveUrgentNote(messageBody);
        isWaitingForNote = false;
        await msg.reply(`✅ Catatan tersimpan: "${messageBody}"`);
        return;
    }

    if (messageBody.toLowerCase() === '!aktif') {
        setBotStatus(true);
        await msg.reply('🤖 Asisten Reika AKTIF.');
        return;
    }
    if (messageBody.toLowerCase() === '!mati') {
        setBotStatus(false);
        await msg.reply('😴 Asisten Reika MATI.');
        return;
    }
    if (messageBody.toLowerCase() === '!ringkasan') {
        const messageBuffer = getMessageBuffer();
        if (messageBuffer.length === 0) {
            await msg.reply('Belum ada pesan tersimpan.');
            return;
        }
        await msg.reply('Sedang menyusun ringkasan...');
        const fullLogText = messageBuffer.map(item => item.text).join('\n');
        const summary = await generateGeminiSummary(fullLogText);
        await msg.reply(`📝 *Ringkasan:*\n\n${summary}`);

        clearMessageBuffer();
        return;
    }
}

async function processAIResponse(msgInstance, senderName, textInput, chatIdContext, specialContact, mediaData) {
    const chat = await msgInstance.getChat();
    const messageBuffer = getMessageBuffer();
    const historyLogs = messageBuffer
        .filter(item => item.chatId === chatIdContext)
        .slice(-50)
        .map(item => item.text)
        .join('\n');

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }

    await new Promise(resolve => setTimeout(resolve, mediaData ? 3000 : 2000));

    let fullResponse;
    if (mediaData) {
        fullResponse = await generateVisionResponse(textInput, mediaData);
    } else {
        fullResponse = await generateGroqResponse(senderName, textInput, historyLogs, specialContact, null, getUrgentNote());
    }

    const parts = fullResponse.split('|||');
    const chatReply = parts[0].trim();
    if (chatReply) {
        await msgInstance.reply(chatReply);
        console.log(`🤖 Reika Membalas ke ${senderName}: "${chatReply.substring(0, 50)}..."`);
    }

    if (parts.length > 1) {
        const chatId = msgInstance.from;
        const now = Date.now();
        const lastSentTime = statusCooldowns.get(chatId) || 0;

        if (now - lastSentTime > COOLDOWN_DURATION) {
            const infoStatus = parts[1].trim();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.sendMessage(chatId, infoStatus);
            statusCooldowns.set(chatId, now);
            console.log(`ℹ️ Info Status dikirim ke ${senderName}`);
        }
    }

    addMessageToBuffer({
        chatId: chatIdContext,
        text: `[Reika]: ${chatReply}`,
        timestamp: Date.now()
    });
}

module.exports = handleMessage;
