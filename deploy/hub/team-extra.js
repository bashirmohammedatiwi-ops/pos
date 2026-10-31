'use strict';

/*
 * تطبيق الفريق — وحدات إضافية على خادم الـ VPS:
 *   · إصدارات التطبيق: رفع APK من لوحة التحكم، وفحص التحديث والتنزيل من داخل التطبيق.
 *   · جدول الفريق الأسبوعي: من في الدوام ومن في عطلة/إجازة لكل يوم.
 *   · ملخص الحضور الشهري لكل موظف: الأيام، الساعات، التأخير، الغياب، تجاوز الاستراحة.
 *   · إشعارات Firebase (FCM HTTP v1) تصل والتطبيق مغلق — تعمل حين يوضع حساب الخدمة على الخادم.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const IRAQ_MS = 3 * 3600_000;
const iraqDate = (ms = Date.now()) => new Date(ms + IRAQ_MS).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const APK_RE = /^DeemaTeam-\d+\.\d+\.\d+\.apk$/;
const vcode = v => v.split('.').reduce((s, n) => s * 1000 + Number(n), 0);

const PUSH_RETRY_MS = [1500, 5000];

function createExtra({ db, ctx, now, audit, dayFor, overtimeOf = () => 0, shiftOf = () => ({}) }) {
  db.exec('CREATE TABLE IF NOT EXISTS _extra_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE app_releases (
       id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL UNIQUE, notes TEXT, required INTEGER NOT NULL DEFAULT 0,
       file TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT, created_by TEXT, created_at TEXT NOT NULL
     );`,
  ];
  const done = new Set(db.prepare('SELECT id FROM _extra_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _extra_migrations (id, applied_at) VALUES (?, ?)').run(i + 1, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  const appDir = path.join(ctx.dataDir, 'app');
  fs.mkdirSync(appDir, { recursive: true });

  /* ═════════════ إصدارات التطبيق ═════════════ */
  const releaseView = r => ({
    id: r.id,
    version: r.version,
    notes: r.notes,
    required: !!r.required,
    size: r.size,
    sha256: r.sha256,
    url: `/api/team/app/download/${r.file}`,
    createdBy: r.created_by,
    createdAt: r.created_at,
  });
  function latest() {
    const rows = db.prepare('SELECT * FROM app_releases').all();
    if (!rows.length) return null;
    rows.sort((a, b) => vcode(b.version) - vcode(a.version));
    return rows[0];
  }
  /** أحدث إصدار + هل التحديث إلزامي لمن يملك إصداراً معيناً (أي إصدار إلزامي أحدث منه) */
  function check(current) {
    const top = latest();
    if (!top) return { latest: null };
    const cur = VERSION_RE.test(String(current || '')) ? vcode(current) : 0;
    const newer = db.prepare('SELECT * FROM app_releases').all().filter(r => vcode(r.version) > cur);
    return { latest: releaseView(top), update: vcode(top.version) > cur, required: newer.some(r => r.required) };
  }
  function addRelease(body, actor) {
    const version = String(body.version || '').trim();
    if (!VERSION_RE.test(version)) return { status: 400, body: { error: 'رقم الإصدار بصيغة 1.2.3' } };
    if (db.prepare('SELECT id FROM app_releases WHERE version = ?').get(version)) return { status: 409, body: { error: 'هذا الإصدار مرفوع مسبقاً' } };
    const raw = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    // ملف APK = ZIP يبدأ بـ PK
    if (buf.length < 100_000 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { status: 400, body: { error: 'الملف ليس APK صالحاً' } };
    if (buf.length > 28 * 1048576) return { status: 413, body: { error: 'الملف أكبر من 28 ميغابايت' } };
    const file = `DeemaTeam-${version}.apk`;
    fs.writeFileSync(path.join(appDir, file), buf);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    db.prepare('INSERT INTO app_releases (version, notes, required, file, size, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(version, String(body.notes || '').slice(0, 2000) || null, body.required ? 1 : 0, file, buf.length, sha, actor, now());
    audit(actor, 'app.release', version, { size: buf.length, required: !!body.required });
    return { status: 200, body: releaseView(db.prepare('SELECT * FROM app_releases WHERE version = ?').get(version)) };
  }
  function deleteRelease(id, actor) {
    const r = db.prepare('SELECT * FROM app_releases WHERE id = ?').get(id);
    if (!r) return { status: 404, body: { error: 'غير موجود' } };
    try {
      fs.unlinkSync(path.join(appDir, r.file));
    } catch {
      /* محذوف مسبقاً */
    }
    db.prepare('DELETE FROM app_releases WHERE id = ?').run(id);
    audit(actor, 'app.release.delete', r.version, null);
    return { status: 200, body: { ok: true } };
  }
  function serveApk(res, file) {
    if (!APK_RE.test(file)) return ctx.sendOpen(res, 404, { error: 'not found' });
    const p = path.join(appDir, file);
    if (!fs.existsSync(p)) return ctx.sendOpen(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Length': fs.statSync(p).size,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(p).pipe(res);
  }

  /* ═════════════ جدول الفريق الأسبوعي ═════════════ */
  function roster(url, allow) {
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : iraqDate();
    const days = Math.min(31, Math.max(1, Number(url.searchParams.get('days') || 7)));
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    const staff = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY section_name, name').all().filter(s => allow(s.id));
    const rows = staff.map(s => ({
      staffId: s.id,
      name: s.name,
      kind: s.kind,
      sectionName: s.section_name,
      cells: dates.map(d => {
        const st = dayFor(s.id, d);
        return { date: d, off: !!st?.off, reason: st?.reason ?? null };
      }),
    }));
    const working = dates.map((_, i) => rows.filter(r => !r.cells[i].off).length);
    return { from, dates, rows, working, staffCount: rows.length };
  }

  /* ═════════════ ملخص الحضور لكل موظف ═════════════ */
  function summary(url, allow, showPay = true) {
    const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : iraqDate();
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : `${to.slice(0, 8)}01`;
    const today = iraqDate();
    const last = to < today ? to : today;
    const dates = [];
    for (let d = from; d <= last && dates.length < 92; d = addDays(d, 1)) dates.push(d);
    const staff = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY name').all().filter(s => allow(s.id));
    const recs = db.prepare('SELECT * FROM attendance WHERE date BETWEEN ? AND ?').all(from, to);
    const breaks = db.prepare('SELECT b.* FROM breaks b JOIN attendance a ON a.id = b.attendance_id WHERE a.date BETWEEN ? AND ?').all(from, to);
    const byAtt = new Map();
    for (const b of breaks) byAtt.set(b.attendance_id, [...(byAtt.get(b.attendance_id) || []), b]);
    const byStaff = new Map();
    for (const r of recs) byStaff.set(r.staff_id, [...(byStaff.get(r.staff_id) || []), r]);
    return {
      from,
      to,
      days: dates.length,
      rows: staff.map(s => {
        const list = byStaff.get(s.id) || [];
        const present = new Set(list.map(r => r.date));
        let scheduled = 0;
        let absent = 0;
        let leaveDays = 0;
        let offDays = 0;
        for (const d of dates) {
          const st = dayFor(s.id, d);
          if (st?.off) {
            if (st.reason === 'weekly' || st.reason === 'swap') offDays++;
            else leaveDays++;
            continue;
          }
          scheduled++;
          if (!present.has(d) && d < today) absent++;
        }
        let worked = 0;
        let breakMin = 0;
        let over = 0;
        let ot = 0;
        let otDays = 0;
        for (const r of list) {
          const bl = byAtt.get(r.id) || [];
          const bm = bl.reduce((x, b) => x + Math.round(((b.end_at ? Date.parse(b.end_at) : Date.now()) - Date.parse(b.start_at)) / 60_000), 0);
          breakMin += bm;
          over += bl.reduce((x, b) => x + (b.over_minutes || 0), 0);
          const w = Math.max(0, Math.round(((r.check_out ? Date.parse(r.check_out) : Date.now()) - Date.parse(r.check_in)) / 60_000) - bm);
          worked += w;
          const o = overtimeOf(s.id, r.date, w);
          if (o > 0) {
            ot += o;
            otDays++;
          }
        }
        const sh = shiftOf(s.id);
        const lateRows = list.filter(r => r.late_minutes > 0);
        // بالساعات: لا أيام مقررة ولا غياب — يُحسب ما حضره فقط
        if (sh.hourly) {
          scheduled = present.size;
          absent = 0;
        }
        return {
          staffId: s.id,
          name: s.name,
          kind: s.kind,
          sectionName: s.section_name,
          scheduledDays: scheduled,
          presentDays: present.size,
          absentDays: absent,
          offDays,
          leaveDays,
          workedMinutes: worked,
          avgMinutes: present.size ? Math.round(worked / present.size) : 0,
          lateDays: lateRows.length,
          lateMinutes: lateRows.reduce((x, r) => x + r.late_minutes, 0),
          breakMinutes: breakMin,
          overMinutes: over,
          hourly: !!sh.hourly,
          overtimeEnabled: !!sh.overtime,
          overtimeRate: showPay ? sh.overtimeRate ?? null : null,
          overtimeMinutes: ot,
          overtimeDays: otDays,
          overtimePay: showPay && sh.overtimeRate ? Math.round((ot / 60) * sh.overtimeRate) : null,
          autoClosed: list.filter(r => r.auto_closed).length,
          edited: list.filter(r => r.edited_by).length,
          attendanceRate: !sh.hourly && scheduled ? Math.round((Math.min(present.size, scheduled) / scheduled) * 100) : null,
        };
      }),
    };
  }

  /** تقرير الموظف نفسه لشهر: ملخص + كل يوم + إجازات السنة */
  function myMonth(s, monthRaw) {
    const today = iraqDate();
    const month = /^\d{4}-\d{2}$/.test(String(monthRaw || '')) ? monthRaw : today.slice(0, 7);
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const to = end < today ? end : today;
    const params = new URLSearchParams({ from, to });
    const row = from <= today ? summary({ searchParams: params }, id => id === s.id).rows[0] ?? null : null;
    const recs = new Map(db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date BETWEEN ? AND ?').all(s.id, from, to).map(r => [r.date, r]));
    const days = [];
    for (let d = to; d >= from; d = addDays(d, -1)) {
      const r = recs.get(d);
      const st = dayFor(s.id, d);
      let worked = 0;
      let breakMin = 0;
      if (r) {
        const bl = db.prepare('SELECT * FROM breaks WHERE attendance_id = ?').all(r.id);
        breakMin = bl.reduce((x, b) => x + Math.round(((b.end_at ? Date.parse(b.end_at) : Date.now()) - Date.parse(b.start_at)) / 60_000), 0);
        worked = Math.max(0, Math.round(((r.check_out ? Date.parse(r.check_out) : Date.now()) - Date.parse(r.check_in)) / 60_000) - breakMin);
      }
      days.push({
        date: d,
        off: !!st?.off,
        reason: st?.reason ?? null,
        checkIn: r?.check_in ?? null,
        checkOut: r?.check_out ?? null,
        lateMinutes: r?.late_minutes ?? 0,
        workedMinutes: worked,
        breakMinutes: breakMin,
        overtimeMinutes: r ? overtimeOf(s.id, d, worked) : 0,
        autoClosed: !!r?.auto_closed,
      });
    }
    const leaves = db.prepare("SELECT type, COUNT(*) AS n FROM leave_requests WHERE staff_id = ? AND status = 'approved' AND substr(created_at, 1, 4) = ? GROUP BY type").all(s.id, month.slice(0, 4));
    return { month, from, to, row, days, leaves };
  }

  /* ═════════════ إشعارات Firebase (FCM HTTP v1) ═════════════ */
  let sa = null;
  let saLoadedAt = 0;
  function serviceAccount() {
    if (Date.now() - saLoadedAt < 60_000) return sa;
    saLoadedAt = Date.now();
    try {
      const raw = process.env.FIREBASE_SA_JSON || (fs.existsSync(path.join(ctx.dataDir, 'firebase-sa.json')) ? fs.readFileSync(path.join(ctx.dataDir, 'firebase-sa.json'), 'utf8') : '');
      sa = raw ? JSON.parse(raw) : null;
      if (sa && (!sa.client_email || !sa.private_key || !sa.project_id)) sa = null;
    } catch {
      sa = null;
    }
    return sa;
  }
  let token = { value: '', exp: 0 };
  async function accessToken() {
    const acc = serviceAccount();
    if (!acc) return null;
    if (token.value && token.exp - 60_000 > Date.now()) return token.value;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: acc.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(acc.private_key).toString('base64url');
    const res = await fetch(acc.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    if (!res.ok) throw new Error(`FCM auth ${res.status}`);
    const j = await res.json();
    token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return token.value;
  }
  const pushLog = [];
  async function sendOne(acc, bearer, deviceToken, n) {
    // عطل عابر عند Google أو في الشبكة: يُعاد الإرسال بدل أن يضيع الإشعار
    for (let attempt = 0; ; attempt++) {
      let res = null;
      try {
        res = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: deviceToken,
              notification: { title: n.title, body: n.body || '' },
              data: { link: n.link || '', type: n.type || '' },
              android: { priority: 'high', notification: { channel_id: 'team', sound: 'default', default_vibrate_timings: true } },
              apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
            },
          }),
        });
      } catch (err) {
        if (attempt >= PUSH_RETRY_MS.length) return `error ${err.message}`;
      }
      if (res?.ok) return 'ok';
      if (res) {
        const text = await res.text();
        // الرمز نفسه لم يعد صالحاً (حُذف التطبيق أو تغيّر الهاتف) — نزيله.
        // خطأ في محتوى الإشعار لا يمس تسجيل الهاتف.
        if (res.status === 404 || /UNREGISTERED/.test(text) || (/INVALID_ARGUMENT/.test(text) && /registration token/i.test(text))) {
          db.prepare('DELETE FROM push_tokens WHERE token = ?').run(deviceToken);
          return 'removed';
        }
        if ((res.status !== 429 && res.status < 500) || attempt >= PUSH_RETRY_MS.length) return `error ${res.status}`;
      }
      await new Promise(r => setTimeout(r, PUSH_RETRY_MS[attempt]));
    }
  }
  /** يرسل لمستخدمين (staff/manager) — يُستدعى من التبليغات والمحادثات */
  async function pushTo(kind, ids, n) {
    const acc = serviceAccount();
    if (!acc || !ids.length) return { configured: !!acc, count: 0, ok: 0 };
    const list = db.prepare(`SELECT token FROM push_tokens WHERE user_kind = ? AND user_id IN (${ids.map(() => '?').join(',')})`).all(kind, ...ids.map(Number));
    if (!list.length) return { configured: true, count: 0, ok: 0 };
    try {
      let bearer;
      try {
        bearer = await accessToken();
      } catch {
        await new Promise(r => setTimeout(r, PUSH_RETRY_MS[1]));
        bearer = await accessToken();
      }
      const results = await Promise.all(list.map(t => sendOne(acc, bearer, t.token, n).catch(e => `error ${e.message}`)));
      const ok = results.filter(r => r === 'ok').length;
      const failed = results.filter(r => r.startsWith('error'));
      pushLog.unshift({ at: now(), kind, count: list.length, ok, title: n.title, error: failed[0] });
      pushLog.length = Math.min(pushLog.length, 50);
      if (failed.length) console.error('push failed', failed[0]);
      return { configured: true, count: list.length, ok };
    } catch (err) {
      pushLog.unshift({ at: now(), kind, count: list.length, ok: 0, title: n.title, error: err.message });
      pushLog.length = Math.min(pushLog.length, 50);
      console.error('push failed', err.message);
      return { configured: true, count: list.length, ok: 0 };
    }
  }
  /** الموظف أو المدير يجرّب إشعارات هاتفه بنفسه (مرة كل 20 ثانية) */
  const selfTests = new Map();
  async function pushSelf(kind, id) {
    const key = `${kind}:${id}`;
    if (Date.now() - (selfTests.get(key) || 0) < 20_000) return { status: 429, body: { error: 'انتظر قليلاً ثم جرّب مرة أخرى' } };
    selfTests.set(key, Date.now());
    const r = await pushTo(kind, [id], { title: 'تجربة الإشعارات ✅', body: 'وصلك هذا الإشعار — الإشعارات تعمل على هاتفك', link: kind === 'manager' ? '/more' : '/account' });
    return { status: 200, body: r };
  }
  function pushStatus() {
    const acc = serviceAccount();
    const tokens = db.prepare('SELECT user_kind AS kind, COUNT(*) AS n FROM push_tokens GROUP BY user_kind').all();
    return { configured: !!acc, projectId: acc?.project_id ?? null, tokens, log: pushLog.slice(0, 20) };
  }

  /* ═════════════ المسارات ═════════════ */
  async function json(req) {
    try {
      return JSON.parse((await ctx.readBody(req)) || '{}');
    } catch {
      return null;
    }
  }
  /** مسارات عامة (بلا تسجيل دخول): فحص التحديث والتنزيل */
  function handlePublic(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/team/app/latest') {
      ctx.sendOpen(res, 200, check(url.searchParams.get('v')));
      return true;
    }
    const m = p.match(/^\/api\/team\/app\/download\/([\w.-]+)$/);
    if (req.method === 'GET' && m) {
      serveApk(res, m[1]);
      return true;
    }
    return false;
  }
  async function handleManage(req, res, url, sub, actor, open, allow = () => true, showPay = true) {
    const send = (st, b) => (open ? ctx.sendOpen : ctx.send)(res, st, b);
    if (req.method === 'GET' && sub === 'roster') return send(200, roster(url, allow)), true;
    if (req.method === 'GET' && sub === 'attend/summary') return send(200, summary(url, allow, showPay)), true;
    if (!open) return false; // ما يلي للإدارة فقط
    if (req.method === 'GET' && sub === 'app-releases') return send(200, db.prepare('SELECT * FROM app_releases ORDER BY id DESC').all().map(releaseView)), true;
    if (req.method === 'POST' && sub === 'app-releases') {
      const body = await json(req);
      if (!body) return send(400, { error: 'طلب غير صالح' }), true;
      const out = addRelease(body, actor);
      return send(out.status, out.body), true;
    }
    const m = sub.match(/^app-releases\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      const out = deleteRelease(Number(m[1]), actor);
      return send(out.status, out.body), true;
    }
    if (req.method === 'GET' && sub === 'push/status') return send(200, pushStatus()), true;
    if (req.method === 'POST' && sub === 'push/test') {
      const body = (await json(req)) || {};
      await pushTo(body.kind === 'manager' ? 'manager' : 'staff', [Number(body.id)], { title: 'تجربة الإشعارات ✅', body: 'وصلك هذا الإشعار والتطبيق مغلق — الإشعارات تعمل', link: '/alerts' });
      return send(200, pushStatus()), true;
    }
    return false;
  }

  return { handlePublic, handleManage, pushTo, pushSelf, check, myMonth };
}

module.exports = { createExtra };
