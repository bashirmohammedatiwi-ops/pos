const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createCatalogStore } = require('./catalogStore.cjs');
const { getMachineHwId } = require('./hwid.cjs');
const { readPrintConfig, writePrintConfig } = require('./printConfig.cjs');
const { printHtml } = require('./printHtml.cjs');
const { readWindowConfig, writeWindowConfig } = require('./windowConfig.cjs');
const {
  configure,
  ensureApi,
  hasLocalApi,
  readSavedApiBase,
  writeSavedApiBase,
  discoverServers,
  setUrlChangedHandler,
  watchdogTick,
  resolveApiExe,
} = require('./apiHost.cjs');
const { resolveRole } = require('./role.cjs');
const {
  ensureConnected: ensureCardReader,
  isNotConnectedMessage: isCardReaderDetached,
  serviceBaseUrl: cardServiceBaseUrl,
} = require('./cardTerminal.cjs');
const { configure: configureCrashLog, logError, logInfo } = require('./crashLog.cjs');
const {
  wasDirtyShutdown,
  markRunning,
  markClean,
  wipeCacheDirs,
  clearChromiumCaches,
} = require('./sessionRecovery.cjs');

app.commandLine.appendSwitch(
  'disable-features',
  [
    'BlockInsecurePrivateNetworkRequests',
    'PrivateNetworkAccessSendPreflights',
    'LocalNetworkAccessChecks',
    'LocalNetworkAccessChecksForNavigations',
  ].join(','),
);

// نافذة بيضاء على بعض تعريفات الرسوميات القديمة — تعطيل تسريع العتاد افتراضياً
// (يمكن استثناء جهاز بتمرير --enable-gpu عند التشغيل)
if (!process.argv.includes('--enable-gpu')) {
  app.disableHardwareAcceleration();
}

// Hidden-to-tray / lock-screen must not freeze the renderer (blank UI, dead inputs).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const role = resolveRole();
process.env.FOT_APP = role;
const isDev = !app.isPackaged;
const startBackground = process.argv.includes('--background');

function isServerEdition() {
  if (!app.isPackaged || role !== 'admin') return false;
  const execDir = path.dirname(process.execPath);
  return fs.existsSync(path.join(execDir, 'Api', 'FOT.Pos.Api.exe')) || Boolean(resolveApiExe());
}

if (isServerEdition()) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
  else app.on('second-instance', () => showMainWindow());
}

let store;
let tray = null;
let mainWindow = null;
let quitting = false;
const reloadGuard = { count: 0, windowStart: Date.now() };
// POS only: consumed once per app launch so the renderer forces a fresh login on
// every app restart while crash-heal reloads within the same launch keep the session.
let freshLaunchPending = role === 'pos';

function canReloadWindow(reason) {
  const now = Date.now();
  if (now - reloadGuard.windowStart > 180_000) {
    reloadGuard.count = 0;
    reloadGuard.windowStart = now;
  }
  reloadGuard.count += 1;
  if (reloadGuard.count > 4) {
    logError('reload blocked', { reason, count: reloadGuard.count });
    return false;
  }
  logInfo('reload window', { reason, count: reloadGuard.count });
  return true;
}

function ensureStore(userData) {
  if (store) return store;
  try {
    store = createCatalogStore(userData);
  } catch (e) {
    logError('catalog store init failed', e instanceof Error ? e.message : e);
  }
  return store;
}

process.on('uncaughtException', err => {
  logError('uncaughtException', err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
});
process.on('unhandledRejection', reason => {
  logError('unhandledRejection', reason instanceof Error ? reason.message : String(reason));
});

function rendererIndex() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, role === 'pos' ? 'fot-pos' : 'fot-admin', 'index.html');
  }
  return path.join(__dirname, '..', '..', 'web', role === 'pos' ? 'fot-pos' : 'fot-admin', 'dist', 'index.html');
}

function recoveryIndex() {
  return path.join(__dirname, 'recovery.html');
}

function isLoginLaunch() {
  if (process.argv.includes('--background')) return true;
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  } catch {
    return false;
  }
}

function waitForDesktopSession() {
  const up = os.uptime();
  if (up >= 120) return Promise.resolve();
  const ms = Math.min(10_000, Math.max(2_000, Math.round((90 - up) * 70)));
  logInfo('delay renderer for desktop session', { uptime: Math.round(up), ms });
  return new Promise(resolve => setTimeout(resolve, ms));
}

function healWindowInput(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.setEnabled(true);
    win.focus();
    win.webContents.focus();
    void win.webContents.executeJavaScript(`
      try { window.focus(); } catch (e) {}
    `).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

async function isRendererBlank(win) {
  if (!win || win.isDestroyed()) return true;
  const state = await win.webContents.executeJavaScript(`
    (() => {
      const root = document.getElementById('root');
      return {
        ready: Boolean(window.__fotAppReady),
        kids: root ? root.childElementCount : 0,
        text: root ? String(root.innerText || '').trim().length : 0,
      };
    })()
  `).catch(() => null);
  if (!state) return true;
  return !state.ready || state.kids === 0 || state.text < 4;
}

function scheduleBlankCheck(win, reason) {
  if (!win || win.isDestroyed() || isDev) return;
  setTimeout(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    void isRendererBlank(win).then(blank => {
      if (!blank) return;
      logError('blank ui detected', { reason });
      if (canReloadWindow(reason || 'blank-ui')) loadApp(win);
    });
  }, 3500);
}

function loadApp(win) {
  if (!win || win.isDestroyed()) return;
  win.__fotLoaded = true;
  win.__fotHiddenAt = 0;
  if (isDev) {
    const devUrl = role === 'pos' ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:5173';
    void win.loadURL(devUrl);
    return;
  }
  void win.loadFile(rendererIndex());
}

function loadRecovery(win) {
  if (!win || win.isDestroyed() || isDev) return;
  logError('showing recovery page');
  void win.loadFile(recoveryIndex());
}

let splashWindow = null;

function splashHtml() {
  const bg = role === 'pos' ? '#0b1220' : '#0f172a';
  const title = role === 'pos' ? 'نقطة البيع' : 'لوحة التحكم';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><style>
  html,body{height:100%;margin:0;background:${bg};color:#e2e8f0;
    font-family:system-ui,"Segoe UI",Tahoma,sans-serif;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:14px}
  .brand{font-size:26px;font-weight:800;letter-spacing:2px}
  .sub{font-size:14px;color:#94a3b8}
  .spin{width:34px;height:34px;border-radius:50%;border:3px solid #1e293b;
    border-top-color:#0f9f76;animation:sp 0.9s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
</style></head>
<body>
  <div class="brand">FOT POS</div>
  <div class="sub">${title} — جاري التحميل…</div>
  <div class="spin"></div>
</body></html>`;
}

function createSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;
  try {
    splashWindow = new BrowserWindow({
      width: 380,
      height: 240,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: true,
      backgroundColor: role === 'pos' ? '#0b1220' : '#0f172a',
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
    // Never let a stuck splash outlive startup.
    setTimeout(closeSplash, 30_000);
  } catch (e) {
    logError('splash failed', e instanceof Error ? e.message : e);
    splashWindow = null;
  }
  return splashWindow;
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch { /* ignore */ }
  }
  splashWindow = null;
}

/** Shows the main window and retires the splash — the single reveal path. */
function revealMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) {
    win.show();
    if (role === 'pos' && !win.isFullScreen()) win.maximize();
  }
  closeSplash();
}

async function recoverRenderer() {
  reloadGuard.count = 0;
  reloadGuard.windowStart = Date.now();
  const userData = app.getPath('userData');
  wipeCacheDirs(userData);
  await clearChromiumCaches();
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (win) loadApp(win);
  return { ok: true };
}

function showMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    const hiddenFor = win.__fotHiddenAt ? Date.now() - win.__fotHiddenAt : 0;
    win.__fotHiddenAt = 0;
    if (!win.__fotLoaded) {
      loadApp(win);
    } else if (!isDev && hiddenFor > 90_000 && canReloadWindow('long-hidden')) {
      loadApp(win);
    }
    revealMainWindow(win);
    healWindowInput(win);
    const staleMs = Date.now() - (win.__fotLastReady || 0);
    if (!isDev && staleMs > 20 * 60_000) {
      void isRendererBlank(win).then(blank => {
        if (blank && canReloadWindow('stale-show')) loadApp(win);
      });
    } else {
      scheduleBlankCheck(win, 'show');
    }
    return;
  }
  createWindow();
}

function createTray() {
  if (!isServerEdition() || tray) return;
  try {
    const icon = nativeImage.createFromPath(process.execPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('FOT POS Server');
    const menu = Menu.buildFromTemplate([
      { label: 'لوحة التحكم', click: () => showMainWindow() },
      { label: 'إعادة تحميل الواجهة', click: () => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        if (win && canReloadWindow('tray-reload')) loadApp(win);
        showMainWindow();
      } },
      { type: 'separator' },
      { label: 'إنهاء FOT POS', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', () => showMainWindow());
  } catch (e) {
    console.error('[fot-tray]', e);
  }
}

function createWindow() {
  const userData = app.getPath('userData');
  const windowCfg = readWindowConfig(userData, { fullscreen: role === 'pos' });
  const startFullscreen = role === 'pos' && windowCfg.fullscreen !== false;
  const hideOnLaunch = isServerEdition() && startBackground;

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    fullscreen: startFullscreen,
    fullscreenable: true,
    backgroundColor: role === 'pos' ? '#0b1220' : '#0f172a',
    title: role === 'pos' ? 'FOT POS — الكاشير' : isServerEdition() ? 'FOT POS — الخادم الرئيسي' : 'FOT POS — لوحة التحكم',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      additionalArguments: [`--fot-role=${role}`],
    },
  });

  mainWindow = win;
  win.webContents.setBackgroundThrottling(false);

  win.once('ready-to-show', () => {
    if (!hideOnLaunch) {
      revealMainWindow(win);
      healWindowInput(win);
    }
  });

  win.on('show', () => {
    win.__fotHiddenAt = 0;
    healWindowInput(win);
  });
  win.on('restore', () => healWindowInput(win));
  win.on('focus', () => {
    try { win.webContents.focus(); } catch { /* ignore */ }
  });
  win.on('hide', () => {
    win.__fotHiddenAt = Date.now();
  });

  setTimeout(() => {
    if (win.isDestroyed() || hideOnLaunch || win.isVisible() || !win.__fotLoaded) return;
    logInfo('force-show window (ready-to-show missed)');
    revealMainWindow(win);
  }, 3500);

  let emptyUiTimer = null;
  win.webContents.on('did-finish-load', () => {
    win.__fotLastReady = Date.now();
    void win.webContents.setVisualZoomLevelLimits(1, 1);
    if (emptyUiTimer) clearTimeout(emptyUiTimer);
    const loaded = win.webContents.getURL();
    if (isDev || loaded.includes('recovery.html')) return;
    emptyUiTimer = setTimeout(async () => {
      if (win.isDestroyed()) return;
      const ready = await win.webContents.executeJavaScript('Boolean(window.__fotAppReady)').catch(() => false);
      if (ready) return;
      logError('empty ui after load');
      if (canReloadWindow('empty-ui')) loadApp(win);
      else loadRecovery(win);
    }, 10_000);
  });

  win.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    logError('did-fail-load', { code, desc, url });
    if (isDev || code === -3) return;
    if (canReloadWindow('did-fail-load')) loadApp(win);
    else loadRecovery(win);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logError('render-process-gone', details);
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    if (canReloadWindow('render-process-gone')) loadApp(win);
    else loadRecovery(win);
  });

  // A busy renderer (long sync, big table) can look unresponsive for a while —
  // only reload when it stays unresponsive past the grace window.
  let rendererResponsive = true;
  win.webContents.on('unresponsive', () => {
    rendererResponsive = false;
    logError('renderer unresponsive');
    setTimeout(() => {
      if (win.isDestroyed() || rendererResponsive) return;
      logError('renderer still unresponsive after grace — reloading');
      if (canReloadWindow('unresponsive')) loadApp(win);
    }, 15_000);
  });

  win.webContents.on('responsive', () => {
    rendererResponsive = true;
    logInfo('renderer responsive');
  });

  win.on('enter-full-screen', () => {
    writeWindowConfig(userData, { fullscreen: true }, { fullscreen: role === 'pos' });
  });
  win.on('leave-full-screen', () => {
    writeWindowConfig(userData, { fullscreen: false }, { fullscreen: role === 'pos' });
    if (role === 'pos') win.maximize();
  });

  win.on('close', event => {
    if (isServerEdition() && !quitting) {
      event.preventDefault();
      win.__fotHiddenAt = Date.now();
      win.hide();
    }
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') {
      event.preventDefault();
      if (canReloadWindow('manual-reload')) loadApp(win);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!isLoginLaunch()) loadApp(win);
}

ipcMain.handle('desktop:info', async () => ({
  role,
  version: app.getVersion(),
  packaged: app.isPackaged,
  hasLocalApi: await hasLocalApi(),
  isServerEdition: isServerEdition(),
  apiBase: readSavedApiBase(),
}));
ipcMain.handle('desktop:recover', () => recoverRenderer());
// True exactly once per app launch (POS role) — the renderer uses it to force a
// fresh login on every app restart while reloads within the run keep the session.
ipcMain.handle('boot:consume-fresh', () => {
  const value = freshLaunchPending;
  freshLaunchPending = false;
  return value;
});

function broadcastApiBase(url) {
  if (!url) return;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('api:base-changed', url);
  }
}

setUrlChangedHandler(broadcastApiBase);

ipcMain.handle('api:ensure', (_event, preferredUrl) => ensureApi({ isDev, preferredUrl }));
ipcMain.handle('api:getBase', () => readSavedApiBase());
ipcMain.handle('api:setBase', (_event, url) => {
  const prev = readSavedApiBase();
  const saved = writeSavedApiBase(url);
  if (saved && saved !== prev) broadcastApiBase(saved);
  return saved || null;
});
ipcMain.handle('api:discover', (_event, opts) => discoverServers({ timeoutMs: opts?.timeoutMs ?? 4000, httpScan: opts?.httpScan !== false }));

ipcMain.handle('hwid:get', () => getMachineHwId());

ipcMain.handle('print:list', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  const list = await win.webContents.getPrintersAsync();
  return list.map(p => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
  }));
});

ipcMain.handle('print:config:get', () => readPrintConfig(app.getPath('userData')));
ipcMain.handle('print:config:set', (_event, patch) => writePrintConfig(app.getPath('userData'), patch || {}));

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('window:fullscreen:get', event => Boolean(windowFromEvent(event)?.isFullScreen()));
ipcMain.handle('window:fullscreen:set', (event, flag) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  win.setFullScreen(Boolean(flag));
  writeWindowConfig(app.getPath('userData'), { fullscreen: Boolean(flag) }, { fullscreen: role === 'pos' });
  return win.isFullScreen();
});
ipcMain.handle('window:fullscreen:toggle', event => {
  const win = windowFromEvent(event);
  if (!win) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  writeWindowConfig(app.getPath('userData'), { fullscreen: next }, { fullscreen: role === 'pos' });
  return next;
});

ipcMain.handle('print:html', async (_event, html, copies = 1, deviceName, options) => {
  const config = readPrintConfig(app.getPath('userData'));
  const named = deviceName || config.printerName || undefined;
  return printHtml(html, copies, named, options);
});

function safeIpc(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(`[fot-ipc] ${channel}`, e);
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  });
}

function bindStoreIpc() {
  const catalog = {
    findBarcode: 'findProduct',
    search: 'searchProducts',
    syncBatch: 'upsertProducts',
    productCount: 'productCount',
    prune: 'pruneProducts',
  };
  const outbox = {
    enqueue: 'enqueue',
    list: 'pending',
    count: 'pendingCount',
    markSynced: 'removeOutbox',
    markError: 'markOutboxError',
    update: 'updateOutbox',
    resetRetry: 'resetOutboxRetry',
    counts: 'outboxCounts',
  };
  const methods = [
    'getMeta', 'setMeta', 'upsertProducts', 'findProduct', 'searchProducts', 'productCount', 'productsByIds',
    'pruneProducts',
    'saveGroups', 'loadGroups', 'loadGroupItems', 'saveSalesmen', 'loadSalesmen',
    'saveAccounts', 'loadAccounts', 'savePrintSettings', 'loadPrintSettings',
    'nextLocalNumber', 'seedReceiptSeq', 'enqueue', 'pending', 'pendingCount', 'removeOutbox',
    'markOutboxError', 'updateOutbox', 'resetOutboxRetry', 'outboxCounts',
    'saveLastReceipt', 'loadLastReceipt', 'saveTodayReceipts', 'loadTodayReceipts',
  ];
  for (const name of methods) {
    safeIpc(`store:${name}`, (...args) => {
      const s = ensureStore(app.getPath('userData'));
      if (!s) throw new Error('المخزن المحلي غير جاهز');
      return s[name](...args);
    });
  }
  for (const [alias, method] of Object.entries(catalog)) {
    safeIpc(`catalog:${alias}`, (...args) => {
      const s = ensureStore(app.getPath('userData'));
      if (!s) throw new Error('المخزن المحلي غير جاهز');
      return s[method](...args);
    });
  }
  for (const [alias, method] of Object.entries(outbox)) {
    safeIpc(`outbox:${alias}`, (...args) => {
      const s = ensureStore(app.getPath('userData'));
      if (!s) throw new Error('المخزن المحلي غير جاهز');
      return s[method](...args);
    });
  }
}

/** Readers report these fields as numbers or strings depending on firmware; the server wants text. */
function cardText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** PAX stamps the sale as yyyyMMddHHmmss, which is not a date the server can parse as-is. */
function cardTimestamp(value) {
  const raw = cardText(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14) {
    const [y, m, d, h, min, s] = [
      digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8),
      digits.slice(8, 10), digits.slice(10, 12), digits.slice(12, 14),
    ];
    return `${y}-${m}-${d}T${h}:${min}:${s}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

ipcMain.handle('card:charge', async (_event, payload) => {
  const amount = Number(payload?.amount) || 0;
  const comPort = payload?.comPort || '';
  const base = cardServiceBaseUrl(payload?.service);
  const fils = Math.round(amount * 1000);

  async function attachReader() {
    const state = await ensureCardReader(base, comPort);
    logInfo(`[fot-card] connect ok=${state.ok} port=${state.comPort ?? '-'} tried=${state.tried.join(',') || '-'}`);
    return state;
  }

  function sale() {
    return fetch(`${base}/createRequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CATEGORY: 'com.pax.payment.Sale',
        parm: { amount: fils, tipAmount: 0, currencyCode: 'IQD' },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  }

  try {
    let attached = await attachReader();

    let res = await sale();
    if (!res.ok) return { ok: false, message: `خدمة جهاز الدفع ردّت بالرمز ${res.status}` };
    let envelope = await res.json();

    // The service reports an unattached reader instead of failing the HTTP call, so
    // reconnect once and repeat the sale before showing the cashier an error.
    if (String(envelope.resultCode ?? envelope.ResultCode) !== '200'
      && isCardReaderDetached(envelope.message ?? envelope.Message)) {
      attached = await attachReader();
      if (attached.ok) {
        res = await sale();
        if (!res.ok) return { ok: false, message: `خدمة جهاز الدفع ردّت بالرمز ${res.status}` };
        envelope = await res.json();
      }
    }

    if (String(envelope.resultCode ?? envelope.ResultCode) !== '200') {
      const message = envelope.message || envelope.Message || 'رفض جهاز الدفع العملية';
      if (isCardReaderDetached(message)) {
        const ports = attached.tried.length ? ` (المنافذ المجرّبة: ${attached.tried.join(', ')})` : ' (لم يُعثر على منفذ USB للجهاز)';
        return { ok: false, message: `جهاز الدفع غير مرتبط بخدمة ${base.replace(/^https?:\/\//, '')}${ports}` };
      }
      return { ok: false, message, cancelledByDevice: /cancel|إلغ|الغاء/i.test(String(message)) };
    }
    const raw = envelope.response || envelope.Response;
    const detail = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ok: true,
      message: envelope.message || envelope.Message || 'تم الدفع',
      payment: {
        amount: Number(detail?.amount || fils) / 1000,
        rrn: cardText(detail?.voucherNo),
        terminalId: cardText(detail?.terminalId),
        acquirer: cardText(detail?.aquirerName ?? detail?.acquirerName),
        accNo: cardText(detail?.cardNo),
        cardName: cardText(detail?.issuerName),
        cardType: cardText(detail?.cardType),
        authCode: cardText(detail?.authCode),
        batchNo: cardText(detail?.batchNo),
        refNo: cardText(detail?.refNo),
        merchantName: cardText(detail?.merchantName),
        currencyCode: cardText(detail?.currencyCode),
        deviceType: cardText(envelope.typeDevice ?? envelope.TypeDevice),
        transTime: cardTimestamp(detail?.transTime),
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'تعذر الوصول إلى جهاز الدفع' };
  }
});

function configureAutostart() {
  if (!isServerEdition()) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: ['--background'],
    });
  } catch (e) {
    console.error('[fot-autostart]', e);
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  configure(userData);
  configureCrashLog(userData);
  const dirty = wasDirtyShutdown(userData);
  markRunning(userData);
  if (dirty) {
    logInfo('dirty shutdown — clearing renderer caches');
    wipeCacheDirs(userData);
    await clearChromiumCaches();
  }
  bindStoreIpc();
  configureAutostart();
  createTray();
  // Instant visual feedback while the renderer bundle loads — this is what the user
  // sees instead of a blank white window on slow disks / after cache wipes.
  // Server edition starting hidden in the background skips the splash entirely.
  if (!(isServerEdition() && startBackground)) createSplash();
  createWindow();
  void (async () => {
    if (isLoginLaunch()) await waitForDesktopSession();
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (win && !win.__fotLoaded) loadApp(win);
    void ensureApi({ isDev, startup: true, probeOnly: role === 'pos' });
  })();
  setInterval(() => {
    void watchdogTick({ isDev });
  }, 12_000);

  const onSessionWake = reason => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!win || !win.isVisible()) return;
    healWindowInput(win);
    scheduleBlankCheck(win, reason);
  };
  try {
    powerMonitor.on('resume', () => onSessionWake('resume'));
    powerMonitor.on('unlock-screen', () => onSessionWake('unlock-screen'));
  } catch (e) {
    logError('powerMonitor bind failed', e instanceof Error ? e.message : e);
  }

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  try {
    markClean(app.getPath('userData'));
  } catch {
    /* ignore */
  }
});

app.on('window-all-closed', () => {
  if (isServerEdition()) return;
  if (process.platform !== 'darwin') app.quit();
});

// GPU/utility process crashes leave a blank white window without a renderer crash —
// check whether the page is still alive shortly after and reload it if not.
app.on('child-process-gone', (_event, details) => {
  logError('child-process-gone', details);
  if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return;
  setTimeout(() => {
    if (win.isDestroyed()) return;
    void win.webContents.executeJavaScript('Boolean(window.__fotAppReady)')
      .catch(() => false)
      .then(ok => {
        if (!ok && canReloadWindow('gpu-process-gone')) loadApp(win);
      });
  }, 2500);
});
