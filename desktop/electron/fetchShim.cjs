// Electron 22 (the last release that runs on Windows 7) ships Node 16, which has no global
// fetch in the main process. This fills in the small part of fetch the main process uses:
// GET/POST with headers, a string body, an AbortSignal, and ok/status/text()/json().
// Newer Electron builds already have fetch, so this does nothing there.
const http = require('http');
const https = require('https');

function shimFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(String(input)); } catch (e) { reject(new TypeError(`Invalid URL: ${input}`)); return; }
    const lib = url.protocol === 'https:' ? https : http;
    const headers = { ...(init.headers || {}) };
    const body = init.body == null ? null : Buffer.from(String(init.body), 'utf8');
    if (body) headers['Content-Length'] = body.length;
    const signal = init.signal;
    if (signal?.aborted) { reject(abortError()); return; }

    const req = lib.request(url, { method: init.method || 'GET', headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        cleanup();
        const buf = Buffer.concat(chunks);
        const status = res.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: { get: name => res.headers[String(name).toLowerCase()] ?? null },
          text: async () => buf.toString('utf8'),
          json: async () => JSON.parse(buf.toString('utf8')),
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        });
      });
      res.on('error', err => { cleanup(); reject(err); });
    });
    const onAbort = () => { req.destroy(abortError()); };
    function cleanup() { if (signal) signal.removeEventListener?.('abort', onAbort); }
    if (signal) signal.addEventListener?.('abort', onAbort);
    req.on('error', err => { cleanup(); reject(err); });
    if (body) req.write(body);
    req.end();
  });
}

function abortError() {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

if (typeof globalThis.fetch !== 'function') globalThis.fetch = shimFetch;

module.exports = { shimFetch };
