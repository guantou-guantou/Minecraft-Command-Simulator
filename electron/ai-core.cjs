'use strict';

const IDLE_MS = 60_000;

/** `https://host/v1`, `https://host/v1/` and `https://host/v1/chat/completions` all name the same endpoint. */
function endpoint(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : `${u}/chat/completions`;
}

/** Only https, or http to this computer (a local model server). */
function checkBaseUrl(baseUrl) {
  let u;
  try {
    u = new URL(String(baseUrl || '').trim());
  } catch {
    throw new Error('The base URL is not a valid address');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('The base URL must start with https:// (http:// is only allowed for localhost)');
  return u.toString();
}

/** What an error response says, without anything that could carry the key. */
async function errorText(res, apiKey) {
  let body = '';
  try {
    body = (await res.text()).slice(0, 500);
  } catch {
    // no body
  }
  try {
    const j = JSON.parse(body);
    body = j?.error?.message || j?.message || body;
  } catch {
    // not JSON
  }
  const clean = apiKey ? body.split(apiKey).join('***') : body;
  return `HTTP ${res.status}${clean ? `: ${clean}` : ''}`;
}

/**
 * Sends a chat request with `stream: true` and calls `onDelta(text)` for every piece of the reply.
 * Resolves to the whole text. Rejects on a network error, an error status, silence for `idleMs`, or when `signal` aborts.
 * A server that ignores `stream` and answers with plain JSON is handled too.
 */
async function streamChat({ baseUrl, apiKey, model, messages, signal, onDelta = () => {}, idleMs = IDLE_MS, maxTokens }) {
  const url = endpoint(checkBaseUrl(baseUrl));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error(`No answer for ${Math.round(idleMs / 1000)} seconds`)), idleMs);
  };
  touch();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await errorText(res, apiKey));
    const type = res.headers.get('content-type') || '';
    let text = '';
    const push = (piece) => {
      if (!piece) return;
      text += piece;
      onDelta(piece);
    };
    if (!type.includes('text/event-stream')) {
      const j = await res.json();
      push(j?.choices?.[0]?.message?.content ?? '');
      return text;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const line = (raw) => {
      const l = raw.trim();
      if (!l.startsWith('data:')) return;
      const data = l.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        return;
      }
      if (j?.error) throw new Error(j.error.message || 'The server reported an error');
      push(j?.choices?.[0]?.delta?.content ?? '');
    };
    for await (const chunk of res.body) {
      touch();
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(line);
    }
    line(buffer);
    return text;
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw e;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener('abort', abort);
  }
}

const DEFAULTS = { enabled: false, baseUrl: 'https://api.openai.com/v1', model: '', includeScript: true };

/** Settings live in one JSON file; the key is stored only as what `crypto.encrypt` returns (base64). */
function loadSettings(fs, file, crypto) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no file yet
  }
  const s = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter((k) => typeof raw[k] === typeof DEFAULTS[k]).map((k) => [k, raw[k]])) };
  let apiKey = '';
  if (typeof raw.key === 'string' && raw.key && crypto.isAvailable()) {
    try {
      apiKey = crypto.decrypt(Buffer.from(raw.key, 'base64'));
    } catch {
      apiKey = '';
    }
  }
  return { settings: s, apiKey, hasStoredKey: typeof raw.key === 'string' && !!raw.key };
}

/** `change.key`: undefined keeps the stored key, '' removes it, anything else replaces it. */
function saveSettings(fs, file, crypto, write, change) {
  const cur = loadSettings(fs, file, crypto);
  const next = { ...cur.settings };
  for (const k of Object.keys(DEFAULTS)) if (change[k] !== undefined && typeof change[k] === typeof DEFAULTS[k]) next[k] = change[k];
  if (typeof next.baseUrl === 'string' && next.baseUrl.trim()) checkBaseUrl(next.baseUrl);
  let key;
  if (change.key === undefined) {
    try {
      key = JSON.parse(fs.readFileSync(file, 'utf8')).key;
    } catch {
      key = undefined;
    }
  } else if (change.key === '') key = undefined;
  else {
    if (!crypto.isAvailable()) throw new Error('This computer cannot encrypt the key, so it is not saved');
    key = crypto.encrypt(change.key).toString('base64');
  }
  write(fs, file, JSON.stringify({ ...next, ...(key ? { key } : {}) }));
}

module.exports = { endpoint, checkBaseUrl, streamChat, loadSettings, saveSettings, DEFAULTS };