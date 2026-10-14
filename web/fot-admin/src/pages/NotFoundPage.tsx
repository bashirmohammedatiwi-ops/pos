import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Btn, Kbd } from '@/components/ui';
import { IconChart, IconDashboard, IconReceipt, IconSearch } from '@/components/icons';

const QUICK_LINKS = [
  { to: '/', label: 'الرئيسية', icon: IconDashboard },
  { to: '/receipts', label: 'الفواتير', icon: IconReceipt },
  { to: '/reports', label: 'التقارير', icon: IconChart },
];

function openPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
}

export function NotFoundPage() {
  const { pathname } = useLocation();
  const nav = useNavigate();

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="card w-full max-w-lg animate-slide-up p-8 text-center">
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-brand-50" />
          <span className="absolute inset-3 rounded-full bg-brand-100/70" />
          <span className="num relative text-[26px] font-extrabold tracking-tight text-brand-700">404</span>
        </div>
        <h1 className="mt-5 text-[18px] font-extrabold text-header">الصفحة غير موجودة</h1>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
          لم نجد هذا الرابط. ربما نُقلت الصفحة أو كُتب العنوان بشكل خاطئ.
        </p>
        <p className="mx-auto mt-2 inline-block max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11.5px] text-slate-500" dir="ltr">
          {pathname}
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Btn onClick={() => nav('/')} icon={<IconDashboard size={15} />}>العودة للرئيسية</Btn>
          <Btn variant="secondary" onClick={() => nav(-1)}>رجوع</Btn>
          <Btn variant="ghost" onClick={openPalette} icon={<IconSearch size={15} />}>
            بحث <span className="ms-1 inline-flex gap-0.5" dir="ltr"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </Btn>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="text-[11.5px] font-semibold text-slate-400">روابط سريعة</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {QUICK_LINKS.map(l => (
              <Link
                key={l.to}
                to={l.to}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-50 px-3 text-[12px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200"
              >
                <l.icon size={13} />
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
