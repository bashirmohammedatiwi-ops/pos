'use strict';

/*
 * تطبيق الفريق — المحادثات (على خادم الـ VPS):
 *   · «فريق ديما»: مجموعة عامة تلقائية لكل الموظفين والمدراء.
 *   · محادثات خاصة بين أي اثنين (موظف/مدير).
 *   · مجموعات عمل ينشئها المدراء بأعضاء محددين.
 * رسائل نصية وصور ورد على رسالة، حذف خلال 15 دقيقة، «يكتب الآن»، غير المقروء لكل محادثة.
 * المستخدم يُعرَّف بمفتاح «staff:12» أو «manager:3» (نفس مفاتيح القناة الحية).
 */

const DELETE_WINDOW_MS = 15 * 60_000;
const MEDIA_RE = /^\/api\/team\/media\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/;

function createChat({ db, ctx, now, audit, emit }) {
  db.exec('CREATE TABLE IF NOT EXISTS _chat_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const MIGRATIONS = [
    `CREATE TABLE conversations (
       id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT, auto TEXT,
       created_by TEXT, created_at TEXT NOT NULL, last_at TEXT NOT NULL
     );
     CREATE TABLE chat_members (
       conv_id INTEGER NOT NULL, user_key TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
       last_read INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL,
       PRIMARY KEY (conv_id, user_key)
     );
     CREATE INDEX ix_members_user ON chat_members(user_key);
     CREATE TABLE messages (
       id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, sender_key TEXT NOT NULL,
       body TEXT, image TEXT, reply_to INTEGER, created_at TEXT NOT NULL, deleted_at TEXT
     );
     CREATE INDEX ix_messages_conv ON messages(conv_id, id);`,
  ];
  const done = new Set(db.prepare('SELECT id FROM _chat_migrations').all().map(r => r.id));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _chat_migrations (id, applied_at) VALUES (?, ?)').run(i + 1, now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  // المجموعة العامة التلقائية
  if (!db.prepare("SELECT id FROM conversations WHERE auto = 'all'").get()) {
    db.prepare("INSERT INTO conversations (kind, title, auto, created_by, created_at, last_at) VALUES ('group', 'فريق ديما', 'all', 'system', ?, ?)").run(now(), now());
  }

  /* ── المستخدمون ── */
  const managers = () => Object.values(ctx.getManagers?.() || {}).filter(m => m.isActive !== false);
  function person(key) {
    const [kind, idRaw] = String(key).split(':');
    const id = Number(idRaw);
    if (kind === 'staff') {
      const s = db.prepare('SELECT id, name, kind, section_name, is_active FROM staff WHERE id = ?').get(id);
      return s ? { key, kind: 'staff', id, name: s.name, role: s.kind, sub: s.section_name, active: !!s.is_active } : null;
    }
    if (kind === 'manager') {
      const m = managers().find(x => Number(x.id) === id);
      return m ? { key, kind: 'manager', id, name: m.displayName || m.username, role: 'manager', sub: 'مدير', active: true } : null;
    }
    return null;
  }
  function everyone() {
    const staff = db.prepare('SELECT id, name, kind, section_name FROM staff WHERE is_active = 1 ORDER BY name').all()
      .map(s => ({ key: `staff:${s.id}`, kind: 'staff', id: s.id, name: s.name, role: s.kind, sub: s.section_name }));
    const mgrs = managers().map(m => ({ key: `manager:${m.id}`, kind: 'manager', id: Number(m.id), name: m.displayName || m.username, role: 'manager', sub: 'مدير' }));
    return [...mgrs, ...staff];
  }

  const conv = id => db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  const memberRow = (cid, key) => db.prepare('SELECT * FROM chat_members WHERE conv_id = ? AND user_key = ?').get(cid, key);
  const isMember = (c, key) => !!c && (c.auto === 'all' || !!memberRow(c.id, key));
  function memberKeys(c) {
    if (c.auto === 'all') return everyone().map(p => p.key);
    return db.prepare('SELECT user_key FROM chat_members WHERE conv_id = ?').all(c.id).map(r => r.user_key);
  }
  function ensureRow(cid, key) {
    db.prepare("INSERT INTO chat_members (conv_id, user_key, joined_at, last_read) VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conv_id = ?)) ON CONFLICT DO NOTHING").run(cid, key, now(), cid);
  }

  /* ── العرض ── */
  function msgView(m) {
    const p = person(m.sender_key);
    let reply = null;
    if (m.reply_to) {
      // الرد يُعرض فقط إن كانت الرسالة الأصلية من نفس المحادثة
      const r = db.prepare('SELECT id, sender_key, body, image, deleted_at FROM messages WHERE id = ? AND conv_id = ?').get(m.reply_to, m.conv_id);
      if (r) reply = { id: r.id, senderName: person(r.sender_key)?.name ?? '—', body: r.deleted_at ? 'رسالة محذوفة' : r.body || (r.image ? '📷 صورة' : '') };
    }
    return {
      id: m.id,
      convId: m.conv_id,
      sender: { key: m.sender_key, name: p?.name ?? '—', role: p?.role ?? null },
      body: m.deleted_at ? null : m.body,
      image: m.deleted_at ? null : m.image,
      replyTo: reply,
      createdAt: m.created_at,
      deleted: !!m.deleted_at,
    };
  }
  function convView(c, me) {
    const last = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
    const row = memberRow(c.id, me.key);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND id > ? AND sender_key != ? AND deleted_at IS NULL').get(c.id, row?.last_read ?? 0, me.key).n;
    let title = c.title;
    let other = null;
    if (c.kind === 'direct') {
      const otherKey = db.prepare('SELECT user_key FROM chat_members WHERE conv_id = ? AND user_key != ?').get(c.id, me.key)?.user_key;
      other = otherKey ? person(otherKey) : null;
      title = other?.name ?? 'محادثة';
    }
    const lastView = last ? msgView(last) : null;
    return {
      id: c.id,
      kind: c.kind,
      auto: c.auto,
      title,
      other: other ? { key: other.key, role: other.role, sub: other.sub } : null,
      memberCount: c.auto === 'all' ? everyone().length : db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE conv_id = ?').get(c.id).n,
      lastAt: c.last_at,
      last: lastView
        ? { body: lastView.deleted ? 'رسالة محذوفة' : lastView.body || (lastView.image ? '📷 صورة' : ''), senderName: lastView.sender.name, mine: last.sender_key === me.key, at: last.created_at }
        : null,
      unread: row?.muted ? 0 : unread,
      muted: !!row?.muted,
      isAdmin: me.kind === 'manager' || row?.role === 'admin',
    };
  }
  function listFor(me) {
    return db.prepare(`SELECT * FROM conversations WHERE auto = 'all' OR id IN (SELECT conv_id FROM chat_members WHERE user_key = ?) ORDER BY last_at DESC`).all(me.key)
      .filter(c => c.kind !== 'direct' || db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?').get(c.id).n > 0 || c.created_by === me.key)
      .map(c => convView(c, me));
  }
  const totalUnread = me => listFor(me).reduce((s, c) => s + c.unread, 0);

  /* ── الإجراءات ── */
  function direct(me, otherKey) {
    const other = person(otherKey);
    if (!other || !other.active || other.key === me.key) return { status: 400, body: { error: 'لا يمكن بدء محادثة مع هذا الشخص' } };
    const found = db.prepare(`SELECT c.* FROM conversations c
      JOIN chat_members a ON a.conv_id = c.id AND a.user_key = ?
      JOIN chat_members b ON b.conv_id = c.id AND b.user_key = ?
      WHERE c.kind = 'direct'`).get(me.key, other.key);
    if (found) return { status: 200, body: convView(found, me) };
    const r = db.prepare("INSERT INTO conversations (kind, created_by, created_at, last_at) VALUES ('direct', ?, ?, ?)").run(me.key, now(), now());
    const id = Number(r.lastInsertRowid);
    ensureRow(id, me.key);
    ensureRow(id, other.key);
    return { status: 200, body: convView(conv(id), me) };
  }
  function createGroup(me, body) {
    if (me.kind !== 'manager') return { status: 403, body: { error: 'المدراء فقط ينشئون مجموعات' } };
    const title = String(body.title || '').trim().slice(0, 80);
    if (!title) return { status: 400, body: { error: 'اسم المجموعة مطلوب' } };
    const keys = [...new Set((Array.isArray(body.members) ? body.members : []).map(String))].filter(k => person(k));
    if (!keys.length) return { status: 400, body: { error: 'اختر أعضاء المجموعة' } };
    const r = db.prepare("INSERT INTO conversations (kind, title, created_by, created_at, last_at) VALUES ('group', ?, ?, ?, ?)").run(title, me.key, now(), now());
    const id = Number(r.lastInsertRowid);
    ensureRow(id, me.key);
    db.prepare("UPDATE chat_members SET role = 'admin' WHERE conv_id = ? AND user_key = ?").run(id, me.key);
    for (const k of keys) ensureRow(id, k);
    audit(me.key, 'chat.group.create', id, { title, members: keys.length });
    const c = conv(id);
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: id, created: true });
    return { status: 200, body: convView(c, me) };
  }
  function updateGroup(me, id, body) {
    const c = conv(id);
    if (!c || c.kind !== 'group' || c.auto) return { status: 404, body: { error: 'المجموعة غير موجودة' } };
    if (me.kind !== 'manager' && memberRow(id, me.key)?.role !== 'admin') return { status: 403, body: { error: 'لا تملك صلاحية تعديل المجموعة' } };
    if (body.title) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(String(body.title).trim().slice(0, 80), id);
    for (const k of Array.isArray(body.add) ? body.add : []) if (person(String(k))) ensureRow(id, String(k));
    for (const k of Array.isArray(body.remove) ? body.remove : []) db.prepare('DELETE FROM chat_members WHERE conv_id = ? AND user_key = ?').run(id, String(k));
    if (body.delete) {
      db.prepare('DELETE FROM chat_members WHERE conv_id = ?').run(id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      audit(me.key, 'chat.group.delete', id, null);
      return { status: 200, body: { ok: true } };
    }
    audit(me.key, 'chat.group.update', id, body);
    for (const k of memberKeys(conv(id))) emit(k, 'chat', { convId: id, updated: true });
    return { status: 200, body: convView(conv(id), me) };
  }
  function send(me, id, body) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    const text = String(body.body || '').trim().slice(0, 2000);
    const image = typeof body.image === 'string' && MEDIA_RE.test(body.image) ? body.image : null;
    if (!text && !image) return { status: 400, body: { error: 'الرسالة فارغة' } };
    const replyTo = Number(body.replyTo) && db.prepare('SELECT id FROM messages WHERE id = ? AND conv_id = ?').get(Number(body.replyTo), id) ? Number(body.replyTo) : null;
    const t = now();
    const r = db.prepare('INSERT INTO messages (conv_id, sender_key, body, image, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, me.key, text || null, image, replyTo, t);
    const mid = Number(r.lastInsertRowid);
    db.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(t, id);
    ensureRow(id, me.key);
    db.prepare('UPDATE chat_members SET last_read = ? WHERE conv_id = ? AND user_key = ?').run(mid, id, me.key);
    const view = msgView(db.prepare('SELECT * FROM messages WHERE id = ?').get(mid));
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: id, message: view });
    // إشعار Firebase لمن لم يكتم المحادثة (يصل والتطبيق مغلق)
    const muted = new Set(db.prepare('SELECT user_key FROM chat_members WHERE conv_id = ? AND muted = 1').all(id).map(r => r.user_key));
    const targets = { staff: [], manager: [] };
    for (const k of memberKeys(c)) {
      if (k === me.key || muted.has(k)) continue;
      const [kind, uid] = k.split(':');
      if (targets[kind]) targets[kind].push(Number(uid));
    }
    const sender = person(me.key)?.name ?? '';
    const title = c.kind === 'direct' ? sender : `${c.title || 'فريق ديما'} · ${sender}`;
    const preview = text ? text.slice(0, 140) : '📷 صورة';
    for (const kind of ['staff', 'manager']) if (targets[kind].length) ctx.pushTo?.(kind, targets[kind], { title, body: preview, link: `/chat/${id}` });
    return { status: 200, body: view };
  }
  function messages(me, id, url) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    const before = Number(url.searchParams.get('before') || 0);
    const rows = before
      ? db.prepare('SELECT * FROM messages WHERE conv_id = ? AND id < ? ORDER BY id DESC LIMIT 50').all(id, before)
      : db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 50').all(id);
    const members = c.auto === 'all' ? [] : db.prepare('SELECT user_key, role, last_read FROM chat_members WHERE conv_id = ?').all(id)
      .map(r => ({ ...person(r.user_key), role: r.role, lastRead: r.last_read }))
      .filter(x => x.key);
    return { status: 200, body: { conversation: convView(c, me), messages: rows.reverse().map(msgView), members, hasMore: rows.length === 50 } };
  }
  function markRead(me, id, lastId) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    ensureRow(id, me.key);
    const max = db.prepare('SELECT MAX(id) AS m FROM messages WHERE conv_id = ?').get(id).m || 0;
    const v = Math.min(max, Number(lastId) || max);
    db.prepare('UPDATE chat_members SET last_read = MAX(last_read, ?) WHERE conv_id = ? AND user_key = ?').run(v, id, me.key);
    if (c.kind === 'direct') for (const k of memberKeys(c)) if (k !== me.key) emit(k, 'chat-read', { convId: id, key: me.key, lastId: v });
    emit(me.key, 'chat-unread', { total: totalUnread(me) });
    return { status: 200, body: { ok: true, total: totalUnread(me) } };
  }
  function remove(me, mid) {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid);
    if (!m || m.deleted_at) return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    const own = m.sender_key === me.key;
    if (!(me.kind === 'manager' || (own && Date.now() - Date.parse(m.created_at) < DELETE_WINDOW_MS)))
      return { status: 403, body: { error: own ? 'يمكن حذف الرسالة خلال 15 دقيقة فقط' : 'لا يمكنك حذف رسائل الآخرين' } };
    db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(now(), mid);
    if (!own) audit(me.key, 'chat.message.delete', mid, { conv: m.conv_id });
    const c = conv(m.conv_id);
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: c.id, deletedId: mid });
    return { status: 200, body: { ok: true } };
  }

  /* ── المسارات ── */
  async function json(req) {
    try {
      return JSON.parse((await ctx.readBody(req)) || '{}');
    } catch {
      return {};
    }
  }
  /** sub = ما بعد «chat» في المسار، me = { key, kind, id } */
  async function handle(req, res, url, sub, me) {
    const out = (st, b) => ctx.send(res, st, b);
    const r = o => out(o.status, o.body);
    if (req.method === 'GET' && sub === '') return out(200, listFor(me)), true;
    if (req.method === 'GET' && sub === '/unread') return out(200, { total: totalUnread(me) }), true;
    if (req.method === 'GET' && sub === '/people') return out(200, everyone().filter(p => p.key !== me.key)), true;
    if (req.method === 'POST' && sub === '/direct') return r(direct(me, (await json(req)).key)), true;
    if (req.method === 'POST' && sub === '/groups') return r(createGroup(me, await json(req))), true;
    let m = sub.match(/^\/groups\/(\d+)$/);
    if (m && req.method === 'PUT') return r(updateGroup(me, Number(m[1]), await json(req))), true;
    m = sub.match(/^\/messages\/(\d+)$/);
    if (m && req.method === 'DELETE') return r(remove(me, Number(m[1]))), true;
    m = sub.match(/^\/(\d+)\/messages$/);
    if (m && req.method === 'GET') return r(messages(me, Number(m[1]), url)), true;
    if (m && req.method === 'POST') return r(send(me, Number(m[1]), await json(req))), true;
    m = sub.match(/^\/(\d+)\/read$/);
    if (m && req.method === 'POST') return r(markRead(me, Number(m[1]), (await json(req)).lastId)), true;
    m = sub.match(/^\/(\d+)\/typing$/);
    if (m && req.method === 'POST') {
      const c = conv(Number(m[1]));
      if (isMember(c, me.key)) {
        const name = person(me.key)?.name ?? '';
        for (const k of memberKeys(c)) if (k !== me.key) emit(k, 'typing', { convId: c.id, key: me.key, name });
      }
      return out(200, { ok: true }), true;
    }
    m = sub.match(/^\/(\d+)\/mute$/);
    if (m && req.method === 'POST') {
      const c = conv(Number(m[1]));
      if (!isMember(c, me.key)) return out(404, { error: 'المحادثة غير موجودة' }), true;
      ensureRow(c.id, me.key);
      db.prepare('UPDATE chat_members SET muted = ? WHERE conv_id = ? AND user_key = ?').run((await json(req)).muted ? 1 : 0, c.id, me.key);
      return out(200, convView(c, me)), true;
    }
    return false;
  }

  return { handle, totalUnread };
}

module.exports = { createChat };
