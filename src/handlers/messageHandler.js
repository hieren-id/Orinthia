const client = require('../core/whatsapp');
const { saveDatabase, saveUrgentNote, deleteUrgentNote, getUrgentNote, getMessageBuffer, addMessageToBuffer, clearMessageBuffer } = require('../database/db');
// Ganti import generateGeminiResponse -> generateGroqResponse (sesuai request sebelumnya untuk pakai Groq)
const { generateGroqResponse, generateGeminiSummary, generateVisionResponse } = require('../services/aiService');
const { getSpecialContact } = require('../services/contactService');
const { setBotStatus, getBotStatus } = require('../utils/state');

let isWaitingForNote = false;
const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 5000; // Updated to 5000 from user's code preference
const statusCooldowns = new Map();
const COOLDOWN_DURATION = 60 * 60 * 1000;

async function handleMessage(msg) {
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return;

    const chat = await msg.getChat();
    
    // --- PERBAIKAN: HINDARI getContact() ---
    // Gunakan notifyName langsung dari raw data pesan
    let senderName = msg._data.notifyName || msg.from.split('@')[0];
    i     }
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
        .slice(-20)
        .map(item => item.text)
        .join('\n');

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }

    await new Promise(resolve => setTimeout(resolve, mediaData ? 3000 : 2000));

    // LOGIKA PEMILIHAN MODEL (Hybrid Vision/Groq Agentic)
    let fullResponse;
    if (mediaData) {
        // Jika ada gambar, gunakan Gemini Vision (karena Groq GPT-OSS-120B mungkin text-only atau mahal)
        fullResponse = await generateVisionResponse(textInput, mediaData);
    } else {
        // Jika teks biasa, gunakan Groq Agentic
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