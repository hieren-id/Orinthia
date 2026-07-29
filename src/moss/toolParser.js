const KNOWN_COMMANDS = new Set([
  'REPLY',
  'STORE_REPORT',
  'STORE_SUMMARY',
  'GET_SUMMARY',
  'GET_REPORT',
  'GET_MEMORY',
  'STORE_MEMORY',
  'DELETE_MEMORY',
  'REQUEST_REVISION',
  'UPDATE_EVAL',
  'FLUSH',
]);

function splitEscaped(str, delimiter) {
  const parts = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    if (escaped) {
      current += str[i];
      escaped = false;
    } else if (str[i] === '\\') {
      escaped = true;
    } else if (str[i] === delimiter) {
      parts.push(current);
      current = '';
    } else {
      current += str[i];
    }
  }
  parts.push(current);
  return parts;
}

function unescape(str) {
  return str
    .replace(/\\\|/g, '|')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

function parseToolCalls(text) {
  const results = [];
  const regex = /<<MOSS\|([^>]+)>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1];
    const parts = splitEscaped(inner, '|');
    if (parts.length < 1) continue;
    const command = parts[0].trim().toUpperCase();
    if (!KNOWN_COMMANDS.has(command)) continue;
    const params = parts.slice(1).map(p => unescape(p.trim()));
    results.push({ command, params, raw: match[0] });
  }
  return results;
}

function removeToolCalls(text) {
  return text.replace(/<<MOSS\|[^>]+>>/g, '').trim();
}

module.exports = { parseToolCalls, removeToolCalls, KNOWN_COMMANDS };
