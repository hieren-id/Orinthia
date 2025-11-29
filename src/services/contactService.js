const path = require('path');

function getSpecialContact(senderNumber, senderName) {
    try {
        // Reload contacts to ensure fresh data if modified
        const contactsPath = path.resolve(__dirname, '../data/contacts');
        delete require.cache[require.resolve(contactsPath)];
        const contactsList = require(contactsPath);

        const incomingNumber = senderNumber.replace('@c.us', '');

        const specialContact = contactsList.find(c =>
            (c.number && incomingNumber === c.number) ||
            (c.name && senderName.toLowerCase().includes(c.name.toLowerCase()))
        );

        if (specialContact) {
            console.log(`✨ Kontak Spesial: ${specialContact.name}`);
        }

        return specialContact;
    } catch (err) {
        console.error("Error finding special contact:", err);
        return null;
    }
}

module.exports = {
    getSpecialContact
};
