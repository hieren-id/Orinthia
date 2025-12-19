const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Pin a stable web version so WWebJS skips the remote version lookup
// that can fail with "Execution context was destroyed" on some hosts.
const PINNED_WWEB_VERSION = '2.2411.7';

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
        type: 'local',
        path: path.join(__dirname, '../../.wwebjs_cache')
    }
});

module.exports = client;
