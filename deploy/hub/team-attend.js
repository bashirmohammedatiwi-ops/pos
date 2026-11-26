'use strict';
const { HUB_VERSION } = require('./version');

/*
 * تطبيق الفريق — الحضور والانصراف والاستراحة (على خادم الـ VPS).
 *   · الشبكات المسموحة: BSSID للواي فاي و/أو عنوان IP العام للمحل (يقرؤه الخادم لا الهاتف).
 *   · الدوام: افتراضي عام + وردية لكل موظف + وقت خاص لكل يوم من أسبوعه؛ التأخير يُحسب بتوقيت العراق مع مهلة سماح.
 *   · كل سجل حضور يحفظ دوام يومه، فتغيير الدوام لاحقاً لا يغيّر حساب الأيام الماضية.
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
  // يجب أن يطابق عنوان الإنترنت قاعدةً (BSSID وحده يمكن تزويره)
  requireIp: true,
  // هاتف لا يقرأ نقطة البث (إذن الموقع أو الموقع مطفأ) يُقبل إن جاء من عنوان إنترنت المحل المؤكد حديثاً
  allowIpOnly: true,
  // الأوفر تايم (للموظفين المفعّل لهم فقط)
  otMinMinutes: 15,
  otRoundMinutes: 15,
  otCountDayOff: true,
};

const iraqDate = (ms = Date.now()) => new Date(ms + IRAQ_MS).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hm = s => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** لحظة (UTC ms) لوقت «HH:MM» بتوقيت العراق في يوم معيّن؛ النهاية بعد منتصف الليل تُحسب لليوم التالي. */
const atIraq = (date, minutes) => Date.parse(`${date}T00:00:00Z`) - IRAQ_MS + minutes * 60_000;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const HOURLY_CLOSE_GRACE_MS = 8 * 3600_000;
const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
/** 0 = السبت … 6 = الجمعة (نفس ترتيب العطلة الأسبوعية) */
const dayIdx = iso => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7;
/** دوام الأسبوع المخزَّن: مصفوفة من 7 أيام، واليوم الفارغ يتبع وردية الموظف */
function parseWeek(raw) {
  try {
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) && list.length === 7 && list.some(Boolean) ? list : null;
  } catch {
    return null;
  }
}

/** بداية ونهاية الوردية بالدقائق؛ النهاية <= البداية تعني وردية ليلية تنتهي في اليوم التالي. */
function shiftSpan(shift) {
  const start = hm(shift.start) ?? 600;
  let end = hm(shift.end) ?? 1320;
  if (end <= start) end += 1440;
  return { start, end };
}
/**
 * الوردية التي تخص لحظة ما: { date, start, end } (date = يوم بداية الوردية).
 * داخل نافذتها [البداية − مهلة الحضور المبكر، النهاية] هي هي؛ وبين ورديتين الأقرب: نهاية السابقة أم فتح التالية.
 * shiftFor(date) تعطي دوام ذلك اليوم لأنه قد يختلف من يوم لآخر.
 */
function shiftWindow(shiftFor, ms, earlyMinutes) {
  const early = earlyMinutes * 60_000;
  const today = iraqDate(ms);
  const list = [-1, 0, 1].map(k => {
    const date = addDays(today, k);
    const span = shiftSpan(shiftFor(date));
    return { date, start: atIraq(date, span.start), end: atIraq(date, span.end) };
  });
  const hit = list.find(w => ms >= w.start - early && ms <= w.end);
  if (hit) return hit;
  const prev = list.filter(w => w.end < ms).pop();
  const next = list.find(w => w.start - early > ms);
  if (!prev || !next) return prev || next;
  return ms - prev.end <= next.start - early - ms ? prev : next;
}

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
/** الشبكة /24 لعنوان IPv4: مزوّد الإنترنت يبدّل عنوان المحل داخلها عدة مرات في اليوم */
const net24 = ip => {
  const p = String(ip || '').split('.');
  return p.length === 4 ? p.slice(0, 3).join('.') : null;
};
const SHOP_IP_FRESH_MS = 30 * 60_000;
const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/;
/** عنوان المرسل الحقيقي: نثق بترويسة البوابة فقط إذا جاء الطلب من شبكة Docker الداخلية. */
function clientIp(req) {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  // البوابة (nginx) حاوية بعنوان داخلي؛ ‎.1 هو عنوان جسر Docker الذي يمرّر الاتصالات الخارجية المباشرة فلا نثق به
  if (/^127\./.test(remote) || (PRIVATE.test(remote) && !/\.1$/.test(remote))) {
    const h = String(req.headers['x-real-ip'] || '').trim().replace(/^::ffff:/, '');
    if (h) return h;
  }
  return remote;
}

function createAttend({ db, ctx, now, audit, getStaff, notify, managerIds, emit, emitManagers, dayFor, planOf, rateOn, notifySupervisors }) {
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
    // الأوفر تايم لكل موظف: تفعيل + سعر الساعة (اختياري)
    `ALTER TABLE staff_shift ADD COLUMN overtime INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE staff_shift ADD COLUMN overtime_rate INTEGER;`,
    // الشبكة الواحدة بكل نقاط بثها (راوتر + مقويات + نطاقا 2.4/5 GHz)
    `ALTER TABLE networks ADD COLUMN bssids TEXT;
     UPDATE networks SET bssids = json_array(bssid) WHERE bssid IS NOT NULL;`,
    // دوام كل يوم من الأسبوع لكل موظف، ودوام اليوم محفوظاً في سجل الحضور
    `ALTER TABLE staff_shift ADD COLUMN week TEXT;
     ALTER TABLE attendance ADD COLUMN shift_start TEXT;
     ALTER TABLE attendance ADD COLUMN shift_end TEXT;
     ALTER TABLE attendance ADD COLUMN shift_break INTEGER;`,
    // بصمة المدراء: بالساعات، عدة فترات في اليوم (دخول/خروج)، بلا وردية ولا تأخير
    `CREATE TABLE manager_attendance (
       id INTEGER PRIMARY KEY AUTOINCREMENT, manager_id INTEGER NOT NULL, date TEXT NOT NULL,
       check_in TEXT NOT NULL, check_out TEXT, in_ip TEXT, in_bssid TEXT, out_ip TEXT, out_bssid TEXT,
       auto_closed INTEGER NOT NULL DEFAULT 0, note TEXT, edited_by TEXT, edited_at TEXT
     );
     CREATE INDEX ix_mattend_mgr ON manager_attendance(manager_id, date);
     CREATE INDEX ix_mattend_date ON manager_attendance(date);`,
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

  // السجلات الأقدم من حفظ الدوام تأخذ الدوام الساري قبل أول تعديل على الأسبوع، فلا يتغير ما حُسب لها
  {
    const d = settings();
    const pick = col => `(SELECT ${col} FROM staff_shift x WHERE x.staff_id = attendance.staff_id)`;
    db.prepare(`UPDATE attendance SET shift_start = COALESCE(${pick('start')}, ?), shift_end = COALESCE(${pick('end')}, ?), shift_break = COALESCE(${pick('break_minutes')}, ?) WHERE shift_start IS NULL`).run(d.shiftStart, d.shiftEnd, d.breakMinutes);
  }

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
    num('otMinMinutes', 0, 240);
    num('otRoundMinutes', 1, 60);
    if (typeof body.otCountDayOff === 'boolean') next.otCountDayOff = body.otCountDayOff;
    if (typeof body.requireIp === 'boolean') next.requireIp = body.requireIp;
    if (typeof body.allowIpOnly === 'boolean') next.allowIpOnly = body.allowIpOnly;
    db.prepare("INSERT INTO settings (key, value) VALUES ('attend', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
    audit(actor, 'attend.settings', null, next);
    return next;
  }
  /** دوام الموظف في يوم معيّن: وقت ذلك اليوم إن حُدّد، وإلا ورديته، وإلا الافتراضي العام */
  function shiftOf(staffId, date = iraqDate()) {
    const s = settings();
    const o = db.prepare('SELECT * FROM staff_shift WHERE staff_id = ?').get(staffId);
    const baseStart = o?.start || s.shiftStart;
    const baseEnd = o?.end || s.shiftEnd;
    const week = parseWeek(o?.week);
    const day = week?.[dayIdx(date)];
    return {
      start: day?.start || baseStart,
      end: day?.end || baseEnd,
      baseStart,
      baseEnd,
      week,
      breakMinutes: o?.break_minutes ?? s.breakMinutes,
      maxBreaks: o?.max_breaks ?? s.maxBreaks,
      custom: !!(o && (o.start || o.end || week || o.break_minutes != null || o.max_breaks != null)),
      // حساب بالساعات: بلا وردية ولا تأخير ولا أوفر تايم — كل ساعة مدفوعة
      hourly: planOf(staffId).plan === 'hourly',
      overtime: !!o?.overtime && planOf(staffId).plan !== 'hourly',
      overtimeRate: o?.overtime_rate ?? null,
    };
  }
  /** تفعيل/إيقاف الأوفر تايم لموظف وسعر ساعته — مستقل عن الوردية */
  function setOvertime(staffId, body, actor) {
    if (!getStaff(staffId)) return { status: 404, body: { error: 'الموظف غير موجود' } };
    const on = body.enabled ? 1 : 0;
    const rate = body.rate === '' || body.rate == null ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(body.rate)) || 0));
    db.prepare(`INSERT INTO staff_shift (staff_id, overtime, overtime_rate, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(staff_id) DO UPDATE SET overtime = excluded.overtime, overtime_rate = excluded.overtime_rate, updated_at = excluded.updated_at`).run(staffId, on, rate, now());
    audit(actor, 'overtime.set', staffId, { enabled: !!on, rate });
    emit(`staff:${staffId}`, 'attend', { overtime: true });
    return { status: 200, body: shiftOf(staffId) };
  }
  /** دوام سجل حضور كما حُفظ يومها؛ الدوام الحالي لا يغيّر حساب يوم مضى */
  const rowShift = a => {
    const sh = shiftOf(a.staff_id, a.date);
    return { ...sh, start: a.shift_start || sh.start, end: a.shift_end || sh.end, plannedBreak: a.shift_break ?? sh.breakMinutes };
  };
  /** دقائق الأوفر تايم ليوم: العمل الفعلي ناقص الدوام الصافي (أو كل العمل في يوم العطلة) */
  function overtimeOf(staffId, date, workedMinutes, row) {
    const sh = row ? rowShift(row) : shiftOf(staffId, date);
    if (!sh.overtime) return 0;
    const st = settings();
    const day = dayFor(staffId, date);
    let raw;
    if (day?.off) {
      if (!st.otCountDayOff) return 0;
      raw = workedMinutes;
    } else {
      const span = shiftSpan(sh);
      raw = workedMinutes - Math.max(0, span.end - span.start - (sh.plannedBreak ?? sh.breakMinutes));
    }
    if (raw < st.otMinMinutes || raw <= 0) return 0;
    const r = Math.max(1, st.otRoundMinutes);
    return Math.floor(raw / r) * r;
  }
  /** يفحص دوام الأسبوع: أيام فارغة أو { start, end }، ولا يتداخل دوام يوم مع بداية اليوم التالي */
  function readWeek(raw, baseStart, baseEnd) {
    if (raw == null) return { week: null };
    if (!Array.isArray(raw) || raw.length !== 7) return { error: 'دوام الأسبوع غير صالح' };
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = raw[i];
      if (!d) {
        week.push(null);
        continue;
      }
      if (!isTime(d.start) || !isTime(d.end)) return { error: `وقت ${DAY_NAMES[i]} غير صالح` };
      if (d.start === d.end) return { error: `بداية ${DAY_NAMES[i]} ونهايته متساويتان` };
      week.push({ start: d.start, end: d.end });
    }
    const base = { start: baseStart, end: baseEnd };
    for (let i = 0; i < 7; i++) {
      const k = (i + 1) % 7;
      if (!week[i] && !week[k]) continue;
      if (shiftSpan(week[i] || base).end - 1440 > shiftSpan(week[k] || base).start) return { error: `دوام ${DAY_NAMES[i]} ينتهي بعد بداية دوام ${DAY_NAMES[k]}` };
    }
    return { week: week.some(Boolean) ? week : null };
  }
  /** تعديل الدوام يسري على الحضور المفتوح ويوم الوردية الحالية، أما الأيام الماضية فتبقى كما هي */
  function refreshRows(staffId) {
    const rows = db.prepare('SELECT id, date FROM attendance WHERE staff_id = ? AND (check_out IS NULL OR date >= ?)').all(staffId, windowOf(staffId).date);
    for (const r of rows) {
      const sh = shiftOf(staffId, r.date);
      db.prepare('UPDATE attendance SET shift_start = ?, shift_end = ?, shift_break = ? WHERE id = ?').run(sh.start, sh.end, sh.breakMinutes, r.id);
    }
  }
  /** الأسبوع كما سيراه الموظف، للمقارنة ولنص التبليغ؛ أيام العطلة الأسبوعية لا تظهر */
  function weekText(staffId) {
    const today = iraqDate();
    const days = Array.from({ length: 7 }, (_, k) => addDays(today, k)).sort((a, b) => dayIdx(a) - dayIdx(b));
    const list = days.filter(d => !['weekly', 'swap'].includes(dayFor(staffId, d)?.reason)).map(d => ({ name: DAY_NAMES[dayIdx(d)], ...shiftOf(staffId, d) }));
    if (list.length && list.every(d => d.start === list[0].start && d.end === list[0].end)) return `${list[0].start} – ${list[0].end}`;
    return list.map(d => `${d.name} ${d.start} – ${d.end}`).join('، ');
  }
  function setShift(staffId, body, actor) {
    if (!getStaff(staffId)) return { status: 404, body: { error: 'الموظف غير موجود' } };
    const before = weekText(staffId);
    const done = () => {
      refreshRows(staffId);
      const text = weekText(staffId);
      if (text !== before && planOf(staffId).plan !== 'hourly') notify('staff', [staffId], { type: 'schedule', title: 'تم تحديث وقت دوامك', body: text, link: '/shift' });
      emit(`staff:${staffId}`, 'attend', { shift: true });
      return { status: 200, body: shiftOf(staffId) };
    };
    if (body.reset) {
      db.prepare('UPDATE staff_shift SET start = NULL, end = NULL, break_minutes = NULL, max_breaks = NULL, week = NULL WHERE staff_id = ?').run(staffId);
      audit(actor, 'shift.reset', staffId, null);
      return done();
    }
    const cur = db.prepare('SELECT * FROM staff_shift WHERE staff_id = ?').get(staffId);
    const curWeek = parseWeek(cur?.week);
    let start = isTime(body.start) ? body.start : null;
    let end = isTime(body.end) ? body.end : null;
    let week = curWeek;
    if (body.week !== undefined) {
      const st = settings();
      const read = readWeek(body.week, start || st.shiftStart, end || st.shiftEnd);
      if (read.error) return { status: 400, body: { error: read.error } };
      week = read.week;
    } else if (curWeek) {
      // نسخ التطبيق الحالية لا تعرف الأسبوع وترسل دوام اليوم؛ الاستراحة تُحفظ ولا يُستبدل الأسبوع بوقت يوم واحد
      const day = shiftOf(staffId, windowOf(staffId).date);
      if ((start && start !== day.start) || (end && end !== day.end)) return { status: 409, body: { error: 'دوام هذا الموظف يختلف حسب الأيام — عدّل أوقاته من لوحة التحكم' } };
      start = cur.start;
      end = cur.end;
    }
    const bm = body.breakMinutes === '' || body.breakMinutes == null ? null : Math.max(0, Math.min(240, Math.round(Number(body.breakMinutes))));
    const mb = body.maxBreaks === '' || body.maxBreaks == null ? null : Math.max(0, Math.min(10, Math.round(Number(body.maxBreaks))));
    const json = week ? JSON.stringify(week) : null;
    db.prepare(`INSERT INTO staff_shift (staff_id, start, end, break_minutes, max_breaks, week, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id) DO UPDATE SET start=excluded.start, end=excluded.end, break_minutes=excluded.break_minutes, max_breaks=excluded.max_breaks, week=excluded.week, updated_at=excluded.updated_at`)
      .run(staffId, start, end, Number.isFinite(bm) ? bm : null, Number.isFinite(mb) ? mb : null, json, now());
    audit(actor, 'shift.set', staffId, { start, end, bm, mb, week });
    return done();
  }

  /* ── الشبكات ── */
  const networks = () => db.prepare('SELECT * FROM networks ORDER BY id').all();
  /** نقاط بث الشبكة (القديمة كانت BSSID واحداً) */
  const bssidsOf = n => {
    try {
      const list = JSON.parse(n.bssids || '[]');
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* قيمة قديمة */
    }
    return n.bssid ? [n.bssid] : [];
  };

  /* عنوان إنترنت المحل كما يراه الخادم: يُتعلَّم تلقائياً من مزامنة سيرفر المحل (كل دقيقة)
     ومن التقاط مدير لشبكته داخل المحل. الشبكة بلا عنوان ثابت تتبعه — فيتحدث وحده إن غيّر مزوّد الإنترنت العنوان. */
  function shopIp() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'shop_ip'").get();
    try {
      return row ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  }
  function noteShopIp(ip, source) {
    if (!ip || PRIVATE.test(ip) || ipToInt(ip) == null) return;
    const cur = shopIp();
    // كتابة عند التغيّر، أو كل 10 دقائق لتحديث «آخر ظهور»
    if (cur && cur.ip === ip && Date.now() - Date.parse(cur.at) < 10 * 60_000) return;
    // نحفظ العناوين السابقة: قد يتغير العنوان وسيرفر المحل مطفأ فلا يصلنا الجديد إلا بعد تشغيله
    const recent = [...new Set([...(cur && cur.ip !== ip ? [cur.ip] : []), ...(cur?.recent ?? [])])].slice(0, 10);
    db.prepare("INSERT INTO settings (key, value) VALUES ('shop_ip', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ip, at: now(), source, recent }));
    if (cur && cur.ip !== ip) audit('system', 'shop_ip.changed', null, { from: cur.ip, to: ip, source });
  }

  /* عناوين إنترنت أكّدها حضور من نقطة بث المحل نفسها (هاتف قرأ الواي فاي): تقبل من لا يقرأ الواي فاي
     (الموقع، بعض الهواتف) على نفس العنوان حتى لو لم يتصل سيرفر المحل بعد — صباحاً قبل تشغيله مثلاً.
     تُقبل فقط إن كانت من شبكة عناوين المحل (/24) كي لا يُعتمد عنوان VPN أو بيانات الهاتف. */
  // 24 ساعة: عنوان أكّدته الهواتف مساءً يبقى صالحاً حين يفتح المحل صباحاً ولو قبل تشغيل سيرفر المحل
  const VERIFIED_MS = 24 * 3600_000;
  function verifiedIps() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'verified_ips'").get();
    try {
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  }
  function noteVerifiedIp(ip) {
    if (!ip || PRIVATE.test(ip) || ipToInt(ip) == null) return;
    const map = verifiedIps();
    const last = map[ip] ? Date.parse(map[ip]) : 0;
    if (Date.now() - last < 10 * 60_000) return;
    map[ip] = now();
    for (const [k, v] of Object.entries(map)) if (Date.now() - Date.parse(v) > VERIFIED_MS) delete map[k];
    db.prepare("INSERT INTO settings (key, value) VALUES ('verified_ips', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(map));
  }

  const netView = n => {
    const list = bssidsOf(n);
    return { id: n.id, name: n.name, bssid: list[0] ?? null, bssids: list, ip: n.ip, ipMode: n.ip ? 'fixed' : 'auto', ssid: n.ssid, isActive: !!n.is_active, createdBy: n.created_by, createdAt: n.created_at };
  };
  function saveNetwork(id, body, actor) {
    const name = String(body.name || '').trim().slice(0, 80);
    const raw = [...(Array.isArray(body.bssids) ? body.bssids : []), ...(body.bssid ? [body.bssid] : [])].map(String).filter(x => x.trim());
    const bad = raw.find(x => !normBssid(x));
    if (bad) return { status: 400, body: { error: `BSSID غير صالح: ${bad.slice(0, 40)} (مثال: a4:2b:b0:12:34:56)` } };
    const list = [...new Set(raw.map(normBssid))].slice(0, 64);
    const ip = body.ip ? String(body.ip).trim().slice(0, 50) : null;
    if (ip && ipToInt(ip.split('/')[0]) == null) return { status: 400, body: { error: 'عنوان IP غير صالح' } };
    if (!list.length && !ip) return { status: 400, body: { error: 'أضف نقطة بث (BSSID) واحدة على الأقل أو عنوان IP' } };
    if (!name) return { status: 400, body: { error: 'اسم الشبكة مطلوب' } };
    const ssid = body.ssid ? String(body.ssid).slice(0, 64) : null;
    const active = body.isActive === false ? 0 : 1;
    const json = list.length ? JSON.stringify(list) : null;
    if (id) {
      if (!db.prepare('SELECT id FROM networks WHERE id = ?').get(id)) return { status: 404, body: { error: 'الشبكة غير موجودة' } };
      db.prepare('UPDATE networks SET name=?, bssid=?, bssids=?, ip=?, ssid=?, is_active=? WHERE id=?').run(name, list[0] ?? null, json, ip, ssid, active, id);
      audit(actor, 'network.update', id, { name, bssids: list.length, ip });
    } else {
      const r = db.prepare('INSERT INTO networks (name, bssid, bssids, ip, ssid, is_active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, list[0] ?? null, json, ip, ssid, active, actor, now());
      id = Number(r.lastInsertRowid);
      audit(actor, 'network.create', id, { name, bssids: list.length, ip });
    }
    return { status: 200, body: netView(db.prepare('SELECT * FROM networks WHERE id = ?').get(id)) };
  }

  /** هل الطلب من شبكة المحل؟ كل قاعدة تطابق حين تتطابق كل حقولها المحددة. */
  function checkNetwork(req, bssidRaw, client = null) {
    const ip = clientIp(req);
    const web = client === 'web';
    const bssid = normBssid(bssidRaw);
    const s = settings();
    const nets = networks().filter(n => n.is_active);
    const shopInfo = shopIp();
    const shop = shopInfo?.ip ?? null;
    const ipNear = !!net24(ip) && [shop, ...(shopInfo?.recent ?? [])].some(x => net24(x) === net24(ip));
    // العنوان: الثابت إن حُدّد، وإلا عنوان المحل الحالي (يُتعلَّم تلقائياً).
    // نقطة بث مسجّلة مع عنوان من شبكة المحل نفسها تكفي: عنوان المحل المعروف قد يتأخر عن تبديل المزوّد
    const ipOk = n => (n.ip ? ipMatch(n.ip, ip) : !s.requireIp || (!!shop && ip === shop) || (ipNear && bssidsOf(n).length > 0));
    const apOk = n => {
      const list = bssidsOf(n);
      return !list.length || (!!bssid && list.includes(bssid));
    };
    const match = nets.find(n => apOk(n) && ipOk(n));
    // نقطة بث المحل نفسها من عنوان ضمن شبكة المحل: العنوان مؤكد لمن لا يقرأ الواي فاي
    if (match && bssid && bssidsOf(match).includes(bssid) && (ip === shop || ipNear)) noteVerifiedIp(ip);
    if (!s.enforceNetwork) return { ok: true, ip, bssid, network: match || null, enforced: false };
    if (!nets.length) return { ok: false, ip, bssid, error: 'لم تُضبط شبكات المحل بعد — راجع الإدارة' };
    if (match) return { ok: true, ip, bssid, network: match, enforced: true };
    const shopFresh = !!shop && ip === shop && Date.now() - Date.parse(shopInfo.at) < SHOP_IP_FRESH_MS;
    const verifiedAt = verifiedIps()[ip];
    const verified = !!verifiedAt && Date.now() - Date.parse(verifiedAt) < VERIFIED_MS && (ip === shop || ipNear);
    // بعض الهواتف (والموقع) لا تقرأ نقطة البث مع أنها على واي فاي المحل: عنوان إنترنت المحل نفسه يكفي حينها
    if (!bssid && s.allowIpOnly && (shopFresh || verified)) return { ok: true, ip, bssid, network: nets.find(n => !n.ip) || null, enforced: true, viaIp: true };
    if (web && !bssid) {
      if (!s.allowIpOnly) return { ok: false, ip, bssid, error: 'التسجيل من الموقع غير مفعّل — سجّل من تطبيق ديما على هاتفك' };
      if (!shop) return { ok: false, ip, bssid, error: 'عنوان إنترنت المحل غير معروف بعد — تأكد أن سيرفر المحل يعمل ثم حاول بعد دقيقة' };
      return { ok: false, ip, bssid, error: 'أنت لست على إنترنت المحل — اتصل بواي فاي المحل وأطفئ بيانات الهاتف ثم أعد المحاولة' };
    }
    // نقطة بث جديدة من أجهزة المحل نفسها (نفس أول 3 مقاطع) على عنوان المحل المؤكد حديثاً: تُضاف للشبكة تلقائياً
    const fresh = s.requireIp && shopFresh;
    const sibling = fresh && bssid ? nets.find(n => !n.ip && bssidsOf(n).some(b => b.slice(0, 8) === bssid.slice(0, 8))) : null;
    if (sibling && bssidsOf(sibling).length < 64) {
      const list = [...bssidsOf(sibling), bssid];
      db.prepare('UPDATE networks SET bssid = ?, bssids = ? WHERE id = ?').run(list[0], JSON.stringify(list), sibling.id);
      audit('system', 'network.learn', sibling.id, { bssid, ip });
      return { ok: true, ip, bssid, network: sibling, enforced: true };
    }
    const apMatch = bssid && nets.some(n => bssidsOf(n).includes(bssid));
    if (s.requireIp && apMatch && !shop && nets.some(n => !n.ip && bssidsOf(n).includes(bssid)))
      return { ok: false, ip, bssid, error: 'عنوان إنترنت المحل غير معروف بعد — تأكد أن سيرفر المحل متصل بالإنترنت ثم حاول بعد دقيقة' };
    if (s.requireIp && apMatch) return { ok: false, ip, bssid, error: 'واي فاي المحل صحيح لكن الإنترنت ليس إنترنت المحل — أطفئ بيانات الهاتف واتصل بواي فاي المحل' };
    const needsBssid = nets.some(n => bssidsOf(n).length);
    return {
      ok: false,
      ip,
      bssid,
      error: !bssid && needsBssid ? 'تعذر قراءة شبكة الواي فاي — اتصل بواي فاي المحل واسمح للتطبيق بالموقع' : 'أنت لست على شبكة المحل — اتصل بواي فاي المحل ثم حاول مجدداً',
    };
  }

  /* ── الحضور ── */
  const windowOf = (staffId, ms = Date.now()) => (planOf(staffId).plan === 'hourly' ? { date: iraqDate(ms), start: ms, end: ms } : shiftWindow(d => shiftOf(staffId, d), ms, settings().earlyMinutes));
  /**
   * سجل الوردية الجارية: الحضور المفتوح (آخر 24 ساعة — يعبر منتصف الليل)، وإلا سجل يوم الوردية الحالية.
   * الحضور المنسي الذي حان إغلاقه يُغلق هنا أولاً كي لا يحجب حضور الوردية التالية.
   */
  function currentRow(staffId) {
    const open = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND check_out IS NULL AND check_in >= ? ORDER BY check_in DESC LIMIT 1')
      .get(staffId, new Date(Date.now() - 86_400_000).toISOString());
    if (open && !autoClose(open)) return open;
    return db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(staffId, windowOf(staffId).date);
  }
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
      overtimeMinutes: overtimeOf(a.staff_id, a.date, Math.max(0, Math.round((end - Date.parse(a.check_in)) / 60_000) - breakMin), a),
      breakMinutes: breakMin,
      overMinutes: list.reduce((s, b) => s + (b.end_at ? b.over_minutes : breakView(b).overMinutes), 0),
      breaks: list.map(breakView),
    };
  }

  function myState(s) {
    const a = currentRow(s.id);
    const view = attView(a);
    const used = view?.breakMinutes ?? 0;
    // يوم الوردية لا يوم التقويم: وردية 18:00–02:00 تبقى «اليوم» بعد منتصف الليل
    const shiftDate = a?.date ?? windowOf(s.id).date;
    const shift = a ? rowShift(a) : shiftOf(s.id, shiftDate);
    const history = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date < ? ORDER BY date DESC LIMIT 14').all(s.id, shiftDate).map(attView);
    const day = dayFor(s.id, shiftDate);
    const nets = networks().filter(n => n.is_active);
    return {
      now: now(),
      server: HUB_VERSION,
      today: iraqDate(),
      shiftDate,
      day,
      shift,
      attendance: view,
      openBreak: view?.breaks.find(b => !b.endAt) ?? null,
      breakLeftMinutes: Math.max(0, shift.breakMinutes - used),
      breaksLeft: Math.max(0, shift.maxBreaks - (view?.breaks.length ?? 0)),
      history,
      network: { enforced: settings().enforceNetwork, configured: nets.length > 0, needsBssid: nets.some(n => n.bssid) },
      breakWarnMinutes: settings().breakWarnMinutes,
      overtime: shift.overtime ? overtimeMonth(s.id) : null,
      hours: shift.hourly ? myHours(s.id) : null,
    };
  }
  /* ── الدوام بالساعات: الأسبوع من السبت إلى الجمعة، والمبلغ بسعر الساعة الساري في كل يوم ── */
  const weekStart = date => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 1) % 7));
  function hoursOf(staffId, from, to) {
    const out = { minutes: 0, pay: 0, days: 0, open: 0, autoClosed: 0, edited: 0, noRate: 0, weeks: [] };
    const weeks = new Map();
    for (const r of db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(staffId, from, to)) {
      const w = attView(r).workedMinutes;
      const rate = rateOn(staffId, r.date);
      out.minutes += w;
      out.days++;
      if (!r.check_out) out.open++;
      if (r.auto_closed) out.autoClosed++;
      if (r.edited_by) out.edited++;
      if (rate == null && w > 0) out.noRate++;
      const key = weekStart(r.date);
      if (!weeks.has(key)) weeks.set(key, { from: key, to: addDays(key, 6), minutes: 0, money: 0, days: 0 });
      const wk = weeks.get(key);
      wk.minutes += w;
      wk.days++;
      wk.money += ((rate ?? 0) * w) / 60;
    }
    out.weeks = [...weeks.values()].map(({ money, ...wk }) => ({ ...wk, pay: Math.round(money) }));
    out.pay = out.weeks.reduce((x, wk) => x + wk.pay, 0);
    return out;
  }
  /** ساعات الموظف نفسه: هذا الأسبوع والماضي والشهر وآخر الأسابيع */
  function myHours(staffId) {
    const today = iraqDate();
    const start = weekStart(today);
    const pick = (a, b) => {
      const { minutes, pay, days } = hoursOf(staffId, a, b);
      return { from: a, to: b, minutes, pay, days };
    };
    return {
      rate: rateOn(staffId, today) ?? planOf(staffId).hourlyRate,
      week: pick(start, addDays(start, 6)),
      lastWeek: pick(addDays(start, -7), addDays(start, -1)),
      month: pick(`${today.slice(0, 8)}01`, today),
      weeks: hoursOf(staffId, addDays(start, -49), addDays(start, 6)).weeks.reverse(),
    };
  }
  /** كشف ساعات الفترة لكل موظف بالساعات (للإدارة والمدراء والمسؤولين) */
  function hoursReport(url, allow = () => true, showPay = true) {
    const today = iraqDate();
    const from = isDateStr(url.searchParams.get('from')) ? url.searchParams.get('from') : weekStart(today);
    const to = isDateStr(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
    const staff = db.prepare('SELECT * FROM staff ORDER BY name').all().filter(s => planOf(s.id).plan === 'hourly' && allow(s.id));
    const rows = staff.map(s => {
      const h = hoursOf(s.id, from, to);
      if (!showPay) {
        h.pay = null;
        h.weeks = h.weeks.map(w => ({ ...w, pay: null }));
      }
      return { staffId: s.id, name: s.name, kind: s.kind, sectionName: s.section_name, isActive: !!s.is_active, rate: showPay ? (rateOn(s.id, to) ?? planOf(s.id).hourlyRate) : null, ...h };
    }).filter(r => r.isActive || r.days > 0);
    return { from, to, showPay, rows, totalMinutes: rows.reduce((x, r) => x + r.minutes, 0), totalPay: showPay ? rows.reduce((x, r) => x + r.pay, 0) : null };
  }
  /** أوفر تايم الموظف هذا الشهر (حتى اليوم) */
  function overtimeMonth(staffId) {
    const today = iraqDate();
    const rows = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date BETWEEN ? AND ?').all(staffId, `${today.slice(0, 8)}01`, today).map(attView);
    const minutes = rows.reduce((x, r) => x + (r.overtimeMinutes || 0), 0);
    const rate = shiftOf(staffId).overtimeRate;
    return { monthMinutes: minutes, days: rows.filter(r => r.overtimeMinutes > 0).length, rate: rate ?? null, pay: rate ? Math.round((minutes / 60) * rate) : null };
  }

  function checkIn(req, s, body) {
    const net = checkNetwork(req, body.bssid, body.client);
    if (!net.ok) {
      audit(`staff:${s.id}`, 'attend.refused', null, { ip: net.ip, bssid: net.bssid, error: net.error });
      return { status: 403, body: { error: net.error, code: 'network' } };
    }
    const hourly = planOf(s.id).plan === 'hourly';
    const cur = currentRow(s.id);
    // بالساعات: خرج وعاد في اليوم نفسه — يُفتح السجل وتُخصم مدة الغياب من ساعاته
    if (hourly && cur?.check_out) {
      const back = now();
      const gap = Math.max(0, Math.round((Date.parse(back) - Date.parse(cur.check_out)) / 60_000));
      db.prepare('INSERT INTO breaks (attendance_id, staff_id, start_at, end_at, planned_minutes, over_minutes, warned, ip, bssid) VALUES (?, ?, ?, ?, ?, 0, 3, ?, ?)').run(cur.id, s.id, cur.check_out, back, gap, net.ip, net.bssid);
      db.prepare('UPDATE attendance SET check_out = NULL, out_ip = NULL, out_bssid = NULL, auto_closed = 0 WHERE id = ?').run(cur.id);
      audit(`staff:${s.id}`, 'attend.resume', cur.id, { ip: net.ip, gap });
      emitManagers('attend', { staffId: s.id });
      return { status: 200, body: myState(s) };
    }
    if (cur) return { status: 409, body: { error: 'سجّلت حضورك اليوم مسبقاً' } };
    const st = settings();
    const t = now();
    // التأخير مقابل بداية الوردية التي تخص هذه اللحظة (23:45 لوردية 00:30 = مبكر لا تأخير يوم كامل)
    const w = windowOf(s.id, Date.parse(t));
    const shift = shiftOf(s.id, w.date);
    if (!hourly && Date.parse(t) < w.start - st.earlyMinutes * 60_000) return { status: 400, body: { error: `الحضور يبدأ قبل الدوام بـ ${st.earlyMinutes} دقيقة فقط (دوامك ${shift.start})` } };
    const lateRaw = Math.floor((Date.parse(t) - w.start) / 60_000);
    const late = !hourly && lateRaw > st.graceMinutes ? lateRaw : 0;
    const r = db.prepare('INSERT INTO attendance (staff_id, date, check_in, in_ip, in_bssid, network_id, device_id, late_minutes, shift_start, shift_end, shift_break) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.id, w.date, t, net.ip, net.bssid, net.network?.id ?? null, String(body.deviceId || '').slice(0, 120) || null, late, shift.start, shift.end, shift.breakMinutes);
    audit(`staff:${s.id}`, 'attend.in', Number(r.lastInsertRowid), { ip: net.ip, bssid: net.bssid, late });
    if (late > 0) {
      const lateNote = { type: 'attend.late', title: `تأخر ${s.name} ${late} دقيقة`, body: `سجّل حضوره ${new Date(Date.parse(t) + IRAQ_MS).toISOString().slice(11, 16)} — دوامه ${shift.start}`, link: '/attend' };
      notify('manager', managerIds(), lateNote);
      notifySupervisors(s.id, 'viewAttendance', lateNote);
    }
    // حضر في يوم عطلته أو إجازته: يُبلَّغ المدراء (قد يستحق تعويضاً أو تبديلاً)
    const day = hourly ? null : dayFor(s.id, w.date);
    if (day?.off) {
      const why = { weekly: 'عطلته الأسبوعية', swap: 'عطلته (بعد التبديل)', day: 'إجازته', sick: 'إجازته المرضية', urgent: 'إجازته الطارئة' }[day.reason] || 'عطلته';
      const offNote = { type: 'attend.offday', title: `${s.name} حضر في يوم ${why}`, body: `سجّل حضوره ${new Date(Date.parse(t) + IRAQ_MS).toISOString().slice(11, 16)} مع أن اليوم ${why}`, link: '/attend?f=offday', data: { staffId: s.id } };
      notify('manager', managerIds(), offNote);
      notifySupervisors(s.id, 'viewAttendance', offNote);
      audit(`staff:${s.id}`, 'attend.offday', Number(r.lastInsertRowid), { reason: day.reason });
    }
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  function checkOut(req, s, body) {
    const a = currentRow(s.id);
    if (!a) return { status: 400, body: { error: 'لم تسجّل حضورك اليوم' } };
    if (a.check_out) return { status: 409, body: { error: 'سجّلت انصرافك مسبقاً' } };
    const net = checkNetwork(req, body.bssid, body.client);
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
    if (planOf(s.id).plan === 'hourly') return { status: 400, body: { error: 'حسابك بالساعات — سجّل انصرافك عند الخروج وحضورك عند العودة' } };
    const a = currentRow(s.id);
    if (!a || a.check_out) return { status: 400, body: { error: 'سجّل حضورك أولاً' } };
    if (openBreak(a.id)) return { status: 409, body: { error: 'أنت في استراحة الآن' } };
    const net = checkNetwork(req, body.bssid, body.client);
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
    const a = currentRow(s.id);
    const b = a ? openBreak(a.id) : null;
    if (!b) return { status: 400, body: { error: 'لست في استراحة' } };
    const net = checkNetwork(req, body.bssid, body.client);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    const over = closeBreak(b, now());
    audit(`staff:${s.id}`, 'break.end', b.id, { over });
    emitManagers('attend', { staffId: s.id });
    return { status: 200, body: myState(s) };
  }

  /* ── لوحة اليوم للمدير/الإدارة ── */
  function board(allow = () => true, showPay = true) {
    const date = iraqDate();
    const t = Date.now();
    const staff = db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY name').all().filter(s => allow(s.id));
    const st = settings();
    const devices = new Set(db.prepare('SELECT staff_id FROM devices').all().map(r => r.staff_id));
    const rows = staff.map(s => {
      const a = attView(currentRow(s.id));
      // الحالة مقابل نافذة الوردية (الليلية تعبر منتصف الليل) لا ساعات يوم التقويم
      const w = shiftWindow(d => shiftOf(s.id, d), t, st.earlyMinutes);
      const shift = shiftOf(s.id, a?.date ?? w.date);
      if (!showPay) shift.overtimeRate = null;
      const day = dayFor(s.id, a?.date ?? w.date);
      let status;
      if (a) {
        const ob = a.breaks.find(b => !b.endAt);
        status = a.checkOut ? 'out' : ob ? (ob.overMinutes > 0 ? 'over' : 'break') : 'in';
      } else if (shift.hourly) status = 'hourly';
      else if (day?.off) status = 'off';
      else if (t < w.start + st.graceMinutes * 60_000) status = 'soon';
      else if (t > w.end) status = 'absent';
      else status = 'missing';
      // من لم يدخل التطبيق بعد لا يُعدّ غائباً: لا يستطيع تسجيل حضوره أصلاً
      const joined = !!a || devices.has(s.id);
      // حضر في يوم عطلته أو إجازته
      const offDay = !!a && !!day?.off;
      return { staffId: s.id, name: s.name, kind: s.kind, sectionName: s.section_name, shift, day, status, attendance: a, joined, offDay };
    });
    const count = k => rows.filter(r => r.status === k && r.joined).length;
    return {
      date,
      now: now(),
      rows,
      counts: {
        in: count('in'),
        break: count('break') + count('over'),
        over: count('over'),
        out: count('out'),
        off: count('off'),
        missing: count('missing') + count('absent'),
        soon: count('soon'),
        // مفصّلة للواجهة الجديدة: «لم يحضر بعد» (دوامه جارٍ أو لم يبدأ) و«غياب» (انتهى دوامه دون حضور)
        notYet: count('missing') + count('soon'),
        absent: count('absent'),
        present: count('in') + count('break') + count('over'),
        offDay: rows.filter(r => r.offDay).length,
        notJoined: rows.filter(r => !r.joined && r.status !== 'off').length,
        late: rows.filter(r => (r.attendance?.lateMinutes ?? 0) > 0).length,
      },
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
    let co = body.checkOut === null ? null : body.checkOut && !Number.isNaN(Date.parse(body.checkOut)) ? new Date(body.checkOut).toISOString() : a.check_out;
    const shift = rowShift(a);
    const st = settings();
    // وردية ليلية: انصراف بساعة أصغر من الحضور (إصدارات تطبيق أقدم تبنيه على يوم الحضور) = اليوم التالي
    if (!shift.hourly && co && co <= ci && hm(shift.end) != null && hm(shift.end) <= (hm(shift.start) ?? 600) && Date.parse(co) + 86_400_000 > Date.parse(ci)) {
      co = new Date(Date.parse(co) + 86_400_000).toISOString();
    }
    if (co && co <= ci) return { status: 400, body: { error: 'وقت الانصراف قبل الحضور' } };
    // نفس يوم السجل: مقابل دوامه المحفوظ؛ وإن نُقل الحضور ليوم آخر: مقابل دوام ذلك اليوم
    const ciWindow = windowOf(a.staff_id, Date.parse(ci));
    const lateRaw = Math.floor((Date.parse(ci) - (ciWindow.date === a.date ? atIraq(a.date, shiftSpan(shift).start) : ciWindow.start)) / 60_000);
    const late = !shift.hourly && lateRaw > st.graceMinutes ? lateRaw : 0;
    db.prepare('UPDATE attendance SET check_in = ?, check_out = ?, late_minutes = ?, note = ?, edited_by = ?, edited_at = ?, auto_closed = CASE WHEN ? IS NULL THEN auto_closed ELSE 0 END WHERE id = ?')
      .run(ci, co, late, String(body.note || a.note || '').slice(0, 300) || null, actor, now(), co, id);
    if (co) {
      const ob = openBreak(id);
      if (ob) {
        const end = new Date(Math.max(Date.parse(ob.start_at), Math.min(Date.parse(co), Date.now()))).toISOString();
        const over = Math.max(0, Math.round((Date.parse(end) - Date.parse(ob.start_at)) / 60_000 - ob.planned_minutes));
        db.prepare('UPDATE breaks SET end_at = ?, over_minutes = ? WHERE id = ?').run(end, over, ob.id);
      }
    }
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
    const date = windowOf(staffId, ci).date;
    if (db.prepare('SELECT id FROM attendance WHERE staff_id = ? AND date = ?').get(staffId, date)) return { status: 409, body: { error: 'يوجد سجل لهذا اليوم — عدّله بدلاً من إضافة جديد' } };
    const sh = shiftOf(staffId, date);
    const r = db.prepare("INSERT INTO attendance (staff_id, date, check_in, note, edited_by, edited_at, shift_start, shift_end, shift_break) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(staffId, date, new Date(ci).toISOString(), String(body.note || 'إضافة يدوية').slice(0, 300), actor, now(), sh.start, sh.end, sh.breakMinutes);
    // التحقق من الانصراف في correct (يعرف الوردية الليلية)؛ السجل يُحذف إن رُفض
    const out = correct(Number(r.lastInsertRowid), { checkIn: body.checkIn, checkOut: body.checkOut, note: body.note || 'إضافة يدوية' }, actor);
    if (out.status !== 200) db.prepare('DELETE FROM attendance WHERE id = ?').run(Number(r.lastInsertRowid));
    return out;
  }

  /* ── بصمة المدراء: بالساعات، دخول وخروج متعدد في اليوم، من شبكة المحل ── */
  const managersMap = () => ctx.getManagers?.() || {};
  const managerOf = id => managersMap()[id] || managersMap()[String(id)] || null;
  const mSess = r => ({
    id: r.id,
    managerId: r.manager_id,
    date: r.date,
    checkIn: r.check_in,
    checkOut: r.check_out,
    minutes: Math.max(0, Math.round(((r.check_out ? Date.parse(r.check_out) : Date.now()) - Date.parse(r.check_in)) / 60_000)),
    autoClosed: !!r.auto_closed,
    edited: !!r.edited_by,
    editedBy: r.edited_by,
    note: r.note,
  });
  const mOpen = mid => db.prepare('SELECT * FROM manager_attendance WHERE manager_id = ? AND check_out IS NULL ORDER BY id DESC LIMIT 1').get(mid);
  /** أيام الفترة كلها (حتى الفارغة) بفتراتها — للمخطط الزمني */
  function mDays(mid, from, to) {
    const by = new Map();
    for (const r of db.prepare('SELECT * FROM manager_attendance WHERE manager_id = ? AND date BETWEEN ? AND ? ORDER BY check_in').all(mid, from, to)) {
      by.set(r.date, [...(by.get(r.date) || []), mSess(r)]);
    }
    const out = [];
    for (let d = to; d >= from && out.length < 93; d = addDays(d, -1)) {
      const sessions = by.get(d) || [];
      out.push({ date: d, weekday: DAY_NAMES[dayIdx(d)], minutes: sessions.reduce((x, s) => x + s.minutes, 0), sessions });
    }
    return out;
  }
  const mSum = (mid, from, to) => {
    const days = mDays(mid, from, to);
    return { from, to, minutes: days.reduce((x, d) => x + d.minutes, 0), days: days.filter(d => d.sessions.length).length };
  };
  function mState(mid) {
    const today = iraqDate();
    const start = weekStart(today);
    const open = mOpen(mid);
    const nets = networks().filter(n => n.is_active);
    return {
      now: now(),
      today,
      open: open ? mSess(open) : null,
      todayMinutes: mSum(mid, today, today).minutes,
      week: mSum(mid, start, addDays(start, 6)),
      lastWeek: mSum(mid, addDays(start, -7), addDays(start, -1)),
      month: mSum(mid, `${today.slice(0, 8)}01`, today),
      days: mDays(mid, addDays(today, -13), today),
      network: { enforced: settings().enforceNetwork, configured: nets.length > 0, needsBssid: nets.some(n => bssidsOf(n).length > 0) },
    };
  }
  function mIn(req, m, body) {
    const mid = Number(m.id);
    if (mOpen(mid)) return { status: 409, body: { error: 'سجّلت حضورك مسبقاً — سجّل انصرافك أولاً' } };
    const net = checkNetwork(req, body.bssid, body.client);
    if (!net.ok) {
      audit(`manager:${mid}`, 'mattend.refused', null, { ip: net.ip, bssid: net.bssid, error: net.error });
      return { status: 403, body: { error: net.error, code: 'network' } };
    }
    const t = now();
    const r = db.prepare('INSERT INTO manager_attendance (manager_id, date, check_in, in_ip, in_bssid) VALUES (?, ?, ?, ?, ?)').run(mid, iraqDate(Date.parse(t)), t, net.ip, net.bssid);
    audit(`manager:${mid}`, 'mattend.in', Number(r.lastInsertRowid), { ip: net.ip });
    emitManagers('mattend', { managerId: mid });
    return { status: 200, body: mState(mid) };
  }
  function mOut(req, m, body) {
    const mid = Number(m.id);
    const a = mOpen(mid);
    if (!a) return { status: 400, body: { error: 'لم تسجّل حضورك' } };
    const net = checkNetwork(req, body.bssid, body.client);
    if (!net.ok) return { status: 403, body: { error: net.error, code: 'network' } };
    db.prepare('UPDATE manager_attendance SET check_out = ?, out_ip = ?, out_bssid = ? WHERE id = ?').run(now(), net.ip, net.bssid, a.id);
    audit(`manager:${mid}`, 'mattend.out', a.id, { ip: net.ip });
    emitManagers('mattend', { managerId: mid });
    return { status: 200, body: mState(mid) };
  }
  /** نسيان الانصراف: يُغلق قبل صباح اليوم التالي ويعتمد وقت إغلاق المحل (كحساب الساعات للموظفين) */
  function mAutoClose(a) {
    const st = settings();
    const closeAt = atIraq(a.date, shiftSpan({ start: st.shiftStart, end: st.shiftEnd }).end);
    if (Date.now() < closeAt + HOURLY_CLOSE_GRACE_MS) return;
    const t = new Date(Math.max(closeAt, Date.parse(a.check_in))).toISOString();
    const r = db.prepare('UPDATE manager_attendance SET check_out = ?, auto_closed = 1 WHERE id = ? AND check_out IS NULL').run(t, a.id);
    if (!r.changes) return;
    audit('system', 'mattend.autoclose', a.id, { at: t });
    notify('manager', [a.manager_id], { type: 'attend.auto', title: 'أُغلق حضورك تلقائياً', body: 'لم تسجّل انصرافك — اعتُمد وقت إغلاق المحل. راجع الإدارة إن كانت ساعاتك أكثر.', link: '/self' });
    emitManagers('mattend', { managerId: a.manager_id });
  }
  /** كشف ساعات المدراء في فترة، مع فترات كل يوم للمخطط */
  function mReport(url) {
    const today = iraqDate();
    const to = isDateStr(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
    let from = isDateStr(url.searchParams.get('from')) ? url.searchParams.get('from') : weekStart(today);
    if (from > to) from = to;
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) from = addDays(to, -62);
    const rows = Object.values(managersMap()).map(m => {
      const mid = Number(m.id);
      const daily = mDays(mid, from, to);
      const all = daily.flatMap(d => d.sessions);
      const open = mOpen(mid);
      return {
        managerId: mid,
        name: m.displayName || m.username,
        username: m.username,
        isActive: m.isActive !== false,
        minutes: daily.reduce((x, d) => x + d.minutes, 0),
        days: daily.filter(d => d.sessions.length).length,
        open: !!open,
        openSince: open?.check_in ?? null,
        autoClosed: all.filter(s => s.autoClosed).length,
        edited: all.filter(s => s.edited).length,
        daily,
      };
    }).filter(r => r.isActive || r.days > 0).sort((a, b) => Number(b.open) - Number(a.open) || b.minutes - a.minutes || a.name.localeCompare(b.name, 'ar'));
    return { from, to, today, rows, totalMinutes: rows.reduce((x, r) => x + r.minutes, 0), presentNow: rows.filter(r => r.open).length };
  }
  /** تصحيح فترة أو إضافتها يدوياً (لمدير آخر أو من لوحة التحكم) */
  function mSave(id, body, actor) {
    const cur = id ? db.prepare('SELECT * FROM manager_attendance WHERE id = ?').get(id) : null;
    if (id && !cur) return { status: 404, body: { error: 'السجل غير موجود' } };
    const mid = cur ? cur.manager_id : Number(body.managerId);
    if (!managerOf(mid)) return { status: 404, body: { error: 'المدير غير موجود' } };
    const ci = body.checkIn && !Number.isNaN(Date.parse(body.checkIn)) ? new Date(body.checkIn).toISOString() : cur?.check_in;
    if (!ci) return { status: 400, body: { error: 'وقت الحضور مطلوب' } };
    const co = body.checkOut === null ? null : body.checkOut && !Number.isNaN(Date.parse(body.checkOut)) ? new Date(body.checkOut).toISOString() : cur?.check_out ?? null;
    if (co && co <= ci) return { status: 400, body: { error: 'وقت الانصراف قبل الحضور' } };
    if (co && Date.parse(co) - Date.parse(ci) > 24 * 3600_000) return { status: 400, body: { error: 'الفترة أطول من 24 ساعة' } };
    if (Date.parse(ci) > Date.now() + 60_000 || (co && Date.parse(co) > Date.now() + 60_000)) return { status: 400, body: { error: 'لا يمكن تسجيل وقت في المستقبل' } };
    if (!co && db.prepare('SELECT id FROM manager_attendance WHERE manager_id = ? AND check_out IS NULL AND id <> ?').get(mid, id || 0)) return { status: 409, body: { error: 'له حضور مفتوح — أغلقه أولاً' } };
    const note = String(body.note || cur?.note || (id ? 'تصحيح' : 'إضافة يدوية')).slice(0, 300);
    if (cur) {
      db.prepare('UPDATE manager_attendance SET date = ?, check_in = ?, check_out = ?, note = ?, edited_by = ?, edited_at = ?, auto_closed = CASE WHEN ? IS NULL THEN auto_closed ELSE 0 END WHERE id = ?')
        .run(iraqDate(Date.parse(ci)), ci, co, note, actor, now(), co, id);
      audit(actor, 'mattend.correct', id, { from: { in: cur.check_in, out: cur.check_out }, to: { in: ci, out: co }, note });
    } else {
      const r = db.prepare('INSERT INTO manager_attendance (manager_id, date, check_in, check_out, note, edited_by, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(mid, iraqDate(Date.parse(ci)), ci, co, note, actor, now());
      id = Number(r.lastInsertRowid);
      audit(actor, 'mattend.manual', id, { managerId: mid, in: ci, out: co, note });
    }
    notify('manager', [mid], { type: 'attend.edit', title: 'عُدّل سجل حضورك', body: `${actor.replace(/^(manager|supervisor):/, '')} — ${note}`, link: '/self' });
    emitManagers('mattend', { managerId: mid });
    return { status: 200, body: mSess(db.prepare('SELECT * FROM manager_attendance WHERE id = ?').get(id)) };
  }
  function mDelete(id, actor) {
    const cur = db.prepare('SELECT * FROM manager_attendance WHERE id = ?').get(id);
    if (!cur) return { status: 404, body: { error: 'السجل غير موجود' } };
    db.prepare('DELETE FROM manager_attendance WHERE id = ?').run(id);
    audit(actor, 'mattend.delete', id, { managerId: cur.manager_id, in: cur.check_in, out: cur.check_out });
    notify('manager', [cur.manager_id], { type: 'attend.edit', title: 'حُذف سجل من حضورك', body: actor.replace(/^(manager|supervisor):/, ''), link: '/self' });
    emitManagers('mattend', { managerId: cur.manager_id });
    return { status: 200, body: { ok: true } };
  }
  /** بصمة المدير نفسه: /api/team/m/self-attend[/in|/out] */
  async function handleManagerSelf(req, res, sub, m) {
    if (sub !== 'self-attend' && !sub.startsWith('self-attend/')) return false;
    if (req.method === 'GET' && sub === 'self-attend') return ctx.send(res, 200, mState(Number(m.id))), true;
    if (req.method === 'POST' && (sub === 'self-attend/in' || sub === 'self-attend/out')) {
      const body = (await json(req)) || {};
      return reply(res, sub.endsWith('/in') ? mIn(req, m, body) : mOut(req, m, body)), true;
    }
    return false;
  }

  /* ── المؤقت: الاستراحات والإغلاق التلقائي ── */
  /**
   * إغلاق حضور منسي إن حان وقته؛ يُعتمد نهاية الدوام وقتاً للانصراف.
   * يحين بعد نهاية الدوام بعدة ساعات — ومن فُعّل له الأوفر تايم يبقى مفتوحاً حتى تُفتح نافذة ورديته التالية.
   */
  function autoClose(a) {
    const shift = rowShift(a);
    const st = settings();
    // بالساعات: لا وردية له — نسيان الانصراف يُغلق قبل صباح اليوم التالي ويعتمد وقت إغلاق المحل، ويراجعه المدير لأنه يمسّ الراتب
    if (shift.hourly) {
      const closeAt = atIraq(a.date, shiftSpan({ start: st.shiftStart, end: st.shiftEnd }).end);
      if (Date.now() < closeAt + HOURLY_CLOSE_GRACE_MS) return false;
      const last = Math.max(Date.parse(a.check_in), ...breaksOf(a.id).map(b => Date.parse(b.end_at || b.start_at)));
      const t = new Date(Math.max(closeAt, last)).toISOString();
      const r = db.prepare('UPDATE attendance SET check_out = ?, auto_closed = 1 WHERE id = ? AND check_out IS NULL').run(t, a.id);
      if (!r.changes) return true;
      audit('system', 'attend.autoclose', a.id, { at: t, hourly: true });
      const s = getStaff(a.staff_id);
      notify('staff', [a.staff_id], { type: 'attend.auto', title: 'أُغلق حضورك تلقائياً', body: 'لم تسجّل انصرافك — اعتُمد وقت إغلاق المحل. راجع مديرك إن كانت ساعاتك أكثر.', link: '/shift' });
      const note = { type: 'attend.auto', title: `${s?.name ?? 'موظف'} نسي الانصراف`, body: 'حساب بالساعات أُغلق تلقائياً — راجع وقت انصرافه لأنه يدخل في راتبه', link: '/attend' };
      notify('manager', managerIds(), note);
      notifySupervisors(a.staff_id, 'editAttendance', note);
      emitManagers('attend', { staffId: a.staff_id });
      return true;
    }
    const span = shiftSpan(shift);
    const end = atIraq(a.date, span.end);
    const nextDate = addDays(a.date, 1);
    const nextOpen = atIraq(nextDate, shiftSpan(shiftOf(a.staff_id, nextDate)).start) - st.earlyMinutes * 60_000;
    const due = Math.max(end, Math.min(shift.overtime ? Infinity : end + st.autoCloseHours * 3600_000, nextOpen));
    if (Date.now() < due) return false;
    const t = new Date(Math.max(end, Date.parse(a.check_in))).toISOString();
    const ob = openBreak(a.id);
    if (ob) closeBreak(ob, new Date(Math.max(Date.parse(t), Date.parse(ob.start_at))).toISOString());
    const r = db.prepare('UPDATE attendance SET check_out = ?, auto_closed = 1 WHERE id = ? AND check_out IS NULL').run(t, a.id);
    if (!r.changes) return true;
    audit('system', 'attend.autoclose', a.id, { at: t });
    notify('staff', [a.staff_id], { type: 'attend.auto', title: 'أُغلق حضورك تلقائياً', body: `لم تسجّل انصرافك — اعتُمد نهاية الدوام ${shift.end}. راجع مديرك إن كان خطأ.`, link: '/shift' });
    emitManagers('attend', { staffId: a.staff_id });
    return true;
  }

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
            const overNote = { type: 'break.over', title: `${b.staff_name} تجاوز الاستراحة`, body: `تجاوز ${over} دقيقة ولم يسجّل عودته`, link: '/attend' };
            notify('manager', managerIds(), overNote);
            notifySupervisors(b.staff_id, 'viewAttendance', overNote);
            emitManagers('attend', { staffId: b.staff_id });
          }
        }
      }
      // حضور منسي (أو أيام سابقة)
      for (const a of db.prepare('SELECT * FROM attendance WHERE check_out IS NULL').all()) autoClose(a);
      for (const a of db.prepare('SELECT * FROM manager_attendance WHERE check_out IS NULL').all()) mAutoClose(a);
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
      const net = checkNetwork(req, url.searchParams.get('bssid'), url.searchParams.get('client'));
      ctx.send(res, 200, { ok: net.ok, ip: net.ip, network: net.network ? net.network.name : null, viaIp: !!net.viaIp, error: net.ok ? null : net.error });
      return true;
    }
    const body = req.method === 'POST' ? (await json(req)) || {} : {};
    if (req.method === 'POST') {
      const bound = db.prepare('SELECT device_id FROM devices WHERE staff_id = ?').get(s.id);
      if (bound && bound.device_id !== String(body.deviceId || '')) {
        const appBound = !String(bound.device_id).startsWith('web-');
        const error = appBound
          ? body.client === 'web'
            ? 'حسابك مربوط بتطبيق ديما على هاتفك — سجّل الحضور من التطبيق، أو اطلب من الإدارة فك الربط لتستخدم الموقع'
            : 'الحضور من هاتفك المربوط فقط — افتح تطبيق ديما على هاتفك'
          : 'حسابك مربوط بمتصفح آخر — سجّل الخروج ثم الدخول من جديد على هذا الهاتف';
        return reply(res, { status: 403, body: { error, code: 'device' } }), true;
      }
    }
    if (req.method === 'POST' && p === '/api/team/attend/in') return reply(res, checkIn(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/out') return reply(res, checkOut(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/break/start') return reply(res, breakStart(req, s, body)), true;
    if (req.method === 'POST' && p === '/api/team/attend/break/end') return reply(res, breakEnd(req, s, body)), true;
    return false;
  }

  async function handleManage(req, res, url, sub, actor, open, allow = () => true, showPay = true, self = null) {
    const send = (st, b) => (open ? ctx.sendOpen : ctx.send)(res, st, b);
    // دوام المدراء: العرض بصلاحية «دوام المدراء»، والتصحيح لمن يملك تعديل الحضور — ولا أحد يصحّح سجله بنفسه
    if (sub === 'mgr-attend' || sub.startsWith('mgr-attend/')) {
      if (req.method === 'GET' && sub === 'mgr-attend') return send(200, mReport(url)), true;
      const idM = sub.match(/^mgr-attend\/(\d+)$/);
      const manual = req.method === 'POST' && sub === 'mgr-attend/manual';
      if (!manual && !(idM && (req.method === 'PUT' || req.method === 'DELETE'))) return false;
      const body = req.method === 'DELETE' ? {} : (await json(req)) || {};
      const target = manual ? Number(body.managerId) : db.prepare('SELECT manager_id FROM manager_attendance WHERE id = ?').get(Number(idM[1]))?.manager_id;
      if (!open) {
        if (!self?.canEdit) return send(403, { error: 'لا تملك صلاحية تعديل الحضور — راجع الإدارة', code: 'perm', perm: 'editAttendance' }), true;
        if (target === self.managerId) return send(403, { error: 'لا يمكنك تعديل سجل حضورك بنفسك — يعدّله مدير آخر أو الإدارة' }), true;
      }
      if (manual) return reply(res, mSave(null, body, actor), open), true;
      return reply(res, req.method === 'DELETE' ? mDelete(Number(idM[1]), actor) : mSave(Number(idM[1]), body, actor), open), true;
    }
    if (req.method === 'GET' && sub === 'attend/board') return send(200, board(allow, showPay)), true;
    if (req.method === 'GET' && sub === 'attend/hours') return send(200, hoursReport(url, allow, showPay)), true;
    if (req.method === 'GET' && sub === 'attend/log') return send(200, log(url, allow)), true;
    if (req.method === 'GET' && sub === 'attend/settings') return send(200, { settings: settings(), networks: networks().map(netView), shopIp: shopIp() }), true;
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
      // المدير داخل المحل: عنوانه هو عنوان إنترنت المحل
      noteShopIp(ip, 'capture');
      if (body.ipOnly) return reply(res, saveNetwork(null, { name: body.name || 'إنترنت المحل', ip }, actor), open), true;
      const ssid = body.ssid ? String(body.ssid).slice(0, 64) : null;
      const same = ssid ? networks().find(n => n.ssid === ssid) : null;
      if (same) {
        const view = netView(same);
        return reply(res, saveNetwork(same.id, { name: same.name, bssids: [...view.bssids, bssid], ip: same.ip, ssid, isActive: !!same.is_active }, actor), open), true;
      }
      return reply(res, saveNetwork(null, { name: body.name || ssid || 'واي فاي المحل', bssids: [bssid], ip: body.withIp === true ? ip : null, ssid }, actor), open), true;
    }
    if (req.method === 'GET' && sub === 'networks/probe') {
      const net = checkNetwork(req, url.searchParams.get('bssid'), url.searchParams.get('client'));
      return send(200, { ok: net.ok, ip: net.ip, bssid: net.bssid, network: net.network ? net.network.name : null, error: net.ok ? null : net.error }), true;
    }
    let om = sub.match(/^staff\/(\d+)\/overtime$/);
    // الأوفر تايم يمسّ الرواتب: من لوحة التحكم فقط
    if (om && req.method === 'PUT') return reply(res, !open ? { status: 403, body: { error: 'تفعيل الأوفر تايم من لوحة التحكم فقط' } } : setOvertime(Number(om[1]), (await json(req)) || {}, actor), open), true;
    m = sub.match(/^staff\/(\d+)\/shift$/);
    if (m && req.method === 'PUT') return reply(res, allow(Number(m[1])) ? setShift(Number(m[1]), (await json(req)) || {}, actor) : { status: 403, body: { error: 'هذا الموظف خارج أقسامك' } }, open), true;
    if (m && req.method === 'GET') return send(200, showPay ? shiftOf(Number(m[1])) : { ...shiftOf(Number(m[1])), overtimeRate: null }), true;
    return false;
  }

  return { handleStaff, handleManage, handleManagerSelf, shiftOf, board, clientIp, overtimeOf, noteShopIp, shopIp };
}

module.exports = { createAttend, clientIp, ipMatch, normBssid };
