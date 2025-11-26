const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- KONFIGURASI ---
require('dotenv').config(); // Load library dotenv
const MODEL_API_KEY = process.env.GEMINI_API_KEY; // Ambil dari file .env

// Pengecekan agar tidak error jika lupa bikin file .env
if (!MODEL_API_KEY) {
    console.error("❌ ERROR: API Key belum diisi di file .env!");
    process.exit(1);
}

// Inisialisasi Gemini
const genAI = new GoogleGenerativeAI(MODEL_API_KEY);

// --- PERBAIKAN MODEL: Gunakan 1.5-flash (2.5 belum tersedia) ---
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

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
    // --- FILTER BARU: ABAIKAN CHANNEL & STATUS ---
    if (msg.from.includes('@newsletter') || msg.from === 'status@broadcast') {
        return;
    }

    const chat = await msg.getChat();
    // Ambil nama pengirim (Fallback yang aman)
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

        // --- FILTER KHUSUS GRUP: HANYA BALAS JIKA DI-TAG ATAU DI-REPLY ---
        if (chat.isGroup) {
            // Cek 1: Apakah di-tag?
            const mentions = await msg.getMentions();
            const isBotMentioned = mentions.some(contact =>
                contact.id._serialized === client.info.wid._serialized
            );

            // Cek 2: Apakah me-reply pesan kita?
            let isReplyingToMe = false;
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                // quotedMsg.fromMe = true artinya pesan yang dikutip adalah pesan yang dikirim oleh akun ini (kita)
                if (quotedMsg.fromMe) {
                    isReplyingToMe = true;
                }
            }

            // Jika TIDAK ditag DAN TIDAK mereply pesan kita -> STOP
            if (!isBotMentioned && !isReplyingToMe) {
                return;
            }
            console.log(`Bot merespon di Grup ${chat.name} (Tag: ${isBotMentioned}, Reply: ${isReplyingToMe})`);
        }

        // --- PROSES MEMBALAS ---
        if (typeof chat.sendStateTyping === 'function') {
            try { await chat.sendStateTyping(); } catch (err) { }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Minta jawaban lengkap dari Gemini (berisi separator |||)
        const fullResponse = await generateGeminiResponse(senderName, messageBody);

        // --- LOGIKA PEMISAH PESAN ---
        // Kita pecah text berdasarkan tanda "|||"
        const parts = fullResponse.split('|||');

        // Bagian 1: Jawaban Chat (selalu ada)
        const chatReply = parts[0].trim();
        if (chatReply) {
            await msg.reply(chatReply);
        }

        // Bagian 2: Info Status (hanya dikirim jika ada isinya)
        if (parts.length > 1) {
            const infoStatus = parts[1].trim();
            // Beri jeda 1 detik agar urutan pesan enak dibaca
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Kirim info status (Gunakan sendMessage agar tidak me-reply balon chat sebelumnya, tapi pesan terpisah)
            await client.sendMessage(msg.from, infoStatus);
        }
        
        console.log(`Membalas ${senderName}`);
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