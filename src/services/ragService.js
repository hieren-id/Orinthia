const fs = require('fs');
const path = require('path');

const KNOWLEDGE_FILE = path.resolve(__dirname, '../data/knowledge_base.txt');
const VECTOR_STORE_FILE = path.resolve(__dirname, '../data/vector_store.json');

let vectorStore = [];

function chunkText(text, maxLength) {
    const sentences = text.split(/(?<=\.)\s+/);
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        if ((current + sentence).length > maxLength) {
            if (current.trim()) chunks.push(current.trim());
            current = '';
        }
        current += sentence + ' ';
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function buildVectorStoreFromFile() {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        console.warn('Knowledge base file not found, skip indexing.');
        vectorStore = [];
        return;
    }

    const text = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    const chunks = chunkText(text, 800);

    vectorStore = chunks.map(chunk => ({
        text: chunk,
        tokens: tokenize(chunk)
    }));

    fs.writeFileSync(VECTOR_STORE_FILE, JSON.stringify(vectorStore, null, 2));
    console.log(`Vector store built (lexical): ${vectorStore.length} chunks.`);
}

function loadVectorStore() {
    if (fs.existsSync(VECTOR_STORE_FILE)) {
        try {
            const raw = fs.readFileSync(VECTOR_STORE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                vectorStore = data.map(item => ({
                    text: item.text,
                    tokens: Array.isArray(item.tokens) ? item.tokens : tokenize(item.text || '')
                }));
                console.log(`Vector store loaded: ${vectorStore.length} chunks.`);
                return true;
            }
        } catch (err) {
            console.error('Gagal memuat vector_store, akan rebuild:', err);
        }
    }
    return false;
}

async function initializeKnowledgeBase() {
    try {
        const loaded = loadVectorStore();
        if (!loaded) {
            buildVectorStoreFromFile();
        }
    } catch (err) {
        console.error('Gagal inisialisasi knowledge base:', err);
        vectorStore = [];
    }
}

function searchRelevantContext(query, topK = 3) {
    if (!query || !vectorStore.length) return '';

    const queryTokens = tokenize(query);
    if (!queryTokens.length) return '';

    const scored = vectorStore
        .map(chunk => ({
            text: chunk.text,
            score: tokenOverlapScore(queryTokens, chunk.tokens || tokenize(chunk.text || ''))
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    return scored.map(item => item.text).join('\n\n');
}

function tokenOverlapScore(queryTokens, chunkTokens) {
    const setChunk = new Set(chunkTokens);
    let score = 0;
    for (const token of queryTokens) {
        if (setChunk.has(token)) score += 1;
    }
    return score;
}

module.exports = {
    initializeKnowledgeBase,
    searchRelevantContext
};
