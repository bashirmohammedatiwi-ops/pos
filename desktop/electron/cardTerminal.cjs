const { execFile } = require('child_process');

/** PAX terminals (A910/A920) enumerate as USB VID_2FB8 CDC ports; MI_00 is the data port. */
const PAX_VID = 'VID_2FB8';
const PROBE_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 20_000;

/** The vendor service answers with this when the reader was never attached over USB. */
const NOT_CONNECTED = /connect\s*device|device\s*(is\s*)?not\s*connect|not\s*connected|no\s*device|disconnect/i;

function isNotConnectedMessage(message) {
  return NOT_CONNECTED.test(String(message ?? ''));
}

function serviceBaseUrl(service) {
  const raw = String(service || '').trim() || 'localhost:9092';
  const trimmed = raw.replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function runReg(args) {
  return new Promise(resolve => {
    execFile('reg', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/**
 * Reads PortName values under the USB enumeration key and keeps the PAX ones,
 * preferring the MI_00 interface the vendor service expects.
 */
async function detectPaxComPorts() {
  if (process.platform !== 'win32') return [];
  const out = await runReg([
    'query',
    'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB',
    '/s',
    '/v',
    'PortName',
  ]);
  if (!out) return [];

  const found = [];
  let key = '';
  for (const line of out.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    if (/^HKEY_/i.test(text)) {
      key = text;
      continue;
    }
    const match = text.match(/^PortName\s+REG_SZ\s+(\S+)/i);
    if (match && key.toUpperCase().includes(PAX_VID)) {
      found.push({ key, port: match[1] });
    }
  }

  const preferred = found.filter(x => /MI_00/i.test(x.key)).map(x => x.port);
  const others = found.filter(x => !/MI_00/i.test(x.key)).map(x => x.port);
  return [...new Set([...preferred, ...others])];
}

/** true = service sees the reader, false = it does not, null = the service cannot tell us. */
async function probeConnected(base) {
  try {
    const res = await fetch(`${base}/isConnected`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 405) return null;
    if (!res.ok) return false;
    const body = (await res.text()).trim();
    if (!body) return true;
    if (/^(false|0)$/i.test(body)) return false;
    if (/"?(isConnected|connected|result)"?\s*:\s*(false|0)/i.test(body)) return false;
    if (isNotConnectedMessage(body)) return false;
    return true;
  } catch {
    return null;
  }
}

async function connectByUsb(base, comPort) {
  if (!comPort) return false;
  try {
    const res = await fetch(`${base}/connectDeviceByUsb?comPort=${encodeURIComponent(comPort)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = await res.text().catch(() => '');
    return !isNotConnectedMessage(body);
  } catch {
    return false;
  }
}

/**
 * Mirrors the WPF cashier: verify the reader, and when it is not attached try the
 * configured COM port first, then any PAX port Windows knows about.
 * @returns {Promise<{ok: boolean, comPort: string|null, tried: string[]}>}
 */
async function ensureConnected(base, comPort) {
  const configured = String(comPort || '').trim();
  if ((await probeConnected(base)) === true) {
    return { ok: true, comPort: configured || null, tried: [] };
  }

  const candidates = [...new Set([configured, ...(await detectPaxComPorts())].filter(Boolean))];
  for (const port of candidates) {
    if (!(await connectByUsb(base, port))) continue;
    const state = await probeConnected(base);
    if (state !== false) return { ok: true, comPort: port, tried: candidates };
  }

  return { ok: false, comPort: null, tried: candidates };
}

module.exports = {
  connectByUsb,
  detectPaxComPorts,
  ensureConnected,
  isNotConnectedMessage,
  probeConnected,
  serviceBaseUrl,
};
