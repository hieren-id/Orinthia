// FILE: index.js
// UPDATE TAHAP 2: MENAMBAHKAN VISION (MATA)

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
// Gunakan 1.5 Flash karena dia Multimodal (Bisa Teks & Gambar)
// Dan tambahkan tools googleSearch untuk Tahap 1 (Grounding)
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    tools: [
        { googleSearch: {} } // Fitur Googling (Tahap 1)
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

if (fs.existsSync('./urgent_note.txt')) {
    urgentNote = fs.readFileSync('./urgent_note.txt', 'utf8');
    console.log(`Memuat Catatan Mendesak: "${urgentNote}"`);
}

const privateMessageQueues = new Map();
const privateDebounceTimers = new Map();
const DEBOUNCE_TIME = 10000; 
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

        // 1. CHAT REIKA
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

            // Simpan ke buffer (Teks saja untuk history)
            messageBuffer.push({
                chatId: chatIdContext,
                text: `[Karel (Owner)]: ${userQuery} ${media ? '[MENGIRIM GAMBAR]' : ''}`,
                timestamp: Date.now()
            });

            const historyLogs = messageBuffer
                .filter(item => item.chatId === chatIdContext)
                .slice(-20) 
                .map(item => item.text)
                .join('\n');

            // Generate dengan Media
            const responseText = await generateGeminiResponse("Karel (Owner)", userQuery, historyLogs, null, media);
            
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

        // 2. INPUT CATATAN
        if (isWaitingForNote) {
            if (messageBody.includes('Silahkan tambahkan catatan mendesak')) return;
            urgentNote = messageBody;
            fs.writeFileSync('./urgent_note.txt', urgentNote);
            isWaitingForNote = false; 
            await msg.reply(`✅ Catatan tersimpan: "${urgentNote}"`);
            return; 
        }

        if (messageBody.toLowerCase() === '!ctt') {
            isWaitingForNote = true;
            await msg.reply('✍️ Silahkan tambahkan catatan mendesak.');
            return;
        }
        if (messageBody.toLowerCase() === '!ctthps') {
            urgentNote = "";
            isWaitingForNote = false;
            if (fs.existsSync('./urgent_note.txt')) fs.unlinkSync('./urgent_note.txt');
            await msg.reply('🗑️ Catatan dihapus.');
            return;
        }
        if (messageBody.toLowerCase() === '!cekctt') {
            await msg.reply(urgentNote ? `📝 Catatan: "${urgentNote}"` : '✅ Tidak ada catatan aktif.');
            return;
        }
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

    // 1. DOWNLOAD MEDIA (VISION)
    let incomingMedia = null;
    if (isBotActive && msg.hasMedia) {
        try {
            const attachment = await msg.downloadMedia();
            // Hanya proses jika itu GAMBAR (image/jpeg, image/png, dll)
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
            // Tandai di log kalau ada gambar
            const textContent = incomingMedia ? `[MENGIRIM GAMBAR] ${messageBody}` : messageBody;
            
            messageBuffer.push({
                chatId: chatIdContext,
                text: `[${nameLabel}]: ${textContent}`,
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
        } catch (err) {}
        
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
            // Kirim Media ke fungsi process
            await processAIResponse(msg, senderName, messageBody, chat.id._serialized, specialContact, incomingMedia);
        } 
        
        else {
            const chatId = msg.from;
            
            // JIKA ADA GAMBAR, JANGAN PAKAI DEBOUNCE (LANGSUNG PROSES)
            // Karena menggabungkan gambar dalam antrian itu rumit.
            if (incomingMedia) {
                if (privateDebounceTimers.has(chatId)) clearTimeout(privateDebounceTimers.get(chatId));
                privateMessageQueues.delete(chatId);
                
                await processAIResponse(msg, senderName, messageBody, chatId, specialContact, incomingMedia);
                return;
            }

            // LOGIKA DEBOUNCE (Hanya Teks)
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

                // Media di queue teks dianggap null (karena logika di atas sudah handle direct image)
                await processAIResponse(lastMsg, senderName, "", chatId, specialContact, null); 

            }, DEBOUNCE_TIME);

            privateDebounceTimers.set(chatId, timer);
        }
    }
});

// Update fungsi processAIResponse untuk menerima MEDIA
async function processAIResponse(msgInstance, senderName, textInput, chatIdContext, specialContact, mediaData) {
    const chat = await msgInstance.getChat();
    const historyLogs = messageBuffer
        .filter(item => item.chatId === chatIdContext)
        .slice(-20) 
        .map(item => item.text)
        .join('\n');

    if (typeof chat.sendStateTyping === 'function') {
        try { await chat.sendStateTyping(); } catch (err) { }
    }
    
    // Jika ada gambar, delay dikit biar loading gambar kerasa wajar
    await new Promise(resolve => setTimeout(resolve, mediaData ? 3000 : 2000));

    // Panggil Gemini dengan Media
    const fullResponse = await generateGeminiResponse(senderName, textInput, historyLogs, specialContact, mediaData);
    
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

// Update fungsi generateGeminiResponse untuk handle MULTIMODAL
async function generateGeminiResponse(sender, text, historyLogs, specialContact, mediaData) {
    try {
        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        delete require.cache[require.resolve('./prompt')];
        const { getSystemPrompt } = require('./prompt');

        // Jika ada gambar, kita kasih info ke prompt
        const imageContext = mediaData ? "[USER MENGIRIM GAMBAR/FOTO]" : "";
        
        // Rakit Prompt Teks
        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact);
        
        // --- KONSTRUKSI PAYLOAD GEMINI (MULTIMODAL) ---
        // Kita menyusun array: [SystemPrompt, Gambar (Opsional), Pesan User]
        
        const payload = [];
        
        // 1. Masukkan System Prompt
        payload.push(systemPrompt);

        // 2. Masukkan Gambar (Jika ada)
        if (mediaData) {
            payload.push({
                inlineData: {
                    mimeType: mediaData.mimetype,
                    data: mediaData.data // Ini string Base64
                }
            });
            payload.push("Ini adalah gambar yang dikirim oleh lawan bicara. Jelaskan atau tanggapi gambar ini sesuai konteks chat.");
        }

        // 3. Masukkan Pesan User (Jika ada teks caption di gambar, atau teks biasa)
        if (text) {
            payload.push(text);
        }

        // Panggil Gemini dengan Payload Array
        const result = await model.generateContent(payload);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error("Error Gemini:", error);
        return "*Reika (Asisten AI Pribadi Karel):* Maaf, mata saya agak buram (Error memproses gambar/pesan).";
    }
}

async function generateGeminiSummary(textData) {
    try {
        const prompt = `Ringkasan chat WhatsApp offline:\n${textData}\n\nBuat bullet points per pengirim. Bahasa Indonesia.`;
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
    } catch (err) {}

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