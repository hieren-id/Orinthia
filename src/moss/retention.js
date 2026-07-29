const QUARTER_END_MONTHS = [2, 5, 8, 11]; // Maret, Juni, September, Desember (0-indexed)

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function isSunday(date) {
  return date.getDay() === 0;
}

function is28th(date) {
  return date.getDate() === 28;
}

function isQuarterEnd(date) {
  return is28th(date) && QUARTER_END_MONTHS.includes(date.getMonth());
}

function isYearEnd(date) {
  return is28th(date) && date.getMonth() === 11; // Desember
}

function getCurrentPeriode(level, now = new Date()) {
  const today = formatDate(now);

  switch (level) {
    case 'harian':
      return { start: today, end: today };
    case 'mingguan': {
      // Berjalan tiap hari Minggu — periode adalah 7 hari terakhir (Senin—Minggu).
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: formatDate(start), end: today };
    }
    case 'bulanan': {
      // Berjalan tiap tanggal 28 — periode sejak sehari setelah tanggal 28 bulan lalu.
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      start.setDate(start.getDate() + 1);
      return { start: formatDate(start), end: today };
    }
    case 'kuartalan': {
      // Berjalan tiap tanggal 28 Maret/Juni/September/Desember — periode 3 bulan sebelumnya.
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      start.setDate(start.getDate() + 1);
      return { start: formatDate(start), end: today };
    }
    case 'tahunan': {
      // Berjalan tiap tanggal 28 Desember — periode 1 tahun sebelumnya.
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      return { start: formatDate(start), end: today };
    }
    default:
      return { start: today, end: today };
  }
}

function flushByLevel(level) {
  const db = require('../core/db').getDb();
  const tx = db.transaction(() => {
    switch (level) {
      case 'harian':
        db.prepare(`DELETE FROM pesan WHERE DATE(created_at) = DATE('now')`).run();
        break;
      case 'mingguan':
        db.prepare(`DELETE FROM rangkuman WHERE level = 'harian' AND periode_end < DATE('now')`).run();
        break;
      case 'bulanan':
        // Simpan hanya rangkuman mingguan dari minggu terbaru (periode_end
        // terbesar); hapus sisanya. Tidak lagi mengandalkan jendela hari
        // tetap karena tanggal 28 tidak selalu jatuh di hari Minggu yang sama.
        db.prepare(`
          DELETE FROM rangkuman
          WHERE level = 'mingguan'
            AND periode_end < (SELECT MAX(periode_end) FROM rangkuman WHERE level = 'mingguan')
        `).run();
        break;
      case 'kuartalan':
        break;
      case 'tahunan':
        db.prepare(`DELETE FROM rangkuman WHERE level = 'kuartalan'`).run();
        break;
    }
  });
  tx();
}

function getDueEvaluationLevels(now = new Date()) {
  const due = ['harian'];
  if (isSunday(now)) due.push('mingguan');
  if (is28th(now)) due.push('bulanan');
  if (isQuarterEnd(now)) due.push('kuartalan');
  if (isYearEnd(now)) due.push('tahunan');
  return due;
}

module.exports = { getCurrentPeriode, flushByLevel, getDueEvaluationLevels };
