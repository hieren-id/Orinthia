# **🚀 Dokumentasi Teknis Tahap 5: Reika Agentic AI (Final)**

Dokumen ini menjelaskan arsitektur akhir dari Reika, yang telah berevolusi dari sekadar *Chatbot* (Pasif) menjadi **Autonomous Agent** (Aktif) yang memiliki kemampuan menggunakan alat (*Tools*) dan memori jangka panjang (*RAG*).

## **1\. Perubahan Paradigma: Dari Chatbot ke Agent**

| Fitur | Reika Lama (Tahap 1-3) | Reika Final (Tahap 5\) |
| :---- | :---- | :---- |
| **Sifat** | Pasif (Hanya menjawab teks) | **Aktif** (Bisa menjalankan kode/fungsi) |
| **Pemicu Aksi** | Harus perintah kaku (\!ctt) | **Bahasa Natural** ("Tolong catat...") |
| **Ingatan** | Dibaca semua setiap saat (Boros) | **On-Demand** (Dicari hanya saat perlu) |
| **Logika** | Single-turn (Tanya \-\> Jawab) | **Multi-turn** (Tanya \-\> Pikir \-\> Pakai Alat \-\> Jawab) |

## **2\. Arsitektur Sistem (The Brain & The Hands)**

Sistem Reika kini terdiri dari 3 lapisan utama:

### **A. The Brain (Gemini 2.5 Flash)**

Model AI yang tidak hanya menghasilkan teks, tapi juga dilatih untuk memahami struktur **JSON Schema** dari alat yang kita sediakan. Dia bertindak sebagai "Mandor" yang memutuskan alat mana yang harus dipakai.

### **B. The Hands (tools.js)**

Kumpulan fungsi JavaScript yang bisa dieksekusi oleh Node.js.

1. **manageUrgentNote**: Alat untuk memanipulasi file sistem (fs) guna menyimpan status terkini pemilik (Karel).  
2. **consultKnowledgeBase**: Alat untuk mengakses sistem RAG (rag.js) guna mencari fakta masa lalu.  
3. **googleSearch**: Alat bawaan Google untuk mencari data real-time (berita/cuaca).

### **C. The Loop (generateAgenticResponse di index.js)**

Mekanisme perulangan (*While Loop*) yang memungkinkan Reika menggunakan alat berkali-kali sebelum memberikan jawaban akhir.

## **3\. Alur Eksekusi (Flowchart)**

Saat ada pesan masuk: *"Reika, catat aku lagi di jalan, terus cariin berita gempa hari ini."*

1. **Input:** Pesan dikirim ke Gemini beserta definisi tools.  
2. **Thinking 1:** Gemini berpikir: *"User minta catat \-\> Panggil manageUrgentNote. User minta berita \-\> Panggil googleSearch."*  
3. **Function Call:** Gemini mengembalikan JSON perintah (bukan teks jawaban).  
4. **Execution:** Node.js menangkap JSON tersebut, lalu menjalankan fungsi asli di tools.js dan Google Search.  
5. **Observation:** Hasil eksekusi (misal: "Catatan tersimpan" & "Berita Gempa: 5.6 SR") dikirim balik ke Gemini.  
6. **Thinking 2:** Gemini membaca hasil alat tersebut.  
7. **Final Response:** Gemini merangkum semuanya menjadi jawaban natural: *"Oke Karel, catatan sudah diperbarui. Btw, hati-hati ya, barusan ada gempa 5.6 SR di..."*

## **4\. Struktur Kode & File Penting**

### **index.js (Core Logic)**

* **model Initialization:** Dikonfigurasi dengan tools: \[googleSearch, ...toolsDefinition\].  
* **generateAgenticResponse:** Fungsi krusial yang menangani *chat session* dan *function calling loop*.  
* **Hot Reload:** Tetap mempertahankan fitur *hot reload* untuk prompt.js dan contacts.js.

### **tools.js (Toolbox)**

* **toolsDefinition:** Deskripsi alat dalam format yang dimengerti AI (Nama, Deskripsi, Parameter). Deskripsi ini sangat penting karena menjadi "buku manual" bagi AI.  
* **toolsImplementation:** Kode JavaScript asli yang melakukan aksi nyata (CRUD File, Search Vector DB).

### **rag.js (Memory System)**

* Berubah fungsi dari yang tadinya dipanggil otomatis di setiap chat, menjadi alat pasif yang hanya dipanggil via consultKnowledgeBase jika AI merasa perlu mengingat sesuatu.

## **5\. Cara Menggunakan Fitur Baru**

### **A. Manajemen Catatan (Tanpa \!ctt)**

* **User:** *"Reika, tolong set status aku lagi tidur siang sampai jam 3."*  
* **Reika:** Otomatis menjalankan manageUrgentNote \-\> Mengupdate urgent\_note.txt \-\> Menjawab *"Oke, status tidur siang tersimpan."*

### **B. Mengakses Ingatan Masa Lalu**

* **User:** *"Reika, apa makanan kesukaan karel?"*  
* **Reika:** Otomatis menjalankan consultKnowledgeBase \-\> Mencari di database.json \-\> Menjawab *"Berdasarkan ingatan, Karel suka Nasi Goreng."*

### **C. Mencari Informasi Internet**

* **User:** *"Harga Bitcoin hari ini berapa?"*  
* **Reika:** Otomatis menjalankan googleSearch \-\> Menjawab dengan data terkini.

## **6\. Tips Perawatan (Maintenance)**

1. **Database:** File database.json akan terus membesar. Secara default kode membatasi 200 pesan terakhir (.slice(-200)). Jika ingin menyimpan lebih banyak, ubah angkanya di fungsi saveDatabase.  
2. **Monitoring:** Selalu cek terminal/konsol Pterodactyl. Jika Reika memanggil alat, akan muncul log: 🛠️ Reika memanggil alat: nama\_alat.  
3. **Token Usage:** Fitur agentic memakan lebih banyak token karena proses bolak-balik (AI \-\> Alat \-\> AI). Pantau kuota Gemini API.

**Status Sistem: STABIL & SIAP DIGUNAKAN 🚀**