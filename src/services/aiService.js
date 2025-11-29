const { genAI } = require('../core/gemini');
const { getSystemPrompt } = require('../data/prompt');
const { toolsDefinition, toolsImplementation } = require('./toolService');
const { getUrgentNote } = require('../database/db');

// Initialize model with tools
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [
        { googleSearch: {} },
        ...toolsDefinition
    ]
});

async function generateAgenticResponse(sender, text, historyLogs, specialContact, mediaData) {
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

        const currentUrgentNote = getUrgentNote();

        // Initial System Prompt (Context is empty initially, retrieved via tool if needed)
        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, currentUrgentNote, specialContact, "");

        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] }
            ]
        });

        const userParts = [];
        if (mediaData) {
            userParts.push({
                inlineData: {
                    mimeType: mediaData.mimetype,
                    data: mediaData.data
                }
            });
            userParts.push({ text: "Lihat gambar ini." });
        }
        if (text) {
            userParts.push({ text: text });
        } else if (userParts.length === 0) {
            // Jika tidak ada text dan tidak ada media (misal dari debounce),
            // pancing AI untuk merespons berdasarkan history yang sudah ada di system prompt.
            userParts.push({ text: "Silahkan respons pesan terakhir dari riwayat chat di atas." });
        }

        let result = await chat.sendMessage(userParts);
        let response = await result.response;

        // Function Calling Loop
        while (response.functionCalls()) {
            const calls = response.functionCalls();
            const functionResponses = [];

            for (const call of calls) {
                const fnName = call.name;
                const fnArgs = call.args;

                console.log(`🛠️ Reika memanggil alat: ${fnName}`, fnArgs);

                let functionResult;
                if (toolsImplementation[fnName]) {
                    functionResult = await toolsImplementation[fnName](fnArgs);
                } else {
                    functionResult = { error: "Fungsi tidak ditemukan" };
                }

                functionResponses.push({
                    functionResponse: {
                        name: fnName,
                        response: functionResult
                    }
                });
            }

            result = await chat.sendMessage(functionResponses);
            response = await result.response;
        }

        return response.text();

    } catch (error) {
        console.error("Error Agentic Loop:", error);
        return "Maaf, sistem saya sedang mengalami gangguan teknis.";
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
    generateAgenticResponse,
    generateGeminiSummary,
    generateCallResponse
};
