const fs = require('fs');
const path = require('path');

const KNOWLEDGE_FILE = path.resolve(__dirname, '../data/knowledge_base.txt');

let vectorStore = [];

async function initializeKnowledgeBase() {
    console.log('Initializing Knowledge Base...');

    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        console.warn('Knowledge base file not found.');
        vectorStore = [];
        return;
    }

    const text = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    const chunks = chunkText(text, 500);

    vectorStore = chunks.map(chunk => ({
        text: chunk,
        tokens: tokenize(chunk)
    }));

    console.log(`Knowledge base loaded dengan ${vectorStore.length} potongan informasi.`);
}

function chunkText(text, maxLength) {
    const sentences = text.split(/(?<=\.)\s+/);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = '';
        }
        currentChunk += sentence + ' ';
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function searchRelevantContext(query) {
    if (!vectorStore.length || !query) return '';

    const queryTokens = tokenize(query);
    if (!queryTokens.length) return '';

    const scoredChunks = vectorStore
        .map(chunk => ({
            text: chunk.text,
            score: computeTokenOverlap(queryTokens, chunk.tokens)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    return scoredChunks.map(chunk => chunk.text).join('\n\n');
}

function computeTokenOverlap(queryTokens, chunkTokens) {
    const tokenSet = new Set(chunkTokens);
    return queryTokens.reduce((acc, token) => acc + (tokenSet.has(token) ? 1 : 0), 0);
}

module.exports = {
    initializeKnowledgeBase,
    searchRelevantContext
};
