const fs = require('fs');
const path = require('path');

const DB_FILE = path.resolve(__dirname, '../../database.json');
const NOTE_FILE = path.resolve(__dirname, '../../urgent_note.txt');

let messageBuffer = [];
let urgentNote = "";

// Load Catatan Mendesak
if (fs.existsSync(NOTE_FILE)) {
    urgentNote = fs.readFileSync(NOTE_FILE, 'utf8');
    console.log(`📂 Catatan Mendesak Dimuat: "${urgentNote}"`);
}

// Load History Chat (Ingatan Abadi)
if (fs.existsSync(DB_FILE)) {
    try {
        const rawData = fs.readFileSync(DB_FILE, 'utf8');
        messageBuffer = JSON.parse(rawData);
        console.log(`📂 Database Dimuat: ${messageBuffer.length} item ingatan.`);
    } catch (err) {
        console.error("Gagal memuat database:", err);
        messageBuffer = [];
    }
}

function saveDatabase() {
    try {
        // Batasi ukuran file, misal simpan 200 pesan terakhir saja agar file tidak bengkak
        const dataToSave = messageBuffer.slice(-200);
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
        console.error("Gagal menyimpan database:", err);
    }
}

function saveUrgentNote(note) {
    urgentNote = note;
    fs.writeFileSync(NOTE_FILE, urgentNote);
}

function deleteUrgentNote() {
    urgentNote = "";
    if (fs.existsSync(NOTE_FILE)) fs.unlinkSync(NOTE_FILE);
}

function getUrgentNote() {
    return urgentNote;
}

function getMessageBuffer() {
    return messageBuffer;
}

function addMessageToBuffer(message) {
    messageBuffer.push(message);
    saveDatabase();
}

function clearMessageBuffer() {
    messageBuffer = [];
    saveDatabase();
}

module.exports = {
    saveDatabase,
    saveUrgentNote,
    deleteUrgentNote,
    getUrgentNote,
    getMessageBuffer,
    addMessageToBuffer,
    clearMessageBuffer
};
