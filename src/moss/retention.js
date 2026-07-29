const config = require('../config');

function getCurrentPeriode(level) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (level) {
    case 'harian':
      return { start: today, end: today };
    case 'mingguan': {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (config.CALENDAR.week - 1));
      return { start: startDate.toISOString().split('T')[0], end: today };
    }
    case 'bulanan': {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (config.CALENDAR.month - 1));
      return { start: startDate.toISOString().split('T')[0], end: today };
    }
    case 'kuartalan': {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (config.CALENDAR.quarter - 1));
      return { start: startDate.toISOString().split('T')[0], end: today };
    }
    case 'tahunan': {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (config.CALENDAR.year - 1));
      return { start: startDate.toISOString().split('T')[0], end: today };
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
        db.prepare(`DELETE FROM rangkuman WHERE level = 'mingguan' AND periode_end < DATE('now', '-7 days')`).run();
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

function getDueEvaluationLevels() {
  const startDate = new Date(config.SYSTEM_START_DATE);
  const now = new Date();
  const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

  const due = ['harian'];
  if (daysSinceStart > 0 && daysSinceStart % config.CALENDAR.week === 0) due.push('mingguan');
  if (daysSinceStart > 0 && daysSinceStart % config.CALENDAR.month === 0) due.push('bulanan');
  if (daysSinceStart > 0 && daysSinceStart % config.CALENDAR.quarter === 0) due.push('kuartalan');
  if (daysSinceStart > 0 && daysSinceStart % config.CALENDAR.year === 0) due.push('tahunan');

  return due;
}

module.exports = { getCurrentPeriode, flushByLevel, getDueEvaluationLevels };
