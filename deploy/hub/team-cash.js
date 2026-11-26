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

function createCash({ db, ctx, now, permsOf, managerIds, emit }) {
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
  async function handleManage(req, res, url, sub, send) {
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
      if (body.fresh === true) params.fresh = true;
      const out = await runJob('sales.report', params);
      return send(out.ok ? 200 : out.status, out.ok ? out.result : { error: out.error }), true;
    }
    if (!/^cash(\/|$)/.test(sub)) return false;
    if (req.method === 'GET' && sub === 'cash/boxes') return send(200, boxesView()), true;
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
