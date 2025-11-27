const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- KONFIGURASI ---
require('dotenv').config(); 
const MODEL_API_KEY = process.env.GEMINI_API_KEY; 

if (!MODEL_API_KEY) {
    console.error("❌ ERROR: API Key belum diisi di file .env!");
    process.exit(1);
}

// Inisialisasi Gemini
const genAI = new GoogleGenerativeAI(MODEL_API_KEY);
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
let messageBuffer = []; 

// [FITUR BARU] Variable untuk mencatat waktu terakhir kirim status
// Format: Map<ChatID, Timestamp>
const statusCooldowns = new Map(); 
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 Jam dalam milidetik

// --- EVENT HANDLERS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('SCAN QR CODE DI ATAS DENGAN WHATSAPP!');
});

client.on('ready', () => {
    console.log('Bot Gemini Siap! Ketik "!aktif" di WA untuk menyalakan.');
});

client.on('message', async msg => {
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast') {
        return;
    }

    const chat = await msg.getChat();
    let senderName = msg._data.notifyName || msg.from.split('@')[0];
    if (!senderName) senderName = "Seseorang";

    const messageBody = msg.body;

    // --- COMMANDS PENGENDALI ---
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

        messageBuffer = [];
        return;
    }

    // --- LOGIKA UTAMA ---

    // 1. Jika Bot MATI: Simpan pesan (KECUALI GRUP) ke buffer
    if (!isBotActive && !msg.fromMe && !chat.isGroup) {
        const logEntry = `[${senderName}]: ${messageBody}`;
        messageBuffer.push(logEntry);
        console.log(`Disimpan ke buffer: ${logEntry}`);
    }

    // 2. Jika Bot AKTIF: Balas pesan (PRIBADI & GRUP TAG/REPLY)
    if (isBotActive && !msg.fromMe) {

        // --- FILTER KHUSUS GRUP ---
        if (chat.isGroup) {
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(contact =>
                contact.id._serialized === client.info.wid._serialized
            );

            let isReplyingToMe = false;
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.fromMe) {
                    isReplyingToMe = true;
                }
            }

            if (!isBotMentioned && !isReplyingToMe) {
                return;
            }
            console.log(`Bot merespon di Grup ${chat.name}`);
        }

        // --- PROSES MEMBALAS ---
        if (typeof chat.sendStateTyping === 'function') {
            try { await chat.sendStateTyping(); } catch (err) { }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Minta jawaban lengkap dari Gemini
        const fullResponse = await generateGeminiResponse(senderName, messageBody);

        // --- LOGIKA PEMISAH PESAN & COOLDOWN ---
        const parts = fullResponse.split('|||');

        // Bagian 1: Jawaban Chat (Selalu dikirim)
        const chatReply = parts[0].trim();
        if (chatReply) {
            await msg.reply(chatReply);
        }

        // Bagian 2: Info Status (Hanya dikirim jika Cooldown habis)
        if (parts.length > 1) {
            const chatId = msg.from; // ID Unik Pengirim atau Grup
            const now = Date.now();
            const lastSentTime = statusCooldowns.get(chatId) || 0; // Waktu terakhir kirim (default 0)

            // Cek selisih waktu
            if (now - lastSentTime > COOLDOWN_DURATION) {
                // Jika sudah lebih dari 1 jam (atau belum pernah), KIRIM.
                const infoStatus = parts[1].trim();
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                await client.sendMessage(msg.from, infoStatus);
                
                // Catat waktu pengiriman sekarang
                statusCooldowns.set(chatId, now);
                console.log(`Status Info dikirim ke ${senderName} (Cooldown Reset)`);
            } else {
                // Jika belum 1 jam, JANGAN KIRIM.
                console.log(`Status Info di-SKIP untuk ${senderName} (Masih Cooldown)`);
            }
        }
    }
});

// --- FUNGSI INTERAKSI DENGAN GEMINI ---

async function generateGeminiResponse(sender, text) {
    try {
        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };

        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        const prompt = `
        Konteks Waktu Saat Ini:
        - Hari/Tanggal: ${hariTanggal}
        - Jam: ${jamSekarang} WIB

        Kamu adalah asisten pribadi Karel di WhatsApp.
        Nama lawan bicara: ${sender}.
        Pesan mereka: "${text}".
        
        Instruksi Utama:
        1. Jawab pesan dengan sopan, santai, dan singkat (seperti chat WA biasa).
        2. Gunakan "saya" bukan "aku".
        3. Selalu awali jawaban chat dengan: "*Reika (Asisten AI Pribadi Karel)*" [kasih jarak 1 baris]
        
        Instruksi Pemisahan Pesan:
        Setelah kamu selesai menulis jawaban chat, kamu WAJIB menulis tanda pemisah ini: "|||" (tiga garis tegak lurus).
        Di bawah tanda "|||", barulah kamu menulis status Karel.
        
        Format Output yang WAJIB diikuti:
        [Jawaban Chat Kamu Disini]
        |||
        *[Informasi Karel Saat Ini]*
        ⦁ Status: (Isi sesuai jadwal di bawah. Jika kosong, isi "Kegiatan Organisasi")
        ⦁ Range Waktu: (Isi jamnya, atau "-")
        ⦁ Pesan: Silahkan Ngobrol sama Reika dulu ya, Karel lagi OFF, Chat anda akan diteruskan ke Karel

        [Jadwal Kegiatan Karel]
        Jadwal Rutinitas Karel:
        Tidur + Jam Malam: 21.00 - 06.00

        Jadwal Mata Kuliah Karel:
        Senin
        • Keamanan Informasi: 13:00 - 15:40
        • Manajemen Proyek Informatika: 16:00 - 18:40

        Selasa
        • Olah Raga: 07:00 - 09:00
        • Pemrograman Mobile: 13:55 - 15:40
        • Sistem Informasi: 16:00 - 18:40

        Rabu
        • Praktikum Pemrograman Mobile: 09:00 - 11:00
        • Kewirausahaan: 13:00 - 14:45
        • Audit Sistem Informasi: 17:50 - 20:15

        Kamis
        • Uji Kualitas Perangkat Lunak: 14:50 - 17:45

        Jawablah pesan tersebut sekarang:`;

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