const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GEMINI_API_KEY } = require('../config/env');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

const KNOWLEDGE_FILE = path.resolve(__dirname, '../data/knowledge_base.txt');
const VECTOR_STORE_FILE = path.resolve(__dirname, '../data/vector_store.json');

let vectorStore = [];

async function initializeKnowledgeBase() {
    console.log("🔄 Initializing Knowledge Base...");

    if (fs.existsSync(VECTOR_STORE_FILE)) {
        try {
            const rawData = fs.readFileSync(VECTOR_STORE_FILE, 'utf8');
            vectorStore = JSON.parse(rawData);
            console.log(`✅ Vector Store Loaded: ${vectorStore.length} chunks.`);
            return;
        } catch (err) {
            console.error("⚠️ Failed to load vector store, rebuilding...", err);
        }
    }

    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        console.warn("⚠️ Knowledge base file not found.");
        return;
    }

    const text = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    const chunks = chunkText(text, 500); // Chunk size ~500 chars

    vectorStore = [];
    console.log(`📊 Processing ${chunks.length} chunks...`);

    for (const chunk of chunks) {
        try {
            const result = await embeddingModel.embedContent(chunk);
            const vector = result.embedding.values;
            vectorStore.push({ text: chunk, vector });
            // Rate limit handling (simple pause)
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
            console.error("❌ Error embedding chunk:", err);
        }
    }

    fs.writeFileSync(VECTOR_STORE_FILE, JSON.stringify(vectorStore, null, 2));
    console.log("✅ Knowledge Base Indexed & Saved.");
}

function chunkText(text, maxLength) {
    const sentences = text.split('. ');
    let chunks = [];
    let currentChunk = "";

    for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
        currentChunk += sentence + ". ";
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}

async function searchRelevantContext(query) {
    if (!vectorStore.length) return "";

    try {
        const result = await embeddingModel.embedContent(query);
        const queryVector = result.embedding.values;

        const scoredChunks = vectorStore.map(chunk => ({
            text: chunk.text,
            score: cosineSimilarity(queryVector, chunk.vector)
        }));

        // Sort by similarity score (descending)
        scoredChunks.sort((a, b) => b.score - a.score);

        // Take top 3
        const topChunks = scoredChunks.slice(0, 3);

        // Log for debugging
        console.log(`🔍 RAG Search for "${query}":`);
        topChunks.forEach(c => console.log(`   - [${c.score.toFixed(4)}] ${c.text.substring(0, 50)}...`));

        return topChunks.map(c => c.text).join("\n\n");

    } catch (err) {
        console.error("❌ Error searching context:", err);
        return "";
    }
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
    initializeKnowledgeBase,
    searchRelevantContext
};
