// FILE: index.js
// Ini adalah file UTAMA untuk menjalankan bot.

const qrcode = require('qrcode-terminal');
const client = require('./src/core/whatsapp');
const handleMessage = require('./src/handlers/messageHandler');
const handleIncomingCall = require('./src/handlers/callHandler');
const { initializeKnowledgeBase } = require('./src/services/ragService');

// --- EVENT HANDLERS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('SCAN QR CODE DI ATAS DENGAN WHATSAPP!');
});

client.on('ready', async () => {
    console.log('Bot Reika siap! Ketik "!aktif" di WA untuk menyalakan.');
    await initializeKnowledgeBase();
});

client.on('message_create', handleMessage);

client.on('incoming_call', handleIncomingCall);

client.initialize();
