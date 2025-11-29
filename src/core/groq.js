const { Groq } = require('groq-sdk');
const { GROQ_API_KEY } = require('../config/env');

if (!GROQ_API_KEY) {
    console.error("❌ ERROR: GROQ_API_KEY belum diisi di file .env!");
    process.exit(1);
}

// Inisialisasi Client Groq menggunakan SDK resmi 'groq-sdk'
const groq = new Groq({
    apiKey: GROQ_API_KEY
});

module.exports = groq;