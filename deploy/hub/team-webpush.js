'use strict';

/*
 * إشعارات الموقع (Web Push) — بلا مكتبات خارجية:
 *   · مفتاح VAPID يُنشأ مرة واحدة ويُحفظ في مجلد البيانات (vapid.json).
 *   · الاشتراك (من متصفح الموظف/المدير) يُحفظ في web_push، والإرسال مشفّر بمعيار aes128gcm (RFC 8291).
 *   · اشتراك انتهى (404/410 من خادم المتصفح) يُحذف تلقائياً.
 * يعمل على الآيفون (موقع مضاف للشاشة الرئيسية، iOS 16.4+) وأندرويد والحاسبة — بشرط رابط https.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s || ''), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function createWebPush({ db, dataDir, now, subject }) {
  db.exec(`CREATE TABLE IF NOT EXISTS web_push (
    endpoint TEXT PRIMARY KEY, user_kind TEXT NOT NULL, user_id INTEGER NOT NULL,
    p256dh TEXT NOT NULL, auth TEXT NOT NULL, device_id TEXT, user_agent TEXT, updated_at TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_web_push_user ON web_push(user_kind, user_id)');

  /* ── مفاتيح VAPID ── */
  const file = path.join(dataDir, 'vapid.json');
  let keys = null;
  function vapid() {
    if (keys) return keys;
    try {
      keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      keys = {
        publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])),
        privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
        createdAt: now(),
      };
      fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    }
    return keys;
  }

  /** ترويسة VAPID لخادم الإشعارات (المصدر = أصل رابط الاشتراك) */
  function vapidHeader(endpoint) {
    const k = vapid();
    const aud = new URL(endpoint).origin;
    const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
    const unsigned = `${header}.${claims}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: k.privatePem, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${unsigned}.${b64u(sig)}, k=${k.publicKey}`;
  }

  /** تشفير aes128gcm (RFC 8291 + RFC 8188) لسجل واحد */
  function encrypt(sub, payload) {
    const uaPublic = fromB64u(sub.p256dh);
    const authSecret = fromB64u(sub.auth);
    const ecdh = crypto.createECDH('prime256v1');
    const asPublic = ecdh.generateKeys();
    const shared = ecdh.computeSecret(uaPublic);
    const prkKey = hmac(authSecret, shared);
    const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
    const salt = crypto.randomBytes(16);
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
    const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const rs = Buffer.alloc(4);
    rs.writeUInt32BE(4096);
    return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
  }

  async function sendOne(row, n, kind) {
    const payload = JSON.stringify({ title: n.title, body: n.body || '', link: n.link || '', type: n.type || '', kind });
    let res;
    try {
      res = await fetch(row.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidHeader(row.endpoint),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'high',
        },
        body: encrypt(row, payload),
      });
    } catch (err) {
      return `error ${err.message}`;
    }
    if (res.ok) return 'ok';
    // الاشتراك انتهى (أُلغيت الإشعارات أو حُذف الموقع من الشاشة الرئيسية)
    if (res.status === 404 || res.status === 410) {
      db.prepare('DELETE FROM web_push WHERE endpoint = ?').run(row.endpoint);
      return 'removed';
    }
    const text = await res.text().catch(() => '');
    return `error ${res.status} ${text.slice(0, 120)}`;
  }

  /** يرسل لمستخدمين — نفس واجهة إشعارات التطبيق */
  async function sendTo(kind, ids, n) {
    if (!ids.length) return { count: 0, ok: 0 };
    const rows = db.prepare(`SELECT * FROM web_push WHERE user_kind = ? AND user_id IN (${ids.map(() => '?').join(',')})`).all(kind, ...ids.map(Number));
    if (!rows.length) return { count: 0, ok: 0 };
    const results = await Promise.all(rows.map(r => sendOne(r, n, kind)));
    const failed = results.filter(r => r.startsWith('error'));
    if (failed.length) console.error('web push failed', failed[0]);
    return { count: rows.length, ok: results.filter(r => r === 'ok').length, error: failed[0] };
  }

  function subscribe(kind, userId, body) {
    const sub = body?.subscription || {};
    const endpoint = String(sub.endpoint || '');
    const p256dh = String(sub.keys?.p256dh || '');
    const auth = String(sub.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || fromB64u(p256dh).length !== 65 || fromB64u(auth).length < 12)
      return { status: 400, body: { error: 'اشتراك الإشعارات غير صالح' } };
    db.prepare(`INSERT INTO web_push (endpoint, user_kind, user_id, p256dh, auth, device_id, user_agent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_kind = excluded.user_kind, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device_id = excluded.device_id, user_agent = excluded.user_agent, updated_at = excluded.updated_at`)
      .run(endpoint, kind, Number(userId), p256dh, auth, String(body.deviceId || '').slice(0, 120) || null, String(body.userAgent || '').slice(0, 200) || null, now());
    return { status: 200, body: { ok: true } };
  }

  function unsubscribe(kind, userId, body) {
    const endpoint = String(body?.endpoint || body?.subscription?.endpoint || '');
    if (endpoint) db.prepare('DELETE FROM web_push WHERE endpoint = ? AND user_kind = ? AND user_id = ?').run(endpoint, kind, Number(userId));
    return { status: 200, body: { ok: true } };
  }

  const has = (kind, userId) => !!db.prepare('SELECT 1 FROM web_push WHERE user_kind = ? AND user_id = ? LIMIT 1').get(kind, Number(userId));
  const counts = () => db.prepare('SELECT user_kind AS kind, COUNT(*) AS n FROM web_push GROUP BY user_kind').all();

  return { publicKey: () => vapid().publicKey, sendTo, subscribe, unsubscribe, has, counts, encrypt };
}

module.exports = { createWebPush };
