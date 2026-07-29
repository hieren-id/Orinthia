const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'orinthia.log');
const transport = pino.transport({
  targets: [
    { target: 'pino/file', level: 'info', options: { destination: 1 } },
    { target: 'pino/file', level: 'info', options: { destination: logFile, mkdir: true } },
  ],
});

const logger = pino({ level: 'info' }, transport);

module.exports = logger;
