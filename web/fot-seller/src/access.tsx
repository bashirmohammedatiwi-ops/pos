import { useEffect, useRef, useState } from 'react';
import { ACCESS_EVENT, api, getToken, publishAccess, refreshSession, type SellerAccess } from './api';
import { BrandMark } from './ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * بوابة أوقات الفتح — تحدد الإدارة لكل بائع وقتاً يُفتح فيه الويب (بتوقيت العراق).
 * خارج الوقت: شاشة كاملة برسالة وعدّاد تنازلي حتى الفتح، ثم تُفتح تلقائياً.
 * أثناء الوقت: تُقفل تلقائياً لحظة انتهاء الوقت دون انتظار طلب جديد.
 * الوقت يُحسب من ساعة الخادم (لا ساعة الهاتف) عبر فرق serverNow.
 * ───────────────────────────────────────────────────────────────────────────── */

const IRAQ_OFFSET_MS = 3 * 3600_000;

function two(n: number) {
  return String(n).padStart(2, '0');
}

/** "HH:MM" (24 ساعة) → "9:00 ص" */
function to12(hm?: string) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  if (!Number.isFinite(h)) return hm;
  if (h === 24 || h === 0) return `12:${two(m || 0)} ص`;
  const suffix = h < 12 ? 'ص' : 'م';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${two(m || 0)} ${suffix}`;
}

/** تاريخ ووقت بتوقيت العراق للعرض (مستقل عن منطقة الهاتف). */
function iraqLabel(iso: string) {
  const d = new Date(Date.parse(iso) + IRAQ_OFFSET_MS);
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return `${days[d.getUTCDay()]} ${to12(`${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`)}`;
}

export function AccessGate() {
  const [access, setAccess] = useState<SellerAccess | null>(null);
  const [skew, setSkew] = useState(0); // serverNow − Date.now()
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);

  // استقبال حالة الوصول من أي رد
  useEffect(() => {
    const onAccess = (e: Event) => {
      const a = (e as CustomEvent<SellerAccess>).detail;
      if (!a) return;
      const server = Date.parse(a.serverNow);
      if (Number.isFinite(server)) setSkew(server - Date.now());
      setAccess(a);
    };
    window.addEventListener(ACCESS_EVENT, onAccess);
    return () => window.removeEventListener(ACCESS_EVENT, onAccess);
  }, []);

  // سؤال الخادم عند الفتح وكل دقيقتين وعند العودة للصفحة
  useEffect(() => {
    const check = async () => {
      if (checking.current || !getToken()) return;
      checking.current = true;
      try {
        await api.access().then(a => window.dispatchEvent(new CustomEvent(ACCESS_EVENT, { detail: a })));
      } catch {
        /* 423 يُنشر تلقائياً من request؛ الأخطاء الأخرى تُتجاهل هنا */
      } finally {
        checking.current = false;
      }
    };
    void check();
    const id = window.setInterval(check, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // نبضة كل ثانية فقط حين يلزم عدّاد أو إغلاق قريب
  const serverNow = now + skew;
  const closesAt = access?.open && access.closesAt ? Date.parse(access.closesAt) : null;
  const opensAt = access && !access.open && access.opensAt ? Date.parse(access.opensAt) : null;
  const needTick = Boolean(access?.restricted) && (opensAt != null || closesAt != null);
  useEffect(() => {
    if (!needTick) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [needTick]);

  // انتهى الوقت أثناء الاستخدام → قفل فوري محلياً
  const closedLocally = closesAt != null && serverNow >= closesAt;
  // حان وقت الفتح → إعادة التحقق من الخادم ثم فتح
  const reached = opensAt != null && serverNow >= opensAt;
  useEffect(() => {
    if (!reached) return;
    let cancelled = false;
    void (async () => {
      if (getToken()) {
        await refreshSession();
        try {
          const a = await api.access();
          if (!cancelled) window.dispatchEvent(new CustomEvent(ACCESS_EVENT, { detail: a }));
        } catch {
          /* 423 → يبقى مغلقاً بموعد جديد */
        }
      } else if (!cancelled && access) {
        // على شاشة الدخول: نزيل القفل ليتمكن من الدخول
        setAccess({ ...access, open: true, opensAt: null, closesAt: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reached]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!closedLocally || !access) return;
    // نطلب الموعد التالي من الخادم (200 يُنشر هنا، و423 يُنشر داخل request)
    void api.access().then(publishAccess).catch(() => undefined);
  }, [closedLocally]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = Boolean(access?.restricted) && (!access!.open || closedLocally);
  if (!locked || !access) return null;

  const target = opensAt;
  const left = target != null ? Math.max(0, Math.floor((target - serverNow) / 1000)) : null;
  const d = left != null ? Math.floor(left / 86400) : 0;
  const h = left != null ? Math.floor((left % 86400) / 3600) : 0;
  const m = left != null ? Math.floor((left % 3600) / 60) : 0;
  const s = left != null ? left % 60 : 0;
  const iraqNow = new Date(serverNow + IRAQ_OFFSET_MS);

  return (
    <div className="access-gate" role="alertdialog" aria-modal="true" aria-labelledby="access-title">
      <div className="access-card fade-up">
        <div className="access-brand">
          <BrandMark />
        </div>
        <div className="access-lock" aria-hidden>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h1 id="access-title" className="access-title">الويب مغلق الآن</h1>
        <p className="access-text">
          وقت فتح حسابك من <b>{to12(access.from)}</b> إلى <b>{to12(access.to)}</b>
          <br />
          <span className="access-days">{access.days}</span> · بتوقيت العراق
        </p>

        {left != null ? (
          <>
            <div className="access-sub">يُفتح بعد</div>
            <div className="access-timer" dir="ltr">
              {d > 0 && (
                <>
                  <span className="cell"><b>{d}</b><small>يوم</small></span>
                  <span className="sep">:</span>
                </>
              )}
              <span className="cell"><b>{two(h)}</b><small>ساعة</small></span>
              <span className="sep">:</span>
              <span className="cell"><b>{two(m)}</b><small>دقيقة</small></span>
              <span className="sep">:</span>
              <span className="cell"><b>{two(s)}</b><small>ثانية</small></span>
            </div>
            {access.opensAt && <div className="access-when">موعد الفتح: {iraqLabel(access.opensAt)}</div>}
          </>
        ) : (
          <div className="access-sub">جاري التحقق من الموعد…</div>
        )}

        <div className="access-now">
          الساعة الآن في العراق: <b dir="ltr">{to12(`${two(iraqNow.getUTCHours())}:${two(iraqNow.getUTCMinutes())}`)}</b>
        </div>
      </div>
    </div>
  );
}
