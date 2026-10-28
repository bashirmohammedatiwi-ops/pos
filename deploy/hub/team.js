'use strict';

/*
 * تطبيق الفريق — الأساس على خادم الـ VPS.
 * قاعدة SQLite (node:sqlite المدمجة — بلا مكتبات أصلية) في /data/team.db:
 *   staff (مرآة من المحل)، devices (ربط الجهاز)، push_tokens (Firebase)، audit (سجل التدقيق).
 * الدخول: /auth/team-login (كود + رمز + معرّف الجهاز). موظف مربوط ببائع يحصل أيضاً على رمز البائع
 * فتعمل العمولة والأهداف و«براندي» وأوقات الفتح كما هي.
 * الإدارة: /api/admin/team/* بمفتاح المزامنة فقط (تصل عبر سيرفر المحل).
 */

const path = require('path');
const fs = require('fs');

function createTeam(ctx) {
  const { DatabaseSync } = require('node:sqlite');
  const dbFile = path.join(ctx.dataDir, 'team.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

  /* ── ترحيلات مرقّمة ── */
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE staff (
       id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
       job_title TEXT, photo_url TEXT, salesman_id INTEGER, cashier_id INTEGER,
       section_id INTEGER, section_name TEXT, pin_hash TEXT, is_active INTEGER NOT NULL DEFAULT 1,
       updated_at TEXT NOT NULL
     );
     CREATE TABLE devices (
       staff_id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, label TEXT, platform TEXT, app_version TEXT,
       bound_at TEXT NOT NULL, last_seen TEXT NOT NULL
     );
     CREATE TABLE push_tokens (
       token TEXT PRIMARY KEY, user_kind TEXT NOT NULL, user_id INTEGER NOT NULL, platform TEXT,
       device_id TEXT, updated_at TEXT NOT NULL
     );
     CREATE INDEX ix_push_user ON push_tokens(user_kind, user_id);
     CREATE TABLE audit (
       id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL,
       target TEXT, details TEXT
     );
     CREATE INDEX ix_audit_at ON audit(at);`,
  ];
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    const id = i + 1;
    if (applied.has(id)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // نسخة احتياطية يومية (آخر 14 يوماً)
  const backupDir = path.join(ctx.dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  function backup() {
    try {
      const file = path.join(backupDir, `team-${new Date().toISOString().slice(0, 10)}.db`);
      if (fs.existsSync(file)) return;
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const old = fs.readdirSync(backupDir).filter(f => f.startsWith('team-')).sort();
      while (old.length > 14) fs.unlinkSync(path.join(backupDir, old.shift()));
    } catch (err) {
      console.error('team backup failed', err.message);
    }
  }
  setTimeout(backup, 60_000).unref();
  setInterval(backup, 6 * 3600_000).unref();

  const now = () => new Date().toISOString();
  const audit = (actor, action, target, details) =>
    db.prepare('INSERT INTO audit (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)')
      .run(now(), actor || null, action, target == null ? null : String(target), details == null ? null : JSON.stringify(details));

  /* ── مزامنة الموظفين من المحل (قائمة كاملة) ── */
  function applyStaff(rows) {
    if (!Array.isArray(rows)) return;
    const upsert = db.prepare(`INSERT INTO staff (id, code, name, kind, job_title, photo_url, salesman_id, cashier_id, section_id, section_name, pin_hash, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, kind=excluded.kind, job_title=excluded.job_title,
        photo_url=excluded.photo_url, salesman_id=excluded.salesman_id, cashier_id=excluded.cashier_id, section_id=excluded.section_id,
        section_name=excluded.section_name, pin_hash=excluded.pin_hash, is_active=excluded.is_active, updated_at=excluded.updated_at`);
    const ids = [];
    db.exec('BEGIN');
    try {
      // كود مكرر مؤقتاً أثناء إعادة الترقيم: نحرر الأكواد أولاً
      db.prepare("UPDATE staff SET code = '~' || id").run();
      for (const r of rows) {
        const id = Number(r.id ?? r.Id);
        if (!id) continue;
        ids.push(id);
        upsert.run(
          id,
          String(r.code ?? r.Code ?? id),
          String(r.name ?? r.Name ?? ''),
          String(r.kind ?? r.Kind ?? 'other'),
          r.jobTitle ?? r.JobTitle ?? null,
          r.photoUrl ?? r.PhotoUrl ?? null,
          r.salesmanId ?? r.SalesmanId ?? null,
          r.cashierId ?? r.CashierId ?? null,
          r.sectionId ?? r.SectionId ?? null,
          r.sectionName ?? r.SectionName ?? null,
          r.pinHash ?? r.PinHash ?? null,
          (r.isActive ?? r.IsActive ?? true) ? 1 : 0,
          now(),
        );
      }
      if (ids.length) db.prepare(`DELETE FROM staff WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
      else db.prepare('DELETE FROM staff').run();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('team staff sync failed', err.message);
    }
  }

  const getStaff = id => db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  const findStaffByCode = code => db.prepare('SELECT * FROM staff WHERE lower(code) = lower(?)').get(String(code || '').trim());

  function staffView(s) {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      jobTitle: s.job_title,
      photoUrl: s.photo_url,
      sectionId: s.section_id,
      sectionName: s.section_name,
      salesmanId: s.salesman_id,
      cashierId: s.cashier_id,
    };
  }

  function issueStaffToken(s) {
    return ctx.signJwt({ sub: String(s.id), role: 'staff', sid: s.salesman_id || null, name: s.name, exp: ctx.tokenExp() });
  }

  function staffFromReq(req, opts) {
    const payload = ctx.verifyJwt(ctx.bearerToken(req), 'staff', opts);
    const id = Number(payload?.sub || 0);
    if (!id) return null;
    const s = getStaff(id);
    return s && s.is_active ? s : null;
  }

  function touchDevice(staffId, info) {
    db.prepare('UPDATE devices SET last_seen = ?, app_version = COALESCE(?, app_version) WHERE staff_id = ?').run(now(), info?.appVersion || null, staffId);
  }

  /* ── المسارات ── */
  async function handle(req, res, url) {
    const p = url.pathname;

    // تعريف الموظف بالكود قبل الرمز (الاسم فقط)
    if (req.method === 'GET' && p === '/auth/team-lookup') {
      const s = findStaffByCode(url.searchParams.get('code'));
      if (!s || !s.is_active || !s.pin_hash) {
        ctx.sendOpen(res, 404, { error: 'لا موظف بهذا الكود' });
        return true;
      }
      ctx.sendOpen(res, 200, { name: s.name, kind: s.kind });
      return true;
    }

    // دخول الموظف: كود + رمز + الجهاز
    if (req.method === 'POST' && p === '/auth/team-login') {
      const body = JSON.parse((await ctx.readBody(req)) || '{}');
      const s = findStaffByCode(body.code);
      const pin = String(body.pin || '').trim();
      if (!s || !s.pin_hash || pin.length < 4 || !ctx.bcrypt.compareSync(pin, s.pin_hash)) {
        ctx.send(res, 401, { error: 'الكود أو الرمز غير صحيح' });
        return true;
      }
      if (!s.is_active) {
        ctx.send(res, 403, { error: 'الحساب متوقف — راجع الإدارة' });
        return true;
      }
      const deviceId = String(body.deviceId || '').slice(0, 120);
      const bound = db.prepare('SELECT * FROM devices WHERE staff_id = ?').get(s.id);
      if (bound && deviceId && bound.device_id !== deviceId) {
        ctx.send(res, 403, { error: 'هذا الحساب مربوط بهاتف آخر — اطلب من الإدارة فك الربط', code: 'device_bound' });
        return true;
      }
      if (!bound && deviceId) {
        db.prepare('INSERT INTO devices (staff_id, device_id, label, platform, app_version, bound_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(s.id, deviceId, String(body.deviceLabel || '').slice(0, 200) || null, String(body.platform || '').slice(0, 20) || null,
            String(body.appVersion || '').slice(0, 20) || null, now(), now());
        audit(`staff:${s.id}`, 'device.bind', s.id, { deviceId, label: body.deviceLabel });
      } else if (bound) {
        touchDevice(s.id, body);
      }
      // البائع: نفس قيود أوقات الفتح ورمز البائع للخصائص الحالية
      let sellerToken = null;
      let access = null;
      if (s.salesman_id) {
        const acc = ctx.getSellerAccount(s.salesman_id);
        if (acc) {
          access = ctx.accessState(acc);
          if (!access.open) {
            ctx.send(res, 423, { error: 'التطبيق مغلق الآن خارج وقت عملك', code: 'outside_hours', access });
            return true;
          }
          sellerToken = ctx.issueSellerToken(acc);
        }
      }
      audit(`staff:${s.id}`, 'login', s.id, { platform: body.platform, appVersion: body.appVersion });
      ctx.send(res, 200, { token: issueStaffToken(s), staff: staffView(s), sellerToken, access });
      return true;
    }

    if (req.method === 'POST' && p === '/auth/team-refresh') {
      const s = staffFromReq(req, { ignoreExp: true });
      if (!s) {
        ctx.send(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
        return true;
      }
      let sellerToken = null;
      if (s.salesman_id) {
        const acc = ctx.getSellerAccount(s.salesman_id);
        if (acc) sellerToken = ctx.issueSellerToken(acc);
      }
      ctx.send(res, 200, { token: issueStaffToken(s), staff: staffView(s), sellerToken });
      return true;
    }

    if (p.startsWith('/api/team/')) {
      const s = staffFromReq(req);
      if (!s) {
        ctx.send(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
        return true;
      }
      if (req.method === 'GET' && p === '/api/team/me') {
        const device = db.prepare('SELECT label, platform, bound_at AS boundAt FROM devices WHERE staff_id = ?').get(s.id) || null;
        ctx.send(res, 200, { ...staffView(s), device });
        return true;
      }
      if (req.method === 'POST' && p === '/api/team/push-token') {
        const body = JSON.parse((await ctx.readBody(req)) || '{}');
        const token = String(body.token || '').slice(0, 500);
        if (!token) {
          ctx.send(res, 400, { error: 'رمز الإشعارات مفقود' });
          return true;
        }
        db.prepare(`INSERT INTO push_tokens (token, user_kind, user_id, platform, device_id, updated_at) VALUES (?, 'staff', ?, ?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET user_kind='staff', user_id=excluded.user_id, platform=excluded.platform, device_id=excluded.device_id, updated_at=excluded.updated_at`)
          .run(token, s.id, String(body.platform || '').slice(0, 20) || null, String(body.deviceId || '').slice(0, 120) || null, now());
        ctx.send(res, 200, { ok: true });
        return true;
      }
      ctx.send(res, 404, { error: 'not found' });
      return true;
    }

    // إدارة (من سيرفر المحل فقط بمفتاح المزامنة)
    if (p.startsWith('/api/admin/team/')) {
      if (!ctx.syncAuthorized(req)) {
        ctx.sendOpen(res, 401, { error: 'غير مصرح' });
        return true;
      }
      const actor = decodeURIComponent(String(req.headers['x-fot-actor'] || 'admin'));
      if (req.method === 'GET' && p === '/api/admin/team/status') {
        const devices = db.prepare('SELECT staff_id AS staffId, label, platform, app_version AS appVersion, bound_at AS boundAt, last_seen AS lastSeen FROM devices').all();
        const push = db.prepare("SELECT user_id AS staffId, COUNT(*) AS n FROM push_tokens WHERE user_kind = 'staff' GROUP BY user_id").all();
        const staffCount = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
        ctx.sendOpen(res, 200, { staffCount, devices, push, serverTime: now() });
        return true;
      }
      const m = p.match(/^\/api\/admin\/team\/staff\/(\d+)\/reset-device$/);
      if (req.method === 'POST' && m) {
        const id = Number(m[1]);
        db.prepare('DELETE FROM devices WHERE staff_id = ?').run(id);
        db.prepare("DELETE FROM push_tokens WHERE user_kind = 'staff' AND user_id = ?").run(id);
        audit(actor, 'device.reset', id, null);
        ctx.sendOpen(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'GET' && p === '/api/admin/team/audit') {
        const limit = Math.min(500, Number(url.searchParams.get('limit') || 200));
        const rows = db.prepare('SELECT id, at, actor, action, target, details FROM audit ORDER BY id DESC LIMIT ?').all(limit);
        ctx.sendOpen(res, 200, rows);
        return true;
      }
      ctx.sendOpen(res, 404, { error: 'not found' });
      return true;
    }
    return false;
  }

  return { db, applyStaff, handle, audit };
}

module.exports = { createTeam };
