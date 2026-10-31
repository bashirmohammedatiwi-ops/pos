import { useEffect, useState } from 'react';
import { getManagerToken, pushTest, type Role } from './work';
import { getTeamToken, pushPermission, registerPush } from '../team';
import { I, toast } from './kit';
import { haptic, onResume, openAppSettings } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * حالة إشعارات هذا الهاتف: الإذن، تجربة وصول حقيقية، وما يلزم لتصل والتطبيق مغلق.
 * ───────────────────────────────────────────────────────────────────────────── */

export function PushHealth({ role }: { role: Role }) {
  const [perm, setPerm] = useState<Awaited<ReturnType<typeof pushPermission>> | null>(null);
  const [busy, setBusy] = useState(false);
  const bearer = () => (role === 'manager' ? getManagerToken() : getTeamToken());

  useEffect(() => {
    const check = () =>
      void pushPermission().then(p => {
        setPerm(p);
        // عاد من الإعدادات بعد السماح: يُسجَّل الهاتف فوراً
        if (p === 'granted') void registerPush(role, bearer());
      });
    check();
    let off: (() => void) | undefined;
    void onResume(check).then(f => (off = f));
    return () => off?.();
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!perm || perm === 'off') return null;

  async function test() {
    haptic('tap');
    setBusy(true);
    try {
      if (perm !== 'granted') {
        await registerPush(role, bearer());
        const p = await pushPermission();
        setPerm(p);
        if (p !== 'granted') {
          toast('اسمح بالإشعارات من إعدادات التطبيق');
          await openAppSettings();
          return;
        }
      }
      const r = await pushTest(role);
      if (r.ok > 0) toast('أُرسل الإشعار — يصلك خلال ثوانٍ');
      else if (!r.count) {
        await registerPush(role, bearer());
        toast('سُجّل هاتفك الآن — جرّب مرة أخرى بعد قليل');
      } else toast('لم يُرسل الإشعار — تحقق من الإنترنت وجرّب مرة أخرى');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذرت التجربة');
    } finally {
      setBusy(false);
    }
  }

  const ok = perm === 'granted';
  return (
    <section className="t-section">
      <div className="t-section-head">
        <h2>الإشعارات</h2>
      </div>
      <div className="t-card pad" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`t-tile ${ok ? 'ok' : 'bad'}`}>
            <I.bell size={19} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 620 }}>{ok ? 'مسموحة على هذا الهاتف' : 'الإشعارات ممنوعة على هذا الهاتف'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{ok ? 'جرّبها لتتأكد أنها تصلك' : 'لن تصلك الطلبات والرسائل والتنبيهات'}</div>
          </div>
        </div>
        <div className="t-row-2">
          <button type="button" className="t-btn soft sm press" disabled={busy} onClick={() => void test()}>
            {busy ? 'جارٍ الإرسال…' : ok ? 'إرسال إشعار تجريبي' : 'السماح بالإشعارات'}
          </button>
          <button type="button" className="t-btn plain sm press" onClick={() => void openAppSettings()}>
            إعدادات التطبيق
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.8, color: 'var(--ink-3)' }}>
          لتصلك والتطبيق مغلق: من «إعدادات التطبيق» فعّل التشغيل التلقائي (Autostart) واجعل توفير البطارية «بلا قيود»، خصوصاً في هواتف شاومي وهواوي وأوبو.
        </p>
      </div>
    </section>
  );
}
