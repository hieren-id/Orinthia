const db = require('../core/db');

function normalizeNumber(jid) {
  if (!jid) return '';
  let num = jid.replace(/@s\.whatsapp\.net|@g\.us/g, '').replace(/[^0-9]/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  return num;
}

// A real WhatsApp group ID is a bare numeric string (or the older
// digits-digits form). Anything else (e.g. a display name mistakenly stored
// as group_id) can't become a real destination, even though it'll happily
// build a JID-shaped string and let a send call resolve without erroring.
function looksLikeGroupId(id) {
  return /^\d+(-\d+)?$/.test(id || '');
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
  const byNumber = contacts.find(c => normalizeNumber(c.nomor) === norm);
  if (byNumber) return byNumber;
  // Fall back to matching by name (e.g. config.REPORT_RECIPIENTS.pc uses
  // "Mas Rafi", not his number) — mirrors how getGroupByName already works.
  return contacts.find(c => c.nama.toLowerCase() === String(number).toLowerCase()) || null;
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
  const target = name.toLowerCase();
  // Match either the internal shorthand name (e.g. "P2MW Hieren", used in
  // config/system-prompt) or the group's actual WhatsApp title, since a
  // human or Orinthia may refer to a group either way.
  const found = groups.find(g => g.nama.toLowerCase() === target || (g.nama_asli && g.nama_asli.toLowerCase() === target));
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
  looksLikeGroupId,
  isWhitelistedNumber,
  isWhitelistedGroup,
  getContact,
  getGroup,
  getGroupByName,
  isGroupMember,
  canAccessGroupInfo,
};
