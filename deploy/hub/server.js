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

let state = { lastSyncAt: null, accounts: {}, snapshots: {} };
try {
  if (fs.existsSync(STATE_FILE)) {
    state = { lastSyncAt: null, accounts: {}, snapshots: {}, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
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

function verifyJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', JWT_KEY).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (expect !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== 'seller') return null;
    return payload;
  } catch {
    return null;
  }
}

function weekKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

function findPack(snapshot, weekStart) {
  const packs = snapshot?.weekPacks || [];
  if (!packs.length) return null;
  if (!weekStart) return packs[0];
  const key = weekKey(weekStart);
  return packs.find((p) => weekKey(p.weekStart) === key) || packs[0];
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

function send(res, status, body) {
  const json = typeof body === 'string' ? body : JSON.stringify(scrub(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Fot-Sync-Key',
  });
  res.end(json);
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
  const payload = verifyJwt(token);
  const id = Number(payload?.sub || 0);
  return id > 0 ? id : null;
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
  const snapshots = {};
  for (const snap of payload.snapshots || []) {
    const me = snap.me || snap.Me || {};
    const id = Number(me.id ?? me.Id);
    if (!id) continue;
    snapshots[id] = scrub(snap);
  }
  state = {
    lastSyncAt: new Date().toISOString(),
    accounts,
    snapshots,
  };
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
      send(res, 200, {
        status: 'ok',
        lastSyncAt: state.lastSyncAt,
        sellerCount: Object.keys(state.accounts).length,
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
      send(res, 200, {
        ok: true,
        lastSyncAt: state.lastSyncAt,
        sellerCount: Object.keys(state.accounts).length,
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
        goals: pack?.goals || pack?.Goals || [],
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/malls') {
      send(res, 200, []);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/seller/goals') {
      send(res, 200, pack?.goals || pack?.Goals || []);
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
      send(res, 200, row);
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
