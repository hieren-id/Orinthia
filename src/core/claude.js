const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT = 180_000;
const MAX_RETRIES = 2;

async function callOrinthia(systemPrompt, messagePrompt, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = MAX_RETRIES,
    tools = '',
    effort = 'medium',
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await _spawnClaude(systemPrompt, messagePrompt, { timeout, tools, effort });
    if (!result.error || attempt === maxRetries) return result;
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
}

async function _spawnClaude(systemPrompt, messagePrompt, { timeout, tools, effort }) {
  const tmpFile = path.join('/tmp', `orinthia-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);

  try {
    fs.writeFileSync(tmpFile, systemPrompt, 'utf-8');
  } catch (err) {
    return { text: '', error: `Failed to write temp prompt: ${err.message}` };
  }

  const args = [
    '-p',
    '--system-prompt-file', tmpFile,
    '--model', 'sonnet',
    '--effort', effort,
    '--bare',
    '--tools', tools,
    '--output-format', 'text',
  ];

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
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
}

async function callOrinthiaWithEdit(systemPrompt, messagePrompt) {
  return callOrinthia(systemPrompt, messagePrompt, {
    tools: 'Edit',
    effort: 'high',
  });
}

module.exports = { callOrinthia, callOrinthiaWithEdit };
