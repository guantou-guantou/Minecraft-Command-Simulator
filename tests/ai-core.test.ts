import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';

const ai = createRequire(import.meta.url)('../electron/ai-core.cjs') as {
  endpoint(u: string): string;
  checkBaseUrl(u: string): string;
  streamChat(o: { baseUrl: string; apiKey: string; model: string; messages: unknown[]; signal?: AbortSignal; onDelta?: (t: string) => void; idleMs?: number }): Promise<string>;
  loadSettings(fs: unknown, file: string, crypto: unknown): { settings: Record<string, unknown>; apiKey: string; hasStoredKey: boolean };
  saveSettings(fs: unknown, file: string, crypto: unknown, write: (fs: unknown, file: string, text: string) => void, change: Record<string, unknown>): void;
};

async function serve(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const requests: { url?: string; auth?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests, close: () => server.closeAllConnections() ?? server.close() };
}

const sse = (res: http.ServerResponse) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

test('a streamed answer arrives piece by piece, even when lines are split between chunks', async () => {
  const s = await serve((_req, _body, res) => {
    sse(res);
    const all = delta('Hel') + delta('lo ') + delta('world') + 'data: [DONE]\n\n';
    res.write(all.slice(0, 20));
    setTimeout(() => {
      res.write(all.slice(20));
      res.end();
    }, 20);
  });
  const pieces: string[] = [];
  const text = await ai.streamChat({ baseUrl: s.url, apiKey: 'sk-test', model: 'm1', messages: [{ role: 'user', content: 'hi' }], onDelta: (t) => pieces.push(t) });
  s.close();
  assert.equal(text, 'Hello world');
  assert.deepEqual(pieces, ['Hel', 'lo ', 'world']);
  assert.equal(s.requests[0].url, '/v1/chat/completions');
  assert.equal(s.requests[0].auth, 'Bearer sk-test');
  assert.deepEqual([s.requests[0].body.model, s.requests[0].body.stream], ['m1', true]);
});

test('a server that ignores stream and answers with JSON still works', async () => {
  const s = await serve((_req, _body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'plain' } }] }));
  });
  assert.equal(await ai.streamChat({ baseUrl: s.url, apiKey: 'k', model: 'm', messages: [] }), 'plain');
  s.close();
});

test('an error status is reported with the server message and never with the key', async () => {
  const s = await serve((_req, _body, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-secret' } }));
  });
  await assert.rejects(ai.streamChat({ baseUrl: s.url, apiKey: 'sk-secret', model: 'm', messages: [] }), (e: Error) => /HTTP 401: Incorrect API key provided: \*\*\*/.test(e.message) && !e.message.includes('sk-secret'));
  s.close();
});

test('cancelling stops the request, and silence ends it with a message', async () => {
  const s = await serve((_req, _body, res) => {
    sse(res);
    res.write(delta('a'));
  });
  const ctl = new AbortController();
  const got: string[] = [];
  const p = ai.streamChat({ baseUrl: s.url, apiKey: 'k', model: 'm', messages: [], signal: ctl.signal, onDelta: (t) => { got.push(t); ctl.abort(); } });
  await assert.rejects(p, (e: Error & { cancelled?: boolean }) => e.cancelled === true);
  assert.deepEqual(got, ['a']);
  try {
    await assert.rejects(ai.streamChat({ baseUrl: s.url, apiKey: 'k', model: 'm', messages: [], idleMs: 150 }), /No answer for/);
  } finally {
    s.close();
  }
});

test('only https, or http to this computer, is accepted as the address', () => {
  assert.equal(ai.endpoint('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions');
  assert.equal(ai.endpoint('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.doesNotThrow(() => ai.checkBaseUrl('http://localhost:11434/v1'));
  assert.doesNotThrow(() => ai.checkBaseUrl('https://api.openai.com/v1'));
  assert.throws(() => ai.checkBaseUrl('http://example.com/v1'), /https/);
  assert.throws(() => ai.checkBaseUrl('not a url'), /valid/);
  assert.throws(() => ai.checkBaseUrl('file:///etc/passwd'), /https/);
});

function memory() {
  const files = new Map<string, string>();
  return {
    files,
    fs: { readFileSync: (f: string) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f)!; } },
    write: (_fs: unknown, f: string, text: string) => void files.set(f, text),
  };
}
const crypto = (available = true) => ({ isAvailable: () => available, encrypt: (s: string) => Buffer.from(`enc:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^enc:/, '') });

test('the key is stored encrypted and only a replacement or removal changes it', () => {
  const m = memory();
  ai.saveSettings(m.fs, 'f', crypto(), m.write, { enabled: true, model: 'gpt-x', key: 'sk-abc' });
  assert.ok(!m.files.get('f')!.includes('sk-abc'));
  let r = ai.loadSettings(m.fs, 'f', crypto());
  assert.deepEqual([r.settings.enabled, r.settings.model, r.settings.includeScript, r.apiKey, r.hasStoredKey], [true, 'gpt-x', true, 'sk-abc', true]);
  ai.saveSettings(m.fs, 'f', crypto(), m.write, { model: 'gpt-y' });
  r = ai.loadSettings(m.fs, 'f', crypto());
  assert.deepEqual([r.settings.model, r.apiKey], ['gpt-y', 'sk-abc']);
  ai.saveSettings(m.fs, 'f', crypto(), m.write, { key: '' });
  assert.deepEqual([ai.loadSettings(m.fs, 'f', crypto()).apiKey, ai.loadSettings(m.fs, 'f', crypto()).hasStoredKey], ['', false]);
  assert.throws(() => ai.saveSettings(m.fs, 'f', crypto(false), m.write, { key: 'sk-new' }), /cannot encrypt/);
  assert.throws(() => ai.saveSettings(m.fs, 'f', crypto(), m.write, { baseUrl: 'http://example.com' }), /https/);
});