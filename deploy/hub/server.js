'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = Number(process.env.PORT || 4705);
const DATA_DIR = process.env.FOT_HUB_DATA || '/data';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SYNC_KEY = process.env.FOT_HUB_SYNC_KEY || 'fot-hub-sync-e7Kq9mN2pL4xW8vR';
const JWT_KEY = process.env.FOT_HUB_JWT_KEY || 'FOT-HUB-JWT-CHANGE-THIS-SECRET-MIN-32-CHARS';
const JWT_HOURS = Number(process.env.FOT_HUB_JWT_HOURS || 24);

fs.mkdirSync(DATA_DIR, { recursive: true });

let state = { lastSyncAt: null, accounts: {}, snapshots: {}, managers: {}, managerSnapshot: null };
try {
  if (fs.existsSync(STATE_FILE)) {
    state = { lastSyncAt: null, accounts: {}, snapshots: {}, managers: {}, managerSnapshot: null, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  }
} catch (err) {
  console.error('hub state load failed', err.message);
}

function saveState() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function signJwt(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createHmac('sha256', JWT_KEY).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token, role) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', JWT_KEY).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (expect !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (role && payload.role !== role) return null;
    return payload;
  } catch {
    return null;
  }
}

function weekKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

function findPack(snapshot, weekStart) {
  const packs = snapshot?.weekPacks || snapshot?.WeekPacks || [];
  if (!packs.length) return null;
  if (!weekStart) return packs[0];
  const key = weekKey(weekStart);
  return packs.find((p) => weekKey(p.weekStart || p.WeekStart) === key) || packs[0];
}

const CASHIER_KEY = /cashier|كاشير|cash_name|cashiername|cashierid|mallname|mallcount|^malls$|sectionname|sectionid|branchname/i;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (CASHIER_KEY.test(key)) continue;
    if (key === 'salesAmount' || key === 'SalesAmount') {
      out[key] = 0;
      continue;
    }
    out[key] = scrub(raw);
  }
  return out;
}

function fixGoal(goal) {
  if (!goal || typeof goal !== 'object') return goal;
  const sold = Number(goal.sold ?? goal.Sold ?? 0);
  const target = Number(goal.weeklyTarget ?? goal.WeeklyTarget ?? 0);
  const percent = target > 0 ? Math.round((sold / target) * 1000) / 10 : 0;
  return { ...goal, sold, weeklyTarget: target, percent, Percent: percent };
}

function fixGoals(list) {
  return (list || []).map(fixGoal);
}

function writeJson(res, status, body) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Fot-Sync-Key',
  });
  res.end(json);
}

function send(res, status, body) {
  writeJson(res, status, typeof body === 'string' ? body : scrub(body));
}

function sendOpen(res, status, body) {
  writeJson(res, status, body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function syncAuthorized(req) {
  const header = req.headers['x-fot-sync-key'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return header === SYNC_KEY || bearer === SYNC_KEY;
}

function sellerIdFromReq(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyJwt(token, 'seller');
  const id = Number(payload?.sub || 0);
  return id > 0 ? id : null;
}

function managerFromReq(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyJwt(token, 'manager');
  const id = Number(payload?.sub || 0);
  if (!(id > 0)) return null;
  return state.managers?.[id] || null;
}

function findManager(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  return Object.values(state.managers || {}).find((m) => String(m.username || '').toLowerCase() === key) || null;
}

function n(value) {
  return Number(value ?? 0) || 0;
}

function hasManagerPacks(snap) {
  if (!snap || typeof snap !== 'object') return false;
  const packs = snap.weekPacks || snap.WeekPacks || [];
  return Array.isArray(packs) && packs.length > 0;
}

function addCashier(map, name, sales, comm, receipts, pieces) {
  const label = pickCashierName(name);
  if (!label) return;
  const key = label.toLowerCase();
  const cur = map.get(key) || {
    cashierId: map.size + 1,
    name: label,
    salesAmount: 0,
    commissionAmount: 0,
    receiptCount: 0,
    pieceCount: 0,
  };
  cur.salesAmount += n(sales);
  cur.commissionAmount += n(comm);
  cur.receiptCount += n(receipts);
  cur.pieceCount += n(pieces);
  map.set(key, cur);
}

function buildManagerFromSellers(snapshots) {
  const snaps = Object.values(snapshots || {});
  if (!snaps.length) return null;
  const weeks = new Map();

  for (const snap of snaps) {
    const me = snap.me || snap.Me || {};
    const sellerId = Number(me.id ?? me.Id ?? 0);
    const sellerName = me.name || me.Name || 'بائع';
    const packs = snap.weekPacks || snap.WeekPacks || [];
    const weekRows = snap.weeks || snap.Weeks || [];
    const balance = n(snap.balanceDue ?? snap.BalanceDue);

    for (const row of weekRows) {
      const start = row.weekStart || row.WeekStart;
      const key = weekKey(start);
      if (!key) continue;
      if (!weeks.has(key)) {
        weeks.set(key, {
          weekStart: start,
          weekEnd: row.weekEnd || row.WeekEnd,
          isCurrent: !!(row.isCurrent ?? row.IsCurrent),
          salesAmount: 0,
          commissionAmount: 0,
          receiptCount: 0,
          pieceCount: 0,
          sellers: [],
          goals: [],
          lines: [],
          products: new Map(),
          cashierMap: new Map(),
        });
      }
      const bucket = weeks.get(key);
      const pack = packs.find((p) => weekKey(p.weekStart || p.WeekStart) === key);
      const comm = pack?.commission || pack?.Commission || {};
      const packLines = comm.lines || comm.Lines || [];
      const packGoals = pack?.goals || pack?.Goals || [];
      const malls = pack?.malls || pack?.Malls || [];
      const commAmt = n(row.commissionAmount ?? row.CommissionAmount ?? comm.totalCommission ?? comm.TotalCommission);
      const receipts = n(row.receiptCount ?? row.ReceiptCount);
      const pieces = packLines.reduce((s, l) => s + n(l.quantity ?? l.Quantity), 0);
      let sellerSales = 0;
      for (const mall of malls) {
        const sales = n(mall.salesAmount ?? mall.SalesAmount);
        sellerSales += sales;
        addCashier(
          bucket.cashierMap,
          mall.sectionName ?? mall.SectionName,
          sales,
          mall.commissionAmount ?? mall.CommissionAmount,
          mall.receiptCount ?? mall.ReceiptCount,
          0,
        );
      }
      const lineSales = packLines.reduce((s, l) => s + n(l.salesAmount ?? l.SalesAmount), 0);
      const salesAmt = sellerSales || lineSales;
      bucket.salesAmount += salesAmt;
      bucket.commissionAmount += commAmt;
      bucket.receiptCount += receipts;
      bucket.pieceCount += pieces;
      bucket.sellers.push({
        salesmanId: sellerId,
        name: sellerName,
        salesAmount: salesAmt,
        commissionAmount: commAmt,
        receiptCount: receipts,
        pieceCount: pieces,
        goalCount: packGoals.length,
        goalsHit: packGoals.filter((g) => n(g.percent ?? g.Percent) >= 100).length,
        goalPercent: packGoals.length
          ? Math.round((packGoals.reduce((s, g) => s + n(g.percent ?? g.Percent), 0) / packGoals.length) * 10) / 10
          : 0,
        balanceDue: balance,
      });
      for (const g of packGoals) {
        bucket.goals.push({
          ...fixGoal(g),
          salesmanId: sellerId,
          salesmanName: sellerName,
        });
      }
      for (const line of packLines) {
        const qty = n(line.quantity ?? line.Quantity);
        const commission = n(line.commissionAmount ?? line.CommissionAmount);
        const sales = n(line.salesAmount ?? line.SalesAmount);
        const name = line.productName || line.ProductName || 'منتج';
        const cashier = pickCashierName(line.cashierName ?? line.CashierName, line.mallName ?? line.MallName);
        bucket.lines.push({
          id: line.id ?? line.Id,
          salesmanId: sellerId,
          salesmanName: sellerName,
          productName: name,
          groupName: line.groupName ?? line.GroupName ?? null,
          quantity: qty,
          salesAmount: sales,
          commissionAmount: commission,
          receiptNumber: line.receiptNumber ?? line.ReceiptNumber ?? null,
          occurredAt: line.occurredAt || line.OccurredAt,
          cashierName: cashier || null,
          mallName: cashier || null,
        });
        if (!sellerSales) addCashier(bucket.cashierMap, cashier, sales, commission, line.receiptNumber ?? line.ReceiptNumber ? 1 : 0, qty);
        const prod = bucket.products.get(name) || { name, quantity: 0, salesAmount: 0, commissionAmount: 0, count: 0 };
        prod.quantity += qty;
        prod.salesAmount += sales;
        prod.commissionAmount += commission;
        prod.count += 1;
        bucket.products.set(name, prod);
      }
    }
  }

  const packs = [...weeks.values()].sort((a, b) => weekKey(b.weekStart).localeCompare(weekKey(a.weekStart)));
  if (!packs.length) return null;

  function weekRow(p) {
    const cashiers = [...(p.cashierMap?.values() || [])].sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount);
    const sellerCount = p.sellers.filter((s) => s.salesAmount > 0 || s.commissionAmount > 0 || s.pieceCount > 0).length || p.sellers.length;
    return {
      weekStart: p.weekStart,
      weekEnd: p.weekEnd,
      isCurrent: p.isCurrent,
      salesAmount: p.salesAmount,
      commissionAmount: p.commissionAmount,
      receiptCount: p.receiptCount,
      pieceCount: p.pieceCount,
      sellerCount,
      cashierCount: cashiers.length,
      cashiers,
    };
  }

  return {
    weeks: packs.map((p) => {
      const w = weekRow(p);
      return {
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        isCurrent: w.isCurrent,
        salesAmount: w.salesAmount,
        commissionAmount: w.commissionAmount,
        receiptCount: w.receiptCount,
        pieceCount: w.pieceCount,
        sellerCount: w.sellerCount,
        cashierCount: w.cashierCount,
      };
    }),
    weekPacks: packs.map((p) => {
      const w = weekRow(p);
      return {
        weekStart: p.weekStart,
        week: w,
        sellers: p.sellers.sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount),
        cashiers: w.cashiers,
        malls: w.cashiers.map((c) => ({
          sectionId: c.cashierId,
          sectionName: c.name,
          branchName: null,
          salesAmount: c.salesAmount,
          commissionAmount: c.commissionAmount,
          receiptCount: c.receiptCount,
          pieceCount: c.pieceCount,
        })),
        goals: p.goals,
        lines: p.lines.slice(0, 800),
        products: [...p.products.values()].sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount).slice(0, 80),
      };
    }),
  };
}

function packSales(pack) {
  const week = pack?.week || pack?.Week || {};
  return n(week.salesAmount ?? week.SalesAmount);
}

function packCashierCount(pack) {
  return (pack?.cashiers || pack?.Cashiers || []).length + (pack?.malls || pack?.Malls || []).length;
}

function hasRichManager(snap) {
  if (!hasManagerPacks(snap)) return false;
  const packs = snap.weekPacks || snap.WeekPacks || [];
  return packs.some((p) => packSales(p) > 0 || packCashierCount(p) > 0);
}

function mergeManager(official, built) {
  if (!official) return built;
  if (!built) return official;
  const oPacks = official.weekPacks || official.WeekPacks || [];
  const bPacks = built.weekPacks || built.WeekPacks || [];
  const byKey = new Map(bPacks.map((p) => [weekKey(p.weekStart || p.WeekStart), p]));
  const weekPacks = oPacks.map((p) => {
    const b = byKey.get(weekKey(p.weekStart || p.WeekStart));
    if (!b) return p;
    const needSales = packSales(p) <= 0 && packSales(b) > 0;
    const needCash = packCashierCount(p) <= 0 && packCashierCount(b) > 0;
    if (!needSales && !needCash) return p;
    return {
      ...p,
      week: needSales ? (b.week || b.Week || p.week) : (p.week || p.Week),
      Week: needSales ? (b.week || b.Week || p.week) : (p.week || p.Week),
      sellers: needSales ? (b.sellers || b.Sellers || p.sellers) : (p.sellers || p.Sellers),
      Sellers: needSales ? (b.sellers || b.Sellers || p.sellers) : (p.sellers || p.Sellers),
      cashiers: needCash ? (b.cashiers || b.Cashiers || []) : (p.cashiers || p.Cashiers || []),
      Cashiers: needCash ? (b.cashiers || b.Cashiers || []) : (p.cashiers || p.Cashiers || []),
      malls: needCash ? (b.malls || b.Malls || []) : (p.malls || p.Malls || []),
      Malls: needCash ? (b.malls || b.Malls || []) : (p.malls || p.Malls || []),
      lines: needCash || needSales ? (b.lines || b.Lines || p.lines) : (p.lines || p.Lines),
      Lines: needCash || needSales ? (b.lines || b.Lines || p.lines) : (p.lines || p.Lines),
    };
  });
  const weeks = weekPacks.map((p) => p.week || p.Week).filter(Boolean);
  return { ...official, weeks: weeks.length ? weeks : (official.weeks || official.Weeks || []), weekPacks, WeekPacks: weekPacks };
}

function ensureManagerSnapshot() {
  if (hasRichManager(state.managerSnapshot)) return state.managerSnapshot;
  const built = buildManagerFromSellers(state.snapshots);
  if (built) {
    state.managerSnapshot = hasManagerPacks(state.managerSnapshot)
      ? mergeManager(state.managerSnapshot, built)
      : built;
  }
  return state.managerSnapshot;
}

function pickCashierName(...vals) {
  for (const value of vals) {
    const name = String(value || '').trim();
    if (name && name !== 'مول' && name !== 'بدون مول') return name;
  }
  return '';
}

function unifyCashiers(cashiers, malls, lines) {
  const map = new Map();
  function add(id, name, sales, comm, receipts, pieces) {
    const label = pickCashierName(name);
    if (!label) return;
    const key = label.toLowerCase();
    const row = {
      cashierId: Number(id) || 0,
      name: label,
      salesAmount: n(sales),
      commissionAmount: n(comm),
      receiptCount: n(receipts),
      pieceCount: n(pieces),
    };
    const cur = map.get(key);
    if (!cur) {
      map.set(key, row);
      return;
    }
    const better = row.salesAmount > cur.salesAmount
      || (row.salesAmount === cur.salesAmount && row.commissionAmount > cur.commissionAmount);
    if (better) map.set(key, { ...row, cashierId: cur.cashierId || row.cashierId });
  }

  for (const c of cashiers || []) {
    add(c.cashierId ?? c.CashierId, c.name ?? c.Name, c.salesAmount ?? c.SalesAmount, c.commissionAmount ?? c.CommissionAmount, c.receiptCount ?? c.ReceiptCount, c.pieceCount ?? c.PieceCount);
  }
  for (const m of malls || []) {
    add(m.sectionId ?? m.SectionId, m.sectionName ?? m.SectionName, m.salesAmount ?? m.SalesAmount, m.commissionAmount ?? m.CommissionAmount, m.receiptCount ?? m.ReceiptCount, m.pieceCount ?? m.PieceCount);
  }
  if (!map.size) {
    const agg = new Map();
    for (const line of lines || []) {
      const name = pickCashierName(line.cashierName ?? line.CashierName, line.mallName ?? line.MallName);
      if (!name) continue;
      const key = name.toLowerCase();
      const row = agg.get(key) || { name, sales: 0, comm: 0, receipts: new Set(), pieces: 0 };
      row.sales += n(line.salesAmount ?? line.SalesAmount);
      row.comm += n(line.commissionAmount ?? line.CommissionAmount);
      row.pieces += n(line.quantity ?? line.Quantity);
      const rec = line.receiptNumber ?? line.ReceiptNumber;
      if (rec) row.receipts.add(rec);
      agg.set(key, row);
    }
    let i = 1;
    for (const row of agg.values()) add(i++, row.name, row.sales, row.comm, row.receipts.size, row.pieces);
  }
  return [...map.values()].sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount);
}

function presentLines(lines) {
  return (lines || []).map((line) => {
    const cashier = pickCashierName(line.cashierName ?? line.CashierName, line.mallName ?? line.MallName);
    return { ...line, cashierName: cashier || null, mallName: cashier || null };
  });
}

function presentPack(pack) {
  if (!pack) return null;
  const lines = presentLines(pack.lines || pack.Lines || []);
  const cashiers = unifyCashiers(pack.cashiers || pack.Cashiers, pack.malls || pack.Malls, lines);
  const malls = cashiers.map((c) => ({
    sectionId: c.cashierId,
    sectionName: c.name,
    branchName: null,
    salesAmount: c.salesAmount,
    commissionAmount: c.commissionAmount,
    receiptCount: c.receiptCount,
    pieceCount: c.pieceCount,
  }));
  const week = {
    ...(pack.week || pack.Week || {}),
    cashierCount: cashiers.length || n((pack.week || pack.Week || {}).cashierCount ?? (pack.week || pack.Week || {}).CashierCount),
  };
  return {
    ...pack,
    cashiers,
    Cashiers: cashiers,
    malls,
    Malls: malls,
    lines,
    Lines: lines,
    sellers: pack.sellers || pack.Sellers || [],
    Sellers: pack.sellers || pack.Sellers || [],
    goals: pack.goals || pack.Goals || [],
    Goals: pack.goals || pack.Goals || [],
    products: pack.products || pack.Products || [],
    Products: pack.products || pack.Products || [],
    week,
    Week: week,
  };
}

function managerPack(weekStart) {
  return presentPack(findPack(ensureManagerSnapshot(), weekStart));
}

function fixManagerGoals(list) {
  return (list || []).map((g) => {
    const sold = Number(g.sold ?? g.Sold ?? 0);
    const target = Number(g.weeklyTarget ?? g.WeeklyTarget ?? 0);
    const percent = target > 0 ? Math.round((sold / target) * 1000) / 10 : 0;
    return { ...g, sold, weeklyTarget: target, percent, Percent: percent };
  });
}

function applySync(payload) {
  const accounts = {};
  for (const row of payload.accounts || []) {
    const id = Number(row.id ?? row.Id);
    if (!id) continue;
    accounts[id] = {
      id,
      name: row.name ?? row.Name ?? '',
      pinHash: row.pinHash ?? row.PinHash ?? '',
      isActive: row.isActive ?? row.IsActive ?? true,
      mustChangePin: row.mustChangePin ?? row.MustChangePin ?? false,
    };
  }
  const rawSnapshots = {};
  const snapshots = {};
  for (const snap of payload.snapshots || []) {
    const me = snap.me || snap.Me || {};
    const id = Number(me.id ?? me.Id);
    if (!id) continue;
    rawSnapshots[id] = snap;
    snapshots[id] = scrub(snap);
  }
  const next = {
    lastSyncAt: new Date().toISOString(),
    accounts,
    snapshots,
    managers: state.managers || {},
    managerSnapshot: state.managerSnapshot || null,
  };

  const managerRows = payload.managers || payload.Managers;
  if (Array.isArray(managerRows)) {
    const managers = {};
    for (const row of managerRows) {
      const id = Number(row.id ?? row.Id);
      const username = String(row.username ?? row.Username ?? '').trim().toLowerCase();
      if (!id || !username) continue;
      managers[id] = {
        id,
        username,
        displayName: row.displayName ?? row.DisplayName ?? username,
        passwordHash: row.passwordHash ?? row.PasswordHash ?? '',
        isActive: row.isActive ?? row.IsActive ?? true,
      };
    }
    next.managers = managers;
  }

  const incomingManager = payload.managerSnapshot || payload.ManagerSnapshot;
  const fromSellers = buildManagerFromSellers(rawSnapshots);
  if (hasRichManager(incomingManager)) {
    next.managerSnapshot = incomingManager;
  } else if (hasManagerPacks(incomingManager) && fromSellers) {
    next.managerSnapshot = mergeManager(incomingManager, fromSellers);
  } else {
    next.managerSnapshot = fromSellers || incomingManager || next.managerSnapshot;
  }

  state = next;
  saveState();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendOpen(res, 200, {
        status: 'ok',
        lastSyncAt: state.lastSyncAt,
        sellerCount: Object.keys(state.accounts).length,
        managerCount: Object.keys(state.managers || {}).length,
        hasManagerSnapshot: !!state.managerSnapshot,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync') {
      if (!syncAuthorized(req)) {
        send(res, 401, { error: 'مفتاح المزامنة غير صحيح' });
        return;
      }
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      applySync(payload);
      sendOpen(res, 200, {
        ok: true,
        lastSyncAt: state.lastSyncAt,
        sellerCount: Object.keys(state.accounts).length,
        managerCount: Object.keys(state.managers || {}).length,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/seller-lookup') {
      const id = Number(url.searchParams.get('id') || 0);
      const acc = state.accounts[id];
      if (!acc || !acc.name) {
        send(res, 404, { error: 'لا بائع بهذا الرقم' });
        return;
      }
      send(res, 200, { id: acc.id, name: acc.name });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/seller-login') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const id = Number(body.salesmanId || body.SalesmanId || 0);
      const pin = String(body.pin || body.Pin || '').trim();
      const acc = state.accounts[id];
      if (!acc) {
        send(res, 401, { error: 'الرمز غير صحيح' });
        return;
      }
      if (!acc.isActive) {
        send(res, 403, { error: 'الحساب متوقف — راجع الإدارة' });
        return;
      }
      if (!acc.pinHash) {
        send(res, 403, { error: 'اطلب من الإدارة توليد حسابك من لوحة التحكم' });
        return;
      }
      if (pin.length < 4 || !bcrypt.compareSync(pin, acc.pinHash)) {
        send(res, 401, { error: 'الرمز غير صحيح' });
        return;
      }
      const snap = state.snapshots[id];
      const me = snap?.me || snap?.Me || { id: acc.id, name: acc.name, mustChangePin: acc.mustChangePin };
      const token = signJwt({
        sub: String(acc.id),
        role: 'seller',
        display_name: acc.name,
        exp: Math.floor(Date.now() / 1000) + JWT_HOURS * 3600,
      });
      send(res, 200, { token, seller: me });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/manager-lookup') {
      const acc = findManager(url.searchParams.get('username') || '');
      if (!acc) {
        sendOpen(res, 404, { error: 'لا مدير بهذا الاسم' });
        return;
      }
      sendOpen(res, 200, { id: acc.id, username: acc.username, displayName: acc.displayName });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/manager-login') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const acc = findManager(body.username || body.Username || '');
      const password = String(body.password || body.Password || '').trim();
      if (!acc) {
        sendOpen(res, 401, { error: 'بيانات الدخول غير صحيحة' });
        return;
      }
      if (!acc.isActive) {
        sendOpen(res, 403, { error: 'الحساب متوقف — راجع الإدارة' });
        return;
      }
      if (!acc.passwordHash) {
        sendOpen(res, 403, { error: 'اطلب من الإدارة توليد حسابك من لوحة التحكم' });
        return;
      }
      if (password.length < 4 || !bcrypt.compareSync(password, acc.passwordHash)) {
        sendOpen(res, 401, { error: 'بيانات الدخول غير صحيحة' });
        return;
      }
      const token = signJwt({
        sub: String(acc.id),
        role: 'manager',
        display_name: acc.displayName,
        exp: Math.floor(Date.now() / 1000) + JWT_HOURS * 3600,
      });
      sendOpen(res, 200, {
        token,
        manager: { id: acc.id, username: acc.username, displayName: acc.displayName },
      });
      return;
    }

    if (url.pathname.startsWith('/api/manager/')) {
      const acc = managerFromReq(req);
      if (!acc) {
        sendOpen(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
        return;
      }
      const snapshot = ensureManagerSnapshot() || { weeks: [], weekPacks: [] };
      const weekStart = url.searchParams.get('weekStart');
      const pack = managerPack(weekStart);
      const me = { id: acc.id, username: acc.username, displayName: acc.displayName };
      const week = pack?.week || pack?.Week || {};
      const sellers = pack?.sellers || pack?.Sellers || [];
      const cashiers = pack?.cashiers || pack?.Cashiers || [];
      const malls = pack?.malls || pack?.Malls || [];
      const goals = fixManagerGoals(pack?.goals || pack?.Goals || []);
      const lines = pack?.lines || pack?.Lines || [];
      const products = pack?.products || pack?.Products || [];

      if (req.method === 'GET' && url.pathname === '/api/manager/me') {
        sendOpen(res, 200, me);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/weeks') {
        sendOpen(res, 200, snapshot.weeks || snapshot.Weeks || []);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/dashboard') {
        sendOpen(res, 200, {
          manager: me,
          week,
          sellers,
          cashiers,
          malls,
          goals,
          products: products.slice(0, 40),
          lastSyncAt: state.lastSyncAt,
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/sellers') {
        sendOpen(res, 200, sellers);
        return;
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/manager\/sellers\/(\d+)$/)) {
        const sid = Number(url.pathname.split('/').pop());
        const seller = sellers.find((s) => Number(s.salesmanId ?? s.SalesmanId) === sid);
        if (!seller) {
          sendOpen(res, 404, { error: 'لا بائع في هذا الأسبوع' });
          return;
        }
        sendOpen(res, 200, {
          seller,
          goals: goals.filter((g) => Number(g.salesmanId ?? g.SalesmanId) === sid),
          lines: lines.filter((l) => Number(l.salesmanId ?? l.SalesmanId) === sid),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/cashiers') {
        sendOpen(res, 200, cashiers);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/malls') {
        sendOpen(res, 200, malls);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/goals') {
        sendOpen(res, 200, goals);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/lines') {
        sendOpen(res, 200, { totalCommission: lines.reduce((s, l) => s + Number(l.commissionAmount ?? l.CommissionAmount ?? 0), 0), lineCount: lines.length, lines });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/manager/products') {
        sendOpen(res, 200, products);
        return;
      }
      sendOpen(res, 404, { error: 'not found' });
      return;
    }

    if (!url.pathname.startsWith('/api/seller/')) {
      send(res, 404, { error: 'not found' });
      return;
    }

    const id = sellerIdFromReq(req);
    if (!id) {
      send(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
      return;
    }
    const acc = state.accounts[id];
    const snap = state.snapshots[id];
    if (!acc || !snap) {
      send(res, 404, { error: 'لم تُرفع بيانات هذا البائع بعد' });
      return;
    }

    const weekStart = url.searchParams.get('weekStart');
    const pack = findPack(snap, weekStart);
    const me = snap.me || snap.Me || { id: acc.id, name: acc.name, mustChangePin: acc.mustChangePin };

    if (req.method === 'GET' && url.pathname === '/api/seller/me') {
      send(res, 200, me);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/weeks') {
      send(res, 200, snap.weeks || snap.Weeks || []);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/commission-groups') {
      send(res, 200, []);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/commission-products') {
      send(res, 200, []);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/dashboard') {
      send(res, 200, {
        seller: me,
        week: pack?.week || pack?.Week || {},
        balanceDue: snap.balanceDue ?? snap.BalanceDue ?? 0,
        malls: [],
        goals: fixGoals(pack?.goals || pack?.Goals || []),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/malls') {
      send(res, 200, []);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/goals') {
      send(res, 200, fixGoals(pack?.goals || pack?.Goals || []));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/commission-lines') {
      const sectionId = url.searchParams.get('sectionId');
      let bundle = pack?.commission || pack?.Commission || { totalCommission: 0, lineCount: 0, lines: [] };
      if (sectionId) {
        const malls = pack?.malls || pack?.Malls || [];
        const mall = malls.find((m) => String(m.sectionId ?? m.SectionId) === String(sectionId));
        const name = mall?.sectionName || mall?.SectionName;
        const lines = (bundle.lines || bundle.Lines || []).filter((l) => !name || (l.mallName || l.MallName) === name);
        const total = lines.reduce((s, l) => s + Number(l.commissionAmount ?? l.CommissionAmount ?? 0), 0);
        bundle = { totalCommission: total, lineCount: lines.length, lines };
      }
      send(res, 200, bundle);
      return;
    }
    const goalMatch = url.pathname.match(/^\/api\/seller\/goals\/(\d+)\/lines$/);
    if (req.method === 'GET' && goalMatch) {
      const ruleId = Number(goalMatch[1]);
      const details = pack?.goalDetails || pack?.GoalDetails || [];
      const row = details.find((g) => Number(g.ruleId ?? g.RuleId) === ruleId);
      if (!row) {
        send(res, 404, { error: 'الهدف غير مربوط بك' });
        return;
      }
      send(res, 200, fixGoal(row));
      return;
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'تعذر معالجة الطلب' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FOT seller hub listening on :${PORT}`);
});
