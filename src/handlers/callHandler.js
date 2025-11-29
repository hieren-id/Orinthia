const client = require('../core/whatsapp');
const { generateCallResponse } = require('../services/aiService');
const { getSpecialContact } = require('../services/contactService');

let isBotActive = false; // Shared state needs to be managed carefully. 
// Ideally, isBotActive should be in a shared state module or exported from messageHandler if it's the source of truth.
// For now, I will export a function to set bot status or better, put isBotActive in a separate state file.
// But to keep it simple as per plan, I might need to rethink where isBotActive lives.
// It is modified in messageHandler. 
// Let's create a simple state manager in utils or just export it from messageHandler?
// Exporting mutable state is tricky.
// Let's create src/utils/state.js

async function handleIncomingCall(call) {
    const { getBotStatus } = require('../utils/state'); // Lazy load to avoid circular dependency if any
    if (!getBotStatus()) return;

    const callerNumber = call.from.replace('@c.us', '');
    const specialContact = getSpecialContact(call.from, ""); // Name not available in call object immediately usually

    const textResponse = await generateCallResponse(callerNumber, specialContact);

    if (textResponse) {
        await client.sendMessage(call.from, textResponse);
        console.log(`📞 Auto-Reply Telpon ke ${callerNumber}: ${textResponse}`);
    }
}

module.exports = handleIncomingCall;
