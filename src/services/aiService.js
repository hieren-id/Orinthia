const fs = require('fs');
const os = require('os');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const groqClient = require('../core/groq');
const { GROQ_API_KEY, GEMINI_API_KEY } = require('../config/env');
const { getSystemPrompt } = require('../data/prompt');

const TEXT_MODEL = 'gemma-3-27b-it';
const GEMINI_VISION_MODEL = 'gemma-3-27b-it';
const VOICE_MODEL = 'whisper-large-v3-turbo';

const googleClient = new GoogleGenerativeAI(GEMINI_API_KEY);
const gemmaModel = googleClient.getGenerativeModel({ model: TEXT_MODEL });
const visionModel = googleClient.getGenerativeModel({ model: GEMINI_VISION_MODEL });

function formatDateTime() {
    const now = new Date();
    const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
    const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
    return {
        hariTanggal: now.toLocaleDateString('id-ID', optionsDate),
        jamSekarang: now.toLocaleTimeString('id-ID', optionsTime)
    };
}

function extractTextFromCompletion(completion) {
    const choice = completion?.choices?.[0];
    if (!choice) return '';

    const messageContent = choice.message?.content;
    if (Array.isArray(messageContent)) {
        return messageContent.map(part => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            return '';
        }).join('').trim();
    }

    return (messageContent || '').trim();
}

async function createGeminiCompletion(prompt, { temperature = 0.4, maxOutputTokens = 2048 } = {}) {
    const result = await gemmaModel.generateContent({
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {
            temperature,
            maxOutputTokens
        }
    });
    const text = await result.response.text();
    return text?.trim?.() || '';
}

async function generateAIResponse(sender, text, historyLogs, specialContact, urgentNote, retrievedContext) {
    try {
        const { hariTanggal, jamSekarang } = formatDateTime();
        const systemPrompt = getSystemPrompt(
            hariTanggal,
            jamSekarang,
            sender,
            historyLogs,
            urgentNote,
            specialContact,
            retrievedContext
        );

        const userPrompt = text?.trim() ? text : "Lanjutkan respons berdasarkan konteks.";

        const fullPrompt = `${systemPrompt}\n\n[PESAN USER TERAKHIR]:\n${userPrompt}`;

        const responseText = await createGeminiCompletion(fullPrompt);

        return responseText || "Maaf, Reika belum bisa menjawab saat ini.";
    } catch (error) {
        console.error("Error Gemini Chat:", error);
        return "Maaf, Reika sedang gangguan (Gemini Error).";
    }
}

async function generateVisionResponse(text, mediaData) {
    if (!mediaData) {
        return "Tidak ada media yang bisa dianalisis.";
    }

    const prompt = text?.trim() ? text : "Jelaskan media ini secara detail.";
    const base64Data = mediaData.data;

    try {
        const result = await visionModel.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { inlineData: { data: base64Data, mimeType: mediaData.mimetype } }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024
            }
        });

        const textResp = await result.response.text();
        return textResp?.trim?.() || "Tidak ada respons dari analisis gambar.";
    } catch (error) {
        console.error("Error Vision Gemini:", error);
        return "Maaf, belum bisa membaca media yang dikirim.";
    }
}

async function generateGroqSummary(textData) {
    try {
        const prompt = [
            "Buat ringkasan percakapan WhatsApp dalam bahasa Indonesia.",
            "- Format bullet point per pengirim.",
            "- Ambil informasi penting saja.",
            "- Tetap singkat."
        ].join('\n');

        return await createGeminiCompletion(`${prompt}\n\n${textData}`, { temperature: 0.2, maxOutputTokens: 1024 });
    } catch (error) {
        console.error("Error membuat ringkasan:", error);
        return "Gagal membuat ringkasan.";
    }
}

async function transcribeVoiceNote(mediaData) {
    if (!mediaData?.data) return '';

    const extension = guessExtension(mediaData.mimetype);
    const tempFile = path.join(os.tmpdir(), `reika-voice-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
    const buffer = Buffer.from(mediaData.data, 'base64');

    await fs.promises.writeFile(tempFile, buffer);

    try {
        const transcription = await groqClient.audio.transcriptions.create({
            file: fs.createReadStream(tempFile),
            model: VOICE_MODEL,
            language: 'id',
            temperature: 0.2
        });

        return transcription?.text?.trim() || '';
    } catch (error) {
        console.error("Error transkripsi voice note:", error);
        return '';
    } finally {
        fs.promises.unlink(tempFile).catch(() => { });
    }
}

function guessExtension(mimetype = '') {
    const cleanType = (mimetype.split(';')[0] || '').toLowerCase();
    if (cleanType.endsWith('ogg') || cleanType.includes('opus')) return 'ogg';
    if (cleanType.includes('mpeg')) return 'mp3';
    if (cleanType.includes('mp4')) return 'mp4';
    if (cleanType.includes('wav')) return 'wav';
    if (cleanType.includes('webm')) return 'webm';
    return 'tmp';
}

async function generateCallResponse(callerNumber, specialContact) {
    const target = specialContact ? `${specialContact.role} ${specialContact.name}` : callerNumber;
    return `Halo ${target}, Reika tidak bisa menerima panggilan sekarang. Silakan kirim pesan chat ya.`;
}

module.exports = {
    generateAIResponse,
    generateGroqSummary,
    generateVisionResponse,
    generateCallResponse,
    transcribeVoiceNote
};
