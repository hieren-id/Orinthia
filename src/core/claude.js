const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT = 180_000;
const MAX_RETRIES = 2;
const SESSION_ID_KEY = 'claude_session_id';
const SESSION_ESTABLISHED_KEY = 'claude_session_established';

function getSessionId() {
  return db.getSystemState(SESSION_ID_KEY, null);
}

// A session ID sitting in system_state doesn't mean the CLI actually knows
// about it yet — it only does once a --session-id call for it has
// succeeded. Without tracking this separately, a freshly-generated ID
// (e.g. right after startNewSession()) would incorrectly get treated as
// resumable on the very next call, sending --resume for a session that was
// never created and reliably failing.
function isSessionEstablished() {
  return db.getSystemState(SESSION_ESTABLISHED_KEY, 'false') === 'true';
}

function markSessionEstablished() {
  db.setSystemState(SESSION_ESTABLISHED_KEY, 'true');
}

// Exported so pipeline.js can force a fresh session after flushing context
// (FR-PIPE-1 steps 5-6) — --resume keeps the full prior transcript, which is
// exactly what flush is meant to leave behind once it's condensed into a
// summary. Without this, "sesi baru" was never actually happening: every
// call was already a stateless fresh process, so there was nothing to reset.
function startNewSession() {
  const id = crypto.randomUUID();
  db.setSystemState(SESSION_ID_KEY, id);
  db.setSystemState(SESSION_ESTABLISHED_KEY, 'false');
  return id;
}

async function callOrinthia(systemPrompt, messagePrompt, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = MAX_RETRIES,
    tools = '',
    effort = 'medium',
  } = options;

  let sessionId = getSessionId();
  if (!sessionId) sessionId = startNewSession();
  const isNewSession = !isSessionEstablished();

  let result;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    result = await _spawnClaude(systemPrompt, messagePrompt, { timeout, tools, effort, sessionId, isNewSession });
    if (!result.error || attempt === maxRetries) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }

  if (!result.error) {
    if (isNewSession) markSessionEstablished();
  } else if (!isNewSession) {
    // --resume failed even after retries — most likely the stored session
    // is no longer valid on the CLI side (expired, cache cleared, etc.).
    // Reset now so the NEXT call starts a fresh session instead of retrying
    // against a dead one indefinitely; this call still reports its error
    // to the caller as-is. (If isNewSession itself failed, leave state as
    // "not established" so the next call retries creating with the same ID.)
    logger.warn({ sessionId, error: result.error }, 'Claude session resume failed — resetting session for next call');
    startNewSession();
  }

  return result;
}

// --system-prompt-file only has any effect when creating a session
// (--session-id); the docs are explicit that it's ignored on --resume,
// since the session already has its system prompt fixed from creation. So
// the temp file only needs writing, and system prompt updates (persona
// edits etc.) only take effect, when a new session is actually starting.
async function _spawnClaude(systemPrompt, messagePrompt, { timeout, tools, effort, sessionId, isNewSession }) {
  let tmpFile = null;
  const args = [
    '-p',
    '--model', 'sonnet',
    '--effort', effort,
    '--tools', tools,
    '--output-format', 'text',
  ];

  if (isNewSession) {
    tmpFile = path.join('/tmp', `orinthia-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
      fs.writeFileSync(tmpFile, systemPrompt, 'utf-8');
    } catch (err) {
      return { text: '', error: `Failed to write temp prompt: ${err.message}` };
    }
    args.push('--session-id', sessionId, '--system-prompt-file', tmpFile);
  } else {
    args.push('--resume', sessionId);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn('claude', args, {
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.stdin.write(messagePrompt);
    proc.stdin.end();

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        cleanup();
        resolve({ text: stdout, error: `Timeout after ${timeout}ms` });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0 && !stdout) {
        resolve({ text: '', error: stderr || `Exit code ${code}` });
      } else {
        resolve({ text: stdout, error: null });
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({ text: '', error: err.message });
    });

    function cleanup() {
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
    }
  });
}

async function callOrinthiaWithEdit(systemPrompt, messagePrompt) {
  return callOrinthia(systemPrompt, messagePrompt, {
    tools: 'Edit',
    effort: 'high',
  });
}

module.exports = { callOrinthia, callOrinthiaWithEdit, startNewSession };
