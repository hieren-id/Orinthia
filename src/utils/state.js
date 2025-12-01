let isBotActive = false;
let activationTimestamp = null;

function setBotStatus(status) {
    isBotActive = status;
    if (status) {
        activationTimestamp = Date.now();
        console.log(`🕒 Bot Activated at: ${new Date(activationTimestamp).toLocaleString()}`);
    }
}

function getBotStatus() {
    return isBotActive;
}

function getActivationTimestamp() {
    return activationTimestamp;
}

module.exports = {
    setBotStatus,
    getBotStatus,
    getActivationTimestamp
};
