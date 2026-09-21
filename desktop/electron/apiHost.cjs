const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { configure, normalizeApiBase, readSavedApiBase, writeSavedApiBase } = require('./apiConfig.cjs');
const { discoverServers, API_PORT, sortServers } = require('./lanDiscovery.cjs');

const SERVICE = 'FOTPOSServer';
const LOCAL_URL = `http://127.0.0.1:${API_PORT}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveApiExe() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, 'Api', 'FOT.Pos.Api.exe'),
    path.join(process.resourcesPath || execDir, '..', 'Api', 'FOT.Pos.Api.exe'),
    path.join(programFiles, 'FOT POS Server', 'Api', 'FOT.Pos.Api.exe'),
    path.join(programFiles, 'FOT POS', 'Server', 'Api', 'FOT.Pos.Api.exe'),
    path.join(programFiles, 'FOT POS', 'Server', 'FOT.Pos.Api.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'FOT POS Server', 'Api', 'FOT.Pos.Api.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'FOT POS', 'Api', 'FOT.Pos.Api.exe'),
    path.resolve(__dirname, '..', '..', 'src', 'FOT.Pos.Api', 'bin', 'Debug', 'net9.0', 'FOT.Pos.Api.exe'),
    path.resolve(__dirname, '..', '..', 'src', 'FOT.Pos.Api', 'bin', 'Release', 'net9.0', 'FOT.Pos.Api.exe'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function serviceInstalled() {
  return new Promise(resolve => {
    execFile('sc.exe', ['query', SERVICE], { windowsHide: true }, (err, stdout) => {
      resolve(!err && /SERVICE_NAME:\s*FOTPOSServer/i.test(String(stdout || '')));
    });
  });
}

function startService() {
  return new Promise(resolve => {
    execFile('sc.exe', ['start', SERVICE], { windowsHide: true }, () => resolve());
  });
}

function spawnApi(exe) {
  spawn(exe, [], {
    cwd: path.dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function killStaleApi() {
  return new Promise(resolve => {
    execFile('taskkill', ['/IM', 'FOT.Pos.Api.exe', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function hasLocalApi() {
  if (resolveApiExe()) return true;
  return serviceInstalled();
}

async function isHealthyAt(url) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitHealthy(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await isHealthyAt(url)) return true;
    await sleep(500);
  }
  return false;
}

let onUrlChanged = null;

function setUrlChangedHandler(fn) {
  onUrlChanged = typeof fn === 'function' ? fn : null;
}

function remember(url) {
  const prev = readSavedApiBase();
  const saved = writeSavedApiBase(url);
  const next = saved || url;
  if (next && next !== prev) onUrlChanged?.(next);
  return next;
}

async function probeCandidates(urls) {
  const seen = new Set();
  for (const raw of urls) {
    const url = normalizeApiBase(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (await isHealthyAt(url)) return url;
  }
  return null;
}

async function ensureApi({ isDev, preferredUrl, startup, probeOnly } = {}) {
  const saved = readSavedApiBase();
  const localReady = await probeCandidates([preferredUrl, saved, LOCAL_URL]);
  if (localReady) {
    return { ok: true, mode: localReady === LOCAL_URL ? 'running' : 'lan', url: remember(localReady) };
  }

  if (probeOnly) {
    return {
      ok: false,
      mode: 'probe',
      url: saved || preferredUrl || LOCAL_URL,
      message: 'الخادم غير متاح — راجع إعدادات الاتصال',
    };
  }

  const bundled = Boolean(resolveApiExe());
  const installed = bundled || await serviceInstalled();

  if (!installed) {
    const found = sortServers(await discoverServers({ timeoutMs: startup ? 2200 : 4000, httpScan: !startup }));
    for (const server of found) {
      if (await isHealthyAt(server.url)) {
        return {
          ok: true,
          mode: 'lan',
          url: remember(server.url),
          hostName: server.hostName,
        };
      }
    }
    return {
      ok: false,
      mode: 'remote',
      url: saved || preferredUrl || LOCAL_URL,
      message: 'لم يُعثر على خادم FOT POS على الشبكة — ثبّت FOT-POS-Server على الجهاز الرئيسي أو أدخل عنوان API',
    };
  }

  if (isDev) {
    return { ok: false, mode: 'dev', url: LOCAL_URL, message: 'شغّل الـ API: dotnet run --project src/FOT.Pos.Api' };
  }

  if (await serviceInstalled()) {
    await startService();
    if (await waitHealthy(LOCAL_URL, startup ? 12_000 : 20_000)) {
      return { ok: true, mode: 'service', url: remember(LOCAL_URL) };
    }
  }

  const exe = resolveApiExe();
  if (!exe) {
    return {
      ok: false,
      mode: 'missing',
      url: LOCAL_URL,
      message: 'لم يُعثر على FOTPOSServer أو FOT.Pos.Api.exe — ثبّت FOT-POS-Server-Setup أولاً',
    };
  }

  if (!(await isHealthyAt(LOCAL_URL))) {
    await killStaleApi();
    await sleep(800);
  }
  spawnApi(exe);
  if (await waitHealthy(LOCAL_URL, startup ? 20_000 : 45_000)) {
    return { ok: true, mode: 'process', url: remember(LOCAL_URL) };
  }

  return { ok: false, mode: 'timeout', url: LOCAL_URL, message: 'انتهت مهلة انتظار تشغيل API على المنفذ 5000' };
}

async function watchdogTick({ isDev } = {}) {
  const saved = readSavedApiBase() || LOCAL_URL;
  if (await isHealthyAt(saved)) return { ok: true, url: saved, changed: false };
  const result = await ensureApi({ isDev, preferredUrl: saved });
  return { ok: Boolean(result.ok), url: result.url || saved, changed: Boolean(result.ok && result.url && result.url !== saved) };
}

module.exports = {
  configure,
  ensureApi,
  hasLocalApi,
  isHealthyAt,
  readSavedApiBase,
  writeSavedApiBase,
  discoverServers,
  setUrlChangedHandler,
  watchdogTick,
  resolveApiExe,
};
