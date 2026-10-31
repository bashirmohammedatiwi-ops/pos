'use strict';

/*
 * تطبيق الفريق — المحادثات (على خادم الـ VPS):
 *   · «فريق ديما»: مجموعة عامة تلقائية لكل الموظفين والمدراء.
 *   · محادثات خاصة بين أي اثنين (موظف/مدير).
 *   · مجموعات عمل ينشئها المدراء بأعضاء محددين.
 * رسائل نصية وصور ورسائل صوتية ورد على رسالة، تعديل وحذف خلال 24 ساعة، حذف لدي فقط، إعادة توجيه، تفاعلات،
 * تثبيت، بحث، معلومات القراءة، آخر ظهور، «يكتب الآن»، غير المقروء لكل محادثة،
 * وإدارة المجموعات (تسمية، أعضاء، مغادرة) مع رسائل نظام وتبليغ من يُضاف.
 * المستخدم يُعرَّف بمفتاح «staff:12» أو «manager:3» (نفس مفاتيح القناة الحية).
 */

const EDIT_WINDOW_MS = 24 * 3600_000;
const DELETE_WINDOW_MS = 24 * 3600_000;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const FORWARD_MAX_MESSAGES = 20;
const FORWARD_MAX_TARGETS = 10;
const MEDIA_RE = /^\/api\/team\/media\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const AUDIO_RE = /^\/api\/team\/media\/[a-f0-9]{32}\.(webm|ogg|m4a)$/;
const previewOf = m => (m.deleted_at ? 'رسالة محذوفة' : m.body || (m.audio ? '🎤 رسالة صوتية' : m.image ? '📷 صورة' : ''));

function createChat({ db, ctx, now, audit, emit, notify, deleteMedia, isOnline = () => false }) {
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
    // رسائل صوتية، ورسائل النظام («فلان أضاف فلان»)
    `ALTER TABLE messages ADD COLUMN audio TEXT;
     ALTER TABLE messages ADD COLUMN audio_ms INTEGER;
     ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';`,
    // التعديل، إعادة التوجيه، التثبيت، التفاعلات، الحذف لدي، مسح المحادثة، تثبيتها، وآخر ظهور
    `ALTER TABLE messages ADD COLUMN edited_at TEXT;
     ALTER TABLE messages ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE messages ADD COLUMN pinned_at TEXT;
     CREATE TABLE message_reactions (
       msg_id INTEGER NOT NULL, user_key TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT NOT NULL,
       PRIMARY KEY (msg_id, user_key)
     );
     CREATE TABLE message_hidden (
       msg_id INTEGER NOT NULL, user_key TEXT NOT NULL, PRIMARY KEY (msg_id, user_key)
     );
     ALTER TABLE chat_members ADD COLUMN cleared_to INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE chat_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
     CREATE TABLE chat_presence (user_key TEXT PRIMARY KEY, last_seen TEXT NOT NULL);`,
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
  const reactionsOf = id => db.prepare('SELECT user_key, emoji FROM message_reactions WHERE msg_id = ?').all(id).map(r => ({ key: r.user_key, emoji: r.emoji, name: person(r.user_key)?.name ?? '—' }));
  /** شرط الرسائل الظاهرة لمستخدم: بعد آخر مسح وليست محذوفة لديه */
  const visibleSql = 'id > ? AND id NOT IN (SELECT msg_id FROM message_hidden WHERE user_key = ?)';
  const visibleArgs = (cid, key) => [memberRow(cid, key)?.cleared_to ?? 0, key];
  function msgView(m) {
    const p = person(m.sender_key);
    let reply = null;
    if (m.reply_to) {
      // الرد يُعرض فقط إن كانت الرسالة الأصلية من نفس المحادثة
      const r = db.prepare('SELECT id, sender_key, body, image, audio, deleted_at FROM messages WHERE id = ? AND conv_id = ?').get(m.reply_to, m.conv_id);
      if (r) reply = { id: r.id, senderName: person(r.sender_key)?.name ?? '—', body: previewOf(r) };
    }
    return {
      id: m.id,
      convId: m.conv_id,
      sender: { key: m.sender_key, name: p?.name ?? '—', role: p?.role ?? null },
      body: m.deleted_at ? null : m.body,
      image: m.deleted_at ? null : m.image,
      audio: m.deleted_at ? null : m.audio,
      audioMs: m.deleted_at ? null : m.audio_ms,
      kind: m.kind,
      edited: !m.deleted_at && !!m.edited_at,
      forwarded: !m.deleted_at && !!m.forwarded,
      pinned: !m.deleted_at && !!m.pinned_at,
      reactions: m.deleted_at ? [] : reactionsOf(m.id),
      replyTo: reply,
      createdAt: m.created_at,
      deleted: !!m.deleted_at,
    };
  }
  function convView(c, me) {
    const last = db.prepare(`SELECT * FROM messages WHERE conv_id = ? AND ${visibleSql} ORDER BY id DESC LIMIT 1`).get(c.id, ...visibleArgs(c.id, me.key));
    const row = memberRow(c.id, me.key);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND id > ? AND sender_key != ? AND deleted_at IS NULL AND kind != \'system\'').get(c.id, Math.max(row?.last_read ?? 0, row?.cleared_to ?? 0), me.key).n;
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
        ? { body: previewOf(last), senderName: lastView.sender.name, mine: last.sender_key === me.key, at: last.created_at, system: last.kind === 'system' }
        : null,
      unread: row?.muted ? 0 : unread,
      muted: !!row?.muted,
      pinned: !!row?.pinned,
      isAdmin: me.kind === 'manager' || row?.role === 'admin',
    };
  }
  function listFor(me) {
    return db.prepare(`SELECT * FROM conversations WHERE auto = 'all' OR id IN (SELECT conv_id FROM chat_members WHERE user_key = ?) ORDER BY last_at DESC`).all(me.key)
      .filter(c => c.kind !== 'direct' || db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND ${visibleSql}`).get(c.id, ...visibleArgs(c.id, me.key)).n > 0 || (c.created_by === me.key && !memberRow(c.id, me.key)?.cleared_to))
      .map(c => convView(c, me))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }
  const totalUnread = me => listFor(me).reduce((s, c) => s + c.unread, 0);

  /** رسالة نظام داخل المحادثة (بلا إشعار هاتف) */
  function systemMessage(c, actorKey, text) {
    const t = now();
    const r = db.prepare("INSERT INTO messages (conv_id, sender_key, body, kind, created_at) VALUES (?, ?, ?, 'system', ?)").run(c.id, actorKey, text, t);
    db.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(t, c.id);
    const view = msgView(db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid)));
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: c.id, message: view });
  }
  /** تبليغ من أُضيف لمجموعة (يصل للتبليغات والهاتف) */
  function notifyAdded(keys, actorName, c) {
    const groups = { staff: [], manager: [] };
    for (const k of keys) {
      const [kind, uid] = k.split(':');
      if (groups[kind]) groups[kind].push(Number(uid));
    }
    for (const kind of ['staff', 'manager']) {
      if (groups[kind].length) notify?.(kind, groups[kind], { type: 'chat.group', title: `أضافك ${actorName} إلى «${c.title}»`, body: 'يمكنك الآن المشاركة في محادثة المجموعة', link: `/chat/${c.id}` });
    }
  }
  const firstName = key => (person(key)?.name ?? '—').split(' ').slice(0, 2).join(' ');
  /** حذف رسائل وملفات مجموعة كاملة */
  function purgeMessages(id) {
    const files = db.prepare('SELECT image, audio FROM messages WHERE conv_id = ? AND (image IS NOT NULL OR audio IS NOT NULL)').all(id);
    db.prepare('DELETE FROM message_reactions WHERE msg_id IN (SELECT id FROM messages WHERE conv_id = ?)').run(id);
    db.prepare('DELETE FROM message_hidden WHERE msg_id IN (SELECT id FROM messages WHERE conv_id = ?)').run(id);
    db.prepare('DELETE FROM messages WHERE conv_id = ?').run(id);
    for (const m of files) {
      dropMedia(m.image);
      dropMedia(m.audio);
    }
  }
  /** يُحذف الملف فقط إن لم تعد تستخدمه رسالة أخرى (إعادة التوجيه تشارك الملف نفسه) */
  function dropMedia(url) {
    if (!url) return;
    const used = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL AND (image = ? OR audio = ?)').get(url, url).n;
    if (!used) deleteMedia?.(url);
  }

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
    if (me.kind !== 'manager' && !me.canManage) return { status: 403, body: { error: 'المدراء فقط ينشئون مجموعات' } };
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
    const actorName = person(me.key)?.name ?? '';
    systemMessage(c, me.key, `${firstName(me.key)} أنشأ المجموعة`);
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: id, created: true });
    notifyAdded(keys.filter(k => k !== me.key), actorName, c);
    return { status: 200, body: convView(c, me) };
  }
  function updateGroup(me, id, body) {
    const c = conv(id);
    if (!c || c.kind !== 'group' || c.auto) return { status: 404, body: { error: 'المجموعة غير موجودة' } };
    if (me.kind !== 'manager' && memberRow(id, me.key)?.role !== 'admin') return { status: 403, body: { error: 'لا تملك صلاحية تعديل المجموعة' } };
    if (body.delete) {
      for (const k of memberKeys(c)) emit(k, 'chat', { convId: id, removed: true, gone: true });
      purgeMessages(id);
      db.prepare('DELETE FROM chat_members WHERE conv_id = ?').run(id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      audit(me.key, 'chat.group.delete', id, null);
      return { status: 200, body: { ok: true } };
    }
    const actorShort = firstName(me.key);
    const newTitle = String(body.title || '').trim().slice(0, 80);
    if (newTitle && newTitle !== c.title) {
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(newTitle, id);
      systemMessage(conv(id), me.key, `${actorShort} غيّر اسم المجموعة إلى «${newTitle}»`);
    }
    const before = new Set(memberKeys(c));
    const added = [...new Set((Array.isArray(body.add) ? body.add : []).map(String))].filter(k => person(k) && !before.has(k));
    for (const k of added) ensureRow(id, k);
    const removed = [...new Set((Array.isArray(body.remove) ? body.remove : []).map(String))].filter(k => before.has(k) && k !== me.key);
    for (const k of removed) {
      db.prepare('DELETE FROM chat_members WHERE conv_id = ? AND user_key = ?').run(id, k);
      emit(k, 'chat', { convId: id, removed: true });
    }
    if (added.length) {
      systemMessage(conv(id), me.key, `${actorShort} أضاف ${added.map(firstName).join('، ')}`);
      notifyAdded(added, person(me.key)?.name ?? '', conv(id));
    }
    if (removed.length) systemMessage(conv(id), me.key, `${actorShort} أزال ${removed.map(firstName).join('، ')}`);
    audit(me.key, 'chat.group.update', id, { title: newTitle || undefined, added, removed });
    for (const k of memberKeys(conv(id))) emit(k, 'chat', { convId: id, updated: true });
    return { status: 200, body: convView(conv(id), me) };
  }
  /** مغادرة مجموعة (غير «فريق ديما») */
  function leave(me, id) {
    const c = conv(id);
    if (!c || c.kind !== 'group' || c.auto || !memberRow(id, me.key)) return { status: 404, body: { error: 'المجموعة غير موجودة' } };
    systemMessage(c, me.key, `${firstName(me.key)} غادر المجموعة`);
    db.prepare('DELETE FROM chat_members WHERE conv_id = ? AND user_key = ?').run(id, me.key);
    audit(me.key, 'chat.group.leave', id, null);
    return { status: 200, body: { ok: true } };
  }
  function send(me, id, body) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    const text = String(body.body || '').trim().slice(0, 2000);
    const image = typeof body.image === 'string' && MEDIA_RE.test(body.image) ? body.image : null;
    const audio = typeof body.audio === 'string' && AUDIO_RE.test(body.audio) ? body.audio : null;
    const audioMs = audio ? Math.max(0, Math.min(600_000, Math.round(Number(body.audioMs) || 0))) : null;
    if (!text && !image && !audio) return { status: 400, body: { error: 'الرسالة فارغة' } };
    const replyTo = Number(body.replyTo) && db.prepare('SELECT id FROM messages WHERE id = ? AND conv_id = ?').get(Number(body.replyTo), id) ? Number(body.replyTo) : null;
    return { status: 200, body: deliver(me, c, { text, image, audio, audioMs, replyTo }) };
  }
  /** حفظ الرسالة وإيصالها للأعضاء (الإرسال وإعادة التوجيه) */
  function deliver(me, c, { text, image, audio, audioMs, replyTo = null, forwarded = false }) {
    const id = c.id;
    const t = now();
    const r = db.prepare('INSERT INTO messages (conv_id, sender_key, body, image, audio, audio_ms, reply_to, created_at, forwarded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, me.key, text || null, image, audio, audioMs, replyTo, t, forwarded ? 1 : 0);
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
    const preview = text ? text.slice(0, 140) : audio ? '🎤 رسالة صوتية' : '📷 صورة';
    for (const kind of ['staff', 'manager']) if (targets[kind].length) ctx.pushTo?.(kind, targets[kind], { title, body: preview, link: `/chat/${id}` });
    return view;
  }
  /** الرسالة إن كان المستخدم عضواً في محادثتها وتظهر له */
  function ownMessage(me, mid) {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid);
    if (!m || !isMember(conv(m.conv_id), me.key)) return null;
    return m;
  }
  const liveMsg = (c, data) => {
    for (const k of memberKeys(c)) emit(k, 'chat', { convId: c.id, ...data });
  };
  function edit(me, mid, body) {
    const m = ownMessage(me, mid);
    if (!m || m.deleted_at) return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    if (m.sender_key !== me.key || m.kind === 'system') return { status: 403, body: { error: 'تعدّل رسائلك فقط' } };
    if (m.forwarded) return { status: 400, body: { error: 'لا يمكن تعديل رسالة أُعيد توجيهها' } };
    if (m.audio) return { status: 400, body: { error: 'لا يمكن تعديل رسالة صوتية' } };
    if (Date.now() - Date.parse(m.created_at) > EDIT_WINDOW_MS) return { status: 403, body: { error: 'يمكن تعديل الرسالة خلال 24 ساعة فقط' } };
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!text && !m.image) return { status: 400, body: { error: 'الرسالة فارغة' } };
    if ((text || null) === m.body) return { status: 200, body: msgView(m) };
    db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(text || null, now(), mid);
    const view = msgView(db.prepare('SELECT * FROM messages WHERE id = ?').get(mid));
    liveMsg(conv(m.conv_id), { edited: view });
    return { status: 200, body: view };
  }
  function react(me, mid, body) {
    const m = ownMessage(me, mid);
    if (!m || m.deleted_at || m.kind === 'system') return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    const emoji = body.emoji == null ? null : String(body.emoji);
    if (emoji && !REACTIONS.includes(emoji)) return { status: 400, body: { error: 'تفاعل غير معروف' } };
    db.prepare('DELETE FROM message_reactions WHERE msg_id = ? AND user_key = ?').run(mid, me.key);
    if (emoji) db.prepare('INSERT INTO message_reactions (msg_id, user_key, emoji, created_at) VALUES (?, ?, ?, ?)').run(mid, me.key, emoji, now());
    const reactions = reactionsOf(mid);
    liveMsg(conv(m.conv_id), { reacted: { id: mid, reactions } });
    return { status: 200, body: { id: mid, reactions } };
  }
  const pinnedOf = cid => db.prepare('SELECT * FROM messages WHERE conv_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 5').all(cid).map(msgView);
  function pin(me, mid, body) {
    const m = ownMessage(me, mid);
    if (!m || m.deleted_at || m.kind === 'system') return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    const c = conv(m.conv_id);
    if (c.kind !== 'direct' && !convView(c, me).isAdmin) return { status: 403, body: { error: 'مشرف المجموعة فقط يثبّت الرسائل' } };
    db.prepare('UPDATE messages SET pinned_at = ? WHERE id = ?').run(body.pinned === false ? null : now(), mid);
    const pinned = pinnedOf(c.id);
    liveMsg(c, { pins: pinned });
    return { status: 200, body: { pinned } };
  }
  function hide(me, mid) {
    if (!ownMessage(me, mid)) return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    db.prepare('INSERT INTO message_hidden (msg_id, user_key) VALUES (?, ?) ON CONFLICT DO NOTHING').run(mid, me.key);
    return { status: 200, body: { ok: true } };
  }
  /** مسح المحادثة لدي: الرسائل الحالية تختفي عندي فقط وتبقى عند الآخرين */
  function clear(me, id) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    ensureRow(id, me.key);
    const max = db.prepare('SELECT MAX(id) AS m FROM messages WHERE conv_id = ?').get(id).m || 0;
    db.prepare('UPDATE chat_members SET cleared_to = ?, last_read = MAX(last_read, ?) WHERE conv_id = ? AND user_key = ?').run(max, max, id, me.key);
    emit(me.key, 'chat-unread', { total: totalUnread(me) });
    return { status: 200, body: { ok: true } };
  }
  function forward(me, body) {
    const ids = [...new Set((Array.isArray(body.messageIds) ? body.messageIds : []).map(Number))].filter(Boolean);
    const targets = [...new Set((Array.isArray(body.convIds) ? body.convIds : []).map(Number))].filter(Boolean);
    if (!ids.length || !targets.length) return { status: 400, body: { error: 'اختر الرسائل والمحادثات' } };
    if (ids.length > FORWARD_MAX_MESSAGES) return { status: 400, body: { error: `${FORWARD_MAX_MESSAGES} رسالة كحد أقصى في المرة` } };
    if (targets.length > FORWARD_MAX_TARGETS) return { status: 400, body: { error: `${FORWARD_MAX_TARGETS} محادثات كحد أقصى في المرة` } };
    const rows = ids.map(mid => ownMessage(me, mid)).filter(m => m && !m.deleted_at && m.kind !== 'system').sort((a, b) => a.id - b.id);
    if (rows.length !== ids.length) return { status: 404, body: { error: 'بعض الرسائل غير متاحة' } };
    const convs = targets.map(conv);
    if (convs.some(c => !isMember(c, me.key))) return { status: 403, body: { error: 'لست عضواً في إحدى المحادثات' } };
    for (const c of convs) for (const m of rows) deliver(me, c, { text: m.body, image: m.image, audio: m.audio, audioMs: m.audio_ms, forwarded: true });
    audit(me.key, 'chat.forward', null, { from: rows[0].conv_id, messages: rows.length, to: targets });
    return { status: 200, body: { ok: true, sent: rows.length * convs.length } };
  }
  function search(me, id, q) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    const text = String(q || '').trim().slice(0, 80);
    if (text.length < 2) return { status: 200, body: [] };
    const like = `%${text.replace(/[\\%_]/g, x => `\\${x}`)}%`;
    const rows = db.prepare(`SELECT * FROM messages WHERE conv_id = ? AND ${visibleSql} AND deleted_at IS NULL AND kind != 'system' AND body LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 50`).all(id, ...visibleArgs(id, me.key), like);
    return { status: 200, body: rows.map(msgView) };
  }
  /** من قرأ رسالتي */
  function info(me, mid) {
    const m = ownMessage(me, mid);
    if (!m) return { status: 404, body: { error: 'الرسالة غير موجودة' } };
    const c = conv(m.conv_id);
    if (m.sender_key !== me.key && !convView(c, me).isAdmin) return { status: 403, body: { error: 'لا تملك عرض هذه المعلومات' } };
    const lastRead = new Map(db.prepare('SELECT user_key, last_read FROM chat_members WHERE conv_id = ?').all(c.id).map(r => [r.user_key, r.last_read]));
    const people = memberKeys(c).filter(k => k !== m.sender_key).map(k => ({ key: k, name: person(k)?.name ?? '—', read: (lastRead.get(k) ?? 0) >= mid }));
    return { status: 200, body: { createdAt: m.created_at, editedAt: m.edited_at, read: people.filter(p => p.read), unread: people.filter(p => !p.read) } };
  }
  function touch(key) {
    db.prepare('INSERT INTO chat_presence (user_key, last_seen) VALUES (?, ?) ON CONFLICT(user_key) DO UPDATE SET last_seen = excluded.last_seen').run(key, now());
  }
  /** الطرف الآخر في محادثة خاصة: متصل الآن أو آخر ظهور */
  function presence(me, c) {
    if (c.kind !== 'direct') return null;
    const other = db.prepare('SELECT user_key FROM chat_members WHERE conv_id = ? AND user_key != ?').get(c.id, me.key)?.user_key;
    if (!other) return null;
    return { online: isOnline(other), lastSeen: db.prepare('SELECT last_seen FROM chat_presence WHERE user_key = ?').get(other)?.last_seen ?? null };
  }
  function messages(me, id, url) {
    const c = conv(id);
    if (!isMember(c, me.key)) return { status: 404, body: { error: 'المحادثة غير موجودة' } };
    const before = Number(url.searchParams.get('before') || 0);
    const from = Number(url.searchParams.get('from') || 0);
    const vis = visibleArgs(id, me.key);
    // from: الانتقال لرسالة قديمة (رد أو بحث أو مثبّتة) يحمّل من عندها حتى الأحدث
    const rows = from
      ? db.prepare(`SELECT * FROM messages WHERE conv_id = ? AND ${visibleSql} AND id >= ? ORDER BY id DESC LIMIT 1000`).all(id, ...vis, from)
      : before
        ? db.prepare(`SELECT * FROM messages WHERE conv_id = ? AND ${visibleSql} AND id < ? ORDER BY id DESC LIMIT 50`).all(id, ...vis, before)
        : db.prepare(`SELECT * FROM messages WHERE conv_id = ? AND ${visibleSql} ORDER BY id DESC LIMIT 50`).all(id, ...vis);
    // role: دور الموظف للعرض (كما تتوقعه الواجهة)، admin: مشرف المجموعة
    const members = c.auto === 'all' ? [] : db.prepare('SELECT user_key, role, last_read FROM chat_members WHERE conv_id = ?').all(id)
      .map(r => ({ ...person(r.user_key), admin: r.role === 'admin', lastRead: r.last_read }))
      .filter(x => x.key);
    const hasMore = from ? !!db.prepare(`SELECT 1 FROM messages WHERE conv_id = ? AND ${visibleSql} AND id < ? LIMIT 1`).get(id, ...vis, from) : rows.length === 50;
    return { status: 200, body: { conversation: convView(c, me), messages: rows.reverse().map(msgView), members, hasMore, pinned: pinnedOf(id), lastRead: memberRow(id, me.key)?.last_read ?? 0, presence: presence(me, c) } };
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
    if (!((me.kind === 'manager' && me.canModerate !== false) || (own && Date.now() - Date.parse(m.created_at) < DELETE_WINDOW_MS)))
      return { status: 403, body: { error: own ? 'يمكن حذف الرسالة للجميع خلال 24 ساعة فقط' : 'لا يمكنك حذف رسائل الآخرين' } };
    db.prepare('UPDATE messages SET deleted_at = ?, pinned_at = NULL WHERE id = ?').run(now(), mid);
    db.prepare('DELETE FROM message_reactions WHERE msg_id = ?').run(mid);
    // الملف يُحذف من الخادم إن لم تستخدمه رسالة أخرى
    dropMedia(m.image);
    dropMedia(m.audio);
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
    touch(me.key);
    if (req.method === 'GET' && sub === '') return out(200, listFor(me)), true;
    if (req.method === 'POST' && sub === '/forward') return r(forward(me, await json(req))), true;
    if (req.method === 'GET' && sub === '/unread') return out(200, { total: totalUnread(me) }), true;
    if (req.method === 'GET' && sub === '/people') return out(200, everyone().filter(p => p.key !== me.key)), true;
    if (req.method === 'POST' && sub === '/direct') return r(direct(me, (await json(req)).key)), true;
    if (req.method === 'POST' && sub === '/groups') return r(createGroup(me, await json(req))), true;
    let m = sub.match(/^\/groups\/(\d+)$/);
    if (m && req.method === 'PUT') return r(updateGroup(me, Number(m[1]), await json(req))), true;
    m = sub.match(/^\/messages\/(\d+)$/);
    if (m && req.method === 'DELETE') return r(remove(me, Number(m[1]))), true;
    if (m && req.method === 'PUT') return r(edit(me, Number(m[1]), await json(req))), true;
    m = sub.match(/^\/messages\/(\d+)\/(react|pin|hide|info)$/);
    if (m && req.method === 'POST' && m[2] === 'react') return r(react(me, Number(m[1]), await json(req))), true;
    if (m && req.method === 'POST' && m[2] === 'pin') return r(pin(me, Number(m[1]), await json(req))), true;
    if (m && req.method === 'POST' && m[2] === 'hide') return r(hide(me, Number(m[1]))), true;
    if (m && req.method === 'GET' && m[2] === 'info') return r(info(me, Number(m[1]))), true;
    m = sub.match(/^\/(\d+)\/messages$/);
    if (m && req.method === 'GET') return r(messages(me, Number(m[1]), url)), true;
    if (m && req.method === 'POST') return r(send(me, Number(m[1]), await json(req))), true;
    m = sub.match(/^\/(\d+)\/read$/);
    if (m && req.method === 'POST') return r(markRead(me, Number(m[1]), (await json(req)).lastId)), true;
    m = sub.match(/^\/(\d+)\/leave$/);
    if (m && req.method === 'POST') return r(leave(me, Number(m[1]))), true;
    m = sub.match(/^\/(\d+)\/media$/);
    if (m && req.method === 'GET') {
      const c = conv(Number(m[1]));
      if (!isMember(c, me.key)) return out(404, { error: 'المحادثة غير موجودة' }), true;
      const rows = db.prepare('SELECT image FROM messages WHERE conv_id = ? AND image IS NOT NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 60').all(c.id);
      return out(200, rows.map(x => x.image)), true;
    }
    m = sub.match(/^\/(\d+)\/search$/);
    if (m && req.method === 'GET') return r(search(me, Number(m[1]), url.searchParams.get('q'))), true;
    m = sub.match(/^\/(\d+)\/clear$/);
    if (m && req.method === 'POST') return r(clear(me, Number(m[1]))), true;
    m = sub.match(/^\/(\d+)\/presence$/);
    if (m && req.method === 'GET') {
      const c = conv(Number(m[1]));
      if (!isMember(c, me.key)) return out(404, { error: 'المحادثة غير موجودة' }), true;
      return out(200, presence(me, c) ?? {}), true;
    }
    m = sub.match(/^\/(\d+)\/pin-conv$/);
    if (m && req.method === 'POST') {
      const c = conv(Number(m[1]));
      if (!isMember(c, me.key)) return out(404, { error: 'المحادثة غير موجودة' }), true;
      ensureRow(c.id, me.key);
      db.prepare('UPDATE chat_members SET pinned = ? WHERE conv_id = ? AND user_key = ?').run((await json(req)).pinned ? 1 : 0, c.id, me.key);
      return out(200, convView(c, me)), true;
    }
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
