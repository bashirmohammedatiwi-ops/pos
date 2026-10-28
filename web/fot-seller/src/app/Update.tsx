import { useEffect, useState } from 'react';
import { APP_VERSION, apiUrl, isNative } from '../config';
import { I, Sheet } from './kit';
import { haptic, openExternal } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * فحص التحديث: عند فتح التطبيق يسأل الخادم عن أحدث إصدار رفعته الإدارة.
 *  · تحديث اختياري: نافذة سفلية «تحديث متوفر» تُؤجَّل ليوم كامل.
 *  · تحديث إلزامي: شاشة كاملة لا تُغلق حتى يُنزَّل الإصدار الجديد.
 * التنزيل يفتح خارج التطبيق فيثبّته أندرويد فوق النسخة الحالية (نفس التوقيع).
 * ───────────────────────────────────────────────────────────────────────────── */

type Latest = { latest: { version: string; notes?: string | null; size: number; url: string } | null; update?: boolean; required?: boolean };
const SNOOZE = 'fot_update_snooze';

export function UpdateCheck() {
  const [info, setInfo] = useState<Latest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isNative()) return;
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch(apiUrl(`/api/team/app/latest?v=${encodeURIComponent(APP_VERSION)}`), { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = (await res.json()) as Latest;
        if (!alive || !data.latest || !data.update) return;
        setInfo(data);
        let snoozed = '';
        try {
          snoozed = localStorage.getItem(SNOOZE) ?? '';
        } catch {
          /* تخزين غير متاح */
        }
        const [ver, until] = snoozed.split('|');
        if (data.required || ver !== data.latest.version || Date.now() > Number(until || 0)) setOpen(true);
      } catch {
        /* بلا شبكة: نعيد المحاولة في المرة القادمة */
      }
    };
    const t = window.setTimeout(() => void run(), 2500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  if (!info?.latest) return null;
  const l = info.latest;
  const download = () => {
    haptic('tap');
    void openExternal(apiUrl(l.url));
  };
  const later = () => {
    try {
      localStorage.setItem(SNOOZE, `${l.version}|${Date.now() + 24 * 3600e3}`);
    } catch {
      /* تخزين غير متاح */
    }
    setOpen(false);
  };
  const notes = (l.notes ?? '').split('\n').map(x => x.replace(/^[•\-\s]+/, '').trim()).filter(Boolean);
  const body = (
    <div className="t-update">
      <div className="t-update-icon">
        <I.download size={30} />
      </div>
      <b className="ver num ltr">
        {APP_VERSION} ← {l.version}
      </b>
      {notes.length > 0 && (
        <ul>
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <button type="button" className="t-btn block press" onClick={download}>
        تنزيل التحديث · {(l.size / 1048576).toFixed(1)} ميغابايت
      </button>
      <small className="muted">بعد اكتمال التنزيل افتح الملف واضغط «تحديث» — تبقى بياناتك ودخولك كما هي.</small>
      {!info.required && (
        <button type="button" className="t-btn plain block sm press" onClick={later}>
          لاحقاً
        </button>
      )}
    </div>
  );

  if (info.required)
    return (
      <div className="t-update-full" role="dialog" aria-modal="true" aria-label="تحديث إلزامي">
        <div>
          <h2>تحديث مطلوب</h2>
          <p className="muted">أصدرت الإدارة نسخة جديدة يجب تثبيتها لمتابعة استخدام التطبيق.</p>
          {body}
        </div>
      </div>
    );
  return (
    <Sheet open={open} onClose={later} title="تحديث جديد متوفر" subtitle="نسخة أحدث من تطبيق ديما">
      {body}
    </Sheet>
  );
}
