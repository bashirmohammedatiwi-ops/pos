'use strict';

/*
 * تطبيق الفريق — وحدات العمل على خادم الـ VPS (SQLite نفسها):
 *   · التبليغات: مركز تبليغات لكل مستخدم (موظف/مدير) + قناة حية SSE.
 *   · الإعلانات والعروض: منشورات بصور، جمهور محدد، تثبيت، تأكيد اطلاع، إحصاءات القراءة.
 *   · الوسائط: رفع الصور (مدير/إدارة/تقرير مرضي) وتقديمها بأسماء عشوائية.
 *   · الدوام والإجازات: عطلة أسبوعية لكل موظف، طلبات (تبديل/إجازة/مرضية/طارئة/استئذان)، موافقات.
 * المسارات: موظف /api/team/* ، مدير /api/team/m/* ، إدارة /api/admin/team/*
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const IRAQ_MS = 3 * 3600_000;
const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const LEAVE_TYPES = {
  swap: 'تبديل العطلة',
  day: 'إجازة',
  sick: 'إجازة مرضية',
  urgent: 'إجازة طارئة',
  hours: 'استئذان',
};
const POST_KINDS = ['news', 'offer', 'instruction', 'congrats', 'alert'];
const MEDIA_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** تاريخ اليوم بتوقيت العراق YYYY-MM-DD */
function iraqDate(ms = Date.now()) {
  return new Date(ms + IRAQ_MS).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** 0 = السبت … 6 = الجمعة (نفس ترتيب أوقات الفتح) */
function dayIdx(iso) {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7;
}
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

function createWork({ db, ctx, now, audit, getStaff }) {
  /* ── الجداول ── */
  db.exec('CREATE TABLE IF NOT EXISTS _work_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE notifications (
       id INTEGER PRIMARY KEY AUTOINCREMENT, user_kind TEXT NOT NULL, user_id INTEGER NOT NULL,
       type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, image TEXT, link TEXT, data TEXT,
       broadcast_id INTEGER, read_at TEXT, created_at TEXT NOT NULL
     );
     CREATE INDEX ix_notif_user ON notifications(user_kind, user_id, id);
     CREATE TABLE broadcasts (
       id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, image TEXT, link TEXT,
       audience TEXT NOT NULL, target_count INTEGER NOT NULL, created_by TEXT, created_at TEXT NOT NULL
     );
     CREATE TABLE posts (
       id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
       images TEXT NOT NULL DEFAULT '[]', audience TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
       requires_ack INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_by TEXT, created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
     );
     CREATE TABLE post_reads (
       post_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, read_at TEXT NOT NULL, ack_at TEXT,
       PRIMARY KEY (post_id, staff_id)
     );
     CREATE TABLE weekly_off (
       staff_id INTEGER PRIMARY KEY, days_mask INTEGER NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
     );
     CREATE TABLE leave_requests (
       id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, type TEXT NOT NULL,
       date_from TEXT, date_to TEXT, swap_from TEXT, swap_to TEXT, time_from TEXT, time_to TEXT,
       reason TEXT, attachment TEXT, status TEXT NOT NULL DEFAULT 'pending',
       decided_by TEXT, decided_note TEXT, decided_at TEXT, created_at TEXT NOT NULL
     );
     CREATE INDEX ix_leave_staff ON leave_requests(staff_id, id);
     CREATE INDEX ix_leave_status ON leave_requests(status, id);`,
  ];
  const done = new Set(db.prepare('SELECT id FROM _work_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    const id = i + 1;
    if (done.has(id)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _work_migrations (id, applied_at) VALUES (?, ?)').run(id, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  const mediaDir = path.join(ctx.dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  /* ═════════════ القناة الحية (SSE) ═════════════ */
  const streams = new Map(); // "staff:12" | "manager:3" → Set(res)
  function openStream(req, res, key) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    if (!streams.has(key)) streams.set(key, new Set());
    streams.get(key).add(res);
    const [kind, id] = key.split(':');
    res.write(`event: hello\ndata: ${JSON.stringify({ unread: unreadCount(kind, Number(id)) })}\n\n`);
    req.on('close', () => {
      const set = streams.get(key);
      set?.delete(res);
      if (set && !set.size) streams.delete(key);
    });
  }
  function emit(key, event, data) {
    const set = streams.get(key);
    if (!set) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(msg);
      } catch {
        /* مغلق */
      }
    }
  }
  function emitManagers(event, data) {
    for (const key of streams.keys()) if (key.startsWith('manager:')) emit(key, event, data);
  }
  setInterval(() => {
    for (const set of streams.values()) for (const res of set) {
      try {
        res.write(': ping\n\n');
      } catch {
        /* مغلق */
      }
    }
  }, 25_000).unref();

  /* ═════════════ الجمهور ═════════════ */
  function normAudience(a) {
    const out = {};
    if (!a || a.all) return { all: true };
    if (Array.isArray(a.kinds)) out.kinds = a.kinds.map(String).filter(k => ['seller', 'cashier', 'supervisor', 'other'].includes(k));
    if (Array.isArray(a.sections)) out.sections = a.sections.map(Number).filter(Boolean);
    if (Array.isArray(a.staff)) out.staff = a.staff.map(Number).filter(Boolean);
    if (!out.kinds?.length && !out.sections?.length && !out.staff?.length) return { all: true };
    return out;
  }
  function matches(a, s) {
    if (!a || a.all) return true;
    return !!(a.kinds?.includes(s.kind) || (s.section_id && a.sections?.includes(Number(s.section_id))) || a.staff?.includes(Number(s.id)));
  }
  const activeStaff = () => db.prepare('SELECT * FROM staff WHERE is_active = 1').all();
  const audienceIds = a => activeStaff().filter(s => matches(a, s)).map(s => s.id);
  function audienceLabel(a) {
    if (!a || a.all) return 'كل الموظفين';
    const parts = [];
    const K = { seller: 'البائعون', cashier: 'الكاشيرية', supervisor: 'المشرفون', other: 'موظفون آخرون' };
    if (a.kinds?.length) parts.push(a.kinds.map(k => K[k] || k).join('، '));
    if (a.sections?.length) parts.push(`${a.sections.length} قسم`);
    if (a.staff?.length) parts.push(`${a.staff.length} موظف`);
    return parts.join(' + ');
  }

  /* ═════════════ التبليغات ═════════════ */
  const insNotif = db.prepare(`INSERT INTO notifications (user_kind, user_id, type, title, body, image, link, data, broadcast_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  function unreadCount(kind, id) {
    return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_kind = ? AND user_id = ? AND read_at IS NULL').get(kind, id).n;
  }
  function notifView(r) {
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      image: r.image,
      link: r.link,
      data: r.data ? JSON.parse(r.data) : null,
      readAt: r.read_at,
      createdAt: r.created_at,
    };
  }
  /** يرسل تبليغاً لمجموعة مستخدمين: يُخزّن + يصل فوراً على القناة الحية + Firebase لاحقاً. */
  function notify(kind, ids, n, broadcastId = null) {
    const at = now();
    const list = [...new Set(ids.map(Number).filter(Boolean))];
    const rows = new Map();
    db.exec('BEGIN');
    try {
      for (const id of list) {
        const r = insNotif.run(kind, id, n.type, n.title, n.body ?? null, n.image ?? null, n.link ?? null, n.data ? JSON.stringify(n.data) : null, broadcastId, at);
        rows.set(id, { id: Number(r.lastInsertRowid), type: n.type, title: n.title, body: n.body ?? null, image: n.image ?? null, link: n.link ?? null, data: n.data ?? null, readAt: null, createdAt: at });
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const id of list) emit(`${kind}:${id}`, 'notify', { item: rows.get(id), unread: unreadCount(kind, id) });
    try {
      ctx.pushTo?.(kind, list, { title: n.title, body: n.body || '', link: n.link || '' });
    } catch {
      /* Firebase اختياري */
    }
    return list.length;
  }
  const managerIds = () => Object.values(ctx.getManagers?.() || {}).filter(m => m.isActive !== false).map(m => Number(m.id));

  function listNotifications(kind, id, url) {
    const before = Number(url.searchParams.get('before') || 0);
    const limit = Math.min(100, Number(url.searchParams.get('limit') || 40));
    const rows = before
      ? db.prepare('SELECT * FROM notifications WHERE user_kind = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(kind, id, before, limit)
      : db.prepare('SELECT * FROM notifications WHERE user_kind = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(kind, id, limit);
    return { items: rows.map(notifView), unread: unreadCount(kind, id) };
  }
  function markRead(kind, id, body) {
    const at = now();
    if (body.all) db.prepare('UPDATE notifications SET read_at = ? WHERE user_kind = ? AND user_id = ? AND read_at IS NULL').run(at, kind, id);
    else if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids.map(Number).filter(Boolean).slice(0, 500);
      db.prepare(`UPDATE notifications SET read_at = ? WHERE user_kind = ? AND user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(at, kind, id, ...ids);
    }
    const unread = unreadCount(kind, id);
    emit(`${kind}:${id}`, 'unread', { unread });
    return { unread };
  }

  /** تبليغ يدوي من الإدارة/المدير لجمهور محدد */
  function broadcast(body, actor) {
    const title = clip(body.title, 120);
    if (!title) return { status: 400, body: { error: 'العنوان مطلوب' } };
    const audience = normAudience(body.audience);
    const ids = audienceIds(audience);
    if (!ids.length) return { status: 400, body: { error: 'لا موظفين في هذا الجمهور' } };
    const r = db.prepare('INSERT INTO broadcasts (title, body, image, link, audience, target_count, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(title, clip(body.body, 2000), clip(body.image, 200), clip(body.link, 200), JSON.stringify(audience), ids.length, actor, now());
    const bid = Number(r.lastInsertRowid);
    notify('staff', ids, { type: 'broadcast', title, body: clip(body.body, 2000), image: clip(body.image, 200), link: clip(body.link, 200) }, bid);
    audit(actor, 'notify.broadcast', bid, { title, count: ids.length });
    return { status: 200, body: { ok: true, id: bid, count: ids.length } };
  }
  function broadcastLog() {
    return db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM notifications n WHERE n.broadcast_id = b.id AND n.read_at IS NOT NULL) AS read_count
      FROM broadcasts b ORDER BY b.id DESC LIMIT 100`).all().map(b => ({
      id: b.id,
      title: b.title,
      body: b.body,
      image: b.image,
      audience: JSON.parse(b.audience),
      audienceLabel: audienceLabel(JSON.parse(b.audience)),
      targetCount: b.target_count,
      readCount: b.read_count,
      createdBy: b.created_by,
      createdAt: b.created_at,
    }));
  }

  /* ═════════════ الوسائط ═════════════ */
  function saveMedia(body, maxBytes) {
    let data = String(body.data || '');
    let mime = String(body.mime || '');
    const m = data.match(/^data:([\w/+.-]+);base64,(.*)$/s);
    if (m) {
      mime = m[1];
      data = m[2];
    }
    const ext = MIME_EXT[mime];
    if (!ext) return { status: 400, body: { error: 'نوع الصورة غير مدعوم (JPG/PNG/WebP)' } };
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) return { status: 400, body: { error: 'الصورة فارغة' } };
    if (buf.length > maxBytes) return { status: 413, body: { error: `الصورة أكبر من ${Math.round(maxBytes / 1048576)} ميغابايت` } };
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(mediaDir, name), buf);
    return { status: 200, body: { url: `/api/team/media/${name}`, name, size: buf.length } };
  }
  function serveMedia(res, name) {
    if (!MEDIA_RE.test(name)) {
      ctx.sendOpen(res, 404, { error: 'not found' });
      return;
    }
    const file = path.join(mediaDir, name);
    if (!fs.existsSync(file)) {
      ctx.sendOpen(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': EXT_MIME[name.split('.').pop()],
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  }

  /* ═════════════ الإعلانات ═════════════ */
  function postView(p, s) {
    const read = s ? db.prepare('SELECT read_at, ack_at FROM post_reads WHERE post_id = ? AND staff_id = ?').get(p.id, s.id) : null;
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      images: JSON.parse(p.images || '[]'),
      pinned: !!p.pinned,
      requiresAck: !!p.requires_ack,
      expiresAt: p.expires_at,
      createdBy: p.created_by,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      read: !!read,
      acked: !!read?.ack_at,
    };
  }
  function postsFor(s) {
    const t = now();
    return db.prepare('SELECT * FROM posts WHERE deleted = 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY pinned DESC, id DESC LIMIT 200').all(t)
      .filter(p => matches(JSON.parse(p.audience), s))
      .map(p => postView(p, s));
  }
  function postsAdmin() {
    const staff = activeStaff();
    return db.prepare('SELECT * FROM posts WHERE deleted = 0 ORDER BY pinned DESC, id DESC LIMIT 200').all().map(p => {
      const a = JSON.parse(p.audience);
      const target = staff.filter(s => matches(a, s)).length;
      const c = db.prepare('SELECT COUNT(*) AS r, SUM(CASE WHEN ack_at IS NOT NULL THEN 1 ELSE 0 END) AS a FROM post_reads WHERE post_id = ?').get(p.id);
      return { ...postView(p, null), audience: a, audienceLabel: audienceLabel(a), targetCount: target, readCount: c.r || 0, ackCount: c.a || 0, expired: !!(p.expires_at && p.expires_at <= now()) };
    });
  }
  function postReaders(id) {
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!p) return null;
    const a = JSON.parse(p.audience);
    const reads = new Map(db.prepare('SELECT * FROM post_reads WHERE post_id = ?').all(id).map(r => [r.staff_id, r]));
    return activeStaff().filter(s => matches(a, s)).map(s => {
      const r = reads.get(s.id);
      return { staffId: s.id, name: s.name, kind: s.kind, sectionName: s.section_name, readAt: r?.read_at ?? null, ackAt: r?.ack_at ?? null };
    }).sort((x, y) => (x.readAt ? 1 : 0) - (y.readAt ? 1 : 0) || x.name.localeCompare(y.name, 'ar'));
  }
  function savePost(id, body, actor) {
    const title = clip(body.title, 160);
    if (!title) return { status: 400, body: { error: 'عنوان الإعلان مطلوب' } };
    const kind = POST_KINDS.includes(body.kind) ? body.kind : 'news';
    const images = (Array.isArray(body.images) ? body.images : []).map(String).filter(u => /^\/api\/team\/media\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(u)).slice(0, 10);
    const audience = normAudience(body.audience);
    const expires = body.expiresAt && !Number.isNaN(Date.parse(body.expiresAt)) ? new Date(body.expiresAt).toISOString() : null;
    const t = now();
    let pid = id;
    if (id) {
      const ex = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(id);
      if (!ex) return { status: 404, body: { error: 'الإعلان غير موجود' } };
      db.prepare('UPDATE posts SET kind=?, title=?, body=?, images=?, audience=?, pinned=?, requires_ack=?, expires_at=?, updated_at=? WHERE id=?')
        .run(kind, title, clip(body.body, 6000), JSON.stringify(images), JSON.stringify(audience), body.pinned ? 1 : 0, body.requiresAck ? 1 : 0, expires, t, id);
      audit(actor, 'post.update', id, { title });
    } else {
      const r = db.prepare('INSERT INTO posts (kind, title, body, images, audience, pinned, requires_ack, expires_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(kind, title, clip(body.body, 6000), JSON.stringify(images), JSON.stringify(audience), body.pinned ? 1 : 0, body.requiresAck ? 1 : 0, expires, actor, t, t);
      pid = Number(r.lastInsertRowid);
      audit(actor, 'post.create', pid, { title, audience });
      if (body.notify !== false) {
        const ids = audienceIds(audience);
        notify('staff', ids, { type: 'post', title, body: clip(body.body, 160), image: images[0] || null, link: `/posts?id=${pid}`, data: { postId: pid } });
      }
    }
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(pid);
    for (const s of activeStaff()) if (matches(audience, s)) emit(`staff:${s.id}`, 'post', { id: pid });
    return { status: 200, body: postView(p, null) };
  }
  function deletePost(id, actor) {
    db.prepare('UPDATE posts SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id);
    audit(actor, 'post.delete', id, null);
    for (const key of streams.keys()) if (key.startsWith('staff:')) emit(key, 'post', { id, deleted: true });
    return { status: 200, body: { ok: true } };
  }

  /* ═════════════ الدوام والإجازات ═════════════ */
  const getMask = staffId => db.prepare('SELECT days_mask FROM weekly_off WHERE staff_id = ?').get(staffId)?.days_mask ?? 0;
  function leaveView(r, s) {
    const st = s || getStaff(r.staff_id);
    return {
      id: r.id,
      staffId: r.staff_id,
      staffName: st?.name ?? '—',
      staffKind: st?.kind ?? null,
      sectionName: st?.section_name ?? null,
      type: r.type,
      typeLabel: LEAVE_TYPES[r.type] || r.type,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      swapFrom: r.swap_from,
      swapTo: r.swap_to,
      timeFrom: r.time_from,
      timeTo: r.time_to,
      reason: r.reason,
      attachment: r.attachment,
      status: r.status,
      decidedBy: r.decided_by,
      decidedNote: r.decided_note,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
    };
  }
  function leaveSummary(r) {
    if (r.type === 'swap') return `${DAY_NAMES[dayIdx(r.swap_from)]} ${r.swap_from} ← ${DAY_NAMES[dayIdx(r.swap_to)]} ${r.swap_to}`;
    if (r.type === 'hours') return `${r.date_from} من ${r.time_from} إلى ${r.time_to}`;
    return r.date_from === r.date_to ? `${DAY_NAMES[dayIdx(r.date_from)]} ${r.date_from}` : `${r.date_from} → ${r.date_to}`;
  }

  /** حالة الموظف في يوم: عطلة أسبوعية / إجازة / تبديل / استئذان / دوام */
  function dayStatus(staffId, date, mask, approved) {
    let off = ((mask >> dayIdx(date)) & 1) === 1;
    let reason = off ? 'weekly' : null;
    let leave = null;
    for (const r of approved) {
      if (r.type === 'swap') {
        if (r.swap_from === date) {
          off = false;
          reason = 'swapped-in';
          leave = r.id;
        }
        if (r.swap_to === date) {
          off = true;
          reason = 'swap';
          leave = r.id;
        }
      } else if (r.type === 'hours') {
        if (r.date_from === date && !off) {
          reason = 'hours';
          leave = r.id;
        }
      } else if (r.date_from <= date && date <= r.date_to) {
        off = true;
        reason = r.type;
        leave = r.id;
      }
    }
    return { date, weekday: DAY_NAMES[dayIdx(date)], off, reason, leaveId: leave };
  }
  function schedule(staffId, from, days) {
    const mask = getMask(staffId);
    const approved = db.prepare("SELECT * FROM leave_requests WHERE staff_id = ? AND status = 'approved' AND (date_to >= ? OR swap_to >= ? OR swap_from >= ?)")
      .all(staffId, from, from, from);
    return Array.from({ length: days }, (_, i) => dayStatus(staffId, addDays(from, i), mask, approved));
  }

  function createLeave(s, body) {
    const type = String(body.type || '');
    if (!LEAVE_TYPES[type]) return { status: 400, body: { error: 'نوع الطلب غير معروف' } };
    const today = iraqDate();
    const reason = clip(body.reason, 500);
    const attachment = typeof body.attachment === 'string' && /^\/api\/team\/media\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(body.attachment) ? body.attachment : null;
    let row = { date_from: null, date_to: null, swap_from: null, swap_to: null, time_from: null, time_to: null };
    if (type === 'swap') {
      if (!isDate(body.swapFrom) || !isDate(body.swapTo)) return { status: 400, body: { error: 'اختر يوم العطلة واليوم البديل' } };
      if (body.swapFrom === body.swapTo) return { status: 400, body: { error: 'اليومان متطابقان' } };
      if (body.swapFrom < today || body.swapTo < today) return { status: 400, body: { error: 'لا يمكن التبديل لأيام مضت' } };
      if (body.swapFrom > addDays(today, 30) || body.swapTo > addDays(today, 30)) return { status: 400, body: { error: 'التبديل خلال 30 يوماً فقط' } };
      const mask = getMask(s.id);
      if (mask && ((mask >> dayIdx(body.swapFrom)) & 1) !== 1) return { status: 400, body: { error: `${DAY_NAMES[dayIdx(body.swapFrom)]} ليس يوم عطلتك` } };
      row = { ...row, swap_from: body.swapFrom, swap_to: body.swapTo };
    } else if (type === 'hours') {
      if (!isDate(body.dateFrom) || !isTime(body.timeFrom) || !isTime(body.timeTo)) return { status: 400, body: { error: 'اختر اليوم ووقت الخروج والعودة' } };
      if (body.timeFrom >= body.timeTo) return { status: 400, body: { error: 'وقت العودة يجب أن يكون بعد وقت الخروج' } };
      if (body.dateFrom < today) return { status: 400, body: { error: 'لا يمكن الاستئذان ليوم مضى' } };
      row = { ...row, date_from: body.dateFrom, date_to: body.dateFrom, time_from: body.timeFrom, time_to: body.timeTo };
    } else {
      const from = body.dateFrom;
      const to = body.dateTo || body.dateFrom;
      if (!isDate(from) || !isDate(to)) return { status: 400, body: { error: 'اختر تاريخ الإجازة' } };
      if (to < from) return { status: 400, body: { error: 'تاريخ النهاية قبل البداية' } };
      const earliest = type === 'sick' ? addDays(today, -7) : today;
      if (from < earliest) return { status: 400, body: { error: type === 'sick' ? 'الإجازة المرضية حتى 7 أيام سابقة فقط' : 'لا يمكن طلب إجازة لأيام مضت' } };
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 30) return { status: 400, body: { error: 'أقصى مدة للطلب 31 يوماً' } };
      row = { ...row, date_from: from, date_to: to };
    }
    // تعارض مع طلب قائم لنفس الأيام
    const active = db.prepare("SELECT * FROM leave_requests WHERE staff_id = ? AND status IN ('pending','approved')").all(s.id);
    const span = r => (r.type === 'swap' ? [r.swap_to, r.swap_to] : [r.date_from, r.date_to]);
    const [a1, a2] = type === 'swap' ? [row.swap_to, row.swap_to] : [row.date_from, row.date_to];
    const clash = active.find(r => {
      const [b1, b2] = span(r);
      return b1 && a1 <= b2 && b1 <= a2 && !(type === 'hours' && r.type === 'hours' && (row.time_to <= r.time_from || r.time_to <= row.time_from));
    });
    if (clash) return { status: 409, body: { error: `لديك طلب ${clash.status === 'pending' ? 'معلّق' : 'مقبول'} لنفس اليوم (${LEAVE_TYPES[clash.type]})` } };
    const r = db.prepare(`INSERT INTO leave_requests (staff_id, type, date_from, date_to, swap_from, swap_to, time_from, time_to, reason, attachment, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(s.id, type, row.date_from, row.date_to, row.swap_from, row.swap_to, row.time_from, row.time_to, reason, attachment, now());
    const id = Number(r.lastInsertRowid);
    const full = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    audit(`staff:${s.id}`, 'leave.request', id, { type });
    notify('manager', managerIds(), { type: 'leave.new', title: `طلب ${LEAVE_TYPES[type]} — ${s.name}`, body: leaveSummary(full) + (reason ? ` · ${reason}` : ''), link: `/approvals?id=${id}`, data: { leaveId: id } });
    emitManagers('leave', { id });
    return { status: 200, body: leaveView(full, s) };
  }

  function decideLeave(id, approve, note, actor) {
    const r = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    if (!r) return { status: 404, body: { error: 'الطلب غير موجود' } };
    if (r.status !== 'pending') return { status: 409, body: { error: 'تم البت في هذا الطلب مسبقاً' } };
    const status = approve ? 'approved' : 'rejected';
    db.prepare('UPDATE leave_requests SET status = ?, decided_by = ?, decided_note = ?, decided_at = ? WHERE id = ?').run(status, actor, clip(note, 300), now(), id);
    audit(actor, `leave.${status}`, id, { note });
    const full = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    notify('staff', [r.staff_id], {
      type: `leave.${status}`,
      title: approve ? `تمت الموافقة على ${LEAVE_TYPES[r.type]}` : `رُفض طلب ${LEAVE_TYPES[r.type]}`,
      body: leaveSummary(full) + (note ? ` · ${note}` : ''),
      link: '/shift',
      data: { leaveId: id },
    });
    emit(`staff:${r.staff_id}`, 'leave', { id });
    emitManagers('leave', { id });
    return { status: 200, body: leaveView(full) };
  }

  function cancelLeave(s, id) {
    const r = db.prepare('SELECT * FROM leave_requests WHERE id = ? AND staff_id = ?').get(id, s.id);
    if (!r) return { status: 404, body: { error: 'الطلب غير موجود' } };
    if (r.status !== 'pending') return { status: 409, body: { error: 'لا يمكن إلغاء طلب تم البت فيه — راجع مديرك' } };
    db.prepare("UPDATE leave_requests SET status = 'cancelled', decided_at = ? WHERE id = ?").run(now(), id);
    audit(`staff:${s.id}`, 'leave.cancel', id, null);
    emitManagers('leave', { id });
    return { status: 200, body: { ok: true } };
  }

  function listLeave(url) {
    const status = url.searchParams.get('status') || 'pending';
    const rows = status === 'all'
      ? db.prepare('SELECT * FROM leave_requests ORDER BY id DESC LIMIT 300').all()
      : db.prepare('SELECT * FROM leave_requests WHERE status = ? ORDER BY id DESC LIMIT 300').all(status);
    const cache = new Map();
    return rows.map(r => {
      if (!cache.has(r.staff_id)) cache.set(r.staff_id, getStaff(r.staff_id));
      return leaveView(r, cache.get(r.staff_id));
    });
  }

  function setWeeklyOff(staffId, mask, actor) {
    const s = getStaff(staffId);
    if (!s) return { status: 404, body: { error: 'الموظف غير موجود' } };
    const m = Math.max(0, Math.min(127, Number(mask) || 0));
    const before = getMask(staffId);
    db.prepare(`INSERT INTO weekly_off (staff_id, days_mask, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(staff_id) DO UPDATE SET days_mask = excluded.days_mask, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(staffId, m, actor, now());
    if (before !== m) {
      audit(actor, 'weekly_off.set', staffId, { from: before, to: m });
      const names = DAY_NAMES.filter((_, i) => (m >> i) & 1);
      notify('staff', [staffId], { type: 'schedule', title: 'تم تحديث عطلتك الأسبوعية', body: names.length ? `عطلتك: ${names.join(' و')}` : 'لا عطلة أسبوعية محددة', link: '/shift' });
      emit(`staff:${staffId}`, 'leave', { weekly: true });
    }
    return { status: 200, body: { staffId, daysMask: m } };
  }

  /** نظرة اليوم للمدير/الإدارة: من في عطلة أو إجازة اليوم والطلبات المعلقة */
  function overview() {
    const today = iraqDate();
    const staff = activeStaff();
    const approved = db.prepare("SELECT * FROM leave_requests WHERE status = 'approved' AND (date_to >= ? OR swap_to >= ? OR swap_from >= ?)").all(today, today, today);
    const byStaff = new Map();
    for (const r of approved) byStaff.set(r.staff_id, [...(byStaff.get(r.staff_id) || []), r]);
    const masks = new Map(db.prepare('SELECT staff_id, days_mask FROM weekly_off').all().map(r => [r.staff_id, r.days_mask]));
    const offToday = [];
    const partial = [];
    for (const s of staff) {
      const st = dayStatus(s.id, today, masks.get(s.id) ?? 0, byStaff.get(s.id) || []);
      if (st.off) offToday.push({ staffId: s.id, name: s.name, kind: s.kind, reason: st.reason });
      else if (st.reason === 'hours') {
        const r = (byStaff.get(s.id) || []).find(x => x.id === st.leaveId);
        partial.push({ staffId: s.id, name: s.name, kind: s.kind, timeFrom: r?.time_from, timeTo: r?.time_to });
      }
    }
    const pending = db.prepare("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'").get().n;
    const devices = db.prepare('SELECT COUNT(*) AS n FROM devices').get().n;
    const active7 = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE last_seen >= ?').get(new Date(Date.now() - 7 * 86_400_000).toISOString()).n;
    return { today, weekday: DAY_NAMES[dayIdx(today)], staffCount: staff.length, offToday, partial, pending, devices, active7, posts: postsAdmin().slice(0, 5) };
  }

  function staffDirectory() {
    const masks = new Map(db.prepare('SELECT staff_id, days_mask FROM weekly_off').all().map(r => [r.staff_id, r.days_mask]));
    const devices = new Map(db.prepare('SELECT staff_id, label, last_seen FROM devices').all().map(r => [r.staff_id, r]));
    return db.prepare('SELECT * FROM staff ORDER BY is_active DESC, name').all().map(s => ({
      id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      jobTitle: s.job_title,
      sectionId: s.section_id,
      sectionName: s.section_name,
      isActive: !!s.is_active,
      weeklyOff: masks.get(s.id) ?? 0,
      device: devices.get(s.id)?.label ?? null,
      lastSeen: devices.get(s.id)?.last_seen ?? null,
    }));
  }

  /* ═════════════ أدوات الرد ═════════════ */
  async function json(req) {
    try {
      return JSON.parse((await ctx.readBody(req)) || '{}');
    } catch {
      return null;
    }
  }
  const reply = (res, out, open) => (open ? ctx.sendOpen : ctx.send)(res, out.status, out.body);

  /* ═════════════ مسارات الموظف (بعد التحقق من الرمز) ═════════════ */
  async function handleStaff(req, res, url, s) {
    const p = url.pathname;
    const key = `staff:${s.id}`;
    if (req.method === 'GET' && p === '/api/team/notifications') return ctx.send(res, 200, listNotifications('staff', s.id, url)), true;
    if (req.method === 'POST' && p === '/api/team/notifications/read') {
      const body = (await json(req)) || {};
      ctx.send(res, 200, markRead('staff', s.id, body));
      return true;
    }
    if (req.method === 'GET' && p === '/api/team/posts') return ctx.send(res, 200, postsFor(s)), true;
    let m = p.match(/^\/api\/team\/posts\/(\d+)\/(read|ack)$/);
    if (req.method === 'POST' && m) {
      const id = Number(m[1]);
      const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(id);
      if (!post || !matches(JSON.parse(post.audience), s)) return ctx.send(res, 404, { error: 'الإعلان غير موجود' }), true;
      const t = now();
      db.prepare('INSERT INTO post_reads (post_id, staff_id, read_at) VALUES (?, ?, ?) ON CONFLICT(post_id, staff_id) DO NOTHING').run(id, s.id, t);
      if (m[2] === 'ack') db.prepare('UPDATE post_reads SET ack_at = COALESCE(ack_at, ?) WHERE post_id = ? AND staff_id = ?').run(t, id, s.id);
      // قراءة الإعلان تقرأ تبليغه أيضاً
      db.prepare("UPDATE notifications SET read_at = ? WHERE user_kind = 'staff' AND user_id = ? AND type = 'post' AND read_at IS NULL AND json_extract(data, '$.postId') = ?").run(t, s.id, id);
      emit(key, 'unread', { unread: unreadCount('staff', s.id) });
      ctx.send(res, 200, postView(post, s));
      return true;
    }
    if (req.method === 'GET' && p === '/api/team/leave') {
      const from = iraqDate();
      const requests = db.prepare('SELECT * FROM leave_requests WHERE staff_id = ? ORDER BY id DESC LIMIT 60').all(s.id).map(r => leaveView(r, s));
      ctx.send(res, 200, { today: from, weeklyOff: getMask(s.id), days: schedule(s.id, addDays(from, -dayIdx(from)), 21), requests, types: LEAVE_TYPES });
      return true;
    }
    if (req.method === 'POST' && p === '/api/team/leave') {
      const body = await json(req);
      if (!body) return ctx.send(res, 400, { error: 'طلب غير صالح' }), true;
      reply(res, createLeave(s, body));
      return true;
    }
    m = p.match(/^\/api\/team\/leave\/(\d+)\/cancel$/);
    if (req.method === 'POST' && m) return reply(res, cancelLeave(s, Number(m[1]))), true;
    if (req.method === 'POST' && p === '/api/team/media') {
      const body = await json(req);
      if (!body) return ctx.send(res, 400, { error: 'طلب غير صالح' }), true;
      const out = saveMedia(body, 6 * 1048576);
      if (out.status === 200) audit(`staff:${s.id}`, 'media.upload', out.body.name, { size: out.body.size });
      reply(res, out);
      return true;
    }
    return false;
  }

  /* ═════════════ مسارات مشتركة للمدير والإدارة ═════════════ */
  async function handleManage(req, res, url, sub, actor, open) {
    const send = (st, b) => (open ? ctx.sendOpen : ctx.send)(res, st, b);
    if (req.method === 'GET' && sub === 'overview') return send(200, overview()), true;
    if (req.method === 'GET' && sub === 'directory') return send(200, staffDirectory()), true;
    if (req.method === 'GET' && sub === 'leave') return send(200, listLeave(url)), true;
    let m = sub.match(/^leave\/(\d+)\/decide$/);
    if (req.method === 'POST' && m) {
      const body = (await json(req)) || {};
      reply(res, decideLeave(Number(m[1]), !!body.approve, body.note, actor), open);
      return true;
    }
    m = sub.match(/^staff\/(\d+)\/weekly-off$/);
    if (req.method === 'PUT' && m) {
      const body = (await json(req)) || {};
      reply(res, setWeeklyOff(Number(m[1]), body.daysMask, actor), open);
      return true;
    }
    m = sub.match(/^staff\/(\d+)\/schedule$/);
    if (req.method === 'GET' && m) {
      const id = Number(m[1]);
      const from = url.searchParams.get('from') || iraqDate();
      return send(200, { weeklyOff: getMask(id), days: schedule(id, isDate(from) ? from : iraqDate(), Math.min(62, Number(url.searchParams.get('days') || 28))) }), true;
    }
    if (req.method === 'GET' && sub === 'posts') return send(200, postsAdmin()), true;
    if (req.method === 'POST' && sub === 'posts') {
      const body = await json(req);
      if (!body) return send(400, { error: 'طلب غير صالح' }), true;
      reply(res, savePost(null, body, actor), open);
      return true;
    }
    m = sub.match(/^posts\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const body = await json(req);
      if (!body) return send(400, { error: 'طلب غير صالح' }), true;
      reply(res, savePost(Number(m[1]), body, actor), open);
      return true;
    }
    if (m && req.method === 'DELETE') return reply(res, deletePost(Number(m[1]), actor), open), true;
    m = sub.match(/^posts\/(\d+)\/readers$/);
    if (req.method === 'GET' && m) {
      const rows = postReaders(Number(m[1]));
      return send(rows ? 200 : 404, rows ?? { error: 'الإعلان غير موجود' }), true;
    }
    if (req.method === 'POST' && sub === 'media') {
      const body = await json(req);
      if (!body) return send(400, { error: 'طلب غير صالح' }), true;
      const out = saveMedia(body, 8 * 1048576);
      if (out.status === 200) audit(actor, 'media.upload', out.body.name, { size: out.body.size });
      reply(res, out, open);
      return true;
    }
    if (req.method === 'POST' && sub === 'notify') {
      const body = await json(req);
      if (!body) return send(400, { error: 'طلب غير صالح' }), true;
      reply(res, broadcast(body, actor), open);
      return true;
    }
    if (req.method === 'GET' && sub === 'notify/log') return send(200, broadcastLog()), true;
    return false;
  }

  return { handleStaff, handleManage, openStream, serveMedia, notify, unreadCount, listNotifications, markRead, iraqDate };
}

module.exports = { createWork };
