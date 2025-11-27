const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");
// HAPUS IMPORT DI ATAS INI AGAR BISA HOT RELOAD
// const { getSystemPrompt } = require('./prompt'); 

// --- KONFIGURASI ---
require('dotenv').config(); 
const MODEL_API_KEY = process.env.GEMINI_API_KEY; 

if (!MODEL_API_KEY) {
    console.error("❌ ERROR: API Key belum diisi di file .env!");
    process.exit(1);
}

// Inisialisasi Gemini
const genAI = new GoogleGenerativeAI(MODEL_API_KEY);
// Gunakan 1.5-flash agar stabil
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Inisialisasi WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// --- STATE VARIABLES ---
let isBotActive = false; 

// Buffer sekarang menyimpan Objek: { chatId, text, timestamp }
let messageBuffer = []; 

// Debounce / Antrian Pesan Pribadi
const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 5000; // 5 detik

// Variable untuk mencatat waktu terakhir kirim status
const statusCooldowns = new Map(); 
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 Jam

// --- EVENT HANDLERS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('SCAN QR CODE DI ATAS DENGAN WHATSAPP!');
});

client.on('ready', () => {
    console.log('Bot Gemini Siap! Ketik "!aktif" di WA untuk menyalakan.');
});

// 'message_create' mendeteksi pesan masuk DAN pesan yang kamu kirim sendiri.
client.on('message_create', async msg => {
    
    // Filter Saluran & Status Update
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') {
        return;
    }

    const chat = await msg.getChat();
    let senderName = msg._data.notifyName || msg.from.split('@')[0];
    if (!senderName) senderName = "Seseorang";

    const messageBody = msg.body;

    // --- COMMANDS PENGENDALI ---
    if (msg.fromMe) {
        if (messageBody.toLowerCase() === '!aktif') {
            isBotActive = true;
            await msg.reply('🤖 Asisten Reika AKTIF. Saya akan membalas pesan masuk.');
            console.log('Bot diaktifkan oleh Owner.');
            return;
        }

        if (messageBody.toLowerCase() === '!mati') {
            isBotActive = false;
            await msg.reply('😴 Asisten Reika MATI. Silakan handle chat sendiri.');
            console.log('Bot dimatikan oleh Owner.');
            return;
        }

        if (messageBody.toLowerCase() === '!ringkasan') {
            if (messageBuffer.length === 0) {
                await msg.reply('Belum ada pesan tersimpan untuk diringkas.');
                return;
            }

            await msg.reply('Sedang menyusun ringkasan...');
            
            // Ambil text dari object buffer untuk ringkasan
            const fullLogText = messageBuffer.map(item => item.text).join('\n');
            const summary = await generateGeminiSummary(fullLogText);
            
            await msg.reply(`📝 *Ringkasan Pesan Selama Bot Aktif:*\n\n${summary}`);

            messageBuffer = [];
            console.log('Buffer pesan telah di-reset.');
            return;
        }
    }

    // --- LOGIKA BUFFERING (Simpan Pesan ke Memori) ---
    if (isBotActive) {
        let shouldBuffer = false;
        
        // Grup: Hanya simpan jika di-tag/reply
        if (chat.isGroup) {
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(contact => contact.id._serialized === client.info.wid._serialized);
            
            let isReplyingToMe = false;
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.fromMe) isReplyingToMe = true;
            }

            if (isBotMentioned || isReplyingToMe) shouldBuffer = true;
        } else {
            // Private Chat: Selalu simpan
            shouldBuffer = true;
        }

        if (shouldBuffer && messageBody.toLowerCase() !== '!ringkasan') {
            const nameLabel = msg.fromMe ? "Anda (Owner)" : senderName;
            
            // Tentukan ID Chat untuk pengelompokan context
            const chatIdContext = msg.fromMe ? msg.to : msg.from;

            // Simpan sebagai Objek agar bisa difilter nanti
            messageBuffer.push({
                chatId: chatIdContext,
                text: `[${nameLabel}]: ${messageBody}`,
                timestamp: Date.now()
            });
            
            console.log(`Buffered [${chatIdContext}]: ${messageBody.substring(0, 20)}...`);
        }
    }

    // --- LOGIKA AUTO REPLY (Hanya untuk pesan orang lain) ---
    if (isBotActive && !msg.fromMe) {

        // SKENARIO 1: GRUP (Immediate)
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
            await processAIResponse(msg, senderName, messageBody, chat.id._serialized);
        } 
        
        // SKENARIO 2: PRIVATE CHAT (Debounce)
        else {
            const chatId = msg.from;

            if (privateDebounceTimers.has(chatId)) {
                clearTimeout(privateDebounceTimers.get(chatId));
            }

            const currentQueue = privateMessageQueues.get(chatId) || [];
            currentQueue.push(msg);
            privateMessageQueues.set(chatId, currentQueue);

            console.log(`Menunggu pesan lanjutan dari ${senderName}... (Antrian: ${currentQueue.length})`);

            const timer = setTimeout(async () => {
                const queue = privateMessageQueues.get(chatId);
                if (!queue || queue.length === 0) return;

                const lastMsg = queue[queue.length - 1];
                
                // Gabung pesan untuk log/debug
                const combinedText = queue.map(m => m.body).join('\n');

                console.log(`Timer habis. Memproses pesan dari ${senderName}.`);

                privateMessageQueues.delete(chatId);
                privateDebounceTimers.delete(chatId);

                // Panggil proses AI dengan Context ID = Chat ID Private
                await processAIResponse(lastMsg, senderName, combinedText, chatId);

            }, DEBOUNCE_TIME);

            privateDebounceTimers.set(chatId, timer);
        }
    }
});

// --- FUNGSI UTAMA PROSES AI (Dengan Context History) ---
async function processAIResponse(msgInstance, senderName, textInput, chatIdContext) {
    const chat = await msgInstance.getChat();

    // 1. AMBIL HISTORY DARI BUFFER
    const historyLogs = messageBuffer
        .filter(item => item.chatId === chatIdContext)
        .slice(-20) // Ambil 20 terakhir
        .map(item => item.text)
        .join('\n');

    // Typing effect
    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Minta jawaban lengkap dari Gemini (sekarang pakai fungsi dari prompt.js)
    const fullResponse = await generateGeminiResponse(senderName, textInput, historyLogs);

    // --- LOGIKA PEMISAH PESAN & COOLDOWN ---
    const parts = fullResponse.split('|||');

    const chatReply = parts[0].trim();
    if (chatReply) {
        await msgInstance.reply(chatReply);
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
            console.log(`Status Info dikirim ke ${senderName} (Cooldown Reset)`);
        } else {
            console.log(`Status Info di-SKIP untuk ${senderName} (Masih Cooldown)`);
        }
    }
}

// --- FUNGSI INTERAKSI DENGAN GEMINI ---

async function generateGeminiResponse(sender, text, historyLogs) {
    try {
        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };

        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        // --- PANGGIL FUNGSI DARI PROMPT.JS DENGAN HOT RELOAD ---
        // 1. Hapus Cache file prompt.js dari memori Node.js
        delete require.cache[require.resolve('./prompt')];
        
        // 2. Load ulang file prompt.js yang terbaru
        const { getSystemPrompt } = require('./prompt');

        // Kita kirim parameter yang dibutuhkan ke fungsi getSystemPrompt
        const prompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error Gemini:", error);
        return "*Reika (Asisten AI Pribadi Karel):* Maaf, saya sedang gangguan sebentar.";
    }
}

async function generateGeminiSummary(textData) {
    try {
        const prompt = `
        Berikut adalah log percakapan WhatsApp yang masuk saat saya offline:
        
        ${textData}
        
        Tugasmu:
        Buatkan ringkasan poin-poin penting (bullet points). 
        Kelompokkan berdasarkan nama pengirim jika ada banyak pengirim berbeda.
        Tulis dalam Bahasa Indonesia yang jelas.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error Summary:", error);
        return "Gagal membuat ringkasan log.";
    }
}

client.initialize();