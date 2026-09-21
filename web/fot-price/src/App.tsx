import { useCallback, useEffect, useRef, useState } from 'react';
import { isPriceCheckerSettingsQr, type ProductDto } from '@fot/shared';
import { api } from '@/api/client';
import {
  buildApiBase,
  getApiBase,
  needsServerSetup,
  parseApiBase,
  setApiBase,
  testApiConnection,
} from '@/lib/apiBase';
import { findProduct, syncCatalog } from '@/lib/catalog';
import { db } from '@/lib/db';

type View = 'idle' | 'hit' | 'miss';

function money(n: number) {
  const value = Math.round(Number(n) || 0);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function offerPercent(p: ProductDto) {
  if (p.discountPercent > 0) return Math.round(p.discountPercent);
  if (p.originalPrice > p.price && p.originalPrice > 0) {
    return Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
  }
  return 0;
}

function hasOffer(p: ProductDto) {
  return Boolean(p.offerName) || offerPercent(p) > 0 || p.originalPrice > p.price + 0.5;
}

export function App() {
  const scanRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef(0);
  const clearRef = useRef(0);
  const [online, setOnline] = useState(false);
  const [view, setView] = useState<View>('idle');
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [host, setHost] = useState(() => parseApiBase(getApiBase()).host);
  const [port, setPort] = useState(() => parseApiBase(getApiBase()).port || '5000');
  const [settingsMsg, setSettingsMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const focusScan = useCallback(() => {
    if (settingsOpen) return;
    const el = scanRef.current;
    if (!el) return;
    try { el.focus(); } catch { /* old webview */ }
  }, [settingsOpen]);

  const ping = useCallback(async () => {
    if (!getApiBase()) {
      setOnline(false);
      return false;
    }
    try {
      await api.health();
      setOnline(true);
      return true;
    } catch {
      setOnline(false);
      return false;
    }
  }, []);

  const runSync = useCallback(async () => {
    if (!getApiBase()) return;
    try {
      await syncCatalog();
      await db.productCount();
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    if (needsServerSetup()) setSettingsOpen(true);
    void ping().then(ok => { if (ok) void runSync(); });
    const alive = window.setInterval(() => { void ping(); }, 8000);
    const sync = window.setInterval(() => { void runSync(); }, 240_000);
    return () => {
      window.clearInterval(alive);
      window.clearInterval(sync);
    };
  }, [ping, runSync]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        focusScan();
        void ping().then(ok => { if (ok) void runSync(); });
      }
    };
    window.addEventListener('fot-price-api-changed', () => { void runSync(); });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', focusScan);
    const t = window.setTimeout(focusScan, 80);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', focusScan);
      window.clearTimeout(t);
    };
  }, [focusScan, ping, runSync]);

  const showIdleSoon = useCallback(() => {
    window.clearTimeout(clearRef.current);
    clearRef.current = window.setTimeout(() => {
      setView('idle');
      setProduct(null);
      focusScan();
    }, 8000);
  }, [focusScan]);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    if (isPriceCheckerSettingsQr(code)) {
      setSettingsOpen(true);
      return;
    }
    const hit = await findProduct(code, online);
    if (!hit) {
      setProduct(null);
      setView('miss');
      showIdleSoon();
      return;
    }
    setProduct(hit);
    setView('hit');
    showIdleSoon();
  }, [online, showIdleSoon]);

  const startHold = () => {
    window.clearTimeout(holdRef.current);
    holdRef.current = window.setTimeout(() => setSettingsOpen(true), 1600);
  };
  const endHold = () => window.clearTimeout(holdRef.current);

  const saveSettings = async () => {
    setSaving(true);
    const url = buildApiBase({ host, port });
    const test = await testApiConnection(url);
    setSettingsMsg(test.message);
    if (test.ok) {
      setApiBase(url);
      setOnline(true);
      setSettingsOpen(false);
      void runSync();
      window.setTimeout(focusScan, 60);
    } else if (url) {
      setApiBase(url);
    }
    setSaving(false);
  };

  const pct = product ? offerPercent(product) : 0;
  const offer = product ? hasOffer(product) : false;

  return (
    <div className="pc-shell" onClick={focusScan}>
      <button
        type="button"
        className="pc-hot"
        onTouchStart={startHold}
        onTouchEnd={endHold}
        onMouseDown={startHold}
        onMouseUp={endHold}
        aria-label="إعدادات"
      />

      <main className="pc-stage">
        {view === 'idle' && (
          <div className="pc-idle">
            <h1>مرّر باركود المنتج</h1>
            <p>سيظهر السعر مباشرة</p>
          </div>
        )}

        {view === 'hit' && product && (
          <section>
            <h2 className="pc-name">{product.name || 'المنتج'}</h2>
            {offer ? (
              <div>
                <span className="pc-old-label">قبل</span>
                <div className="pc-old">{money(product.originalPrice || product.price)}</div>
                {pct > 0 && <div className="pc-off">خصم {pct}%</div>}
                <span className="pc-new-label">بعد</span>
                <div className="pc-price">{money(product.price)}</div>
              </div>
            ) : (
              <div className="pc-price">{money(product.price)}</div>
            )}
          </section>
        )}

        {view === 'miss' && (
          <section className="pc-miss">
            <h2 className="pc-name">تعذر العثور على المنتج</h2>
            <div className="pc-price">أعد مسح الباركود</div>
          </section>
        )}
      </main>

      <input
        ref={scanRef}
        className="pc-scan"
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="مسح الباركود"
        onBlur={() => window.setTimeout(focusScan, 40)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const value = e.currentTarget.value;
          e.currentTarget.value = '';
          void lookup(value);
        }}
      />

      {settingsOpen && (
        <div className="pc-overlay" onClick={e => e.stopPropagation()}>
          <div className="pc-dialog">
            <h2>إعدادات الجهاز</h2>
            <p>IP الحاسبة الرئيسية والمنفذ 5000</p>
            <input
              className="pc-field"
              dir="ltr"
              placeholder="192.168.1.10"
              value={host}
              onChange={e => setHost(e.target.value)}
            />
            <input
              className="pc-field"
              dir="ltr"
              placeholder="5000"
              value={port}
              onChange={e => setPort(e.target.value)}
            />
            <button type="button" className="pc-btn primary" disabled={saving} onClick={() => void saveSettings()}>
              {saving ? 'جارٍ الفحص…' : 'حفظ'}
            </button>
            {!needsServerSetup() && (
              <button type="button" className="pc-btn ghost" onClick={() => { setSettingsOpen(false); focusScan(); }}>
                إغلاق
              </button>
            )}
            {settingsMsg && <div className="pc-hint">{settingsMsg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
