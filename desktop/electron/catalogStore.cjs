const fs = require('fs');
const path = require('path');

function openBetterSqlite(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  return {
    exec: sql => db.exec(sql),
    prepare: sql => db.prepare(sql),
    transaction: fn => db.transaction(fn),
  };
}

function openNodeSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  return {
    exec: sql => db.exec(sql),
    prepare: sql => db.prepare(sql),
    transaction: fn => (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function openEngine(file) {
  try {
    return openBetterSqlite(file);
  } catch {
    return openNodeSqlite(file);
  }
}

function barcodeCandidates(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return [];
  const list = [trimmed];
  if (/^\d+$/.test(trimmed)) {
    const stripped = trimmed.replace(/^0+/, '');
    if (stripped && stripped !== trimmed) list.push(stripped);
    if (trimmed.length < 13) list.push(trimmed.padStart(13, '0'));
    if (trimmed.length < 12) list.push(trimmed.padStart(12, '0'));
  }
  return [...new Set(list)];
}

function createCatalogStore(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const candidates = [
    path.join(userDataDir, 'catalog.db'),
    path.join(userDataDir, 'catalog-fallback.db'),
  ];
  let lastError;
  for (const dbPath of candidates) {
    try {
      return openCatalogStore(dbPath);
    } catch (e) {
      lastError = e;
      console.error('[fot-store] failed to open', dbPath, e);
    }
  }
  throw lastError;
}

function openCatalogStore(dbPath) {
  const db = openEngine(dbPath);

  // Durability + concurrency: WAL keeps commits fsync-light while remaining crash-safe,
  // busy_timeout rides out short cross-connection lock contention.
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
  } catch (e) {
    console.error('[fot-store] pragma setup failed', e);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL,
      num TEXT,
      name TEXT,
      barcode TEXT,
      original_price REAL NOT NULL,
      price REAL NOT NULL,
      stock REAL NOT NULL,
      discount_percent INTEGER NOT NULL,
      offer_name TEXT,
      stored_discount_percent INTEGER NOT NULL DEFAULT 0,
      change_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_num ON products(num);
    CREATE TABLE IF NOT EXISTS pending_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      client_receipt_id TEXT,
      local_number INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS salesmen (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credit_accounts (
      id INTEGER PRIMARY KEY, num TEXT, name TEXT, balance REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS print_settings (
      id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS group_items (group_id INTEGER PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS last_receipt (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS today_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Additive migrations for stores created by older builds.
  const columns = new Set(
    db.prepare('PRAGMA table_info(pending_receipts)').all().map(c => c.name),
  );
  if (!columns.has('status')) {
    db.exec("ALTER TABLE pending_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'");
  }
  if (!columns.has('edited_at')) {
    db.exec('ALTER TABLE pending_receipts ADD COLUMN edited_at TEXT');
  }
  const productColumns = new Set(
    db.prepare('PRAGMA table_info(products)').all().map(c => c.name),
  );
  if (!productColumns.has('stored_discount_percent')) {
    db.exec('ALTER TABLE products ADD COLUMN stored_discount_percent INTEGER NOT NULL DEFAULT 0');
  }
  if (!productColumns.has('change_version')) {
    db.exec('ALTER TABLE products ADD COLUMN change_version INTEGER NOT NULL DEFAULT 0');
  }

  // Receipt display numbers: {year}{cashierCode}{sequence:000000} — must stay identical to
  // web/fot-pos/src/lib/db.ts and the server's ReceiptNumberFormatter so a locally printed
  // number matches what the dashboard will show after upload.
  function formatReceiptNumber(year, cashierCode, seq) {
    return Number(`${year}${cashierCode}${String(seq).padStart(6, '0')}`);
  }

  function parseReceiptNumber(number) {
    const text = String(number);
    if (!number || text.length < 11) return null;
    const year = Number(text.slice(0, 4));
    const seq = Number(text.slice(-6));
    const cashierCode = Number(text.slice(4, -6));
    if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
    if (!Number.isInteger(cashierCode) || cashierCode <= 0) return null;
    if (!Number.isInteger(seq) || seq <= 0 || seq > 999999) return null;
    if (formatReceiptNumber(year, cashierCode, seq) !== number) return null;
    return { year, cashierCode, seq };
  }

  function rowToProduct(r) {
    if (!r) return null;
    return {
      id: r.id,
      seq: r.seq,
      num: r.num,
      name: r.name,
      barcode: r.barcode,
      originalPrice: r.original_price,
      price: r.price,
      stock: r.stock,
      discountPercent: r.discount_percent,
      offerName: r.offer_name,
      storedDiscountPercent: r.stored_discount_percent ?? 0,
      changeVersion: r.change_version ?? 0,
    };
  }

  const upsertProduct = db.prepare(`
    INSERT INTO products (id, seq, num, name, barcode, original_price, price, stock, discount_percent, offer_name, stored_discount_percent, change_version)
    VALUES (@id, @seq, @num, @name, @barcode, @original_price, @price, @stock, @discount_percent, @offer_name, @stored_discount_percent, @change_version)
    ON CONFLICT(id) DO UPDATE SET
      seq=excluded.seq, num=excluded.num, name=excluded.name, barcode=excluded.barcode,
      original_price=excluded.original_price, price=excluded.price, stock=excluded.stock,
      discount_percent=excluded.discount_percent, offer_name=excluded.offer_name,
      stored_discount_percent=excluded.stored_discount_percent, change_version=excluded.change_version
  `);
  const findByBarcode = db.prepare('SELECT * FROM products WHERE barcode = ? LIMIT 1');
  const findByNum = db.prepare('SELECT * FROM products WHERE num = ? LIMIT 1');

  return {
    getMeta(key) {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      return row?.value ?? null;
    },
    setMeta(key, value) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, String(value));
    },
    upsertProducts(products) {
      const run = db.transaction(list => {
        for (const p of list || []) {
          upsertProduct.run({
            id: p.id,
            seq: p.seq ?? 0,
            num: p.num ?? null,
            name: p.name ?? null,
            barcode: p.barcode ?? null,
            original_price: Number(p.originalPrice ?? p.price ?? 0),
            price: Number(p.price ?? 0),
            stock: Number(p.stock ?? 0),
            discount_percent: Number(p.discountPercent ?? 0),
            offer_name: p.offerName ?? null,
            stored_discount_percent: Number(p.storedDiscountPercent ?? 0),
            change_version: Number(p.changeVersion ?? 0),
          });
        }
      });
      run(products);
      try { db.exec('PRAGMA wal_checkpoint(PASSIVE);'); } catch { /* next open still reads the WAL */ }
    },
    findProduct(code) {
      for (const candidate of barcodeCandidates(code)) {
        const byBarcode = findByBarcode.get(candidate);
        if (byBarcode) return rowToProduct(byBarcode);
        const byNum = findByNum.get(candidate);
        if (byNum) return rowToProduct(byNum);
      }
      return null;
    },
    searchProducts(term, limit = 24) {
      const q = `%${String(term || '').trim().toLowerCase()}%`;
      const rows = db.prepare(`
        SELECT * FROM products
        WHERE lower(ifnull(name,'')) LIKE ? OR ifnull(barcode,'') LIKE ? OR ifnull(num,'') LIKE ?
        LIMIT ?
      `).all(q, `%${String(term || '').trim()}%`, `%${String(term || '').trim()}%`, Number(limit) || 24);
      return rows.map(rowToProduct);
    },
    productCount() {
      return db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
    },
    /**
     * Removes products the server no longer has. The sync feed only carries inserts and
     * updates, so a material deleted in Edari would otherwise stay on this terminal forever.
     * Ids land in a temp table first — an IN list of 30k values exceeds SQLite's limit.
     */
    pruneProducts(liveIds) {
      const list = Array.isArray(liveIds) ? liveIds.map(Number).filter(Number.isFinite) : [];
      if (!list.length) return 0;
      const run = db.transaction(() => {
        db.prepare('CREATE TEMP TABLE IF NOT EXISTS live_ids (id INTEGER PRIMARY KEY)').run();
        db.prepare('DELETE FROM live_ids').run();
        const insert = db.prepare('INSERT OR IGNORE INTO live_ids (id) VALUES (?)');
        for (const id of list) insert.run(id);
        const removed = db.prepare('DELETE FROM products WHERE id NOT IN (SELECT id FROM live_ids)').run().changes;
        db.prepare('DELETE FROM live_ids').run();
        return removed;
      });
      return run();
    },
    /** Stock/price lookup for the POS product table (joined by catalog product id). */
    productsByIds(ids) {
      const list = Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
      if (!list.length) return [];
      const placeholders = list.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT id, seq, num, name, barcode, original_price, price, stock,
               discount_percent, offer_name, stored_discount_percent, change_version
        FROM products WHERE id IN (${placeholders})
      `).all(...list);
      return rows.map(rowToProduct);
    },
    saveGroups(groups, itemsByGroup) {
      const run = db.transaction(() => {
        db.prepare('DELETE FROM groups').run();
        db.prepare('DELETE FROM group_items').run();
        const gStmt = db.prepare('INSERT INTO groups (id, json) VALUES (?, ?)');
        const iStmt = db.prepare('INSERT INTO group_items (group_id, json) VALUES (?, ?)');
        for (const g of groups || []) gStmt.run(g.id, JSON.stringify(g));
        for (const [id, items] of Object.entries(itemsByGroup || {})) {
          iStmt.run(Number(id), JSON.stringify(items));
        }
      });
      run();
    },
    loadGroups() {
      return db.prepare('SELECT json FROM groups').all().map(r => JSON.parse(r.json));
    },
    loadGroupItems(groupId) {
      const row = db.prepare('SELECT json FROM group_items WHERE group_id = ?').get(groupId);
      return row ? JSON.parse(row.json) : [];
    },
    saveSalesmen(list) {
      const run = db.transaction(() => {
        db.prepare('DELETE FROM salesmen').run();
        const stmt = db.prepare('INSERT INTO salesmen (id, name) VALUES (?, ?)');
        for (const s of list || []) stmt.run(s.id, s.name);
      });
      run();
    },
    loadSalesmen() {
      return db.prepare('SELECT id, name FROM salesmen').all();
    },
    saveAccounts(list) {
      const run = db.transaction(() => {
        db.prepare('DELETE FROM credit_accounts').run();
        const stmt = db.prepare('INSERT INTO credit_accounts (id, num, name, balance) VALUES (?, ?, ?, ?)');
        for (const a of list || []) stmt.run(a.id, a.num ?? null, a.name ?? null, Number(a.balance ?? 0));
      });
      run();
    },
    loadAccounts() {
      return db.prepare('SELECT id, num, name, balance FROM credit_accounts').all();
    },
    savePrintSettings(settings) {
      db.prepare(`
        INSERT INTO print_settings (id, json, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), new Date().toISOString());
    },
    loadPrintSettings() {
      const row = db.prepare('SELECT json FROM print_settings WHERE id = 1').get();
      return row ? JSON.parse(row.json) : null;
    },
    nextLocalNumber(cashierCode = 0) {
      const year = new Date().getFullYear();
      const code = cashierCode > 0 ? cashierCode : 9;
      const key = `offline_receipt_seq_${year}_${code}`;
      const raw = this.getMeta(key);
      let next = (raw ? Number(raw) : 0) + 1;
      const parked = db.prepare(
        'SELECT local_number FROM pending_receipts WHERE synced = 0 AND local_number > 0',
      ).all();
      for (const row of parked) {
        const parsed = parseReceiptNumber(row.local_number);
        if (parsed && parsed.year === year && parsed.cashierCode === code && parsed.seq >= next) {
          next = parsed.seq + 1;
        }
      }
      const jumpTo = Number(this.getMeta(`receipt_seq_jump_${year}_${code}`) ?? '0') || 0;
      const ownedThrough = Number(this.getMeta(`receipt_owned_through_${year}_${code}`) ?? '0') || 0;
      if (jumpTo > next && ownedThrough > 0 && next > ownedThrough) next = jumpTo;
      this.setMeta(key, String(next));
      return formatReceiptNumber(year, code, next);
    },
    seedReceiptSeq(cashierCode, serverSeq) {
      if (!serverSeq || serverSeq <= 0) return;
      const year = new Date().getFullYear();
      const code = cashierCode > 0 ? cashierCode : 9;
      const key = `offline_receipt_seq_${year}_${code}`;
      const local = Number(this.getMeta(key) ?? '0') || 0;
      if (serverSeq > local) this.setMeta(key, String(serverSeq));
    },
    enqueue(row) {
      const info = db.prepare(`
        INSERT INTO pending_receipts (payload_json, created_at, client_receipt_id, local_number, retry_count, last_error, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        JSON.stringify(row.payload ?? row),
        row.createdAt || new Date().toISOString(),
        row.clientReceiptId || null,
        Number(row.localNumber || 0),
        Number(row.retryCount || 0),
        row.lastError ?? null,
        row.status === 'deferred' ? 'deferred' : 'queued',
      );
      return Number(info.lastInsertRowid);
    },
    pending() {
      return db.prepare('SELECT * FROM pending_receipts WHERE synced = 0').all().map(r => ({
        id: r.id,
        payload: JSON.parse(r.payload_json),
        clientReceiptId: r.client_receipt_id,
        localNumber: r.local_number,
        createdAt: r.created_at,
        retryCount: r.retry_count,
        lastError: r.last_error,
        status: r.status === 'deferred' ? 'deferred' : 'queued',
        editedAt: r.edited_at ?? null,
      }));
    },
    pendingCount() {
      return db.prepare('SELECT COUNT(*) AS n FROM pending_receipts WHERE synced = 0').get().n;
    },
    removeOutbox(id) {
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(id);
    },
    updateOutbox(id, changes = {}) {
      const sets = [];
      const args = [];
      if (changes.payload !== undefined) {
        sets.push('payload_json = ?');
        args.push(JSON.stringify(changes.payload));
      }
      if (changes.status !== undefined) {
        sets.push('status = ?');
        args.push(changes.status === 'deferred' ? 'deferred' : 'queued');
      }
      if (changes.localNumber !== undefined) {
        sets.push('local_number = ?');
        args.push(Number(changes.localNumber || 0));
      }
      if (!sets.length) return;
      if (changes.payload !== undefined) {
        sets.push('edited_at = ?');
        args.push(new Date().toISOString());
      }
      args.push(Number(id));
      db.prepare(`UPDATE pending_receipts SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    },
    resetOutboxRetry(id) {
      db.prepare(`
        UPDATE pending_receipts SET retry_count = 0, last_error = NULL WHERE id = ?
      `).run(Number(id));
    },
    outboxCounts(deadThreshold = 8) {
      const rows = db.prepare(`
        SELECT status, retry_count FROM pending_receipts WHERE synced = 0
      `).all();
      const counts = { total: rows.length, queued: 0, deferred: 0, dead: 0 };
      for (const r of rows) {
        const dead = r.retry_count >= deadThreshold;
        if (dead) counts.dead++;
        else if (r.status === 'deferred') counts.deferred++;
        else counts.queued++;
      }
      return counts;
    },
    markOutboxError(id, error, permanent) {
      if (permanent) {
        db.prepare(`
          UPDATE pending_receipts
          SET retry_count = CASE WHEN retry_count < 99 THEN 99 ELSE retry_count END, last_error = ?
          WHERE id = ?
        `).run(String(error).slice(0, 400), id);
        return;
      }
      db.prepare(`
        UPDATE pending_receipts
        SET retry_count = retry_count + 1, last_error = ?
        WHERE id = ?
      `).run(String(error).slice(0, 400), id);
    },
    saveLastReceipt(data) {
      db.prepare(`
        INSERT INTO last_receipt (id, json) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET json = excluded.json
      `).run(JSON.stringify(data));
    },
    loadLastReceipt() {
      const row = db.prepare('SELECT json FROM last_receipt WHERE id = 1').get();
      return row ? JSON.parse(row.json) : null;
    },
    /** Today-only mirror of the cashier's receipts so reopening shows them instantly, offline. */
    saveTodayReceipts(list) {
      const now = new Date().toISOString();
      const run = db.transaction(rows => {
        db.prepare('DELETE FROM today_receipts').run();
        const stmt = db.prepare('INSERT INTO today_receipts (json, created_at) VALUES (?, ?)');
        for (const r of rows || []) stmt.run(JSON.stringify(r), now);
      });
      run(list);
    },
    loadTodayReceipts() {
      return db.prepare('SELECT json FROM today_receipts ORDER BY id ASC').all().map(r => JSON.parse(r.json));
    },
  };
}

module.exports = { createCatalogStore };
