// FILE: tools.js
// Definisi Tools dalam format standar OpenAI/Groq

const fs = require('fs');
const { searchRelevantContext } = require('../services/ragService');

const NOTE_FILE = './urgent_note.txt';

// 1. Definisi Tools (Format JSON Schema untuk Llama 3)
const toolsDefinition = [
    {
        type: "function",
        function: {
            name: "manageUrgentNote",
            description: "Alat untuk MEMBUAT atau MENGHAPUS catatan mendesak/status Karel. Gunakan saat user minta update status.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "delete"],
                        description: "'create' untuk simpan catatan baru, 'delete' untuk hapus."
                    },
                    content: {
                        type: "string",
                        description: "Isi teks catatan yang mau disimpan (Wajib jika action='create')."
                    }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "consultKnowledgeBase",
            description: "Alat untuk MENCARI fakta/memori masa lalu tentang Karel dari Database. Gunakan saat user tanya hal spesifik tentang Karel.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Kata kunci pencarian."
                    }
                },
                required: ["query"]
            }
        }
    }
];

// 2. Implementasi Fungsi (Logika JS Asli)
const toolsImplementation = {
    manageUrgentNote: async ({ action, content }) => {
        try {
            if (action === 'delete') {
                if (fs.existsSync(NOTE_FILE)) fs.unlinkSync(NOTE_FILE);
                return "Catatan mendesak berhasil dihapus. Jadwal kembali normal.";
            } else {
                fs.writeFileSync(NOTE_FILE, content || "");
                return `Berhasil mencatat: "${content}". Info ini sekarang aktif.`;
            }
        } catch (error) {
            return `Gagal mengelola catatan: ${error.message}`;
        }
    },

    consultKnowledgeBase: async ({ query }) => {
        try {
            console.log(`🧠 Reika (Llama) sedang mengingat: "${query}"...`);
            const result = await searchRelevantContext(query);
            if (!result || result.length < 5) return "Tidak ditemukan informasi relevan di ingatan.";
            return `FAKTA DITEMUKAN DARI INGATAN: ${result}`;
        } catch (error) {
            return `Gagal akses memori: ${error.message}`;
        }
    }
};

module.exports = { toolsDefinition, toolsImplementation };