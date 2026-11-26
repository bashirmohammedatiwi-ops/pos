'use strict';

/*
 * تطبيق الفريق — الصناديق وتقارير «إداري» لتطبيق المدراء (على خادم الـ VPS):
 *   · أرصدة الصناديق: يرفعها سيرفر المحل كل نصف دقيقة (/api/sync/cash) وتصل للمدراء لحظياً.
 *   · التقارير عند الطلب (كشف صندوق لفترة…): خادم الفريق لا يستطيع الاتصال بالمحل، فيضع الطلب
 *     في طابور؛ سيرفر المحل ينتظر الطابور بطلب معلّق (/api/sync/jobs) فيصله خلال لحظة، ينفّذه على
 *     الإداري ويعيد النتيجة (/api/sync/jobs/{id}). المدير ينتظر الرد في الطلب نفسه.
 *   · تقرير مبيعات الإداري (أشجار المواد والفروع والأيام) بالطابور نفسه: /api/team/m/edari/sales.
 * الصلاحية: viewCash للصناديق (مطفأة افتراضياً — تُفعَّل لكل مدير من لوحة التحكم)، و viewSales لتقرير المبيعات.
 */

const JOB_TIMEOUT_MS = 40_000;
const RESULT_CACHE_MS = 15_000;
// أقصى فترة لتقرير المبيعات (كما في سيرفر المحل)
const SALES_MAX_DAYS = 93;
// أرصدة أقدم من هذا تُعرض مع تنبيه «سيرفر المحل غير متصل»
const STALE_MS = 4 * 60_000;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

function createCash({ db, ctx, now, permsOf, managerIds, emit, notify, audit }) {
  db.exec('CREATE TABLE IF NOT EXISTS cash_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const load = key => {
    const row = db.prepare('SELECT value, updated_at FROM cash_state WHERE key = ?').get(key);
    try {
      return row ? { value: JSON.parse(row.value), at: row.updated_at } : null;
    } catch {
      return null;
    }
  };
  const save = (key, value) =>
    db.prepare('INSERT INTO cash_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(value), now());

  let snapshot = load('boxes'); // { value: CashBoxesDto, at }
  let shopError = null; // آخر خطأ أبلغ به سيرفر المحل (الإداري مطفأ)
  let shopSeenAt = 0; // آخر مرة انتظر فيها سيرفر المحل الطابور

  const viewers = () => managerIds().filter(id => permsOf(id).perms.viewCash);

  /* ── تنبيهات الصناديق (لمن يملك viewCash) ── */
  db.exec('CREATE TABLE IF NOT EXISTS cash_alert_log (day TEXT NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (day, key))');
  const ALERT_DEFAULTS = { bigOut: 2_000_000, bigOutUsd: 1000, negative: true, dailyClose: true, closeAt: '22:30' };
  function alertSettings() {
    const saved = load('alerts')?.value ?? {};
    return { ...ALERT_DEFAULTS, ...saved };
  }
  function saveAlertSettings(body, actor) {
    const cur = alertSettings();
    const money = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
    const next = {
      bigOut: money(body.bigOut, cur.bigOut),
      bigOutUsd: money(body.bigOutUsd, cur.bigOutUsd),
      negative: body.negative !== undefined ? !!body.negative : cur.negative,
      dailyClose: body.dailyClose !== undefined ? !!body.dailyClose : cur.dailyClose,
      closeAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.closeAt || '')) ? body.closeAt : cur.closeAt,
    };
    save('alerts', next);
    audit?.(actor, 'cash.alerts', null, next);
    return next;
  }
  const fmtAmount = (v, c) => (c === 'USD' ? `$${Math.round(v).toLocaleString('en-US')}` : `${Math.round(v).toLocaleString('en-US')} د.ع`);
  const compact = (v, c) => {
    if (c === 'USD') return fmtAmount(v, c);
    const a = Math.abs(v);
    const trim = (x, d) => x.toFixed(d).replace(/\.0+$/, '');
    if (a >= 1e6) return `${trim(v / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} مليون`;
    if (a >= 1e3) return `${Math.round(v / 1e3)} ألف`;
    return String(Math.round(v));
  };
  /** تنبيه واحد لكل مفتاح في اليوم */
  function alertOnce(day, key, n) {
    const ids = viewers();
    if (!ids.length || !notify) return;
    const r = db.prepare('INSERT INTO cash_alert_log (day, key, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(day, key, now());
    if (r.changes) notify('manager', ids, n);
  }
  /** يقارن اللقطة الجديدة بالسابقة: صرف كبير جديد من صندوق، أو صندوق صار سالباً */
  function checkAlerts(prev, next) {
    if (!prev || !next || prev.today !== next.today) return;
    const s = alertSettings();
    const before = new Map((prev.boxes || []).map(b => [b.seq, b]));
    for (const b of next.boxes || []) {
      const o = before.get(b.seq);
      if (!o) continue;
      const added = Number(b.todayOut) - Number(o.todayOut);
      const limit = b.currency === 'USD' ? s.bigOutUsd : s.bigOut;
      if (limit > 0 && added >= limit) {
        const moves = Math.max(1, Number(b.todayCount) - Number(o.todayCount));
        alertOnce(next.today, `out:${b.seq}:${b.todayCount}`, {
          type: 'cash.out',
          title: `صرف ${fmtAmount(added, b.currency)} من ${b.name}`,
          body: `الرصيد الآن ${fmtAmount(b.balance, b.currency)}${moves > 1 ? ` · ${moves} حركات` : ''}`,
          link: `/cash/${b.seq}`,
        });
      }
      if (s.negative && Number(b.balance) < 0 && Number(o.balance) >= 0)
        alertOnce(next.today, `neg:${b.seq}`, { type: 'cash.negative', title: `${b.name} صار بالسالب`, body: `الرصيد ${fmtAmount(b.balance, b.currency)} — راجع آخر الحركات`, link: `/cash/${b.seq}` });
    }
  }
  /** ملخص الصناديق البارزة عند الإغلاق بتبليغ واحد */
  function checkClose() {
    try {
      const s = alertSettings();
      if (!s.dailyClose || !snapshot?.value?.boxes?.length) return;
      const local = new Date(Date.now() + 3 * 3600_000);
      const day = local.toISOString().slice(0, 10);
      if (local.toISOString().slice(11, 16) < s.closeAt || snapshot.value.today !== day) return;
      if (Date.now() - Date.parse(snapshot.at) > STALE_MS) return; // أرقام قديمة: لا ملخص مضلل
      const featured = snapshot.value.boxes.filter(b => b.featured);
      if (!featured.length) return;
      const parts = featured.map(b => `${b.name.replace(/^صندوق\s+/, '')} ${compact(b.balance, b.currency)}`);
      const moved = featured.filter(b => b.todayCount).length;
      alertOnce(day, 'close', { type: 'cash.close', title: 'الصناديق عند الإغلاق', body: parts.join(' · ') + (moved ? '' : ' · بلا حركة اليوم'), link: '/cash' });
    } catch (err) {
      console.error('cash close alert failed', err.message);
    }
  }
  setInterval(checkClose, 60_000).unref();
  const notifyViewers = data => {
    for (const id of viewers()) emit(`manager:${id}`, 'cash', data);
  };

  function boxesView() {
    const at = snapshot?.at ?? null;
    const age = at ? Date.now() - Date.parse(at) : Infinity;
    return {
      ...(snapshot?.value ?? { today: null, boxes: [], featured: [] }),
      receivedAt: at,
      stale: age > STALE_MS,
      // سيرفر المحل متصل الآن وينتظر الطلبات
      shopOnline: Date.now() - shopSeenAt < 60_000,
      error: shopError,
    };
  }

  /* ── طابور الطلبات ── */
  let nextId = Date.now() % 1_000_000;
  const jobs = new Map(); // id → { id, kind, params, taken, resolve, timer }
  const waiters = new Set(); // ردود سيرفر المحل المعلّقة
  const cache = new Map(); // "kind:params" → { at, result }

  const pendingJobs = () => [...jobs.values()].filter(j => !j.taken);
  function flushWaiters() {
    const list = pendingJobs();
    if (!list.length) return;
    for (const w of [...waiters]) {
      waiters.delete(w);
      clearTimeout(w.timer);
      for (const j of list) j.taken = true;
      ctx.sendOpen(w.res, 200, { jobs: list.map(j => ({ id: j.id, kind: j.kind, params: j.params })) });
      return; // طلب واحد يأخذ كل ما في الطابور
    }
  }
  /** يضع طلباً وينتظر رد سيرفر المحل. */
  function runJob(kind, params) {
    const key = `${kind}:${JSON.stringify(params)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < RESULT_CACHE_MS) return Promise.resolve({ ok: true, result: hit.result });
    return new Promise(resolve => {
      const id = ++nextId;
      const job = {
        id,
        kind,
        params,
        taken: false,
        resolve: out => {
          clearTimeout(job.timer);
          jobs.delete(id);
          if (out.ok) {
            cache.set(key, { at: Date.now(), result: out.result });
            if (cache.size > 60) cache.delete(cache.keys().next().value);
          }
          resolve(out);
        },
      };
      job.timer = setTimeout(
        () => job.resolve({ ok: false, status: 504, error: Date.now() - shopSeenAt < 90_000 ? 'تأخر سيرفر المحل في الرد — حاول مرة أخرى' : 'سيرفر المحل غير متصل الآن — تأكد أنه يعمل ومتصل بالإنترنت' }),
        JOB_TIMEOUT_MS,
      );
      jobs.set(id, job);
      flushWaiters();
    });
  }

  /* ── مسارات سيرفر المحل ── */
  async function handleSync(req, res, url) {
    const p = url.pathname;
    if (p !== '/api/sync/cash' && !p.startsWith('/api/sync/jobs')) return false;
    if (!ctx.syncAuthorized(req)) return ctx.sendOpen(res, 401, { error: 'مفتاح المزامنة غير صحيح' }), true;
    shopSeenAt = Date.now();

    if (p === '/api/sync/cash' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        return ctx.sendOpen(res, 400, { error: 'bad json' }), true;
      }
      if (body.boxes && Array.isArray(body.boxes.boxes)) {
        try {
          checkAlerts(snapshot?.value, body.boxes);
        } catch (err) {
          console.error('cash alerts failed', err.message);
        }
        save('boxes', body.boxes);
        snapshot = { value: body.boxes, at: now() };
        shopError = null;
        notifyViewers({ at: snapshot.at });
      } else if (body.error) {
        const changed = shopError !== String(body.error);
        shopError = String(body.error).slice(0, 300);
        if (changed) notifyViewers({ error: shopError });
      }
      return ctx.sendOpen(res, 200, { ok: true }), true;
    }

    // طلب معلّق: يعود فور وصول طلب، أو فارغاً بعد المهلة
    if (p === '/api/sync/jobs' && req.method === 'GET') {
      const wait = Math.max(0, Math.min(28, Number(url.searchParams.get('wait') || 0))) * 1000;
      const list = pendingJobs();
      if (list.length || !wait) {
        for (const j of list) j.taken = true;
        return ctx.sendOpen(res, 200, { jobs: list.map(j => ({ id: j.id, kind: j.kind, params: j.params })) }), true;
      }
      const w = { res, timer: null };
      w.timer = setTimeout(() => {
        waiters.delete(w);
        ctx.sendOpen(res, 200, { jobs: [] });
      }, wait);
      waiters.add(w);
      req.on('close', () => {
        clearTimeout(w.timer);
        waiters.delete(w);
      });
      return true;
    }

    const m = p.match(/^\/api\/sync\/jobs\/(\d+)$/);
    if (m && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        return ctx.sendOpen(res, 400, { error: 'bad json' }), true;
      }
      const job = jobs.get(Number(m[1]));
      if (job) job.resolve(body.ok ? { ok: true, result: body.result } : { ok: false, status: 502, error: String(body.error || 'تعذر تنفيذ التقرير').slice(0, 300) });
      return ctx.sendOpen(res, 200, { ok: true }), true;
    }
    return false;
  }

  /* ── مسارات المدير: /api/team/m/cash/* و /api/team/m/edari/sales ── */
  async function handleManage(req, res, url, sub, send, actor) {
    if (req.method === 'POST' && sub === 'edari/sales') {
      let body = {};
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        /* فارغ */
      }
      const from = isDate(body.from) ? body.from : null;
      let to = isDate(body.to) ? body.to : from;
      if (!from) return send(400, { error: 'حدد التاريخ' }), true;
      if (to < from) to = from;
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > SALES_MAX_DAYS) return send(400, { error: `أقصى فترة للتقرير ${SALES_MAX_DAYS} يوماً — اختر فترة أقصر` }), true;
      const branches = (Array.isArray(body.branches) ? body.branches : [])
        .map(b => String(b).replace(/[^0-9]/g, ''))
        .filter(Boolean)
        .slice(0, 40)
        .sort();
      const node = Number.isInteger(Number(body.node)) && Number(body.node) > 0 ? Number(body.node) : 0;
      const q = typeof body.q === 'string' ? body.q.trim().slice(0, 80) : '';
      const params = { from, to, branches: branches.join(','), node, q, lines: body.lines === true && node > 0, maxLines: 800 };
      if (body.compare === true) params.compare = true;
      if (body.fresh === true) params.fresh = true;
      const out = await runJob('sales.report', params);
      return send(out.ok ? 200 : out.status, out.ok ? out.result : { error: out.error }), true;
    }
    if (!/^cash(\/|$)/.test(sub)) return false;
    if (req.method === 'GET' && sub === 'cash/boxes') return send(200, boxesView()), true;
    if (sub === 'cash/alerts') {
      if (req.method === 'GET') return send(200, alertSettings()), true;
      if (req.method === 'PUT') {
        let body = {};
        try {
          body = JSON.parse((await ctx.readBody(req)) || '{}');
        } catch {
          /* فارغ */
        }
        return send(200, saveAlertSettings(body, actor || 'manager')), true;
      }
    }
    // حركة الأموال: من أين جاء المال وإلى أين ذهب (كل الصناديق أو صندوق واحد)
    if (req.method === 'POST' && sub === 'cash/flow') {
      let body = {};
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        /* فارغ */
      }
      const from = isDate(body.from) ? body.from : null;
      let to = isDate(body.to) ? body.to : from;
      if (!from) return send(400, { error: 'حدد التاريخ' }), true;
      if (to < from) to = from;
      const seq = Number.isInteger(Number(body.seq)) && Number(body.seq) > 0 ? Number(body.seq) : 0;
      if (seq && snapshot && !snapshot.value.boxes.some(b => Number(b.seq) === seq)) return send(404, { error: 'الصندوق غير موجود' }), true;
      const out = await runJob('cash.flow', seq ? { from, to, seq } : { from, to });
      return send(out.ok ? 200 : out.status, out.ok ? out.result : { error: out.error }), true;
    }
    if (req.method === 'POST' && sub === 'cash/statement') {
      let body = {};
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        /* فارغ */
      }
      const seq = Number(body.seq);
      if (!Number.isInteger(seq) || seq <= 0) return send(400, { error: 'اختر الصندوق' }), true;
      // صناديق اللقطة الأخيرة فقط: لا يُطلب كشف حساب آخر من دليل الحسابات
      if (snapshot && !snapshot.value.boxes.some(b => Number(b.seq) === seq)) return send(404, { error: 'الصندوق غير موجود' }), true;
      const from = isDate(body.from) ? body.from : null;
      const to = isDate(body.to) ? body.to : from;
      if (!from) return send(400, { error: 'حدد التاريخ' }), true;
      const out = await runJob('cash.statement', { seq, from, to: to < from ? from : to });
      return send(out.ok ? 200 : out.status, out.ok ? out.result : { error: out.error }), true;
    }
    return false;
  }

  return { handleSync, handleManage, boxesView };
}

module.exports = { createCash };
