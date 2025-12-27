const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config/env');

if (!GEMINI_API_KEY) {
    console.error('Gemini ERROR: API Key belum diisi di file .env (GEMINI_API_KEY)!');
    process.exit(1);
}

const gemini = new GoogleGenerativeAI({
    apiKey: GEMINI_API_KEY
});

module.exports = gemini;