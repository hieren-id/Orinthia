const fs = require('fs');
const path = require('path');

const DB_FILE = path.resolve(__dirname, '../data/database.json');
const NOTE_FILE = path.resolve(__dirname, '../data/urgent_note.txt');

let messageBuffer = [];
let conversationSummaries = [];
let urgentNote = "";

// Load Catatan Mendesak
if (fs.existsSync(NOTE_FILE)) {
    urgentNote = fs.readFileSync(NOTE_FILE, 'utf8');
    console.log(`dY", Catatan Mendesak Dimuat: "${urgentNote}"`);
}

// Load History Chat (Ingatan Abadi) + Summaries
if (fs.existsSync(DB_FILE)) {
    try {
        const rawData = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(rawData);

        if (Array.isArray(parsed)) {
            messageBuffer = parsed;
        } else {
            messageBuffer = Array.isArray(parsed.messages) ? parsed.messages : [];
            conversationSummaries = Array.isArray(parsed.summaries) ? parsed.summaries : [];
        }

        console.log(`dY", Database Dimuat: ${messageBuffer.length} item ingatan.`);
    } catch (err) {
        console.error("Gagal memuat database:", err);
        messageBuffer = [];
        conversationSummaries = [];
    }
}

function saveDatabase() {
    try {
        const dataToSave = {
            messages: messageBuffer.slice(-1000),
            summaries: conversationSummaries.slice(-500)
        };
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

function getMessagesByChat(chatId) {
    return messageBuffer.filter(item => item.chatId === chatId);
}

function clearMessagesByChat(chatId) {
    messageBuffer = messageBuffer.filter(item => item.chatId !== chatId);
    saveDatabase();
}

function addConversationSummary(summary) {
    conversationSummaries.push(summary);
    saveDatabase();
}

function getConversationSummaries() {
    return conversationSummaries;
}

module.exports = {
    saveDatabase,
    saveUrgentNote,
    deleteUrgentNote,
    getUrgentNote,
    getMessageBuffer,
    addMessageToBuffer,
    clearMessageBuffer,
    getMessagesByChat,
    clearMessagesByChat,
    addConversationSummary,
    getConversationSummaries
};
