const db = require('../core/db');

function normalizeNumber(jid) {
  if (!jid) return '';
  let num = jid.replace(/@s\.whatsapp\.net|@g\.us/g, '').replace(/[^0-9]/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  return num;
}

function isWhitelistedNumber(number) {
  const norm = normalizeNumber(number);
  const contacts = db.getAllContacts();
  return contacts.some(c => normalizeNumber(c.nomor) === norm);
}

function isWhitelistedGroup(groupId) {
  const norm = normalizeNumber(groupId);
  const groups = db.getAllGroups();
  return groups.some(g => g.group_id === norm || g.group_id === groupId);
}

function getContact(number) {
  const norm = normalizeNumber(number);
  const contacts = db.getAllContacts();
  return contacts.find(c => normalizeNumber(c.nomor) === norm) || null;
}

function getGroup(groupId) {
  const groups = db.getAllGroups();
  let found = groups.find(g => g.group_id === groupId);
  if (!found) {
    const norm = normalizeNumber(groupId);
    found = groups.find(g => normalizeNumber(g.group_id) === norm);
  }
  if (found && typeof found.anggota === 'string') {
    found.anggota = JSON.parse(found.anggota);
  }
  return found || null;
}

function getGroupByName(name) {
  const groups = db.getAllGroups();
  const found = groups.find(g => g.nama.toLowerCase() === name.toLowerCase());
  if (found && typeof found.anggota === 'string') {
    found.anggota = JSON.parse(found.anggota);
  }
  return found || null;
}

function isGroupMember(groupId, number) {
  const group = getGroup(groupId);
  if (!group || !group.anggota) return false;
  const norm = normalizeNumber(number);
  return group.anggota.some(a => normalizeNumber(a.nomor) === norm);
}

function canAccessGroupInfo(personNumber, groupId) {
  return isGroupMember(groupId, personNumber);
}

module.exports = {
  normalizeNumber,
  isWhitelistedNumber,
  isWhitelistedGroup,
  getContact,
  getGroup,
  getGroupByName,
  isGroupMember,
  canAccessGroupInfo,
};
