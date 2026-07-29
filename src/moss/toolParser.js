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

// Only decides where to split on the delimiter; it must NOT interpret what
// an escape sequence means. Any backslash-pair (\|, \n, \\) is passed
// through untouched so unescape() can resolve it afterward — consuming the
// backslash here (as the previous version did) meant \n arrived at
// unescape() as a bare "n", with nothing left to convert to a newline.
function splitEscaped(str, delimiter) {
  const parts = [];
  let current = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      current += str[i] + str[i + 1];
      i += 2;
      continue;
    }
    if (str[i] === delimiter) {
      parts.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += str[i];
    i += 1;
  }
  parts.push(current);
  return parts;
}

function unescape(str) {
  // Single left-to-right pass so a substitution can't create a false match
  // for a later step (sequential .replace() calls had this problem: \\n
  // became \<newline> instead of the literal "\n" it should resolve to,
  // because the \n-replace ran before the \\-replace saw it).
  return str.replace(/\\(.)/g, (match, ch) => {
    if (ch === '|') return '|';
    if (ch === 'n') return '\n';
    if (ch === '\\') return '\\';
    return match;
  });
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
