// FILE: index.js
// Ini adalah file UTAMA untuk menjalankan bot.

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

require('dotenv').config();
const MODEL_API_KEY = process.env.GEMINI_API_KEY;

if (!MODEL_API_KEY) {
    console.error("❌ ERROR: API Key belum diisi di file .env!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(MODEL_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [
        {
            googleSearch: {}
        }
    ]

});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
    }
});

// --- STATE VARIABLES ---
let isBotActive = false;
let messageBuffer = [];
let isWaitingForNote = false;
let urgentNote = "";

// Load catatan saat startup
if (fs.existsSync('./urgent_note.txt')) {
    urgentNote = fs.readFileSync('./urgent_note.txt', 'utf8');
    console.log(`Memuat Catatan Mendesak: "${urgentNote}"`);
}

const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 5000;
const statusCooldowns = new Map();
const COOLDOWN_DURATION = 60 * 60 * 1000;

// --- EVENT HANDLERS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('SCAN QR CODE DI ATAS DENGAN WHATSAPP!');
});

client.on('ready', () => {
    console.log('Bot Gemini Siap! Ketik "!aktif" di WA untuk menyalakan.');
});

client.on('message_create', async msg => {

    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return;

    const chat = await msg.getChat();
    let senderName = msg._data.notifyName || msg.from.split('@')[0];
    if (!senderName) senderName = "Seseorang";
    const messageBody = msg.body;

    // --- LOGIKA COMMANDS OWNER ---
    if (msg.fromMe) {

        // 1. FITUR CHAT DENGAN REIKA (!reika)
        if (messageBody.toLowerCase().startsWith('!reika')) {
            const userQuery = messageBody.replace(/^!reika\s*/i, '');
            if (!userQuery) {
                await msg.reply("Halo Karel! Mau ngobrol apa sama Reika?");
                return;
            }
            const chatIdContext = msg.to;
            messageBuffer.push({
                chatId: chatIdContext,
                text: `[Karel (Owner)]: ${userQuery}`,
                timestamp: Date.now()
            });

            const historyLogs = messageBuffer
                .filter(item => item.chatId === chatIdContext)
                .slice(-20)
                .map(item => item.text)
                .join('\n');

            const responseText = await generateGeminiResponse("Karel (Owner)", userQuery, historyLogs, null);
            const parts = responseText.split('|||');
            const chatReply = parts[0].trim();

            if (chatReply) {
                await msg.reply(chatReply);
                messageBuffer.push({
                    chatId: chatIdContext,
                    text: `[Reika]: ${chatReply}`,
                    timestamp: Date.now()
                });
            }
            return;
        }

        // 2. MANAJEMEN COMMANDS CATATAN
        if (messageBody.toLowerCase() === '!ctt') {
            isWaitingForNote = true;
            await msg.reply('✍️ Silahkan tambahkan catatan mendesak. Kirim pesan selanjutnya sebagai isi catatan.');
            return;
        }

        if (messageBody.toLowerCase() === '!ctthps') {
            urgentNote = "";
            isWaitingForNote = false;
            if (fs.existsSync('./urgent_note.txt')) fs.unlinkSync('./urgent_note.txt');
            await msg.reply('🗑️ Catatan mendesak dihapus. Kembali mengikuti jadwal normal.');
            return;
        }

        if (messageBody.toLowerCase() === '!cekctt') {
            if (urgentNote && urgentNote.trim().length > 0) {
                await msg.reply(`📝 *Catatan Mendesak Saat Ini:*\n"${urgentNote}"\n\n(Bot sedang mengabaikan jadwal rutin dan menggunakan status ini).`);
            } else {
                await msg.reply('✅ Tidak ada catatan mendesak yang aktif.\nBot berjalan sesuai jadwal rutin.');
            }
            return;
        }

        // 3. INPUT CATATAN (FLOW KHUSUS)
        if (isWaitingForNote) {

            // --- FIX ERROR NYIMPEN PESAN SENDIRI ---
            // Cek apakah pesan ini adalah instruksi dari bot? Jika ya, ABAIKAN.
            if (messageBody.includes('Silahkan tambahkan catatan mendesak')) {
                return;
            }
            // ----------------------------------------

            urgentNote = messageBody;
            fs.writeFileSync('./urgent_note.txt', urgentNote);
            isWaitingForNote = false;
            await msg.reply(`✅ Catatan tersimpan: "${urgentNote}"\n\nInfo ini akan meng-override jadwal kuliah/rutinitas.`);
            return;
        }

        // 4. COMMAND UMUM
        if (messageBody.toLowerCase() === '!aktif') {
            isBotActive = true;
            await msg.reply('🤖 Asisten Reika AKTIF.');
            return;
        }
        if (messageBody.toLowerCase() === '!mati') {
            isBotActive = false;
            await msg.reply('😴 Asisten Reika MATI.');
            return;
        }
        if (messageBody.toLowerCase() === '!ringkasan') {
            if (messageBuffer.length === 0) {
                await msg.reply('Belum ada pesan tersimpan.');
                return;
            }
            await msg.reply('Sedang menyusun ringkasan...');
            const fullLogText = messageBuffer.map(item => item.text).join('\n');
            const summary = await generateGeminiSummary(fullLogText);
            await msg.reply(`📝 *Ringkasan:*\n\n${summary}`);
            messageBuffer = [];
            return;
        }
    }

    // --- LOGIKA UTAMA (AUTO REPLY) ---

    if (isBotActive) {
        let shouldBuffer = false;
        if (chat.isGroup) {
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(c => c.id._serialized === client.info.wid._serialized);
            let isReplyingToMe = false;
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.fromMe) isReplyingToMe = true;
            }
            if (isBotMentioned || isReplyingToMe) shouldBuffer = true;
        } else {
            shouldBuffer = true;
        }

        if (shouldBuffer && !messageBody.startsWith('!')) {
            const nameLabel = msg.fromMe ? "Anda (Owner)" : senderName;
            const chatIdContext = msg.fromMe ? msg.to : msg.from;
            messageBuffer.push({
                chatId: chatIdContext,
                text: `[${nameLabel}]: ${messageBody}`,
                timestamp: Date.now()
            });
        }
    }

    if (isBotActive && !msg.fromMe) {

        let specialContact = null;
        try {
            delete require.cache[require.resolve('./contacts')];
            const contactsList = require('./contacts');
            const incomingNumber = msg.from.replace('@c.us', '');
            specialContact = contactsList.find(c =>
                (c.number && incomingNumber === c.number) ||
                (c.name && senderName.toLowerCase().includes(c.name.toLowerCase()))
            );
            if (specialContact) console.log(`✨ Kontak Spesial: ${specialContact.name}`);
        } catch (err) { }

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
            await processAIResponse(msg, senderName, messageBody, chat.id._serialized, specialContact);
        }

        else {
            const chatId = msg.from;
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

                await processAIResponse(lastMsg, senderName, "", chatId, specialContact);

            }, DEBOUNCE_TIME);

            privateDebounceTimers.set(chatId, timer);
        }
    }
});

async function processAIResponse(msgInstance, senderName, textInput, chatIdContext, specialContact) {
    const chat = await msgInstance.getChat();
    const historyLogs = messageBuffer
        .filter(item => item.chatId === chatIdContext)
        .slice(-20)
        .map(item => item.text)
        .join('\n');

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    const fullResponse = await generateGeminiResponse(senderName, textInput, historyLogs, specialContact);
    const parts = fullResponse.split('|||');
    const chatReply = parts[0].trim();
    if (chatReply) await msgInstance.reply(chatReply);

    if (parts.length > 1) {
        const chatId = msgInstance.from;
        const now = Date.now();
        const lastSentTime = statusCooldowns.get(chatId) || 0;

        if (now - lastSentTime > COOLDOWN_DURATION) {
            const infoStatus = parts[1].trim();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.sendMessage(chatId, infoStatus);
            statusCooldowns.set(chatId, now);
        }
    }
}

async function generateGeminiResponse(sender, text, historyLogs, specialContact) {
    try {
        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        delete require.cache[require.resolve('./prompt')];
        const { getSystemPrompt } = require('./prompt');

        const prompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact);

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
        const prompt = `Ringkasan chat WhatsApp offline:\n${textData}\n\nTugas Kamu (Reika) adalah memaparkan semua chat yang tersimpan selama kamu aktif, posisikan dirimu sebagai Reika yang sedang memaparkan ringkasannya, Buat bullet points per pengirim. Buat juga dan pisahkan bagian yang kamu anggap Penting, Buat dan pisahkan juga hal-hal yang aku (Karel) inginkan untuk dicatat, Bahasa Indonesia.`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        return "Gagal membuat ringkasan.";
    }
}

// --- EVENT HANDLER KHUSUS TELEPON MASUK ---
client.on('incoming_call', async call => {
    if (!isBotActive) return;
    console.log(`📞 Panggilan masuk dari: ${call.from}`);
    const callerNumber = call.from.replace('@c.us', '');
    let specialContact = null;
    try {
        delete require.cache[require.resolve('./contacts')];
        const contactsList = require('./contacts');
        specialContact = contactsList.find(c => c.number === callerNumber);
    } catch (err) { }

    try {
        const toneInstruction = specialContact
            ? `Ini adalah ${specialContact.role} (${specialContact.name}). GAYA BICARA: ${specialContact.instruction}`
            : `Ini teman biasa. GAYA BICARA: Santai, gaul, asyik, pakai gue/elo.`;

        const prompt = `Situasi: Seseorang sedang menelpon Karel di WhatsApp.
        Tugasmu (Reika): Buat SATU pesan chat singkat menyapa penelepon. Tanyakan "Ada yang bisa dibantu?".
        ${toneInstruction}
        Jawablah dengan pesan chat saja (tanpa tanda kutip):`;

        const result = await model.generateContent(prompt);
        const textResponse = result.response.text().trim();
        await client.sendMessage(call.from, textResponse);
    } catch (error) {
        console.error("Error handle call:", error);
    }
});

client.initialize();