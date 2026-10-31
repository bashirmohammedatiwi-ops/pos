'use strict';
const { HUB_VERSION } = require('./version');

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
    // نسخة الجلسة: تزيد عند تغيير الرمز أو فك الجهاز أو الإيقاف فتسقط كل الرموز السابقة
    `ALTER TABLE staff ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;`,
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
    // رمز جديد أو إيقاف الحساب: تزيد نسخة الجلسة فتسقط الرموز القديمة.
    // الموظف الجديد يبدأ من الوقت الحالي (لا من 0) كي لا تعود رموز موظف حُذف ثم أُعيد بنفس الرقم
    const upsert = db.prepare(`INSERT INTO staff (id, code, name, kind, job_title, photo_url, salesman_id, cashier_id, section_id, section_name, pin_hash, is_active, updated_at, token_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))
      ON CONFLICT(id) DO UPDATE SET
        token_version = staff.token_version + (CASE WHEN staff.pin_hash IS NOT excluded.pin_hash OR (staff.is_active = 1 AND excluded.is_active = 0) THEN 1 ELSE 0 END),
        code=excluded.code, name=excluded.name, kind=excluded.kind, job_title=excluded.job_title,
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
      // قائمة فارغة = مزامنة ناقصة غالباً: لا نحذف أحداً (الإيقاف يتم بـ isActive)
      if (ids.length) db.prepare(`DELETE FROM staff WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('team staff sync failed', err.message);
    }
    // قنوات من أُوقف أو حُذف أو تغيّر رمزه تُغلق فوراً
    work.recheckStreams('staff:');
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
      plan: work.planOf(s.id).plan,
      supervisor: !!work.supervisorOf(s.id),
    };
  }

  function issueStaffToken(s) {
    return ctx.signJwt({ sub: String(s.id), role: 'staff', sid: s.salesman_id || null, name: s.name, tv: s.token_version, exp: ctx.tokenExp() });
  }

  /** الموظف صاحب الرمز إن كان نشطاً ونسخة جلسته حالية.
   *  رموز ما قبل نسخة الجلسة (بلا tv) تُقبل للتجديد فقط ما لم تزد النسخة بعد. */
  function staffFromToken(token, opts) {
    const payload = ctx.verifyJwt(token, 'staff', opts);
    const id = Number(payload?.sub || 0);
    if (!id) return null;
    const s = getStaff(id);
    if (!s || !s.is_active) return null;
    const tv = payload.tv ?? (opts?.refresh ? 0 : null);
    return tv === s.token_version ? s : null;
  }
  const staffFromReq = (req, opts) => staffFromToken(ctx.bearerToken(req), opts);

  /** إسقاط كل جلسات الموظف (الرموز والقناة الحية) */
  function revokeStaff(id) {
    db.prepare('UPDATE staff SET token_version = token_version + 1 WHERE id = ?').run(id);
    work.recheckStreams(`staff:${id}`);
  }

  /* حدّ محاولات الدخول: بعد max فشل خلال 15 دقيقة يُقفل المفتاح 15 دقيقة */
  const attempts = new Map();
  function throttled(key) {
    const a = attempts.get(key);
    if (!a) return 0;
    if (a.until && a.until > Date.now()) return Math.round((a.until - Date.now()) / 1000);
    if (Date.now() - a.first > 15 * 60_000) attempts.delete(key);
    return 0;
  }
  function failed(key, max) {
    const a = attempts.get(key) && Date.now() - attempts.get(key).first < 15 * 60_000 ? attempts.get(key) : { n: 0, first: Date.now(), until: 0 };
    a.n++;
    if (a.n >= max) a.until = Date.now() + 15 * 60_000;
    attempts.set(key, a);
    if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  }

  function touchDevice(staffId, info) {
    db.prepare('UPDATE devices SET last_seen = ?, app_version = COALESCE(?, app_version) WHERE staff_id = ?').run(now(), info?.appVersion || null, staffId);
  }

  // التبليغات، الإعلانات، الوسائط، الدوام والإجازات
  const work = require('./team-work').createWork({ db, ctx, now, audit, getStaff });
  // الحضور والاستراحة، والمحادثات
  const attend = require('./team-attend').createAttend({
    db,
    ctx,
    now,
    audit,
    getStaff,
    notify: work.notify,
    managerIds: work.managerIds,
    emit: work.emit,
    emitManagers: work.emitManagers,
    dayFor: work.dayFor,
    planOf: work.planOf,
    rateOn: work.rateOn,
    notifySupervisors: work.notifySupervisors,
  });
  const chat = require('./team-chat').createChat({ db, ctx, now, audit, emit: work.emit, notify: work.notify, deleteMedia: work.deleteMedia, isOnline: work.isOnline });
  // إصدارات التطبيق، جدول الفريق، الملخص الشهري، إشعارات Firebase
  const extra = require('./team-extra').createExtra({ db, ctx, now, audit, dayFor: work.dayFor, overtimeOf: attend.overtimeOf, shiftOf: attend.shiftOf });
  ctx.pushTo = (kind, ids, n) => void extra.pushTo(kind, ids, n);
  // مبيعات المحل المباشرة والأيام السابقة للمدراء
  const sales = require('./team-sales').createSales({ db, ctx, now, audit, permsOf: work.permsOf, managerIds: work.managerIds, emit: work.emit, notify: work.notify });

  // الفواتير الكاملة بتفاصيلها
  const invoices = require('./team-invoices').createInvoices({ db, ctx, now, permsOf: work.permsOf, managerIds: work.managerIds, emit: work.emit });

  /** صلاحية المدير المطلوبة لكل مسار (لا شيء = متاح لكل المدراء) */
  function permFor(method, sub) {
    if (sub === 'leave' || /^leave\//.test(sub) || /^staff\/\d+\/weekly-off$/.test(sub)) return 'approveLeave';
    if (/^attend\/(board|log|summary|hours)$/.test(sub) || sub === 'roster' || (sub === 'attend/settings' && method === 'GET') || (sub === 'networks/probe' && method === 'GET')) return 'viewAttendance';
    if (/^attend\//.test(sub) || /^networks/.test(sub) || /^staff\/\d+\/shift$/.test(sub)) return 'editAttendance';
    if ((sub === 'posts' && method !== 'GET') || /^posts\/\d+$/.test(sub) || sub === 'notify') return 'sendPosts';
    if (sub === 'chat/groups' || /^chat\/groups\//.test(sub)) return 'manageChat';
    if (/^product-images\//.test(sub) && method !== 'GET') return 'admin';
    if (/^sales(\/|$)/.test(sub)) return 'viewSales';
    if (/^invoices(\/|$)/.test(sub)) return 'viewInvoices';
    return null;
  }

  /** ما يُسمح به للمسؤول من الموظفين داخل /api/team/m/* — لا شبكات ولا إعدادات ولا ما يخص الإدارة */
  function supervisorRoute(method, sub) {
    if (['overview', 'directory', 'leave', 'roster', 'notify/log', 'attend/board', 'attend/log', 'attend/summary', 'attend/hours'].includes(sub)) return method === 'GET';
    if (/^leave\/\d+\/decide$/.test(sub) || sub === 'attend/manual' || sub === 'notify' || sub === 'media') return method === 'POST';
    if (/^attend\/\d+$/.test(sub) || /^staff\/\d+\/weekly-off$/.test(sub)) return method === 'PUT';
    if (/^staff\/\d+\/shift$/.test(sub)) return method === 'PUT' || method === 'GET';
    if (/^staff\/\d+\/schedule$/.test(sub)) return method === 'GET';
    if (sub === 'posts' || /^posts\/\d+(\/readers)?$/.test(sub)) return true;
    return /^(sales|invoices)(\/|$)/.test(sub);
  }
  /** المسؤول: موظف برمز حسابه العادي، صلاحياته ونطاقه من لوحة التحكم */
  async function handleSupervisor(req, res, url, sub, s) {
    const key = `staff:${s.id}`;
    if (req.method === 'GET' && sub === 'events') {
      const token = url.searchParams.get('token') || '';
      work.openStream(req, res, key, () => !!staffFromToken(token) && !!work.supervisorOf(s.id));
      return true;
    }
    const { perms, members } = work.supervisorOf(s.id);
    if (req.method === 'GET' && sub === 'me') {
      ctx.send(res, 200, { id: s.id, username: s.code, displayName: s.name, unread: work.unreadCount('staff', s.id), perms, sections: [], supervisor: true, memberCount: members.length });
      return true;
    }
    const need = permFor(req.method, sub);
    if (!supervisorRoute(req.method, sub) || (need && !perms[need])) {
      ctx.send(res, 403, { error: 'لا تملك صلاحية هذا الإجراء — راجع الإدارة', code: 'perm', perm: need });
      return true;
    }
    const allow = work.supervisorScope(s.id);
    const target = sub.match(/^staff\/(\d+)\//);
    if (target && !allow(Number(target[1]))) {
      ctx.send(res, 403, { error: 'هذا الموظف ليس ضمن فريقك' });
      return true;
    }
    const actor = `supervisor:${s.name}`;
    if (await work.handleManage(req, res, url, sub, actor, false, allow)) return true;
    if (await attend.handleManage(req, res, url, sub, actor, false, allow, perms.viewPay)) return true;
    if (await extra.handleManage(req, res, url, sub, actor, false, allow, perms.viewPay)) return true;
    if (await sales.handleManage(req, res, url, sub, (st, b) => ctx.send(res, st, b), actor)) return true;
    if (await invoices.handleManage(req, res, url, sub, (st, b) => ctx.send(res, st, b))) return true;
    ctx.send(res, 404, { error: 'not found' });
    return true;
  }

  function managerFromToken(token) {
    const payload = ctx.verifyJwt(token, 'manager');
    const id = Number(payload?.sub || 0);
    const m = id ? (ctx.getManagers?.() || {})[id] || (ctx.getManagers?.() || {})[String(id)] : null;
    return m && m.isActive !== false ? m : null;
  }

  /* ── المسارات ── */
  async function handle(req, res, url) {
    const p = url.pathname;

    // مبيعات المحل من سيرفر المحل (مفتاح المزامنة)
    if (p.startsWith('/api/sync/sales/invoices') && (await invoices.handleSync(req, res, url))) return true;
    if (p.startsWith('/api/sync/sales') && (await sales.handleSync(req, res, url))) return true;

    // فحص التحديث وتنزيل التطبيق (عام)
    if (extra.handlePublic(req, res, url)) return true;

    // صور الإعلانات والمنتجات: عامة بأسماء عشوائية غير قابلة للتخمين
    const media = p.match(/^\/api\/team\/media\/([\w.]+)$/);
    if (req.method === 'GET' && media) {
      work.serveMedia(res, media[1]);
      return true;
    }
    // مرفقات الإجازات (تقارير طبية): رابط موقّع قصير العمر، أو رمز صاحب الطلب، أو مدير يملك الموافقة على موظفه
    const priv = p.match(/^\/api\/team\/private\/([\w.]+)$/);
    if (req.method === 'GET' && priv) {
      const name = priv[1];
      let allowed = work.signedOk(name, url);
      if (!allowed && ctx.bearerToken(req)) {
        const owner = work.privateOwner(name);
        const s = staffFromReq(req);
        const m = s ? null : managerFromToken(ctx.bearerToken(req));
        allowed = owner != null && (s ? s.id === owner : !!m && !!work.permsOf(Number(m.id)).perms.approveLeave && work.scopeOf(Number(m.id))(owner));
      }
      if (!allowed) ctx.sendOpen(res, 403, { error: 'رابط المرفق منتهٍ — أعد فتح الطلب' });
      else work.servePrivate(res, name);
      return true;
    }

    // القناة الحية (EventSource لا يرسل ترويسات — الرمز في الرابط)
    if (req.method === 'GET' && p === '/api/team/events') {
      const token = url.searchParams.get('token') || '';
      const s = staffFromToken(token);
      if (!s) {
        ctx.send(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
        return true;
      }
      // تُعاد المصادقة دورياً: الإيقاف أو تغيير الرمز أو انتهاء الصلاحية يغلق القناة
      work.openStream(req, res, `staff:${s.id}`, () => !!staffFromToken(token));
      return true;
    }

    // المدير داخل التطبيق: /api/team/m/*
    if (p.startsWith('/api/team/m/')) {
      // ردود المدير تحتفظ بأسماء الأقسام (تُحذف من ردود البائعين فقط)
      res.teamManager = true;
      const sub = p.slice('/api/team/m/'.length);
      const token = sub === 'events' ? url.searchParams.get('token') || '' : ctx.bearerToken(req);
      const m = managerFromToken(token);
      if (!m) {
        const sup = staffFromToken(token);
        if (sup && work.supervisorOf(sup.id)) return handleSupervisor(req, res, url, sub, sup);
        ctx.send(res, 401, { error: 'انتهت الجلسة — أعد الدخول' });
        return true;
      }
      const mid = Number(m.id);
      if (req.method === 'GET' && sub === 'events') {
        work.openStream(req, res, `manager:${mid}`, () => !!managerFromToken(token));
        return true;
      }
      const { perms, sections } = work.permsOf(mid);
      if (req.method === 'POST' && sub === 'push-test') {
        const out = await extra.pushSelf('manager', mid);
        ctx.send(res, out.status, out.body);
        return true;
      }
      if (req.method === 'GET' && sub === 'me') {
        ctx.send(res, 200, { id: mid, username: m.username, displayName: m.displayName, unread: work.unreadCount('manager', mid), perms, sections });
        return true;
      }
      // رمز إشعارات هاتف المدير
      if (sub === 'push-token' && (req.method === 'POST' || req.method === 'DELETE')) {
        const body = JSON.parse((await ctx.readBody(req)) || '{}');
        const token = String(body.token || '').slice(0, 500);
        if (req.method === 'DELETE') {
          db.prepare("DELETE FROM push_tokens WHERE user_kind = 'manager' AND user_id = ? AND (token = ? OR device_id = ?)").run(mid, token, String(body.deviceId || '-'));
        } else if (token) {
          db.prepare(`INSERT INTO push_tokens (token, user_kind, user_id, platform, device_id, updated_at) VALUES (?, 'manager', ?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET user_kind='manager', user_id=excluded.user_id, platform=excluded.platform, device_id=excluded.device_id, updated_at=excluded.updated_at`)
            .run(token, mid, String(body.platform || '').slice(0, 20) || null, String(body.deviceId || '').slice(0, 120) || null, now());
        } else {
          ctx.send(res, 400, { error: 'رمز الإشعارات مفقود' });
          return true;
        }
        ctx.send(res, 200, { ok: true });
        return true;
      }
      // الصلاحية المطلوبة لكل مسار، ونطاق أقسام المدير
      const need = permFor(req.method, sub);
      if (need && !perms[need]) {
        ctx.send(res, 403, { error: 'لا تملك صلاحية هذا الإجراء — راجع الإدارة', code: 'perm', perm: need });
        return true;
      }
      const allow = work.scopeOf(mid);
      const staffTarget = sub.match(/^staff\/(\d+)\//);
      if (staffTarget && !allow(Number(staffTarget[1]))) {
        ctx.send(res, 403, { error: 'هذا الموظف خارج أقسامك' });
        return true;
      }
      if (req.method === 'GET' && sub === 'notifications') {
        ctx.send(res, 200, work.listNotifications('manager', mid, url));
        return true;
      }
      if (req.method === 'POST' && sub === 'notifications/read') {
        let body = {};
        try {
          body = JSON.parse((await ctx.readBody(req)) || '{}');
        } catch {
          /* فارغ */
        }
        ctx.send(res, 200, work.markRead('manager', mid, body));
        return true;
      }
      if (sub === 'chat' || sub.startsWith('chat/')) {
        if (await chat.handle(req, res, url, sub.slice(4), { key: `manager:${mid}`, kind: 'manager', id: mid, canModerate: perms.manageChat })) return true;
      }
      const actorName = `manager:${m.displayName || m.username}`;
      if (await work.handleManage(req, res, url, sub, actorName, false, allow)) return true;
      if (await attend.handleManage(req, res, url, sub, actorName, false, allow, perms.viewPay)) return true;
      if (await extra.handleManage(req, res, url, sub, actorName, false, allow, perms.viewPay)) return true;
      if (await sales.handleManage(req, res, url, sub, (st, b) => ctx.send(res, st, b), actorName)) return true;
      if (await invoices.handleManage(req, res, url, sub, (st, b) => ctx.send(res, st, b))) return true;
      ctx.send(res, 404, { error: 'not found' });
      return true;
    }

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
      const ipKey = `ip:${require('./team-attend').clientIp(req)}`;
      const codeKey = `code:${String(body.code || '').trim().toLowerCase()}`;
      const wait = Math.max(throttled(ipKey), throttled(codeKey));
      if (wait) {
        ctx.send(res, 429, { error: `محاولات كثيرة — حاول بعد ${Math.ceil(wait / 60)} دقيقة`, code: 'throttled' });
        return true;
      }
      const s = findStaffByCode(body.code);
      const pin = String(body.pin || '').trim();
      if (!s || !s.pin_hash || pin.length < 4 || !(await ctx.bcrypt.compare(pin, s.pin_hash))) {
        failed(ipKey, 30);
        failed(codeKey, 8);
        ctx.send(res, 401, { error: 'الكود أو الرمز غير صحيح' });
        return true;
      }
      attempts.delete(codeKey);
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
      // البائع: رمز البائع للعمولة والأهداف والبراندات
      let sellerToken = null;
      let access = null;
      if (s.salesman_id) {
        const acc = ctx.getSellerAccount(s.salesman_id);
        if (acc) {
          // خارج الوقت يدخل التطبيق عادياً: الخادم يقفل العمولات والأهداف وحدها
          access = ctx.accessState(acc);
          sellerToken = ctx.issueSellerToken(acc);
        }
      }
      audit(`staff:${s.id}`, 'login', s.id, { platform: body.platform, appVersion: body.appVersion });
      ctx.send(res, 200, { token: issueStaffToken(s), staff: staffView(s), sellerToken, access });
      return true;
    }

    if (req.method === 'POST' && p === '/auth/team-refresh') {
      const s = staffFromReq(req, { refresh: true });
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
        ctx.send(res, 200, { ...staffView(s), device, supervisorPerms: work.supervisorOf(s.id)?.perms ?? null });
        return true;
      }
      // الخروج: إيقاف إشعارات هذا الهاتف
      if (req.method === 'DELETE' && p === '/api/team/push-token') {
        const body = JSON.parse((await ctx.readBody(req)) || '{}');
        db.prepare("DELETE FROM push_tokens WHERE user_kind = 'staff' AND user_id = ? AND (token = ? OR device_id = ?)").run(s.id, String(body.token || ''), String(body.deviceId || '-'));
        ctx.send(res, 200, { ok: true });
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
      if (req.method === 'POST' && p === '/api/team/push-test') {
        const out = await extra.pushSelf('staff', s.id);
        ctx.send(res, out.status, out.body);
        return true;
      }
      // تقريري الشهري: حضوري، تأخيري، إضافي، إجازاتي
      if (req.method === 'GET' && p === '/api/team/attend/month') {
        ctx.send(res, 200, extra.myMonth(s, url.searchParams.get('month')));
        return true;
      }
      if (await work.handleStaff(req, res, url, s)) return true;
      if (await attend.handleStaff(req, res, url, s)) return true;
      if (p === '/api/team/chat' || p.startsWith('/api/team/chat/')) {
        if (await chat.handle(req, res, url, p.slice('/api/team/chat'.length), { key: `staff:${s.id}`, kind: 'staff', id: s.id, canManage: !!work.supervisorOf(s.id)?.perms.manageChat })) return true;
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
        ctx.sendOpen(res, 200, { staffCount, devices, push, serverTime: now(), hubVersion: HUB_VERSION });
        return true;
      }
      const m = p.match(/^\/api\/admin\/team\/staff\/(\d+)\/reset-device$/);
      if (req.method === 'POST' && m) {
        const id = Number(m[1]);
        db.prepare('DELETE FROM devices WHERE staff_id = ?').run(id);
        db.prepare("DELETE FROM push_tokens WHERE user_kind = 'staff' AND user_id = ?").run(id);
        // الهاتف القديم يفقد جلسته فوراً — الدخول من جديد يربط الهاتف الجديد
        revokeStaff(id);
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
      // لوحة التحكم تعرض الصور عبر الوكيل (المسار نفسه بلا مصادقة المتصفح)
      const am = p.match(/^\/api\/admin\/team\/media\/([\w.]+)$/);
      if (req.method === 'GET' && am) {
        work.serveMedia(res, am[1]);
        return true;
      }
      const ap = p.match(/^\/api\/admin\/team\/private\/([\w.]+)$/);
      if (req.method === 'GET' && ap) {
        work.servePrivate(res, ap[1]);
        return true;
      }
      if (await work.handleManage(req, res, url, p.slice('/api/admin/team/'.length), actor, true)) return true;
      if (await attend.handleManage(req, res, url, p.slice('/api/admin/team/'.length), actor, true)) return true;
      if (await extra.handleManage(req, res, url, p.slice('/api/admin/team/'.length), actor, true)) return true;
      if (await invoices.handleManage(req, res, url, p.slice('/api/admin/team/'.length), (st, b) => ctx.sendOpen(res, st, b))) return true;
      // عنوان المحل العام كما يراه الخادم (الطلب يصل من سيرفر المحل مباشرة)
      if (req.method === 'GET' && p === '/api/admin/team/whoami') {
        ctx.sendOpen(res, 200, { ip: require('./team-attend').clientIp(req), shopIp: attend.shopIp() });
        return true;
      }
      ctx.sendOpen(res, 404, { error: 'not found' });
      return true;
    }
    return false;
  }

  /** طلب مزامنة صحيح من سيرفر المحل: عنوانه = عنوان إنترنت المحل */
  const noteShopIp = req => attend.noteShopIp(require('./team-attend').clientIp(req), 'sync');
  return { canViewSales: id => work.permsOf(Number(id)).perms.viewSales, db, applyStaff, handle, audit, withImages: work.withImages, recheckStreams: work.recheckStreams, noteShopIp };
}

module.exports = { createTeam };
