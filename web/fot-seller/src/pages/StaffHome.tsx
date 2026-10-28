import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../config';
import { KIND_LABEL, clearTeam, getTeamMe, refreshTeam, type TeamStaff } from '../team';
import { Avatar, BrandMark, IconOut, Sheet } from '../ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * الرئيسية للموظف غير البائع (كاشير، مشرف، …) — حسابه والوحدات القادمة.
 * الحضور والإجازات والتبليغات والمحادثات تُضاف هنا تباعاً.
 * ───────────────────────────────────────────────────────────────────────────── */

const SOON = [
  { title: 'الحضور والاستراحة', hint: 'تسجيل الدخول والخروج من شبكة المحل، ومنبّه نهاية الاستراحة' },
  { title: 'دوامي وإجازاتي', hint: 'يوم العطلة الأسبوعي وطلبات التبديل والإجازة' },
  { title: 'التبليغات والإعلانات', hint: 'تعليمات الإدارة والعروض الجديدة بالصور' },
  { title: 'المحادثات', hint: 'محادثات خاصة ومجموعات العمل' },
];

export function StaffHome() {
  const nav = useNavigate();
  const [me, setMe] = useState<TeamStaff | null>(getTeamMe);
  const [askOut, setAskOut] = useState(false);

  useEffect(() => {
    void refreshTeam().then(r => {
      if (!r.ok) nav('/login', { replace: true });
      else if (r.staff) setMe(r.staff);
    });
  }, [nav]);

  function logout() {
    clearTeam();
    nav('/login', { replace: true });
  }

  const name = me?.name || 'موظف';

  return (
    <div className="app">
      <div className="app-body">
        <div className="workspace">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <Avatar name={name} />
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.22em] text-gold">DEEMA · TEAM</p>
                <p className="text-sm font-extrabold">{name}</p>
              </div>
            </div>
            <button type="button" className="icon-btn" aria-label="خروج" onClick={() => setAskOut(true)}>
              <IconOut />
            </button>
          </header>

          <main className="main space-y-4">
            <section className="card flex items-center gap-4 p-5 fade-up">
              <BrandMark size={48} />
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold tracking-[0.22em] text-gold">{KIND_LABEL[me?.kind ?? ''] ?? 'موظف'}</p>
                <h1 className="display mt-1 text-2xl font-black leading-tight">أهلاً {name.split(' ')[0]}</h1>
                <p className="mt-1 text-sm font-bold text-muted">
                  {[me?.jobTitle, me?.sectionName].filter(Boolean).join(' · ') || 'فريق ديما الحياة'}
                </p>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">كود الدخول</p>
                <p className="num mt-1 text-lg font-extrabold" dir="ltr">{me?.code ?? '—'}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">إصدار التطبيق</p>
                <p className="num mt-1 text-lg font-extrabold">{APP_VERSION}</p>
              </div>
            </section>

            <section>
              <p className="kicker mb-2">قريباً في التطبيق</p>
              <div className="space-y-2.5">
                {SOON.map(m => (
                  <div key={m.title} className="card p-4">
                    <p className="font-extrabold">{m.title}</p>
                    <p className="mt-1 text-sm font-bold leading-6 text-muted">{m.hint}</p>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>

      <Sheet open={askOut} title="تأكيد الخروج؟" onClose={() => setAskOut(false)}>
        <p className="text-sm font-bold text-muted">ستحتاج الكود والرمز للدخول مرة أخرى.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="rounded-2xl bg-paper py-3 font-extrabold" onClick={() => setAskOut(false)}>بقاء</button>
          <button type="button" className="rounded-2xl bg-terracotta py-3 font-extrabold text-white" onClick={logout}>خروج</button>
        </div>
      </Sheet>
    </div>
  );
}
