'use strict';

/*
 * مبيعات المحل لتطبيق المدراء (صلاحية viewSales).
 * سيرفر المحل يرفع:
 *   live  — حزمة اليوم + آخر الفواتير + نقاط البيع، خلال ثوانٍ من كل فاتورة (POST /api/sync/sales)
 *   days  — حزمة مفصّلة لكل يوم سابق (تُرفع الأيام الجديدة/المتغيّرة فقط حسب البصمة)
 *   totals— إجمالي كل يوم لسنة
 * المدير: /api/team/m/sales/{live,day,range,alerts} + حدث «sales» على القناة الحية مع كل تحديث.
 * تنبيهات المتابعة: فاتورة كبيرة، مرتجع كبير، نقطة بيع انقطعت، مبيعات أبطأ من المعتاد، ملخص الإغلاق.
 */

const fs = require('fs');
const path = require('path');

function createSales({ db, ctx, now, audit, permsOf, managerIds, emit, notify }) {
  db.exec('CREATE TABLE IF NOT EXISTS _sales_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE sales_days (day TEXT PRIMARY KEY, hash TEXT NOT NULL, pack TEXT NOT NULL, updated_at TEXT NOT NULL);
     CREATE TABLE sales_totals (day TEXT PRIMARY KEY, net REAL NOT NULL, receipts INTEGER NOT NULL, returns REAL NOT NULL, pieces REAL NOT NULL);`,
    `CREATE TABLE sales_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE sales_alert_log (day TEXT NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (day, key));`,
  ];
  const applied = new Set(db.prepare('SELECT id FROM _sales_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    if (applied.has(i + 1)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _sales_migrations (id, applied_at) VALUES (?, ?)').run(i + 1, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  /* ── اليوم الحي (في الذاكرة + ملف ليبقى بعد إعادة التشغيل) ── */
  const liveFile = path.join(ctx.dataDir, 'sales-live.json');
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
  } catch {
    live = null;
  }
  let saveTimer = null;
  function saveLive() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(liveFile, JSON.stringify(live), () => undefined), 2000);
  }

  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const dayKey = d => d.toISOString().slice(0, 10);
  const shift = (day, n) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return dayKey(d);
  };
  const today = () => live?.pack?.day || dayKey(new Date(Date.now() + 3 * 3600_000));
  function packOf(day) {
    if (!day) return null;
    if (live?.pack?.day === day) return live.pack;
    const row = db.prepare('SELECT pack FROM sales_days WHERE day = ?').get(day);
    return row ? JSON.parse(row.pack) : null;
  }

  /** من يرى المبيعات: المدراء النشطون بصلاحية viewSales */
  const viewers = () => managerIds().filter(id => permsOf(id).perms.viewSales);

  /* ── تنبيهات المتابعة ── */
  const ALERT_DEFAULTS = { bigSale: 500000, bigReturn: 100000, terminalOffline: true, slowPace: true, dailyClose: true, closeAt: '22:30' };
  function alertSettings() {
    const row = db.prepare("SELECT value FROM sales_settings WHERE key = 'alerts'").get();
    let saved = {};
    try {
      saved = row ? JSON.parse(row.value) : {};
    } catch {
      saved = {};
    }
    return { ...ALERT_DEFAULTS, ...saved };
  }
  function saveAlertSettings(body, actor) {
    const cur = alertSettings();
    const money = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
    const next = {
      bigSale: money(body.bigSale, cur.bigSale),
      bigReturn: money(body.bigReturn, cur.bigReturn),
      terminalOffline: body.terminalOffline !== undefined ? !!body.terminalOffline : cur.terminalOffline,
      slowPace: body.slowPace !== undefined ? !!body.slowPace : cur.slowPace,
      dailyClose: body.dailyClose !== undefined ? !!body.dailyClose : cur.dailyClose,
      closeAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.closeAt || '')) ? body.closeAt : cur.closeAt,
    };
    db.prepare("INSERT INTO sales_settings (key, value) VALUES ('alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
    audit?.(actor, 'sales.alerts', null, next);
    return next;
  }
  const compact = n => {
    const a = Math.abs(n);
    const trim = (x, d) => x.toFixed(d).replace(/\.0+$/, '');
    if (a >= 1e6) return `${trim(n / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} مليون`;
    if (a >= 1e3) return `${Math.round(n / 1e3)} ألف`;
    return String(Math.round(n));
  };
  /** تنبيه مرة واحدة لكل مفتاح في اليوم */
  function alertOnce(day, key, n) {
    const ids = viewers();
    if (!ids.length) return;
    const r = db.prepare('INSERT INTO sales_alert_log (day, key, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(day, key, now());
    if (!r.changes) return;
    notify?.('manager', ids, { ...n, link: '/sales' });
  }
  const posLabel = (name, id) => (!name || /^win:/i.test(name) ? `نقطة بيع ${id}` : name);
  function checkLiveAlerts(fresh) {
    const s = alertSettings();
    const day = live.pack.day;
    for (const r of fresh) {
      if (r.kind === 0 && s.bigSale > 0 && num(r.total) >= s.bigSale)
        alertOnce(day, `sale:${r.id}`, { type: 'sales.big', title: `فاتورة كبيرة: ${compact(num(r.total))} د.ع`, body: [r.cashier, r.seller].filter(Boolean).join(' · ') });
      if (r.kind === 1 && s.bigReturn > 0 && num(r.total) >= s.bigReturn)
        alertOnce(day, `return:${r.id}`, { type: 'sales.return', title: `مرتجع كبير: ${compact(num(r.total))} د.ع`, body: r.cashier ? `الكاشير ${r.cashier}` : '' });
    }
    const atMs = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(live.at || '') ? live.at : `${live.at}+03:00`);
    if (Number.isNaN(atMs)) return;
    const local = new Date(atMs + 3 * 3600_000);
    const hour = local.getUTCHours();
    if (s.terminalOffline && hour >= 10 && hour < 22) {
      for (const t of live.terminals || []) {
        // فقط النقاط التي باعت اليوم: جهاز قديم غير مستخدم لا يُنبَّه عنه
        if (!t.lastSaleAt || !t.lastSeen) continue;
        const seen = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t.lastSeen) ? t.lastSeen : `${t.lastSeen}+03:00`);
        if (!Number.isNaN(seen) && atMs - seen > 15 * 60_000)
          alertOnce(day, `off:${t.id}`, { type: 'sales.offline', title: `انقطعت ${posLabel(t.name, t.id)}`, body: 'لا اتصال منذ أكثر من 15 دقيقة — تحقق من الجهاز والشبكة' });
      }
    }
    if (s.slowPace && hour >= 14 && hour < 22) {
      const logged = db.prepare("SELECT 1 FROM sales_alert_log WHERE day = ? AND key = 'pace'").get(day);
      if (!logged) {
        const avg = sameWeekdayAvg(day);
        if (avg && avg.weeks >= 2) {
          const frac = local.getUTCMinutes() / 60;
          let expected = 0;
          for (const h of avg.hours) expected += h.h < hour ? h.t : h.h === hour ? h.t * frac : 0;
          const net = num(live.pack.totals?.net);
          if (expected > 0 && net < expected * 0.7)
            alertOnce(day, 'pace', { type: 'sales.pace', title: 'المبيعات أبطأ من المعتاد', body: `${compact(net)} حتى الآن مقابل ${compact(expected)} في مثل هذا الوقت عادةً` });
        }
      }
    }
  }
  /** ملخص إغلاق اليوم بتبليغ واحد */
  function checkClose() {
    try {
      if (!live?.pack) return;
      const s = alertSettings();
      if (!s.dailyClose) return;
      const local = new Date(Date.now() + 3 * 3600_000);
      const day = local.toISOString().slice(0, 10);
      const hm = local.toISOString().slice(11, 16);
      if (live.pack.day !== day || hm < s.closeAt) return;
      const t = live.pack.totals || {};
      if (!num(t.receipts)) return;
      const week = packOf(shift(day, -7));
      const pct = week && num(week.totals?.net) ? Math.round(((num(t.net) - num(week.totals.net)) / Math.abs(num(week.totals.net))) * 100) : null;
      const cmp = pct == null ? '' : ` · ${pct >= 0 ? '+' : ''}${pct}% عن الأسبوع الماضي`;
      alertOnce(day, 'close', { type: 'sales.close', title: `إغلاق اليوم: ${compact(num(t.net))} د.ع`, body: `${num(t.receipts)} فاتورة · ${Math.round(num(t.pieces))} قطعة${cmp}` });
    } catch (err) {
      console.error('sales close alert failed', err.message);
    }
  }
  setInterval(checkClose, 60_000).unref();

  /* ── استقبال المزامنة ── */
  function applySync(body) {
    let changed = 0;
    if (body.live && body.live.pack && body.live.pack.day) {
      const prev = live;
      live = { ...body.live, receivedAt: now() };
      saveLive();
      const t = live.pack.totals || {};
      // الأحدث أولاً: فواتير جديدة منذ آخر رفع (للبث المباشر)
      const lastId = prev?.recent?.[0]?.id || 0;
      const fresh = prev && prev.pack?.day === live.pack.day ? (live.recent || []).filter(r => r.id > lastId) : [];
      const summary = { day: live.pack.day, net: num(t.net), receipts: num(t.receipts), pieces: num(t.pieces), lastAt: t.lastAt || null, at: live.at || null, fresh: fresh.slice(0, 10) };
      for (const id of viewers()) emit(`manager:${id}`, 'sales', summary);
      try {
        checkLiveAlerts(fresh);
      } catch (err) {
        console.error('sales alerts failed', err.message);
      }
    }
    if (Array.isArray(body.days) && body.days.length) {
      const up = db.prepare(`INSERT INTO sales_days (day, hash, pack, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET hash = excluded.hash, pack = excluded.pack, updated_at = excluded.updated_at`);
      db.exec('BEGIN');
      try {
        for (const d of body.days) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.day || '')) || !d.pack) continue;
          up.run(d.day, String(d.hash || ''), JSON.stringify(d.pack), now());
          changed++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    if (Array.isArray(body.totals) && body.totals.length) {
      const up = db.prepare(`INSERT INTO sales_totals (day, net, receipts, returns, pieces) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET net = excluded.net, receipts = excluded.receipts, returns = excluded.returns, pieces = excluded.pieces`);
      db.exec('BEGIN');
      try {
        for (const r of body.totals) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.day || ''))) continue;
          up.run(r.day, num(r.net), num(r.receipts), num(r.returnsTotal), num(r.pieces));
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    return { ok: true, days: changed };
  }

  async function handleSync(req, res, url) {
    if (url.pathname === '/api/sync/sales/hashes' && req.method === 'GET') {
      if (!ctx.syncAuthorized(req)) return ctx.sendOpen(res, 401, { error: 'مفتاح المزامنة غير صحيح' }), true;
      const days = Object.fromEntries(db.prepare('SELECT day, hash FROM sales_days').all().map(r => [r.day, r.hash]));
      ctx.sendOpen(res, 200, { days });
      return true;
    }
    if (url.pathname === '/api/sync/sales' && req.method === 'POST') {
      if (!ctx.syncAuthorized(req)) return ctx.sendOpen(res, 401, { error: 'مفتاح المزامنة غير صحيح' }), true;
      let body;
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        return ctx.sendOpen(res, 400, { error: 'bad json' }), true;
      }
      ctx.sendOpen(res, 200, applySync(body));
      return true;
    }
    return false;
  }

  /* ── تجميع عدة أيام ── */
  function mergeNamed(target, rows, keyOf = r => r.id) {
    for (const r of rows || []) {
      const k = keyOf(r);
      const cur = target.get(k) || { id: r.id, name: r.name, sub: r.sub ?? null, barcode: r.barcode ?? null, t: 0, n: 0, q: 0, d: 0, v: 0, va: 0, days: 0, lastAt: null };
      cur.d += num(r.d);
      cur.v += num(r.v);
      cur.va += num(r.va);
      cur.t += num(r.t);
      cur.n += num(r.n);
      cur.q += num(r.q);
      cur.days += 1;
      if (r.name) cur.name = r.name;
      if (r.lastAt && (!cur.lastAt || r.lastAt > cur.lastAt)) cur.lastAt = r.lastAt;
      target.set(k, cur);
    }
  }
  const sorted = m => [...m.values()].sort((a, b) => b.t - a.t);

  function aggregate(packs) {
    const totals = { net: 0, gross: 0, receipts: 0, pieces: 0, returnsTotal: 0, returnsCount: 0, gifts: 0, offersDiscount: 0, userDiscount: 0, itemsDiscount: 0, cardTotal: 0, cardCount: 0 };
    const hours = Array.from({ length: 24 }, (_, h) => ({ h, t: 0, n: 0 }));
    const sections = new Map();
    const terminals = new Map();
    const cashiers = new Map();
    const sellers = new Map();
    const products = new Map();
    for (const p of packs) {
      const t = p.totals || {};
      for (const k of Object.keys(totals)) totals[k] += num(t[k]);
      for (const h of p.hours || []) {
        hours[h.h].t += num(h.t);
        hours[h.h].n += num(h.n);
      }
      mergeNamed(sections, p.sections);
      mergeNamed(terminals, p.terminals);
      mergeNamed(cashiers, p.cashiers);
      mergeNamed(sellers, p.sellers);
      mergeNamed(products, p.products);
    }
    return {
      totals,
      hours,
      sections: sorted(sections),
      terminals: sorted(terminals),
      cashiers: sorted(cashiers),
      sellers: sorted(sellers),
      products: sorted(products).slice(0, 80),
    };
  }

  /** إجماليات الأيام في المدة (اليوم من الحزمة الحية) */
  function dailyRows(from, to) {
    const rows = db.prepare('SELECT day, net, receipts, returns AS returnsTotal, pieces FROM sales_totals WHERE day >= ? AND day <= ? ORDER BY day').all(from, to);
    const t = today();
    if (live?.pack && t >= from && t <= to) {
      const lt = live.pack.totals || {};
      const row = { day: t, net: num(lt.net), receipts: num(lt.receipts), returnsTotal: num(lt.returnsTotal), pieces: num(lt.pieces) };
      const i = rows.findIndex(r => r.day === t);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    }
    return rows;
  }

  const sumRows = rows => rows.reduce((a, r) => ({ net: a.net + r.net, receipts: a.receipts + r.receipts, pieces: a.pieces + r.pieces, returnsTotal: a.returnsTotal + r.returnsTotal, days: a.days + (r.receipts > 0 ? 1 : 0) }), { net: 0, receipts: 0, pieces: 0, returnsTotal: 0, days: 0 });

  /** متوسط آخر 4 أيام من نفس يوم الأسبوع (بالساعة) — لتوقّع نهاية اليوم */
  function sameWeekdayAvg(day) {
    const packs = [7, 14, 21, 28].map(n => packOf(shift(day, -n))).filter(Boolean);
    if (!packs.length) return null;
    const hours = Array.from({ length: 24 }, (_, h) => ({ h, t: 0, n: 0 }));
    let net = 0;
    for (const p of packs) {
      net += num(p.totals?.net);
      for (const h of p.hours || []) {
        hours[h.h].t += num(h.t) / packs.length;
        hours[h.h].n += num(h.n) / packs.length;
      }
    }
    return { weeks: packs.length, net: net / packs.length, hours };
  }

  function dayView(day) {
    const t = today();
    const isToday = day === t;
    const pack = packOf(day);
    return {
      day,
      isToday,
      pack,
      recent: isToday ? live?.recent || [] : [],
      terminalsLive: isToday ? live?.terminals || [] : [],
      at: isToday ? live?.at || null : null,
      receivedAt: isToday ? live?.receivedAt || null : null,
      compare: {
        prev: packOf(shift(day, -1)),
        lastWeek: packOf(shift(day, -7)),
        avg4: sameWeekdayAvg(day),
      },
      bounds: { min: db.prepare('SELECT MIN(day) AS d FROM sales_totals').get().d || null, max: t },
    };
  }

  function rangeView(from, to) {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
    const days = dailyRows(from, to);
    const prevTo = shift(from, -1);
    const prevFrom = shift(from, -span);
    const prevDays = dailyRows(prevFrom, prevTo);
    // تفصيل الأقسام والكاشيرية والبائعين والمنتجات والساعات من الحزم (حتى 120 يوماً)
    const packs = [];
    if (span <= 120) for (let d = from; d <= to; d = shift(d, 1)) {
      const p = packOf(d);
      if (p) packs.push(p);
    }
    // أيام الأسبوع (0 = السبت) × الساعة
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const weekday = Array.from({ length: 7 }, (_, w) => ({ w, net: 0, days: 0 }));
    for (const p of packs) {
      const w = (new Date(`${p.day}T12:00:00Z`).getUTCDay() + 1) % 7;
      for (const h of p.hours || []) heat[w][h.h] += num(h.t);
    }
    for (const r of days) {
      if (!r.receipts) continue;
      const w = (new Date(`${r.day}T12:00:00Z`).getUTCDay() + 1) % 7;
      weekday[w].net += r.net;
      weekday[w].days += 1;
    }
    return {
      from,
      to,
      span,
      days,
      sum: sumRows(days),
      prev: { from: prevFrom, to: prevTo, sum: sumRows(prevDays), days: prevDays },
      detail: packs.length ? { ...aggregate(packs), dayCount: packs.length } : null,
      heat,
      weekday,
      bounds: { min: db.prepare('SELECT MIN(day) AS d FROM sales_totals').get().d || null, max: today() },
    };
  }

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  async function handleManage(req, res, url, sub, send, actor) {
    if (!/^sales(\/|$)/.test(sub)) return false;
    if (sub === 'sales/alerts') {
      if (req.method === 'GET') return send(200, alertSettings()), true;
      if (req.method === 'PUT') {
        let body = {};
        try {
          body = JSON.parse((await ctx.readBody(req)) || '{}');
        } catch {
          return send(400, { error: 'طلب غير صالح' }), true;
        }
        return send(200, saveAlertSettings(body, actor)), true;
      }
    }
    if (req.method !== 'GET') return false;
    if (sub === 'sales/live') return send(200, dayView(today())), true;
    if (sub === 'sales/day') {
      const day = url.searchParams.get('date') || today();
      if (!DAY_RE.test(day)) return send(400, { error: 'تاريخ غير صحيح' }), true;
      return send(200, dayView(day)), true;
    }
    if (sub === 'sales/range') {
      const t = today();
      let from = url.searchParams.get('from') || shift(t, -29);
      let to = url.searchParams.get('to') || t;
      if (!DAY_RE.test(from) || !DAY_RE.test(to)) return send(400, { error: 'تاريخ غير صحيح' }), true;
      if (from > to) [from, to] = [to, from];
      if (from < shift(to, -400)) from = shift(to, -400);
      return send(200, rangeView(from, to)), true;
    }
    return false;
  }

  return { handleSync, handleManage, live: () => live };
}

module.exports = { createSales };
