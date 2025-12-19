const Groq = require('groq-sdk');
const { GROQ_API_KEY } = require('../config/env');

if (!GROQ_API_KEY) {
    console.error('Groq ERROR: API Key belum diisi di file .env (GROQ_API_KEY)!');
    process.exit(1);
}

const groq = new Groq({
    apiKey: GROQ_API_KEY
});

module.exports = groq;
