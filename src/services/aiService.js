const groq = require('../core/groq'); 
const modelGemini = require('../core/gemini'); 
const { getSystemPrompt } = require('../data/prompt');
const { toolsDefinition, toolsImplementation } = require('../data/tools'); 

// Fungsi Utama: Chat Agentic dengan Groq
async function generateGroqResponse(sender, text, historyLogs, specialContact, mediaData, urgentNote) {
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
        const systemPrompt = getSystemPrompt(hariTanggal, jamSekarang, sender, historyLogs, urgentNote, specialContact, "");

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: text || "Lanjutkan respons berdasarkan konteks." }
        ];

        // --- MENGGUNAKAN MODEL PILIHANMU ---
        const MODEL_NAME = "openai/gpt-oss-120b"; 

        // --- CALL 1: REQUEST KE GROQ ---
        // Menggunakan syntax groq-sdk sesuai template kamu
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: MODEL_NAME,
            tools: toolsDefinition, // Sertakan tools
            tool_choice: "auto",
            temperature: 0.7,
            max_completion_tokens: 4096, // Dibatasi biar gak kepanjangan di WA
            top_p: 1,
            stream: false, // Kita butuh full response buat diproses logic WA
            reasoning_effort: "medium"
        });

        const responseMsg = chatCompletion.choices[0].message;

        // --- LOOP: JIKA MEMANGGIL ALAT (TOOL CALLS) ---
        if (responseMsg.tool_calls) {
            messages.push(responseMsg); // Simpan history thinking AI

            for (const toolCall of responseMsg.tool_calls) {
                const fnName = toolCall.function.name;
                const fnArgs = JSON.parse(toolCall.function.arguments);
                
                console.log(`🛠️ Reika (Groq) memakai alat: ${fnName}`);
                
                let fnResult = JSON.stringify({ error: "Fungsi tidak ditemukan" });
                if (toolsImplementation[fnName]) {
                    const rawResult = await toolsImplementation[fnName](fnArgs);
                    fnResult = typeof rawResult === 'object' ? JSON.stringify(rawResult) : rawResult;
                }

                // Masukkan hasil alat ke history
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: fnName,
                    content: fnResult
                });
            }

            // --- CALL 2: JAWABAN FINAL SETELAH ALAT ---
            const finalCompletion = await groq.chat.completions.create({
                messages: messages,
                model: MODEL_NAME,
                stream: false
            });
            return finalCompletion.choices[0].message.content;
        }

        // Jika tidak panggil alat, langsung return jawaban
        return responseMsg.content;

    } catch (error) {
        console.error("Error Groq SDK:", error);
        return "Maaf, Reika sedang overload sebentar (Groq Error).";
    }
}

// Fungsi Vision (Tetap pakai Gemini karena GPT-OSS-120B di Groq Text Only)
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
    generateGroqResponse, 
    generateGeminiSummary,
    generateVisionResponse
};