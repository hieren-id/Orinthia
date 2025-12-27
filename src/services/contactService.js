const path = require('path');

function loadContacts() {
    const contactsPath = path.resolve(__dirname, '../data/contacts.json');
    delete require.cache[require.resolve(contactsPath)];
    const data = require(contactsPath);
    return Array.isArray(data) ? data : [];
}

function loadSpecialContacts() {
    try {
        const specialPath = path.resolve(__dirname, '../data/special_contacts.js');
        delete require.cache[require.resolve(specialPath)];
        const data = require(specialPath);
        return Array.isArray(data) ? data : [];
    } catch (err) {
        return [];
    }
}

function normalizeNumber(num = '') {
    return (num || '').replace(/\D/g, '');
}

function matchPhone(incomingNumber, contact) {
    const incoming = normalizeNumber(incomingNumber);
    const phones = Array.isArray(contact.phone) ? contact.phone : [];
    return phones.some(p => {
        const normalized = normalizeNumber(p);
        return normalized === incoming || (normalized && incoming.endsWith(normalized)) || (incoming && normalized.endsWith(incoming));
    });
}

function getSpecialContact(senderNumber, senderName) {
    try {
        const contactsList = [...loadContacts(), ...loadSpecialContacts()];
        const incomingNumber = senderNumber.replace('@c.us', '');

        const specialContact = contactsList.find(c =>
            matchPhone(incomingNumber, c) ||
            (c.name && senderName && senderName.toLowerCase().includes(c.name.toLowerCase()))
        );

        if (specialContact) {
            console.log(`Kontak ditemukan: ${specialContact.name}`);
        }

        return specialContact || null;
    } catch (err) {
        console.error("Error finding special contact:", err);
        return null;
    }
}

module.exports = {
    getSpecialContact,
    loadContacts,
    loadSpecialContacts
};
