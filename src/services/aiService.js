const modelGemini = require('../core/gemini');
const { getSystemPrompt } = require('../data/prompt');

// Fungsi Utama: Chat Agentic dengan Gemini (Tanpa Tools)
async function generateAIResponse(sender, text, historyLogs, specialContact, mediaData, urgentNote, retrievedContext) {
    try {
        // Reload prompt (Hot Reload)
        const promptPath = require.resolve('../data/prompt');
        delete require.cache[promptPath];
        const { getSystemPrompt } = require(promptPath);

        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        // System Prompt Awal
        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact, retrievedContext);

        // Gabungkan Prompt dan Pesan User
        const fullPrompt = `${systemPrompt}\n\n[PESAN USER TERAKHIR]:\n${text || "Lanjutkan respons berdasarkan konteks."}`;

        // --- CALL GEMINI ---
        const result = await modelGemini.generateContent(fullPrompt);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error("Error Gemini:", error);
        return "Maaf, Reika sedang gangguan (Gemini Error).";
    }
}

// Fungsi Vision
async function generateVisionResponse(text, mediaData) {
    try {
        const model = modelGemini;
        const prompt = text || "Jelaskan gambar ini.";
        const imagePart = {
            inlineData: {
                mimeType: mediaData.mimetype,
                data: mediaData.data
            }
        };
        const result = await model.generateContent([prompt, imagePart]);
        return result.response.text();
    } catch (e) {
        return "Gagal melihat gambar.";
    }
}

async function generateGeminiSummary(textData) {
    try {
        const model = modelGemini;
        const prompt = `Ringkasan chat WhatsApp offline:\n${textData}\n\nBuat bullet points per pengirim. Bahasa Indonesia.`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        return "Gagal membuat ringkasan.";
    }
}

module.exports = {
    generateAIResponse,
    generateGeminiSummary,
    generateVisionResponse
};