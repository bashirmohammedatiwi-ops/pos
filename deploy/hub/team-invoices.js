'use strict';

/*
 * الفواتير الكاملة لتطبيق المدراء (صلاحية viewInvoices).
 * سيرفر المحل يرفع:
 *   rows        — فواتير جديدة خلال ثوانٍ من البيع (POST /api/sync/sales/invoices)
 *   day + rows  — يوم كامل يحل محل ما عندنا (ناقص أو تغيّر: بيع متأخر، تعديل فاتورة)
 *   status      — عدد فواتير المحل والأيام المتبقية للنقل
 * ويقرأ /api/sync/sales/invoices/state ليعرف ما الذي نقص، بالبصمة نفسها التي يحسبها هو.
 * المدير: /api/team/m/invoices (بحث وفلاتر وملخص) و invoices/facets و invoices/status و invoices/:id.
 * الصافي بالشروط نفسها في تحليلات المبيعات: البيع + ، المرتجع − ، الهدية تُعدّ فقط.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 40;

function createInvoices({ db, ctx, now, permsOf, managerIds, emit }) {
  db.exec('CREATE TABLE IF NOT EXISTS _invoice_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE sales_invoices (
       id INTEGER PRIMARY KEY,
       number INTEGER NOT NULL,
       printed INTEGER,
       day TEXT NOT NULL,
       at TEXT NOT NULL,
       kind INTEGER NOT NULL,
       total REAL NOT NULL,
       line_count INTEGER NOT NULL,
       pieces REAL NOT NULL,
       card INTEGER NOT NULL,
       cashier TEXT,
       pos TEXT,
       seller TEXT,
       sellers TEXT NOT NULL,
       return_of INTEGER,
       edits INTEGER NOT NULL,
       preview TEXT,
       search TEXT NOT NULL,
       detail TEXT NOT NULL
     );
     CREATE INDEX idx_invoices_day ON sales_invoices (day, at DESC, id DESC);
     CREATE INDEX idx_invoices_at ON sales_invoices (at DESC, id DESC);
     CREATE INDEX idx_invoices_number ON sales_invoices (number);
     CREATE INDEX idx_invoices_printed ON sales_invoices (printed);
     CREATE INDEX idx_invoices_return ON sales_invoices (return_of);
     CREATE TABLE sales_invoice_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  ];
  const applied = new Set(db.prepare('SELECT id FROM _invoice_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    if (applied.has(i + 1)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _invoice_migrations (id, applied_at) VALUES (?, ?)').run(i + 1, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const str = v => (v == null || v === '' ? null : String(v));
  const viewers = () => managerIds().filter(id => permsOf(id).perms.viewInvoices);
  /** الرقم الظاهر للمستخدم: رقم الفاتورة الورقية إن رُبطت */
  const shown = r => (r.printed > 0 ? r.printed : r.number);

  const upsert = db.prepare(`INSERT OR REPLACE INTO sales_invoices
    (id, number, printed, day, at, kind, total, line_count, pieces, card, cashier, pos, seller, sellers, return_of, edits, preview, search, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function store(r) {
    const id = num(r.id);
    const at = String(r.at || '');
    const day = at.slice(0, 10);
    if (!id || !DAY_RE.test(day)) return false;
    const lines = (Array.isArray(r.lines) ? r.lines : []).map(l => ({
      name: str(l.name) || 'مادة محذوفة',
      barcode: str(l.barcode),
      qty: num(l.qty),
      price: num(l.price),
      original: num(l.original),
      discount: num(l.discount),
      seller: str(l.seller),
      group: str(l.group),
    }));
    const lineSellers = lines.map(l => l.seller).filter(Boolean);
    const sellerNames = [...new Set(lineSellers.length ? lineSellers : r.seller ? [String(r.seller)] : [])];
    const detail = {
      itemsDiscount: num(r.itemsDiscount),
      offersDiscount: num(r.offersDiscount),
      userDiscount: num(r.userDiscount),
      payment: num(r.payment),
      cashBack: num(r.cashBack),
      section: str(r.section),
      remarks: str(r.remarks),
      voucher: str(r.voucher),
      discountPerson: str(r.discountPerson),
      card: r.card ? { type: str(r.cardType), acquirer: str(r.cardAcquirer), last4: str(r.cardLast4), ref: str(r.cardRef), terminal: str(r.cardTerminal) } : null,
      lines,
    };
    const search = lines
      .flatMap(l => [l.name, l.barcode])
      .concat(sellerNames, [r.cashier, r.pos, r.remarks, r.voucher, r.discountPerson])
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    upsert.run(
      id,
      num(r.number),
      r.printed > 0 ? num(r.printed) : null,
      day,
      at,
      num(r.kind),
      num(r.total),
      lines.length,
      lines.reduce((s, l) => s + Math.abs(l.qty), 0),
      r.card ? 1 : 0,
      str(r.cashier),
      str(r.pos),
      str(r.seller),
      sellerNames.length ? `|${sellerNames.join('|')}|` : '',
      num(r.returnOf) || null,
      num(r.edits),
      lines[0]?.name || null,
      search,
      JSON.stringify(detail),
    );
    return true;
  }

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function applySync(body) {
    let stored = 0;
    if (body.day && DAY_RE.test(String(body.day)) && Array.isArray(body.rows)) {
      // يوم كامل: ما لم يصل فيه لم يعد موجوداً في المحل
      tx(() => {
        db.prepare('DELETE FROM sales_invoices WHERE day = ?').run(body.day);
        for (const r of body.rows) if (String(r.at || '').slice(0, 10) === body.day && store(r)) stored++;
      });
    } else if (Array.isArray(body.rows) && body.rows.length) {
      tx(() => {
        for (const r of body.rows) if (store(r)) stored++;
      });
      if (stored) for (const id of viewers()) emit(`manager:${id}`, 'invoices', { count: stored });
    }
    if (body.status && typeof body.status === 'object') {
      const value = JSON.stringify({ shopCount: num(body.status.shopCount), pendingDays: num(body.status.pendingDays), at: str(body.status.at), receivedAt: now() });
      db.prepare("INSERT INTO sales_invoice_state (key, value) VALUES ('sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
    }
    return { ok: true, stored };
  }

  function signatures() {
    const days = db
      .prepare(`SELECT day, COUNT(*) AS n, MAX(id) AS maxId, ROUND(SUM(total), 2) AS sum, SUM(edits) AS edits, COALESCE(SUM(printed), 0) AS printed
                FROM sales_invoices GROUP BY day`)
      .all();
    const maxId = days.reduce((m, d) => Math.max(m, d.maxId), 0);
    return { maxId, days };
  }

  async function handleSync(req, res, url) {
    if (url.pathname !== '/api/sync/sales/invoices' && url.pathname !== '/api/sync/sales/invoices/state') return false;
    if (!ctx.syncAuthorized(req)) return ctx.sendOpen(res, 401, { error: 'مفتاح المزامنة غير صحيح' }), true;
    if (url.pathname.endsWith('/state') && req.method === 'GET') return ctx.sendOpen(res, 200, signatures()), true;
    if (url.pathname.endsWith('/invoices') && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await ctx.readBody(req)) || '{}');
      } catch {
        return ctx.sendOpen(res, 400, { error: 'bad json' }), true;
      }
      return ctx.sendOpen(res, 200, applySync(body)), true;
    }
    return ctx.sendOpen(res, 405, { error: 'method' }), true;
  }

  /* ── القراءة للمدير ── */

  const likeEscape = s => s.replace(/[\\%_]/g, m => `\\${m}`);

  /** شروط الفلاتر: الكلمات كلها يجب أن تظهر (اسم مادة أو باركود أو بائع…)، والرقم يطابق رقم الفاتورة أيضاً */
  function whereOf(q) {
    const sql = [];
    const args = [];
    const from = q.get('from');
    const to = q.get('to');
    if (from && DAY_RE.test(from)) (sql.push('day >= ?'), args.push(from));
    if (to && DAY_RE.test(to)) (sql.push('day <= ?'), args.push(to));
    const kind = q.get('kind');
    if (kind === '0' || kind === '1' || kind === '2') (sql.push('kind = ?'), args.push(Number(kind)));
    if (q.get('pay') === 'card') sql.push('card = 1');
    if (q.get('pay') === 'cash') sql.push('card = 0 AND kind <> 2');
    if (q.get('cashier')) (sql.push('cashier = ?'), args.push(q.get('cashier')));
    if (q.get('pos')) (sql.push('pos = ?'), args.push(q.get('pos')));
    if (q.get('seller')) (sql.push("sellers LIKE ? ESCAPE '\\'"), args.push(`%|${likeEscape(q.get('seller'))}|%`));
    const min = Number(q.get('min'));
    if (min > 0) (sql.push('total >= ?'), args.push(min));
    const max = Number(q.get('max'));
    if (max > 0) (sql.push('total <= ?'), args.push(max));
    const words = String(q.get('q') || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const w of words) {
      const like = `%${likeEscape(w)}%`;
      if (/^\d+$/.test(w)) {
        sql.push(`(CAST(number AS TEXT) LIKE ? ESCAPE '\\' OR CAST(printed AS TEXT) LIKE ? ESCAPE '\\' OR search LIKE ? ESCAPE '\\')`);
        args.push(like, like, like);
      } else {
        sql.push(`search LIKE ? ESCAPE '\\'`);
        args.push(like);
      }
    }
    return { where: sql.length ? `WHERE ${sql.join(' AND ')}` : '', args };
  }

  const ORDER = {
    new: 'at DESC, id DESC',
    old: 'at ASC, id ASC',
    high: 'total DESC, id DESC',
    low: 'total ASC, id DESC',
  };

  const rowOut = r => ({
    id: r.id,
    number: shown(r),
    at: r.at,
    day: r.day,
    kind: r.kind,
    total: r.total,
    lines: r.line_count,
    pieces: r.pieces,
    card: !!r.card,
    cashier: r.cashier,
    pos: r.pos,
    seller: r.seller,
    preview: r.preview,
    edited: r.edits > 0,
    returnOf: r.return_of,
  });

  function list(url) {
    const q = url.searchParams;
    const { where, args } = whereOf(q);
    const offset = Math.max(0, Math.floor(Number(q.get('offset')) || 0));
    const order = ORDER[q.get('sort')] || ORDER.new;
    const rows = db
      .prepare(`SELECT id, number, printed, at, day, kind, total, line_count, pieces, card, cashier, pos, seller, preview, edits, return_of
                FROM sales_invoices ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, PAGE, offset)
      .map(rowOut);
    const s = db
      .prepare(`SELECT COUNT(*) AS count,
                  COALESCE(SUM(CASE kind WHEN 0 THEN total WHEN 1 THEN -total ELSE 0 END), 0) AS net,
                  COALESCE(SUM(CASE WHEN kind = 0 THEN 1 ELSE 0 END), 0) AS sales,
                  COALESCE(SUM(CASE WHEN kind = 0 THEN total ELSE 0 END), 0) AS salesTotal,
                  COALESCE(SUM(CASE WHEN kind = 1 THEN 1 ELSE 0 END), 0) AS returns,
                  COALESCE(SUM(CASE WHEN kind = 1 THEN total ELSE 0 END), 0) AS returnsTotal,
                  COALESCE(SUM(CASE WHEN kind = 2 THEN 1 ELSE 0 END), 0) AS gifts,
                  COALESCE(SUM(CASE WHEN kind = 2 THEN total ELSE 0 END), 0) AS giftsTotal,
                  COALESCE(SUM(CASE kind WHEN 0 THEN pieces WHEN 1 THEN -pieces ELSE 0 END), 0) AS pieces,
                  COALESCE(SUM(CASE WHEN card = 1 AND kind = 0 THEN total WHEN card = 1 AND kind = 1 THEN -total ELSE 0 END), 0) AS cardTotal
                FROM sales_invoices ${where}`)
      .get(...args);
    const dayRows = rows.length
      ? db
          .prepare(`SELECT day, COUNT(*) AS n, COALESCE(SUM(CASE kind WHEN 0 THEN total WHEN 1 THEN -total ELSE 0 END), 0) AS net
                    FROM sales_invoices ${where ? `${where} AND` : 'WHERE'} day IN (${[...new Set(rows.map(r => r.day))].map(() => '?').join(',')}) GROUP BY day`)
          .all(...args, ...new Set(rows.map(r => r.day)))
      : [];
    return {
      rows,
      summary: s,
      days: Object.fromEntries(dayRows.map(d => [d.day, { n: d.n, net: d.net }])),
      hasMore: offset + rows.length < s.count,
      sync: syncStatus(),
    };
  }

  function facets(url) {
    const q = new URLSearchParams();
    if (url.searchParams.get('from')) q.set('from', url.searchParams.get('from'));
    if (url.searchParams.get('to')) q.set('to', url.searchParams.get('to'));
    const { where, args } = whereOf(q);
    const col = c => db.prepare(`SELECT DISTINCT ${c} AS v FROM sales_invoices ${where ? `${where} AND` : 'WHERE'} ${c} IS NOT NULL ORDER BY v`).all(...args).map(r => r.v);
    const sellers = new Set();
    for (const r of db.prepare(`SELECT DISTINCT sellers AS v FROM sales_invoices ${where}`).all(...args)) {
      for (const name of String(r.v).split('|')) if (name) sellers.add(name);
    }
    return { cashiers: col('cashier'), pos: col('pos'), sellers: [...sellers].sort((a, b) => a.localeCompare(b, 'ar')) };
  }

  function syncStatus() {
    const row = db.prepare("SELECT value FROM sales_invoice_state WHERE key = 'sync'").get();
    const state = row ? JSON.parse(row.value) : null;
    const t = db.prepare('SELECT COUNT(*) AS count, MIN(day) AS firstDay, MAX(at) AS lastAt FROM sales_invoices').get();
    return { count: t.count, firstDay: t.firstDay, lastAt: t.lastAt, shopCount: state?.shopCount ?? null, pendingDays: state?.pendingDays ?? null, checkedAt: state?.receivedAt ?? null };
  }

  const brief = r => ({ id: r.id, number: shown(r), at: r.at, kind: r.kind, total: r.total });

  function detail(id) {
    const r = db.prepare('SELECT * FROM sales_invoices WHERE id = ?').get(id);
    if (!r) return null;
    const near = (op, dir) =>
      db.prepare(`SELECT id FROM sales_invoices WHERE at ${op} ? OR (at = ? AND id ${op} ?) ORDER BY at ${dir}, id ${dir} LIMIT 1`).get(r.at, r.at, r.id)?.id ?? null;
    const source = r.return_of ? db.prepare('SELECT id, number, printed, at, kind, total FROM sales_invoices WHERE id = ?').get(r.return_of) : null;
    return {
      ...rowOut(r),
      systemNumber: r.number,
      ...JSON.parse(r.detail),
      returnOfInvoice: source ? brief(source) : null,
      returns: db.prepare('SELECT id, number, printed, at, kind, total FROM sales_invoices WHERE return_of = ? ORDER BY at').all(r.id).map(brief),
      newer: near('>', 'ASC'),
      older: near('<', 'DESC'),
    };
  }

  async function handleManage(req, res, url, sub, send) {
    if (!/^invoices(\/|$)/.test(sub)) return false;
    if (req.method !== 'GET') return send(405, { error: 'method' }), true;
    if (sub === 'invoices') return send(200, list(url)), true;
    if (sub === 'invoices/facets') return send(200, facets(url)), true;
    if (sub === 'invoices/status') return send(200, syncStatus()), true;
    const m = sub.match(/^invoices\/(\d+)$/);
    if (!m) return false;
    const out = detail(Number(m[1]));
    return out ? send(200, out) : send(404, { error: 'الفاتورة غير موجودة' }), true;
  }

  return { handleSync, handleManage };
}

module.exports = { createInvoices };
