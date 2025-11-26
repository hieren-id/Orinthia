const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- KONFIGURASI ---
// 1. Masukkan API Key Gemini kamu di sini
const MODEL_API_KEY = "AIzaSyDiGaHUJYYodUziYe9jr8g684wbdq-OMvg";

// Inisialisasi Gemini
const genAI = new GoogleGenerativeAI(MODEL_API_KEY);
// Kita pakai model 'flash' karena lebih cepat dan hemat untuk chat
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        

// Inisialisasi WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    headless: true, // Wajib true di server
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
    puppeteer: {
        args: ['--no-sandbox'] // Tambahan argumen agar stabil di beberapa OS
    }
});

// --- STATE VARIABLES ---
let isBotActive = false; // Status bot (Aktif/Mati)
let messageBuffer = [];  // Penampung pesan saat offline

// --- EVENT HANDLERS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('SCAN QR CODE DI ATAS DENGAN WHATSAPP!');
});

client.on('ready', () => {
    console.log('Bot Gemini Siap! Ketik "!aktif" di WA untuk menyalakan.');
});

client.on('message', async msg => {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.number;
    const messageBody = msg.body;

    // --- FILTER BARU: ABAIKAN CHANNEL & STATUS ---
    // 1. Cek jika pesan dari Channel/Saluran (id berakhiran @newsletter)
    if (msg.from.includes('@newsletter')) {
        return; // Langsung berhenti, jangan diproses
    }

    // 2. Cek jika pesan adalah Status Update orang lain (id status@broadcast)
    if (msg.from === 'status@broadcast') {
        return; // Langsung berhenti
    }

    // --- COMMANDS PENGENDALI (Hanya merespon perintah dari kamu/pemilik) ---
    // Gunakan msg.fromMe jika ingin trigger dari HP sendiri
    // Gunakan pengecekan nomor jika ingin trigger dari HP lain

    if (messageBody.toLowerCase() === '!aktif') {
        isBotActive = true;
        await msg.reply('🤖 Asisten Gemini AKTIF. Saya akan membalas pesan masuk.');
        console.log('Bot diaktifkan.');
        return;
    }

    if (messageBody.toLowerCase() === '!mati') {
        isBotActive = false;
        await msg.reply('😴 Asisten Gemini MATI. Silakan handle chat sendiri.');
        console.log('Bot dimatikan.');
        return;
    }

    if (messageBody.toLowerCase() === '!ringkasan' && msg.fromMe) {
        if (messageBuffer.length === 0) {
            await msg.reply('Belum ada pesan tersimpan untuk diringkas.');
            return;
        }

        await msg.reply('Sedang menyusun ringkasan...');
        const summary = await generateGeminiSummary(messageBuffer.join('\n'));
        await msg.reply(`📝 *Ringkasan Pesan Masuk:*\n\n${summary}`);

        messageBuffer = []; // Kosongkan buffer setelah diringkas
        return;
    }

    // --- LOGIKA UTAMA ---

    // 1. Jika Bot MATI: Simpan pesan orang lain ke buffer untuk diringkas nanti
    if (!isBotActive && !msg.fromMe && !chat.isGroup) {
        // Format: [Nama Pengirim]: Isi Pesan
        const logEntry = `[${senderName}]: ${messageBody}`;
        messageBuffer.push(logEntry);
        console.log(`Disimpan ke buffer: ${logEntry}`);
    }

    // 2. Jika Bot AKTIF: Balas pesan orang lain (Auto Reply)
    if (isBotActive && !msg.fromMe && !chat.isGroup) {

        // --- PERBAIKAN: Bungkus dengan Try-Catch atau If ---
        // Cek dulu apakah fungsi sendStateTyping ada di objek chat
        if (typeof chat.sendStateTyping === 'function') {
            try {
                await chat.sendStateTyping();
            } catch (err) {
                console.log("Gagal mengirim status 'mengetik', tapi bot tetap jalan.");
            }
        }

        // Beri jeda sedikit (opsional, misal 2 detik)
        await new Promise(resolve => setTimeout(resolve, 2000));
        // ...

        const aiReply = await generateGeminiResponse(senderName, messageBody);
        await msg.reply(aiReply);
        console.log(`Membalas ${senderName}: ${aiReply}`);
    }
});

// --- FUNGSI INTERAKSI DENGAN GEMINI ---

async function generateGeminiResponse(sender, text) {
    try {
        // Prompt Engineering agar gaya bahasa pas
        const prompt = `
        Kamu adalah asisten pribadi Karel di WhatsApp.
        Nama lawan bicara: ${sender}.
        Pesan mereka: "${text}".
        
        Selalu tambahkan tulisan ini di awal chat kamu: "Reika (Asisten AI Pribadi Karel):" [kasih jarak 1 baris setelahnya]

        Selalu tambahkan tulisan ini di akhir chat kamu: "[Note: Chat ini dikirim otomatis oleh AI, segala interaksi akan diteruskan ke Karel]" [kasih jarak 1 baris sebelumnya]
        
        Instruksi:
        1. Jawab dengan sopan, santai, dan singkat (seperti chat WA biasa).
        2. Jangan gunakan bahasa kaku/robot.
        3. Jika mereka bertanya hal teknis, jawab semampunya.
        4. Jangan gunakan salam pembuka yang berlebihan berulang-ulang.
        5. Jangan pakai "aku" gunakanlah "saya"
        
        Jawablah pesan tersebut:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error Gemini:", error);
        return "Maaf, saya sedang gangguan sebentar.";
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