import { useEffect, useState } from 'react';
import { isNative } from '../config';
import { I, Sheet, toast } from './kit';
import { haptic } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * تثبيت الموقع على الشاشة الرئيسية:
 *   · أندرويد والحاسبة (Chrome/Edge/Samsung): نافذة التثبيت الأصلية بضغطة.
 *   · الآيفون: لا يسمح Apple بالتثبيت من الموقع — خطوات مصوّرة (مشاركة ← إضافة إلى الشاشة الرئيسية).
 *   · مثبّت أو داخل تطبيق الهاتف: لا يظهر الزر.
 * ───────────────────────────────────────────────────────────────────────────── */

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: PromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(f => f());

/** يُستدعى مبكراً (main.tsx) كي لا يفوتنا حدث المتصفح قبل تحميل الواجهة */
export function captureInstallPrompt() {
  if (isNative()) return;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e as PromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches || !!window.matchMedia?.('(display-mode: minimal-ui)').matches;

export function useInstall() {
  const [, force] = useState(0);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const f = () => force(x => x + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  const hidden = isNative() || isStandalone() || installedNow;
  // الآيفون دائماً بخطوات؛ غيره بالنافذة الأصلية إن توفرت، وإلا بإرشاد قائمة المتصفح
  const available = !hidden && (isIos() || !!deferred || window.isSecureContext);
  async function install() {
    haptic('tap');
    if (deferred) {
      const ev = deferred;
      deferred = null;
      try {
        await ev.prompt();
        const { outcome } = await ev.userChoice;
        if (outcome === 'accepted') {
          installedNow = true;
          toast('تم التثبيت ✅ — افتح «ديما الفريق» من شاشتك');
        }
      } catch {
        setSheet(true);
      }
      notify();
      return;
    }
    setSheet(true);
  }
  return { available, install, sheet, closeSheet: () => setSheet(false), oneTap: !!deferred };
}

/** خطوات التثبيت (الآيفون، أو متصفح بلا نافذة تثبيت) */
export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ios = isIos();
  const share = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
  const plus = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
  const steps = ios
    ? [
        { icon: share, title: 'اضغط زر المشاركة', text: 'في أسفل سفاري (أو أعلاه على الآيباد). افتح الموقع من سفاري لا من تطبيق آخر.' },
        { icon: plus, title: '«إضافة إلى الشاشة الرئيسية»', text: 'مرّر القائمة للأسفل إن لم تجده مباشرة.' },
        { icon: <I.check size={20} />, title: 'اضغط «إضافة»', text: 'تظهر أيقونة «ديما الفريق» على شاشتك — افتحه منها دائماً لتصلك الإشعارات.' },
      ]
    : [
        { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>, title: 'افتح قائمة المتصفح', text: 'النقاط الثلاث (⋮) بجانب عنوان الموقع.' },
        { icon: plus, title: '«تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»', text: 'في Chrome وEdge وSamsung Internet.' },
        { icon: <I.check size={20} />, title: 'أكّد التثبيت', text: 'يظهر «ديما الفريق» كتطبيق مستقل على هاتفك أو حاسبتك.' },
      ];
  return (
    <Sheet open={open} onClose={onClose} title="ثبّت ديما على شاشتك" subtitle="يفتح كتطبيق مستقل، أسرع، وتصله الإشعارات">
      <ol className="in-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="in-num num">{i + 1}</span>
            <span className="in-ico">{s.icon}</span>
            <span className="in-text">
              <b>{s.title}</b>
              <small>{s.text}</small>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="t-btn block press" style={{ marginTop: 14 }} onClick={onClose}>
        فهمت
      </button>
    </Sheet>
  );
}

/** بطاقة الرئيسية: تختفي بعد التثبيت، ويمكن إخفاؤها أسبوعاً */
export function InstallCard() {
  const { available, install, sheet, closeSheet, oneTap } = useInstall();
  const [snoozed, setSnoozed] = useState(() => {
    try {
      return Date.now() < Number(localStorage.getItem('fot_install_card') || 0);
    } catch {
      return false;
    }
  });
  if (!available || snoozed) return <InstallSheet open={sheet} onClose={closeSheet} />;
  return (
    <div className="in-card-wrap">
      <div className="in-card">
        <span className="in-card-icon" aria-hidden>
          <img src="team-icon.png" alt="" width={44} height={44} />
        </span>
        <span className="in-card-text">
          <b>ثبّت ديما الفريق على شاشتك</b>
          <small>{isIos() ? 'يفتح كتطبيق وتصلك الإشعارات على الآيفون' : 'يفتح كتطبيق مستقل بضغطة واحدة'}</small>
        </span>
        <button type="button" className="t-btn sm press" onClick={() => void install()}>
          {oneTap ? 'تثبيت' : 'كيف؟'}
        </button>
        <button
          type="button"
          className="in-card-x"
          aria-label="إخفاء"
          onClick={() => {
            setSnoozed(true);
            try {
              localStorage.setItem('fot_install_card', String(Date.now() + 7 * 86_400_000));
            } catch {
              /* تخزين غير متاح */
            }
          }}
        >
          <I.close size={15} />
        </button>
      </div>
      <InstallSheet open={sheet} onClose={closeSheet} />
    </div>
  );
}

/** زر صغير (القائمة الجانبية، الحساب، الدخول) */
export function InstallButton({ variant = 'link' }: { variant?: 'link' | 'side' | 'row' }) {
  const { available, install, sheet, closeSheet } = useInstall();
  if (!available) return null;
  return (
    <>
      <button type="button" className={`in-btn ${variant} press`} onClick={() => void install()}>
        <I.download size={variant === 'side' ? 19 : 17} />
        <span>تثبيت التطبيق على الشاشة</span>
      </button>
      <InstallSheet open={sheet} onClose={closeSheet} />
    </>
  );
}
