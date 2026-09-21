import { useState, type FormEvent } from 'react';
import type { LanServer } from '@fot/shared';
import {
  buildApiBase,
  parseApiBase,
  persistApiBase,
  testApiConnection,
  type ApiBaseParts,
} from '@/lib/apiBase';

export function LoginServerSettings({
  initialUrl,
  onSaved,
  onClose,
}: {
  initialUrl: string;
  onSaved: (url: string, online: boolean) => void;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<ApiBaseParts>(() => parseApiBase(initialUrl || 'http://127.0.0.1:5000'));
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<LanServer[]>([]);
  const [scanMessage, setScanMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState<boolean | null>(null);

  function update(patch: Partial<ApiBaseParts>) {
    setParts(prev => ({ ...prev, ...patch }));
    setError('');
    setStatus('');
    setStatusOk(null);
  }

  function currentUrl() {
    return buildApiBase(parts);
  }

  async function scanLan() {
    if (!window.fotDesktop?.discoverServers) {
      setScanMessage('الاكتشاف التلقائي متاح في تطبيق سطح المكتب فقط');
      return;
    }
    setScanning(true);
    setScanMessage('');
    setDiscovered([]);
    try {
      const found = await window.fotDesktop.discoverServers({ timeoutMs: 5000, httpScan: true });
      setDiscovered(found);
      setScanMessage(
        found.length
          ? `وُجد ${found.length} خادم — اضغط أحدها لتعبئة الحقول ثم افحص الاتصال`
          : 'لم يُعثر على خادم على هذه الشبكة',
      );
    } finally {
      setScanning(false);
    }
  }

  function applyDiscovered(url: string) {
    setParts(parseApiBase(url));
    setError('');
    setStatus('تم نسخ العنوان — افحص الاتصال ثم احفظ');
    setStatusOk(null);
  }

  async function onTest() {
    const url = currentUrl();
    if (!url) {
      setError('أدخل عنوان IP أو اسم الجهاز');
      return;
    }
    setTesting(true);
    setError('');
    setStatus('');
    try {
      const result = await testApiConnection(url);
      setStatusOk(result.ok);
      setStatus(result.ok ? `${result.message}\n${result.url}` : result.message);
    } finally {
      setTesting(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    const url = currentUrl();
    if (!url) {
      setError('أدخل عنوان IP أو اسم الجهاز');
      return;
    }
    setSaving(true);
    try {
      const saved = await persistApiBase(url);
      const result = await testApiConnection(saved);
      setStatusOk(result.ok);
      setStatus(result.ok ? `تم الحفظ والاتصال على ${saved}` : `تم الحفظ على ${saved} — الخادم غير متاح الآن، يمكن البيع محلياً`);
      onSaved(saved, result.ok);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-login-settings">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-slate-800">إعدادات الاتصال</h2>
        <button type="button" onClick={onClose} className="text-[12px] text-slate-500 hover:text-slate-700">
          إغلاق
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-6 text-slate-500">
        المنفذ الافتراضي للخادم هو <span className="font-mono" dir="ltr">5000</span>. يُحفظ العنوان على هذا الجهاز ويعمل التطبيق محلياً إن انقطع الاتصال.
      </p>

      <form onSubmit={e => void onSave(e)} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">البروتوكول</span>
          <select
            value={parts.protocol}
            onChange={e => update({ protocol: e.target.value as 'http' | 'https' })}
            className="pos-field h-10 w-full text-[13px]"
          >
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">عنوان IP / الجهاز</span>
          <input
            value={parts.host}
            onChange={e => update({ host: e.target.value })}
            className="pos-field h-10 w-full font-mono text-[13px]"
            dir="ltr"
            placeholder="192.168.1.10"
            autoComplete="off"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">المنفذ</span>
          <input
            value={parts.port}
            onChange={e => update({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            className="pos-field h-10 w-full font-mono text-[13px]"
            dir="ltr"
            placeholder="5000"
            inputMode="numeric"
          />
        </label>

        <p className="rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600" dir="ltr">
          {currentUrl() || '—'}
        </p>

        {window.fotDesktop?.discoverServers && (
          <button
            type="button"
            onClick={() => void scanLan()}
            disabled={scanning}
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600 hover:bg-white disabled:opacity-60"
          >
            {scanning ? 'جاري الاكتشاف…' : 'اكتشاف تلقائي على الشبكة'}
          </button>
        )}

        {scanMessage && <p className="text-[11px] text-slate-500">{scanMessage}</p>}

        {discovered.length > 0 && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-2 text-[11px] text-slate-600">
            <p className="mb-1 font-semibold">خوادم مكتشفة — اضغط للنسخ:</p>
            <ul className="space-y-1">
              {discovered.map(s => (
                <li key={s.url}>
                  <button
                    type="button"
                    onClick={() => applyDiscovered(s.url)}
                    className="w-full rounded-md px-1 py-1 text-right font-mono hover:bg-white"
                    dir="ltr"
                  >
                    {s.hostName ? `${s.hostName} — ` : ''}{s.url}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{error}</div>
        )}
        {status && (
          <div className={`whitespace-pre-line rounded-lg px-2 py-1.5 text-[12px] ${statusOk ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-amber-200 bg-amber-50 text-amber-800'}`}>
            {status}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={testing || saving}
            onClick={() => void onTest()}
            className="h-10 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {testing ? 'جاري الفحص…' : 'فحص الاتصال'}
          </button>
          <button type="submit" disabled={saving || testing} className="pos-btn-primary h-10 text-[13px]">
            {saving ? 'جاري الحفظ…' : 'حفظ الإعدادات'}
          </button>
        </div>
      </form>
    </div>
  );
}
