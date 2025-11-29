let isBotActive = false;

function setBotStatus(status) {
    isBotActive = status;
}

function getBotStatus() {
    return isBotActive;
}

module.exports = {
    setBotStatus,
    getBotStatus
};
