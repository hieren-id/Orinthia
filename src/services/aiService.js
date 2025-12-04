const geminiModel = require('../core/gemini');
const { getSystemPrompt } = require('../data/prompt');

function formatDateTime() {
    const now = new Date();
    const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
    const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
    return {
        hariTanggal: now.toLocaleDateString('id-ID', optionsDate),
        jamSekarang: now.toLocaleTimeString('id-ID', optionsTime)
    };
}

async function generateAIResponse(sender, text, historyLogs, specialContact, urgentNote, retrievedContext) {
    try {
        const { hariTanggal, jamSekarang } = formatDateTime();
        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact, retrievedContext);
        const fullPrompt = `${systemPrompt}\n\n[PESAN USER TERAKHIR]:\n${text || "Lanjutkan respons berdasarkan konteks."}`;

        const result = await geminiModel.generateContent(fullPrompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error Gemini:", error);
        return "Maaf, Reika sedang gangguan (Gemini Error).";
    }
}

async function generateVisionResponse(text, mediaData) {
    try {
        const prompt = text || "Jelaskan gambar ini.";
        const imagePart = {
            inlineData: {
                mimeType: mediaData.mimetype,
                data: mediaData.data
            }
        };
        const result = await geminiModel.generateContent([prompt, imagePart]);
        return result.response.text();
    } catch (e) {
        return "Gagal melihat gambar.";
    }
}

async function generateGeminiSummary(textData) {
    try {
        const prompt = `Ringkasan chat WhatsApp offline:\n${textData}\n\nBuat bullet points per pengirim. Bahasa Indonesia.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        return "Gagal membuat ringkasan.";
    }
}

async function generateCallResponse(callerNumber, specialContact) {
    const target = specialContact ? `${specialContact.role} ${specialContact.name}` : callerNumber;
    return `Halo ${target}, Reika tidak bisa menerima panggilan sekarang. Silakan kirim pesan chat ya.`;
}

module.exports = {
    generateAIResponse,
    generateGeminiSummary,
    generateVisionResponse,
    generateCallResponse
};
