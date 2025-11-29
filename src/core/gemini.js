const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GEMINI_API_KEY } = require('../config/env');

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR: API Key belum diisi di file .env!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Gunakan model latest yang support search & vision
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [
        { googleSearch: {} } // Fitur Googling Aktif
    ]
});

module.exports = model;
