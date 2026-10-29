import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

/* ─────────────────────────────────────────────────────────────────────────────
 * تنبيه بارز حين يكون خادم الفريق على الـ VPS أقدم مما تحتاجه لوحة التحكم والتطبيق:
 * الحضور والشبكات وتحديث التطبيق لا تعمل حتى يُحدَّث — مع الأمر جاهزاً للنسخ.
 * ───────────────────────────────────────────────────────────────────────────── */

/** أقل نسخة خادم يعمل معها هذا الإصدار (deploy/hub/version.js). */
export const REQUIRED_HUB_VERSION = '2026.10.29';
const UPDATE_CMD = 'cd ~/pos && git pull origin main && sh deploy/update.sh';

export function hubIsOutdated(version?: string | null) {
  return !version || version < REQUIRED_HUB_VERSION;
}

export function HubOutdatedBanner({ onKey }: { onKey: () => void }) {
  const q = useQuery({ queryKey: ['team-hub-status'], queryFn: api.teamHubStatus, retry: 0, refetchInterval: 60_000 });
  const [copied, setCopied] = useState(false);
  const keyRejected = q.error instanceof Error && q.error.message.includes('مفتاح المزامنة');
  if (keyRejected) {
    return (
      <section className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-3 text-red-900" role="alert">
        <p className="text-[13.5px] font-bold">خادم الفريق رفض مفتاح المزامنة</p>
        <p className="mt-0.5 text-[12px] leading-6 text-red-800">
          تحديث الـ VPS أنشأ مفتاحاً جديداً. الصق المفتاح الذي ظهر في نهاية التحديث في{' '}
          <button type="button" className="font-bold underline" onClick={onKey}>
            التحديثات والإشعارات ← ربط خادم الفريق
          </button>
          {' '}— حتى ذلك تتوقف المزامنة وتسجيل الحضور.
        </p>
      </section>
    );
  }
  if (!q.data || !hubIsOutdated(q.data.hubVersion)) return null;

  return (
    <section className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-3 text-red-900" role="alert">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-600 text-[18px] text-white" aria-hidden>
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold">
            خادم الفريق على الـ VPS بنسخة قديمة{q.data.hubVersion ? ` (${q.data.hubVersion})` : ''}
          </p>
          <p className="mt-0.5 text-[12px] leading-6 text-red-800">
            تسجيل الحضور، وشبكات المحل وعنوانها، وتحديث التطبيق من داخل الهاتف لن تعمل حتى تحدّثه. ادخل إلى الـ VPS ونفّذ:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="num rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-800 ring-1 ring-inset ring-red-200" dir="ltr">
              {UPDATE_CMD}
            </code>
            <button
              type="button"
              className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-red-700"
              onClick={() => {
                void navigator.clipboard?.writeText(UPDATE_CMD).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? 'نُسخ ✓' : 'نسخ الأمر'}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-5 text-red-800">
            إن ظهر بعد التحديث «NEW SHOP SYNC KEY» فانسخ المفتاح وأدخله في{' '}
            <button type="button" className="font-bold underline" onClick={onKey}>
              التحديثات والإشعارات ← ربط خادم الفريق
            </button>
            . بعد التحديث يدخل الموظفون مرة واحدة من جديد بنفس الكود والرمز.
          </p>
        </div>
      </div>
    </section>
  );
}
