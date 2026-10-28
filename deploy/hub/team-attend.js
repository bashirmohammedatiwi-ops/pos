'use strict';

/*
 * تطبيق الفريق — الحضور والانصراف والاستراحة (على خادم الـ VPS).
 *   · الشبكات المسموحة: BSSID للواي فاي و/أو عنوان IP العام للمحل (يقرؤه الخادم لا الهاتف).
 *   · الدوام: افتراضي عام + ورديات لكل موظف؛ التأخير يُحسب بتوقيت العراق مع مهلة سماح.
 *   · الاستراحة: رصيد يومي وعدد مرات؛ تنبيه وتجاوز يُبلَّغان للموظف والمدراء.
 *   · مؤقت كل دقيقة: تجاوز الاستراحات، وإغلاق الحضور المنسي تلقائياً.
 */

const IRAQ_MS = 3 * 3600_000;
const DEFAULTS = {
  enforceNetwork: true,
  shiftStart: '10:00',
  shiftEnd: '22:00',
  breakMinutes: 30,
  maxBreaks: 2,
  graceMinutes: 10,
  earlyMinutes: 60,
  autoCloseHours: 3,
  breakWarnMinutes: 2,
};

const iraqNow = (ms = Date.now()) => new Date(ms + IRAQ_MS);
const iraqDate = (ms = Date.now()) => iraqNow(ms).toISOString().slice(0, 10);
const iraqMinutes = (ms = Date.now()) => {
  const d = iraqNow(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const hm = s => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** لحظة (UTC ms) لوقت «HH:MM» بتوقيت العراق في يوم معيّن؛ النهاية بعد منتصف الليل تُحسب لليوم التالي. */
const atIraq = (date, minutes) => Date.parse(`${date}T00:00:00Z`) - IRAQ_MS + minutes * 60_000;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function normBssid(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(s) || s === '02:00:00:00:00:00' || s === '00:00:00:00:00:00') return null;
  return s.replace(/-/g, ':');
}
function ipToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
/** يطابق عنواناً مع قاعدة: عنوان كامل، أو CIDR مثل 1.2.3.0/24 */
function ipMatch(rule, ip) {
  if (!rule || !ip) return false;
  const [base, bits] = String(rule).trim().split('/');
  if (bits === undefined) return base === ip;
  const a = ipToInt(base);
  const b = ipToInt(ip);
  const n = Number(bits);
  if (a == null || b == null || !(n >= 0 && n <= 32)) return false;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return (a & mask) === (b & mask);
}
const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/;
/** عنوان المرسل الحقيقي: نثق بترويسة البوابة فقط إذا جاء الطلب من شبكة Docker الداخلية. */
function clientIp(req) {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (PRIVATE.test(remote)) {
    const h = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (h) return h;
  }
  return remote;
}

function createAttend({ db, ctx, now, audit, getStaff, notify, managerIds, emit, emitManagers, dayFor }) {
  db.exec('CREATE TABLE IF NOT EXISTS _attend_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE networks (
       id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bssid TEXT, ip TEXT, ssid TEXT,
       is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL
     );
     CREATE TABLE staff_shift (
       staff_id INTEGER PRIMARY KEY, start TEXT, end TEXT, break_minutes INTEGER, max_breaks INTEGER, updated_at TEXT NOT NULL
     );
     CREATE TABLE attendance (
       id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, date TEXT NOT NULL,
       check_in TEXT NOT NULL, check_out TEXT, in_ip TEXT, in_bssid TEXT, out_ip TEXT, out_bssid TEXT,
       network_id INTEGER, device_id TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, auto_closed INTEGER NOT NULL DEFAULT 0,
       note TEXT, edited_by TEXT, edited_at TEXT
     );
     CREATE UNIQUE INDEX ux_attend_day ON attendance(staff_id, date);
     CREATE INDEX ix_attend_date ON attendance(date);
     CREATE TABLE breaks (
       id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER NOT NULL, staff_id INTEGER NOT NULL,
       start_at TEXT NOT NULL, end_at TEXT, planned_minutes INTEGER NOT NULL, over_minutes INTEGER NOT NULL DEFAULT 0,
       warned INTEGER NOT NULL DEFAULT 0, over_notified INTEGER NOT NULL DEFAULT 0, ip TEXT, bssid TEXT
     );
     CREATE INDEX ix_breaks_att ON breaks(attendance_id);`,
  ];
  const done = new Set(db.prepare('SELECT id FROM _attend_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _attend_migrations (id, applied_at) VALUES (?, ?)').run(i + 1, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  /* ── الإعدادات والورديات ── */
  function settings() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'attend'").get();
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
  }
  function saveSettings(body, actor) {
    const cur = settings();
    const next = { ...cur };
    if (typeof body.enforceNetwork === 'boolean') next.enforceNetwork = body.enforceNetwork;
    for (const k of ['shiftStart', 'shiftEnd']) if (isTime(body[k])) next[k] = body[k];
    const num = (k, lo, hi) => {
      if (body[k] !== undefined && Number.isFinite(Number(body[k]))) next[k] = Math.max(lo, Math.min(hi, Math.round(Number(body[k]))));
    };
    num('breakMinutes', 0, 240);
    num('maxBreaks', 0, 10);
    num('graceMinutes', 0, 120);
    num('earlyMinutes', 0, 240);
    num('autoCloseHours', 1, 12);
    num('breakWarnMinutes', 0, 15);
    db.prepare("INSERT INTO settings (key, value) VALUES ('attend', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
    audit(actor, 'attend.settings', null, next);
    return next;
  }
  function shiftOf(staffId) {
    const s = settings();
    const o = db.prepare('SELECT * FROM staff_shift WHERE staff_id = ?').get(staffId);
    return {
      start: o?.start || s.shiftStart,
      end: o?.end || s.shiftEnd,
      breakMinutes: o?.break_minutes ?? s.breakMinutes,
      maxBreaks: o?.max_breaks ?? s.maxBreaks,
      custom: !!o,
    };
  }
  function setShift(staffId, body, actor) {
    if (!getStaff(staffId)) return { status: 404, body: { error: 'الموظف غير موجود' } };
    if (body.reset) {
      db.prepare('DELETE FROM staff_shift WHERE staff_id = ?').run(staffId);
      audit(actor, 'shift.reset', staffId, null);
      return { status: 200, body: shiftOf(staffId) };
    }
    const start = isTime(body.start) ? body.start : null;
    const end = isTime(body.end) ? body.end : null;
    const bm = body.breakMinutes === '' || body.breakMinutes == null ? null : Math.max(0, Math.min(240, Math.round(Number(body.breakMinutes))));
    const mb = body.maxBreaks === '' || body.maxBreaks == null ? null : Math.max(0, Math.min(10, Math.round(Number(body.maxBreaks))));
    db.prepare(`INSERT INTO staff_shift (staff_id, start, end, break_minutes, max_breaks, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id) DO UPDATE SET start=excluded.start, end=excluded.end, break_minutes=excluded.break_minutes, max_breaks=excluded.max_breaks, updated_at=excluded.updated_at`)
      .run(staffId, start, end, Number.isFinite(bm) ? bm : null, Number.isFinite(mb) ? mb : null, now());
    audit(actor, 'shift.set', staffId, { start, end, bm, mb });
    emit(`staff:${staffId}`, 'attend', { shift: true });
    return { status: 200, body: shiftOf(staffId) };
  }

  /* ── الشبكات ── */
  const networks = () => db.prepare('SELECT * FROM networks ORDER BY id').all();
  const netView = n => ({ id: n.id, name: n.name, bssid: n.bssid, ip: n.ip, ssid: n.ssid, isActive: !!n.is_active, createdBy: n.created_by, createdAt: n.created_at });
  function saveNetwork(id, body, actor) {
    const name = String(body.name || '').trim().slice(0, 80);
    const bssid = body.bssid ? normBssid(body.bssid) : null;
    if (body.bssid && !bssid) return { status: 400, body: { error: 'BSSID غير صالح (مثال: a4:2b:b0:12:34:56)' } };
    const ip = body.ip ? String(body.ip).trim().slice(0, 50) : null;
    if (ip && ipToInt(ip.split('/')[0]) == null) return { status: 400, body: { error: 'عنوان IP غير صالح' } };
    if (!bssid && !ip) return { status: 400, body: { error: 'أدخل BSSID أو عنوان IP على الأقل' } };
    if (!name) return { status: 400, body: { error: 'اسم الشبكة مطلوب' } };
    const ssid = body.ssid ? String(body.ssid).slice(0, 64) : null;
    const active = body.isActive === false ? 0 : 1;
    if (id) {
      if (!db.prepare('SELECT id FROM networks WHERE id = ?').get(id)) return { status: 404, body: { error: 'الشبكة غير موجودة' } };
      db.prepare('UPDATE networks SET name=?, bssid=?, ip=?, ssid=?, is_active=? WHERE id=?').run(name, bssid, ip, ssid, active, id);
      audit(actor, 'network.update', id, { name, bssid, ip });
    } else {
      const r = db.prepare('INSERT INTO networks (name, bssid, ip, ssid, is_active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, bssid, ip, ssid, active, actor, now());
      id = Number(r.lastInsertRowid);
      audit(actor, 'network.create', id, { name, bssid, ip });
    }
    return { status: 200, body: netView(db.prepare('SELECT * FROM networks WHERE id = ?').get(id)) };
  }

  /** هل الطلب من شبكة المحل؟ كل قاعدة تطابق حين تتطابق كل حقولها المحددة. */
  function checkNetwork(req, bssidRaw) {
    const ip = clientIp(req);
    const bssid = normBssid(bssidRaw);
    const s = settings();
    const nets = networks().filter(n => n.is_active);
    const match = nets.find(n => (!n.bssid || n.bssid === bssid) && (!n.ip || ipMatch(n.ip, ip)));
    if (!s.enforceNetwork) return { ok: true, ip, bssid, network: match || null, enforced: false };
    if (!nets.length) return { ok: false, ip, bssid, error: 'لم تُضبط شبكات المحل بعد — راجع الإدارة' };
    if (match) return { ok: true, ip, bssid, network: match, enforced: true };
    const needsBssid = nets.some(n => n.bssid);
    return {
      ok: false,
      ip,
      bssid,
      error: !bssid && needsBssid ? 'تعذر قراءة شبكة الواي فاي — اتصل بواي فاي المحل واسمح للتطبيق بالموقع' : 'أنت لست على شبكة المحل — اتصل بواي فاي المحل ثم حاول مجدداً',
    };
  }

  /* ── الحضور ── */
  const todayRow = staffId => db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(staffId, iraqDate());
  const openBreak = attId => db.prepare('SELECT * FROM breaks WHERE attendance_id = ? AND end_at IS NULL').get(attId);
  const breaksOf = attId => db.prepare('SELECT * FROM breaks WHERE attendance_id = ? ORDER BY id').all(attId);
  const usedMinutes = list => list.reduce((s, b) => s + Math.round(((b.end_at ? Date.parse(b.end_at) : Date.now()) - Date.parse(b.start_at)) / 60_000), 0);
  const breakView = b => ({
    id: b.id,
    startAt: b.start_at,
    endAt: b.end_at,
    plannedMinutes: b.planned_minutes,
    endsAt: new Date(Date.parse(b.start_at) + b.planned_minutes * 60_000).toISOString(),
    overMinutes: b.end_at ? b.over_minutes : Math.max(0, Math.round((Date.now() - Date.parse(b.start_at)) / 60_000 - b.planned_minutes)),
  });
  function attView(a) {
    if (!a) return null;
    const list = breaksOf(a.id);
    const end = a.check_out ? Date.parse(a.check_out) : Date.now();
    const breakMin = usedMinutes(list);
    return {
      id: a.id,
      date: a.date,
      checkIn: a.check_in,
      checkOut: a.check_out,
      lateMinutes: a.late_minutes,
      autoClosed: !!a.auto_closed,
      edited: !!a.edited_by,
      note: a.note,
      workedMinutes: Math.max(0, Math.round((end - Date.parse(a.check_in)) / 60_000) - breakMin),
      breakMinutes: breakMin,
      overMinutes: list.reduce((s, b) => s + (b.end_at ? b.over_minutes : breakView(b).overMinutes), 0),
      breaks: list.map(breakView),
    };
  }

  function myState(s) {
    const shift = shiftOf(s.id);
    const a = todayRow(s.id);
    const view = attView(a);
    const used = view?.breakMinutes ?? 0;
    const history = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date < ? ORDER BY date DESC LIMIT 14').all(s.id, iraqDate()).map(attView);
    const day = dayFor(s.id, iraqDate());
    const nets = networks().filter(n => n.is_active);
    return {
      now: now(),
      today: iraqDate(),
      day,
      shift,
      attendance: view,
      openBreak: view?.breaks.find(b => !b.endAt) ?? null,
      breakLeftMinutes: Math.max(0, shift.breakMinutes - used),
      breaksLeft: Math.max(0, shift.maxBreaks - (view?.breaks.length ?? 0)),
      history,
      network: { enforced: settings().enforceNetwork, configured: nets.length > 0, needsBssid: nets.some(n => n.bssid) },
    };
  }

  function checkIn(req, s, body) {
    const net = checkNetwork(req, body.bssid);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    if (todayRow(s.id)) return { status: 409, body: { error: 'سجّلت حضورك اليوم مسبقاً' } };
    const shift = shiftOf(s.id);
    const st = settings();
    const startMin = hm(shift.start) ?? 600;
    const nowMin = iraqMinutes();
    if (nowMin < startMin - st.earlyMinutes) return { status: 400, body: { error: `الحضور يبدأ قبل الدوام بـ ${st.earlyMinutes} دقيقة فقط (دوامك ${shift.start})` } };
    const lateRaw = nowMin - startMin;
    const late = lateRaw > st.graceMinutes ? lateRaw : 0;
    const t = now();
    const r = db.prepare('INSERT INTO attendance (staff_id, date, check_in, in_ip, in_bssid, network_id, device_id, late_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.id, iraqDate(), t, net.ip, net.bssid, net.network?.id ?? null, String(body.deviceId || '').slice(0, 120) || null, late);
    audit(`staff:${s.id}`, 'attend.in', Number(r.lastInsertRowid), { ip: net.ip, bssid: net.bssid, late });
    if (late > 0) notify('manager', managerIds(), { type: 'attend.late', title: `تأخر ${s.name} ${late} دقيقة`, body: `سجّل حضوره ${new Date(Date.parse(t) + IRAQ_MS).toISOString().slice(11, 16)} — دوامه ${shift.start}`, link: '/attend' });
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  function checkOut(req, s, body) {
    const a = todayRow(s.id);
    if (!a) return { status: 400, body: { error: 'لم تسجّل حضورك اليوم' } };
    if (a.check_out) return { status: 409, body: { error: 'سجّلت انصرافك مسبقاً' } };
    const net = checkNetwork(req, body.bssid);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    const t = now();
    const ob = openBreak(a.id);
    if (ob) closeBreak(ob, t);
    db.prepare('UPDATE attendance SET check_out = ?, out_ip = ?, out_bssid = ? WHERE id = ?').run(t, net.ip, net.bssid, a.id);
    audit(`staff:${s.id}`, 'attend.out', a.id, { ip: net.ip });
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  function closeBreak(b, t) {
    const mins = (Date.parse(t) - Date.parse(b.start_at)) / 60_000;
    const over = Math.max(0, Math.round(mins - b.planned_minutes));
    db.prepare('UPDATE breaks SET end_at = ?, over_minutes = ? WHERE id = ?').run(t, over, b.id);
    return over;
  }

  function breakStart(req, s, body) {
    const a = todayRow(s.id);
    if (!a || a.check_out) return { status: 400, body: { error: 'سجّل حضورك أولاً' } };
    if (openBreak(a.id)) return { status: 409, body: { error: 'أنت في استراحة الآن' } };
    const net = checkNetwork(req, body.bssid);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    const shift = shiftOf(s.id);
    const list = breaksOf(a.id);
    if (list.length >= shift.maxBreaks) return { status: 400, body: { error: `استنفدت عدد الاستراحات اليوم (${shift.maxBreaks})` } };
    const left = shift.breakMinutes - usedMinutes(list);
    if (left <= 0) return { status: 400, body: { error: 'استنفدت رصيد الاستراحة اليوم' } };
    const r = db.prepare('INSERT INTO breaks (attendance_id, staff_id, start_at, planned_minutes, ip, bssid) VALUES (?, ?, ?, ?, ?, ?)').run(a.id, s.id, now(), left, net.ip, net.bssid);
    audit(`staff:${s.id}`, 'break.start', Number(r.lastInsertRowid), { left });
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  function breakEnd(req, s, body) {
    const a = todayRow(s.id);
    const b = a ? openBreak(a.id) : null;
    if (!b) return { status: 400, body: { error: 'لست في استراحة' } };
    const net = checkNetwork(req, body.bssid);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    const over = closeBreak(b, now());
    audit(`staff:${s.id}`, 'break.end', b.id, { over });
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  /* ── لوحة اليوم للمدير/الإدارة ── */
  function board(allow = () => true) {
    const date = iraqDate();
    const nowMin = iraqMinutes();
    const staff = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY name').all().filter(s => allow(s.id));
    const st = settings();
    const rows = staff.map(s => {
      const shift = shiftOf(s.id);
      const a = attView(todayRow(s.id));
      const day = dayFor(s.id, date);
      let status;
      if (a) {
        const ob = a.breaks.find(b => !b.endAt);
        status = a.checkOut ? 'out' : ob ? (ob.overMinutes > 0 ? 'over' : 'break') : 'in';
      } else if (day?.off) status = 'off';
      else if (nowMin < (hm(shift.start) ?? 600) + st.graceMinutes) status = 'soon';
      else if (nowMin > (hm(shift.end) ?? 1320)) status = 'absent';
      else status = 'missing';
      return { staffId: s.id, name: s.name, kind: s.kind, sectionName: s.section_name, shift, day, status, attendance: a };
    });
    const count = k => rows.filter(r => r.status === k).length;
    return {
      date,
      now: now(),
      rows,
      counts: { in: count('in'), break: count('break') + count('over'), over: count('over'), out: count('out'), off: count('off'), missing: count('missing') + count('absent'), soon: count('soon'), late: rows.filter(r => (r.attendance?.lateMinutes ?? 0) > 0).length },
      network: { enforced: st.enforceNetwork, count: networks().filter(n => n.is_active).length },
    };
  }

  function log(url, allow = () => true) {
    const from = url.searchParams.get('from') || iraqDate(Date.now() - 30 * 86_400_000);
    const to = url.searchParams.get('to') || iraqDate();
    const staffId = Number(url.searchParams.get('staffId') || 0);
    const rows = staffId
      ? db.prepare('SELECT * FROM attendance WHERE date BETWEEN ? AND ? AND staff_id = ? ORDER BY date DESC, check_in').all(from, to, staffId)
      : db.prepare('SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC, check_in').all(from, to);
    const names = new Map(db.prepare('SELECT id, name, kind, section_name FROM staff').all().map(s => [s.id, s]));
    return rows.filter(r => allow(r.staff_id)).map(r => {
      const v = attView(r);
      const s = names.get(r.staff_id);
      return { ...v, staffId: r.staff_id, staffName: s?.name ?? '—', staffKind: s?.kind ?? null, sectionName: s?.section_name ?? null, inIp: r.in_ip, inBssid: r.in_bssid, editedBy: r.edited_by };
    });
  }

  function correct(id, body, actor) {
    const a = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
    if (!a) return { status: 404, body: { error: 'السجل غير موجود' } };
    const ci = body.checkIn && !Number.isNaN(Date.parse(body.checkIn)) ? new Date(body.checkIn).toISOString() : a.check_in;
    const co = body.checkOut === null ? null : body.checkOut && !Number.isNaN(Date.parse(body.checkOut)) ? new Date(body.checkOut).toISOString() : a.check_out;
    if (co && co <= ci) return { status: 400, body: { error: 'وقت الانصراف قبل الحضور' } };
    const shift = shiftOf(a.staff_id);
    const lateRaw = iraqMinutes(Date.parse(ci)) - (hm(shift.start) ?? 600);
    const late = lateRaw > settings().graceMinutes ? lateRaw : 0;
    db.prepare('UPDATE attendance SET check_in = ?, check_out = ?, late_minutes = ?, note = ?, edited_by = ?, edited_at = ?, auto_closed = CASE WHEN ? IS NULL THEN auto_closed ELSE 0 END WHERE id = ?')
      .run(ci, co, late, String(body.note || a.note || '').slice(0, 300) || null, actor, now(), co, id);
    audit(actor, 'attend.correct', id, { from: { in: a.check_in, out: a.check_out }, to: { in: ci, out: co }, note: body.note });
    emit(`staff:${a.staff_id}`, 'attend', { id });
    emitManagers('attend', { staffId: a.staff_id });
    return { status: 200, body: attView(db.prepare('SELECT * FROM attendance WHERE id = ?').get(id)) };
  }

  function manual(body, actor) {
    const staffId = Number(body.staffId);
    if (!getStaff(staffId)) return { status: 404, body: { error: 'الموظف غير موجود' } };
    const ci = Date.parse(body.checkIn);
    if (Number.isNaN(ci)) return { status: 400, body: { error: 'وقت الحضور مطلوب' } };
    const date = iraqDate(ci);
    if (db.prepare('SELECT id FROM attendance WHERE staff_id = ? AND date = ?').get(staffId, date)) return { status: 409, body: { error: 'يوجد سجل لهذا اليوم — عدّله بدلاً من إضافة جديد' } };
    const r = db.prepare("INSERT INTO attendance (staff_id, date, check_in, note, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(staffId, date, new Date(ci).toISOString(), String(body.note || 'إضافة يدوية').slice(0, 300), actor, now());
    return correct(Number(r.lastInsertRowid), { checkIn: body.checkIn, checkOut: body.checkOut, note: body.note || 'إضافة يدوية' }, actor);
  }

  /* ── المؤقت: الاستراحات والإغلاق التلقائي ── */
  function tick() {
    try {
      const st = settings();
      const open = db.prepare('SELECT b.*, s.name AS staff_name FROM breaks b JOIN staff s ON s.id = b.staff_id WHERE b.end_at IS NULL').all();
      for (const b of open) {
        const elapsed = (Date.now() - Date.parse(b.start_at)) / 60_000;
        const left = b.planned_minutes - elapsed;
        // warned: بت 1 = تنبيه قبل النهاية، بت 2 = أُبلغ المدراء بالتجاوز
        if (!(b.warned & 1) && st.breakWarnMinutes > 0 && left <= st.breakWarnMinutes && left > 0) {
          db.prepare('UPDATE breaks SET warned = warned | 1 WHERE id = ?').run(b.id);
          notify('staff', [b.staff_id], { type: 'break.warn', title: `تنتهي استراحتك بعد ${Math.ceil(left)} دقيقة`, body: 'استعد للعودة لمكان عملك', link: '/shift' });
        }
        if (left <= 0) {
          const over = Math.floor(-left);
          // للموظف: عند الانتهاء ثم كل 5 دقائق تجاوز؛ للمدراء: مرة واحدة بعد دقيقتين
          const step = Math.floor(over / 5) + 1;
          if (b.over_notified < step) {
            db.prepare('UPDATE breaks SET over_notified = ? WHERE id = ?').run(step, b.id);
            notify('staff', [b.staff_id], { type: 'break.over', title: over > 0 ? `تجاوزت الاستراحة ${over} دقيقة` : 'انتهت استراحتك', body: 'سجّل عودتك من الاستراحة الآن', link: '/shift' });
          }
          if (over >= 2 && !(b.warned & 2)) {
            db.prepare('UPDATE breaks SET warned = warned | 2 WHERE id = ?').run(b.id);
            notify('manager', managerIds(), { type: 'break.over', title: `${b.staff_name} تجاوز الاستراحة`, body: `تجاوز ${over} دقيقة ولم يسجّل عودته`, link: '/attend' });
            emitManagers('attend', { staffId: b.staff_id });
          }
        }
      }
      // حضور منسي: يُغلق بعد نهاية الدوام بعدة ساعات (أو أيام سابقة)
      const openAtt = db.prepare('SELECT * FROM attendance WHERE check_out IS NULL').all();
      for (const a of openAtt) {
        const shift = shiftOf(a.staff_id);
        let endMin = hm(shift.end) ?? 1320;
        if (endMin <= (hm(shift.start) ?? 600)) endMin += 1440;
        const closeAt = atIraq(a.date, endMin);
        if (Date.now() >= closeAt + st.autoCloseHours * 3600_000) {
          const t = new Date(closeAt).toISOString();
          const ob = openBreak(a.id);
          if (ob) closeBreak(ob, new Date(Math.max(closeAt, Date.parse(ob.start_at))).toISOString());
          db.prepare('UPDATE attendance SET check_out = ?, auto_closed = 1 WHERE id = ?').run(t, a.id);
          audit('system', 'attend.autoclose', a.id, { at: t });
          notify('staff', [a.staff_id], { type: 'attend.auto', title: 'أُغلق حضورك تلقائياً', body: `لم تسجّل انصرافك — اعتُمد نهاية الدوام ${shift.end}. راجع مديرك إن كان خطأ.`, link: '/shift' });
        }
      }
    } catch (err) {
      console.error('attend tick failed', err.message);
    }
  }
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();

  /* ── المسارات ── */
  async function json(req) {
    try {
      return JSON.parse((await ctx.readBody(req)) || '{}');
    } catch {
      return null;
    }
  }
  const reply = (res, out, open) => (open ? ctx.sendOpen : ctx.send)(res, out.status, out.body);

  async function handleStaff(req, res, url, s) {
    const p = url.pathname;
    if (!p.startsWith('/api/team/attend')) return false;
    if (req.method === 'GET' && p === '/api/team/attend') return ctx.send(res, 200, myState(s)), true;
    if (req.method === 'GET' && p === '/api/team/attend/probe') {
      const net = checkNetwork(req, url.searchParams.get('bssid'));
      ctx.send(res, 200, { ok: net.ok, ip: net.ip, network: net.network ? net.network.name : null, error: net.ok ? null : net.error });
      return true;
    }
    const body = req.method === 'POST' ? (await json(req)) || {} : {};
    if (req.method === 'POST' && p === '/api/team/attend/in') return reply(res, checkIn(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/out') return reply(res, checkOut(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/break/start') return reply(res, breakStart(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/break/end') return reply(res, breakEnd(req, s, body)), true;
    return false;
  }

  async function handleManage(req, res, url, sub, actor, open, allow = () => true) {
    const send = (st, b) => (open ? ctx.sendOpen : ctx.send)(res, st, b);
    if (req.method === 'GET' && sub === 'attend/board') return send(200, board(allow)), true;
    if (req.method === 'GET' && sub === 'attend/log') return send(200, log(url, allow)), true;
    if (req.method === 'GET' && sub === 'attend/settings') return send(200, { settings: settings(), networks: networks().map(netView) }), true;
    if (req.method === 'PUT' && sub === 'attend/settings') return send(200, saveSettings((await json(req)) || {}, actor)), true;
    if (req.method === 'POST' && sub === 'attend/manual') {
      const body = (await json(req)) || {};
      return reply(res, allow(Number(body.staffId)) ? manual(body, actor) : { status: 403, body: { error: 'هذا الموظف خارج أقسامك' } }, open), true;
    }
    let m = sub.match(/^attend\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const rec = db.prepare('SELECT staff_id FROM attendance WHERE id = ?').get(Number(m[1]));
      if (rec && !allow(rec.staff_id)) return reply(res, { status: 403, body: { error: 'هذا الموظف خارج أقسامك' } }, open), true;
      return reply(res, correct(Number(m[1]), (await json(req)) || {}, actor), open), true;
    }
    if (req.method === 'POST' && sub === 'networks') return reply(res, saveNetwork(null, (await json(req)) || {}, actor), open), true;
    m = sub.match(/^networks\/(\d+)$/);
    if (m && req.method === 'PUT') return reply(res, saveNetwork(Number(m[1]), (await json(req)) || {}, actor), open), true;
    if (m && req.method === 'DELETE') {
      db.prepare('DELETE FROM networks WHERE id = ?').run(Number(m[1]));
      audit(actor, 'network.delete', Number(m[1]), null);
      return send(200, { ok: true }), true;
    }
    // المدير داخل المحل: التقاط شبكته الحالية (BSSID من هاتفه + IP كما يراه الخادم)
    if (req.method === 'POST' && sub === 'networks/capture') {
      const body = (await json(req)) || {};
      const ip = clientIp(req);
      const bssid = normBssid(body.bssid);
      if (!bssid && !body.ipOnly) return send(400, { error: 'تعذر قراءة BSSID — فعّل الموقع واتصل بواي فاي المحل' }), true;
      return reply(res, saveNetwork(null, { name: body.name || body.ssid || 'واي فاي المحل', bssid: body.ipOnly ? null : bssid, ip: body.withIp === false ? null : ip, ssid: body.ssid }, actor), open), true;
    }
    if (req.method === 'GET' && sub === 'networks/probe') {
      const net = checkNetwork(req, url.searchParams.get('bssid'));
      return send(200, { ok: net.ok, ip: net.ip, bssid: net.bssid, network: net.network ? net.network.name : null, error: net.ok ? null : net.error }), true;
    }
    m = sub.match(/^staff\/(\d+)\/shift$/);
    if (m && req.method === 'PUT') return reply(res, allow(Number(m[1])) ? setShift(Number(m[1]), (await json(req)) || {}, actor) : { status: 403, body: { error: 'هذا الموظف خارج أقسامك' } }, open), true;
    if (m && req.method === 'GET') return send(200, shiftOf(Number(m[1]))), true;
    return false;
  }

  return { handleStaff, handleManage, shiftOf, board, clientIp };
}

module.exports = { createAttend, clientIp, ipMatch, normBssid };
