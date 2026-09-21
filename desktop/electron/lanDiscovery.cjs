const dgram = require('dgram');
const os = require('os');

const API_PORT = 5000;
const DISCOVERY_PORT = 49500;
const PROBE = Buffer.from('FOT-POS?');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ipv4Interfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const virtual = /hyper-v|vethernet|vmware|virtualbox|virtual|vbox|loopback|bluetooth|docker|wsl|vpn/i.test(name);
    for (const a of addrs || []) {
      const family = a.family === 4 || a.family === 'IPv4';
      if (!family || a.internal) continue;
      if (String(a.address).startsWith('169.254.')) continue;
      if (virtual) continue;
      out.push(a.address);
    }
  }
  if (out.length === 0) {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) {
        const family = a.family === 4 || a.family === 'IPv4';
        if (!family || a.internal) continue;
        out.push(a.address);
      }
    }
  }
  return out;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function sameSubnet(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  return pa.length === 4 && pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

function rankUrl(url) {
  const host = hostOf(url);
  let score = 0;
  if (host.startsWith('169.254.')) score -= 100;
  else if (host.startsWith('192.168.')) score += 20;
  else if (host.startsWith('10.')) score += 10;
  for (const local of ipv4Interfaces()) {
    if (host === local) score += 30;
    if (sameSubnet(host, local)) score += 100;
  }
  return score;
}

function sortServers(list) {
  return [...list].sort((a, b) => rankUrl(b.url) - rankUrl(a.url) || String(a.hostName).localeCompare(String(b.hostName)) || a.url.localeCompare(b.url));
}

function scanBases() {
  const bases = [];
  for (const ip of ipv4Interfaces()) {
    const parts = ip.split('.');
    if (parts.length !== 4) continue;
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (!bases.includes(base)) bases.push(base);
  }
  return bases.slice(0, 2);
}

function subnetBroadcasts() {
  const set = new Set(['255.255.255.255']);
  for (const base of scanBases()) set.add(`${base}.255`);
  return [...set];
}

function addServer(map, server) {
  if (!server?.url) return;
  const url = String(server.url).replace(/\/$/, '');
  const prev = map.get(url);
  if (!prev) {
    map.set(url, { ...server, url });
    return;
  }
  if (!prev.hostName && server.hostName) prev.hostName = server.hostName;
}

async function discoverUdp(timeoutMs) {
  const found = new Map();
  await new Promise(resolve => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      resolve();
    };

    socket.on('message', (msg, rinfo) => {
      try {
        const json = JSON.parse(msg.toString('utf8'));
        if (json.app !== 'FOT-POS') return;
        const port = Number(json.port) || API_PORT;
        const urls = Array.isArray(json.urls) && json.urls.length
          ? json.urls
          : [`http://${rinfo.address}:${port}`];
        for (const url of urls) {
          addServer(found, {
            url,
            hostName: json.hostName || rinfo.address,
            port,
            source: 'udp',
          });
        }
      } catch {
        /* ignore non-JSON / probe echo */
      }
    });

    const startProbe = () => {
      try { socket.setBroadcast(true); } catch { /* ignore */ }
      for (const host of subnetBroadcasts()) {
        socket.send(PROBE, DISCOVERY_PORT, host, () => {});
      }
    };
    socket.on('error', () => finish());
    socket.bind(0, startProbe);

    setTimeout(finish, timeoutMs);
  });
  return [...found.values()];
}

async function probeHttp(url, timeoutMs = 800) {
  const base = String(url).replace(/\/$/, '');
  try {
    const infoRes = await fetch(`${base}/api/server/info`, { signal: AbortSignal.timeout(timeoutMs) });
    if (infoRes.ok) {
      const info = await infoRes.json();
      return {
        url: base,
        hostName: info.hostName || '',
        port: Number(info.apiPort) || API_PORT,
        source: 'http',
      };
    }
  } catch {
    /* try /health */
  }
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (health.ok || health.status === 503) {
      return { url: base, hostName: '', port: API_PORT, source: 'http' };
    }
  } catch {
    /* unreachable */
  }
  return null;
}

async function scanSubnetHttp(timeoutMs) {
  const found = new Map();
  const bases = scanBases();
  const hosts = [];
  for (const base of bases) {
    for (let i = 1; i <= 254; i++) hosts.push(`http://${base}.${i}:${API_PORT}`);
  }
  const concurrency = 48;
  let index = 0;
  const deadline = Date.now() + timeoutMs;

  async function worker() {
    while (index < hosts.length && Date.now() < deadline) {
      const url = hosts[index++];
      const hit = await probeHttp(url, 600);
      if (hit) addServer(found, hit);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()));
  return [...found.values()];
}

async function discoverServers({ timeoutMs = 3500, httpScan = true } = {}) {
  const found = new Map();
  const udp = await discoverUdp(Math.min(timeoutMs, 1800));
  for (const s of udp) addServer(found, s);

  if (found.size === 0 && httpScan) {
    const remaining = Math.max(800, timeoutMs - 1800);
    const http = await scanSubnetHttp(remaining);
    for (const s of http) addServer(found, s);
  }

  return sortServers([...found.values()]);
}

module.exports = { discoverServers, probeHttp, API_PORT, sleep, rankUrl, sortServers };
