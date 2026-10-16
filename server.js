import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

// Tiny .env reader keeps this prototype dependency-free. Existing process env wins.
try {
  const envText = await readFile(join(root, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const configured = () => Boolean(process.env.DETECTIFAI_API_KEY && process.env.DETECTIFAI_DEEPFAKE_URL && process.env.DETECTIFAI_SPEAKER_URL);
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

function parseMultipart(req, raw) {
  const type = req.headers['content-type'] || '';
  const boundary = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) throw new Error('Expected multipart/form-data audio upload.');
  const marker = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const parts = new Map();
  let cursor = raw.indexOf(marker);
  while (cursor >= 0) {
    cursor += marker.length;
    if (raw.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (raw.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) cursor += 2;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headers = raw.subarray(cursor, headerEnd).toString('utf8');
    const next = raw.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    let end = next;
    if (raw.subarray(end - 2, end).equals(Buffer.from('\r\n'))) end -= 2;
    const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (disposition) {
      const [, name, filename] = disposition;
      const contentType = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1]?.trim() || 'application/octet-stream';
      parts.set(name, { filename, contentType, data: raw.subarray(headerEnd + 4, end) });
    }
    cursor = next;
  }
  return parts;
}

function parseDecision(payload, kind) {
  // Fail closed: only explicit API booleans can satisfy a gate. Adapt these keys
  // to the official DetectifAI response schema once the event API docs are provided.
  const candidates = kind === 'deepfake'
    ? [['is_fake', false], ['is_deepfake', false], ['is_synthetic', false]]
    : [['match', true], ['is_match', true], ['verified', true]];
  for (const [key, passValue] of candidates) {
    if (typeof payload?.[key] === 'boolean') {
      return { passed: payload[key] === passValue, signal: key };
    }
  }
  return { passed: false, signal: 'unrecognized-response' };
}

async function callDetectifAI(url, audio, speakerId, kind) {
  const form = new FormData();
  form.append('file', new Blob([audio.data], { type: audio.contentType }), audio.filename || 'call-audio.webm');
  form.append('speaker_id', speakerId);
  const headerName = process.env.DETECTIFAI_AUTH_HEADER || 'Authorization';
  const prefix = process.env.DETECTIFAI_AUTH_PREFIX ?? 'Bearer';
  const headers = { [headerName]: prefix ? `${prefix} ${process.env.DETECTIFAI_API_KEY}` : process.env.DETECTIFAI_API_KEY };
  const response = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`${kind} API returned HTTP ${response.status}${payload.message ? `: ${payload.message}` : ''}`);
  return { payload, decision: parseDecision(payload, kind) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { configured: configured(), deepfake: Boolean(process.env.DETECTIFAI_DEEPFAKE_URL), speaker: Boolean(process.env.DETECTIFAI_SPEAKER_URL) });
  }
  if (url.pathname === '/api/verify' && req.method === 'POST') {
    if (!configured()) return json(res, 503, { error: 'DetectifAI is not configured. Add the team API key and both endpoint URLs to .env.' });
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) return json(res, 413, { error: 'Audio is too large. Maximum upload size is 20 MB.' });
        chunks.push(chunk);
      }
      const parts = parseMultipart(req, Buffer.concat(chunks));
      const audio = parts.get('audio');
      const speakerId = parts.get('speakerId')?.data.toString('utf8').trim();
      if (!audio?.data?.length) return json(res, 400, { error: 'Add a call recording before verification.' });
      if (!speakerId) return json(res, 400, { error: 'Enter the enrolled speaker ID for the claimed caller.' });
      // One short recording is sent to both checks. Neither check is faked or cached.
      const [deepfake, speaker] = await Promise.all([
        callDetectifAI(process.env.DETECTIFAI_DEEPFAKE_URL, audio, speakerId, 'deepfake'),
        callDetectifAI(process.env.DETECTIFAI_SPEAKER_URL, audio, speakerId, 'speaker'),
      ]);
      const gate = deepfake.decision.passed && speaker.decision.passed;
      return json(res, 200, {
        gate: gate ? 'verified' : 'blocked',
        message: gate ? 'Both checks passed. Continue with your institution’s normal payment authorization.' : 'Verification did not pass. Do not approve based on this call; use a known, independently verified contact channel.',
        checks: {
          deepfake: { passed: deepfake.decision.passed, signal: deepfake.decision.signal, response: deepfake.payload },
          speaker: { passed: speaker.decision.passed, signal: speaker.decision.signal, response: speaker.payload },
        },
      });
    } catch (error) {
      return json(res, 502, { error: error.name === 'TimeoutError' ? 'DetectifAI request timed out. Retry or verify through a known contact channel.' : `Verification failed: ${error.message}` });
    }
  }
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  const file = join(root, safePath || 'index.html');
  if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch { json(res, 404, { error: 'Not found' }); }
});

const port = Number(process.env.PORT || 5000);
server.listen(port, () => console.log(`UnClone Finance Guard ready at http://localhost:${port}`));
