🛠️ Dokumentasi Teknis: Implementasi RAG (Retrieval Augmented Generation)
Dokumen ini menjelaskan arsitektur teknis dan implementasi sistem RAG pada Reika untuk memungkinkan Long-term Memory dan Context Awareness berbasis Knowledge Base.
1. Arsitektur Sistem
Sistem ini menggunakan pendekatan Naive RAG dengan vector similarity search sederhana yang berjalan di memori (in-memory) dan dipersistensi ke file JSON.
Alur Kerja (Pipeline)
Ingestion & Indexing (Saat Booting):
Input: File teks mentah (knowledge_base.txt).
Chunking: Teks dipecah menjadi segmen-segmen kecil (chunks) berdasarkan pemisah kalimat (. ) dengan batas karakter tertentu (default: ~500 chars).
Embedding: Setiap chunk dikirim ke Google Gemini API (model text-embedding-004) untuk dikonversi menjadi representasi vektor (array float).
Storage: Pasangan { text, vector } disimpan ke vector_store.json sebagai cache persisten.
Retrieval (Saat Chat):
Query Embedding: Pesan pengguna dikonversi menjadi vektor menggunakan model yang sama.
Similarity Search: Sistem menghitung jarak semantik antara vektor query dan semua vektor di database menggunakan algoritma Cosine Similarity.
Filtering: Mengambil Top-3 chunk dengan skor kemiripan tertinggi.
Generation (Augmented Prompt):
Konteks yang ditemukan ("Retrieved Context") digabungkan ke dalam System Prompt.
LLM (gemini-2.5-flash) menerima instruksi untuk menjawab berdasarkan konteks tersebut.
2. Struktur Komponen Kode
A. rag.js (Core Logic)
Modul ini bertindak sebagai Vector Engine.
Dependencies: @google/generative-ai, fs.
Model Embedding: text-embedding-004 (Dipilih karena efisiensi dan dimensi vektor 768).
Fungsi Utama:
initializeKnowledgeBase(): Membaca file sumber, melakukan chunking, memanggil API embedding, dan menyimpan ke JSON. Memiliki mekanisme caching (tidak melakukan embedding ulang jika vector_store.json sudah ada).
searchRelevantContext(query): Menerima string query, mengembalikan string konteks gabungan.
cosineSimilarity(vecA, vecB): Fungsi matematis untuk menghitung sudut antara dua vektor multidimensi.
B. knowledge_base.txt (Data Source)
Format: Plain text (.txt).
Encoding: UTF-8.
Best Practice: Gunakan kalimat lengkap dengan tanda baca yang jelas. Chunking logic bergantung pada pemisah titik (. ). Format data tidak terstruktur (unstructured text) diperbolehkan.
C. vector_store.json (Vector Database)
Format: JSON Array.
Schema Objek:
{
  "text": "String potongan teks asli...",
  "vector": [0.0123, -0.0456, 0.789, ... ] // Array float (768 dimensi)
}


Sifat: File ini dibuat otomatis (Generated). Jangan diedit manual. Hapus file ini untuk memaksa re-indexing.
3. Integrasi pada index.js
Inisialisasi
const { initializeKnowledgeBase, searchRelevantContext } = require('./rag');

// Dijalankan saat event 'ready'
client.on('ready', async () => {
    // ...
    await initializeKnowledgeBase(); // Blocking process sampai indexing selesai
});


Injection pada Prompt
Pada fungsi generateGeminiResponse, hasil retrieval disuntikkan ke variabel historyLogs atau parameter khusus sebelum dikirim ke prompt.js.
// Pseudocode logika di generateGeminiResponse
let retrievedKnowledge = "";
if (textInput.length > 5) {
    retrievedKnowledge = await searchRelevantContext(textInput);
}

// Data ini kemudian dikirim ke getSystemPrompt di prompt.js


4. Troubleshooting & Pemeliharaan
Masalah: Bot Lambat Menjawab
Penyebab: Latency tambahan dari request ke Embedding API (searchRelevantContext) sebelum request ke LLM utama.
Solusi: Ini adalah trade-off RAG. Pastikan koneksi server stabil.
Masalah: Bot "Lupa" Data Baru
Penyebab: rag.js mendeteksi keberadaan vector_store.json lama dan melewatkan proses indexing ulang.
Solusi:
Matikan bot.
Hapus file vector_store.json.
Nyalakan bot. Ini akan memaksa sistem membaca ulang knowledge_base.txt.
Masalah: Error "Payload Too Large"
Penyebab: Terlalu banyak konteks yang diambil (misal Top-10) sehingga melebihi batas token model.
Solusi: Kurangi jumlah dokumen yang diambil di rag.js (saat ini diset ke Top-3).
5. Skalabilitas (Next Steps)
Implementasi saat ini menggunakan Flat File JSON yang cocok untuk < 10.000 chunks. Jika knowledge base tumbuh menjadi jutaan baris, pertimbangkan migrasi ke Vector Database terdedikasi:
Pinecone / Weaviate: Managed service (Cloud).
ChromaDB / PGVector (PostgreSQL): Self-hosted solution.
SQLite-VSS: Solusi lokal ringan dengan ekstensi vektor.
