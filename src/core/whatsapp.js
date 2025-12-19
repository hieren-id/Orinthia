const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Pin a stable web version and fetch HTML from remote archive to avoid
// brittle live lookups that can crash on headless hosts.
const PINNED_WWEB_VERSION = '2.3000.1017054665';
const REMOTE_WWEB_HTML = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    },
    webVersion: PINNED_WWEB_VERSION,
    webVersionCache: {
        type: 'remote',
        remotePath: REMOTE_WWEB_HTML
    }
});

module.exports = client;
