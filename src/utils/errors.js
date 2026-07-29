const REJECTION_TEMPLATES = [
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, nama saya Moss. Saya yang bertugas mengelola pesan ibu manager.\n\nMohon maaf, untuk saat ini anda tidak diizinkan untuk menghubungi ibu 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, saya Moss, pengelola pesan ibu manager.\n\nMaaf, nomor anda belum terdaftar sebagai pihak yang dapat menghubungi ibu saat ini 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nSelamat datang, saya Moss. Saya mengurus komunikasi ibu manager.\n\nMohon maaf, anda belum memiliki akses untuk menghubungi ibu. Terima kasih 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, perkenalkan saya Moss.\n\nSayang sekali, nomor anda belum diizinkan untuk menghubungi ibu manager. Mohon pengertiannya 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, saya asisten yang mengelola pesan ibu.\n\nUntuk saat ini, nomor anda belum termasuk dalam daftar yang diizinkan. Terima kasih atas pengertiannya 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nSelamat datang. Saya Moss, pengelola lalu lintas pesan ibu manager.\n\nMohon maaf, akses anda belum terdaftar. Silakan hubungi atasan untuk informasi lebih lanjut 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, saya Moss.\n\nDengan berat hati saya sampaikan bahwa nomor anda belum dapat menghubungi ibu saat ini. Terima kasih 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nPerkenalkan, saya Moss.\n\nMohon maaf, untuk menjaga keamanan, nomor anda belum terdaftar untuk menghubungi ibu manager 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, nama saya Moss, asisten ibu manager.\n\nMaaf, saat ini anda belum memiliki izin untuk menghubungi ibu. Terima kasih atas pengertiannya 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nSelamat datang, saya Moss yang mengelola pesan ibu.\n\nNomor anda belum terdaftar dalam sistem kami. Mohon maaf atas ketidaknyamanannya 🙏🏽',
];

const UNAVAILABLE_TEMPLATES = [
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo, {nama}, saya Moss. Saya yang bertugas mengelola pesan ibu manager.\n\nMohon maaf {nama}, untuk saat ini Ibu manager sedang tidak ada di tempat karena keperluan lain.\n\nPesan {nama} sudah saya catat dan akan segera saya sampaikan ke ibu jika ibu sudah ada di tempat. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo {nama}, perkenalkan saya Moss.\n\nIbu manager sedang tidak dapat dijangkau saat ini. Pesan {nama} sudah saya simpan dan akan saya teruskan segera. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\n{nama}, saya Moss, asisten ibu.\n\nMohon maaf, ibu sedang menangani hal lain. Pesan {nama} sudah saya catat dan akan saya sampaikan. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo {nama}. Saya Moss.\n\nIbu sedang tidak berada di tempat. Pesan {nama} sudah tersimpan dan akan saya sampaikan begitu ibu kembali. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nSelamat {nama}, saya Moss.\n\nMohon maaf, ibu manager sedang sibuk. Pesan {nama} sudah saya amankan dan akan segera saya teruskan. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\n{nama}, perkenalkan saya Moss, pengelola pesan ibu.\n\nIbu sedang tidak tersedia saat ini. Pesan {nama} sudah saya simpan untuk disampaikan. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo {nama}, saya Moss.\n\nMaaf mengganggu, ibu sedang tidak di tempat. Pesan {nama} sudah saya catat dan akan saya sampaikan secepatnya. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\n{nama}, saya Moss, asisten ibu manager.\n\nIbu sedang menangani keperluan lain. Pesan {nama} sudah tersimpan dan akan saya teruskan. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nHalo {nama}. Saya Moss yang mengurus komunikasi ibu.\n\nMohon maaf, ibu sedang tidak dapat dihubungi. Pesan {nama} sudah saya simpan. 🙏🏽',
  '*Moss (Asisten Ibu Manager Orinthia)*\nSelamat datang {nama}, saya Moss.\n\nIbu sedang tidak berada di tempat. Pesan {nama} sudah saya amankan dan akan saya sampaikan saat ibu kembali. 🙏🏽',
];

function getRandomTemplate(templates, nama = '') {
  const idx = Math.floor(Math.random() * templates.length);
  return templates[idx].replace(/\{nama\}/g, nama || 'Teman');
}

function getRejectionMessage(nama) {
  return getRandomTemplate(REJECTION_TEMPLATES, nama);
}

function getUnavailableMessage(nama) {
  return getRandomTemplate(UNAVAILABLE_TEMPLATES, nama);
}

module.exports = { getRejectionMessage, getUnavailableMessage };
