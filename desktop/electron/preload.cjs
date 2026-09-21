const { contextBridge, ipcRenderer } = require('electron');

function resolvePreloadRole() {
  const fromArg = process.argv.find(a => a.startsWith('--fot-role='));
  if (fromArg) {
    const value = fromArg.slice('--fot-role='.length);
    if (value === 'pos' || value === 'admin') return value;
  }
  if (process.argv.includes('--pos') || process.env.FOT_APP === 'pos') return 'pos';
  if (process.argv.includes('--admin') || process.env.FOT_APP === 'admin') return 'admin';
  return 'admin';
}

const store = {
  getMeta: key => ipcRenderer.invoke('store:getMeta', key),
  setMeta: (key, value) => ipcRenderer.invoke('store:setMeta', key, value),
  upsertProducts: products => ipcRenderer.invoke('store:upsertProducts', products),
  findProduct: code => ipcRenderer.invoke('store:findProduct', code),
  searchProducts: (term, limit) => ipcRenderer.invoke('store:searchProducts', term, limit),
  productCount: () => ipcRenderer.invoke('store:productCount'),
  pruneProducts: liveIds => ipcRenderer.invoke('store:pruneProducts', liveIds),
  productsByIds: ids => ipcRenderer.invoke('store:productsByIds', ids),
  saveGroups: (groups, itemsByGroup) => ipcRenderer.invoke('store:saveGroups', groups, itemsByGroup),
  loadGroups: () => ipcRenderer.invoke('store:loadGroups'),
  loadGroupItems: groupId => ipcRenderer.invoke('store:loadGroupItems', groupId),
  saveSalesmen: list => ipcRenderer.invoke('store:saveSalesmen', list),
  loadSalesmen: () => ipcRenderer.invoke('store:loadSalesmen'),
  saveAccounts: list => ipcRenderer.invoke('store:saveAccounts', list),
  loadAccounts: () => ipcRenderer.invoke('store:loadAccounts'),
  savePrintSettings: settings => ipcRenderer.invoke('store:savePrintSettings', settings),
  loadPrintSettings: () => ipcRenderer.invoke('store:loadPrintSettings'),
  nextLocalNumber: cashierCode => ipcRenderer.invoke('store:nextLocalNumber', cashierCode),
  seedReceiptSeq: (cashierCode, serverSeq) => ipcRenderer.invoke('store:seedReceiptSeq', cashierCode, serverSeq),
  enqueue: row => ipcRenderer.invoke('store:enqueue', row),
  pending: () => ipcRenderer.invoke('store:pending'),
  pendingCount: () => ipcRenderer.invoke('store:pendingCount'),
  removeOutbox: id => ipcRenderer.invoke('store:removeOutbox', id),
  markOutboxError: (id, error, permanent) => ipcRenderer.invoke('store:markOutboxError', id, error, permanent),
  updateOutbox: (id, changes) => ipcRenderer.invoke('store:updateOutbox', id, changes),
  resetOutboxRetry: id => ipcRenderer.invoke('store:resetOutboxRetry', id),
  outboxCounts: () => ipcRenderer.invoke('store:outboxCounts'),
  saveLastReceipt: data => ipcRenderer.invoke('store:saveLastReceipt', data),
  loadLastReceipt: () => ipcRenderer.invoke('store:loadLastReceipt'),
  saveTodayReceipts: list => ipcRenderer.invoke('store:saveTodayReceipts', list),
  loadTodayReceipts: () => ipcRenderer.invoke('store:loadTodayReceipts'),
};

const catalog = {
  findBarcode: code => ipcRenderer.invoke('catalog:findBarcode', code),
  search: (term, limit) => ipcRenderer.invoke('catalog:search', term, limit),
  syncBatch: products => ipcRenderer.invoke('catalog:syncBatch', products),
  productCount: () => ipcRenderer.invoke('catalog:productCount'),
  prune: liveIds => ipcRenderer.invoke('catalog:prune', liveIds),
};

const outbox = {
  enqueue: row => ipcRenderer.invoke('outbox:enqueue', row),
  list: () => ipcRenderer.invoke('outbox:list'),
  count: () => ipcRenderer.invoke('outbox:count'),
  markSynced: id => ipcRenderer.invoke('outbox:markSynced', id),
  markError: (id, error, permanent) => ipcRenderer.invoke('outbox:markError', id, error, permanent),
  update: (id, changes) => ipcRenderer.invoke('outbox:update', id, changes),
  resetRetry: id => ipcRenderer.invoke('outbox:resetRetry', id),
  counts: () => ipcRenderer.invoke('outbox:counts'),
};

contextBridge.exposeInMainWorld('fotDesktop', {
  role: resolvePreloadRole(),
  info: () => ipcRenderer.invoke('desktop:info'),
  recover: () => ipcRenderer.invoke('desktop:recover'),
  /** True once per app launch — POS uses it to force re-login on every restart. */
  consumeFreshLaunch: () => ipcRenderer.invoke('boot:consume-fresh'),
  hwId: () => ipcRenderer.invoke('hwid:get'),
  printHtml: (html, copies, deviceName, options) =>
    ipcRenderer.invoke('print:html', html, copies, deviceName, options),
  listPrinters: () => ipcRenderer.invoke('print:list'),
  getPrintConfig: () => ipcRenderer.invoke('print:config:get'),
  setPrintConfig: config => ipcRenderer.invoke('print:config:set', config),
  getFullScreen: () => ipcRenderer.invoke('window:fullscreen:get'),
  setFullScreen: flag => ipcRenderer.invoke('window:fullscreen:set', flag),
  toggleFullScreen: () => ipcRenderer.invoke('window:fullscreen:toggle'),
  cardCharge: payload => ipcRenderer.invoke('card:charge', payload),
  ensureApi: preferredUrl => ipcRenderer.invoke('api:ensure', preferredUrl),
  getApiBase: () => ipcRenderer.invoke('api:getBase'),
  setApiBase: url => ipcRenderer.invoke('api:setBase', url),
  discoverServers: opts => ipcRenderer.invoke('api:discover', opts),
  onApiBaseChanged: callback => {
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('api:base-changed', handler);
    return () => ipcRenderer.removeListener('api:base-changed', handler);
  },
  store,
  catalog,
  outbox,
});
