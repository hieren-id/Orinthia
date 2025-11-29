const model = require('../core/gemini');
const { getSystemPrompt } = require('../data/prompt');
const { searchRelevantContext } = require('./ragService');

async function generateGeminiResponse(sender, text, historyLogs, specialContact, mediaData, urgentNote) {
    try {
        const now = new Date();
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const hariTanggal = now.toLocaleDateString('id-ID', optionsDate);
        const jamSekarang = now.toLocaleTimeString('id-ID', optionsTime);

        // Reload prompt to ensure fresh data if modified
        const promptPath = require.resolve('../data/prompt');
        delete require.cache[promptPath];
        const { getSystemPrompt } = require(promptPath);

        // RAG Retrieval
        let retrievedContext = "";
        if (text && text.length > 5) {
            retrievedContext = await searchRelevantContext(text);
        }

        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact, retrievedContext);

        const payload = [];
        payload.push(systemPrompt);

        if (mediaData) {
            payload.push({
                inlineData: {
                    mimeType: mediaData.mimetype,
                    data: mediaData.data
                }
            });
            payload.push("Ini adalah gambar yang dikirim oleh lawan bicara. Jelaskan atau tanggapi gambar ini sesuai konteks chat.");
        }

        if (text) payload.push(text);

        const result = await model.generateContent(payload);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error("Error Gemini:", error);
        return "*Reika (Asisten AI Pribadi Karel):* Maaf, mata saya agak buram (Error memproses gambar/pesan).";
    }
}

async function generateGeminiSummary(textData) {
    try {
        const prompt = `Ringkasan chat WhatsApp offline:\n${textData}\n\nBuat bullet points per pengirim. Bahasa Indonesia.`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        return "Gagal membuat ringkasan.";
    }
}

async function generateCallResponse(callerNumber, specialContact) {
    try {
        const toneInstruction = specialContact
            ? `Ini adalah ${specialContact.role} (${specialContact.name}). GAYA BICARA: ${specialContact.instruction}`
            : `Ini teman biasa. GAYA BICARA: Santai, gaul, asyik, pakai gue/elo.`;

        const prompt = `Situasi: Seseorang sedang menelpon Karel di WhatsApp.
        Tugasmu (Reika): Buat SATU pesan chat singkat menyapa penelepon. Tanyakan "Ada yang bisa dibantu?".
        ${toneInstruction}
        Jawablah dengan pesan chat saja (tanpa tanda kutip):`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error("Error handle call:", error);
        return "Maaf, Karel sedang tidak bisa menjawab telepon saat ini.";
    }
}

module.exports = {
    generateGeminiResponse,
    generateGeminiSummary,
    generateCallResponse
};
