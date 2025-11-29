const fs = require('fs');
const { searchRelevantContext } = require('./ragService');

const NOTE_FILE = './urgent_note.txt';

// 1. Definisi Tools (Ini yang dibaca oleh Gemini agar dia tahu dia punya alat apa saja)
const toolsDefinition = [
    {
        functionDeclarations: [
            {
                name: "manageUrgentNote",
                description: "Gunakan alat ini untuk MEMBUAT, MENGUBAH, atau MENGHAPUS catatan mendesak (Urgent Note) milik Karel. Gunakan ini jika user meminta mencatat status/kondisi terkini atau meminta menghapus catatan.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        action: {
                            type: "STRING",
                            description: "Pilih aksi: 'create' untuk membuat/menimpa catatan, 'delete' untuk menghapus catatan.",
                            enum: ["create", "delete"]
                        },
                        content: {
                            type: "STRING",
                            description: "Isi catatan yang ingin disimpan (Hanya wajib jika action='create')."
                        }
                    },
                    required: ["action"]
                }
            },
            {
                name: "consultKnowledgeBase",
                description: "Gunakan alat ini untuk MENCARI fakta, kenangan, atau informasi tentang Karel di masa lalu dari Database Ingatan. Gunakan ini jika user bertanya tentang biodata, sejarah, janji, atau preferensi Karel yang mungkin tersimpan di arsip.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        query: {
                            type: "STRING",
                            description: "Kata kunci pencarian yang spesifik."
                        }
                    },
                    required: ["query"]
                }
            }
        ]
    }
];

// 2. Implementasi Fungsi (Apa yang terjadi saat alat dipakai)
const toolsImplementation = {
    manageUrgentNote: ({ action, content }) => {
        try {
            if (action === 'delete') {
                if (fs.existsSync(NOTE_FILE)) fs.unlinkSync(NOTE_FILE);
                return { status: "success", message: "Catatan mendesak berhasil dihapus." };
            } else {
                fs.writeFileSync(NOTE_FILE, content || "");
                return { status: "success", message: `Catatan berhasil disimpan: "${content}"` };
            }
        } catch (error) {
            return { status: "error", message: error.message };
        }
    },

    consultKnowledgeBase: async ({ query }) => {
        try {
            console.log(`🧠 Reika sedang mengingat-ingat tentang: "${query}"...`);
            const result = await searchRelevantContext(query);
            if (!result) return { found: false, message: "Tidak ditemukan informasi relevan di ingatan." };
            return { found: true, context: result };
        } catch (error) {
            return { status: "error", message: error.message };
        }
    }
};

module.exports = { toolsDefinition, toolsImplementation };
