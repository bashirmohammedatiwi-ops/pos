import { Suspense, lazy, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { TableSkeleton } from '@/components/ui';
import { HubOutdatedBanner } from './HubOutdatedBanner';

/* ─────────────────────────────────────────────────────────────────────────────
 * «تطبيق الفريق» — قسم رئيسي واحد يجمع كل ما يخص التطبيق في أقسام فرعية:
 * نظرة عامة، الموظفون، الحضور، الإجازات والعطل، الإعلانات، التبليغات،
 * الشبكات وقواعد الدوام، حسابات المدراء والويب، سجل التدقيق.
 * ───────────────────────────────────────────────────────────────────────────── */

const lz = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then(m => ({ default: m[name] as React.ComponentType<Record<string, unknown>> })));

const Overview = lz(() => import('./TeamAttendPages'), 'TeamOverviewPanel');
const Staff = lz(() => import('./TeamStaffPage'), 'TeamStaffPage');
const Attend = lz(() => import('./TeamAttendPages'), 'TeamAttendPage');
const Hours = lz(() => import('./TeamPlanPages'), 'TeamHoursPage');
const Supervisors = lz(() => import('./TeamPlanPages'), 'TeamSupervisorsPage');
const Leave = lz(() => import('./TeamWorkPages'), 'TeamLeavePage');
const Posts = lz(() => import('./TeamWorkPages'), 'TeamPostsPage');
const Notify = lz(() => import('./TeamWorkPages'), 'TeamNotifyPage');
const Products = lz(() => import('./TeamProductsPage'), 'TeamProductsPage');
const Managers = lz(() => import('./TeamManagersPage'), 'TeamManagersPage');
const Rules = lz(() => import('./TeamAttendPages'), 'TeamRulesPage');
const Accounts = lz(() => import('../PortalAccountsPage'), 'PortalAccountsPage');
const Audit = lz(() => import('./TeamAttendPages'), 'TeamAuditPage');
const Report = lz(() => import('./TeamReportPages'), 'TeamReportPage');
const AppPage = lz(() => import('./TeamReportPages'), 'TeamAppPage');

type Tab = { id: string; label: string; icon: string; hint: string };
const TEAM_TABS: Tab[] = [
  { id: 'overview', label: 'نظرة عامة', icon: '◉', hint: 'الفريق اليوم وما يحتاج انتباهك' },
  { id: 'staff', label: 'الموظفون', icon: '👤', hint: 'الحسابات والرموز والهواتف المربوطة' },
  { id: 'attend', label: 'الحضور', icon: '⏱', hint: 'اللوحة الحيّة والسجل والتصحيح' },
  { id: 'hours', label: 'الدوام بالساعات', icon: '⏳', hint: 'ساعات موظفي الساعات أسبوعياً ورواتبهم' },
  { id: 'report', label: 'الملخص والأوفر تايم', icon: '📊', hint: 'ملخص شهري لكل موظف، الأوفر تايم ومبلغه، وجدول الفريق' },
  { id: 'leave', label: 'الإجازات والعطل', icon: '📅', hint: 'الطلبات والموافقات والعطل الأسبوعية' },
  { id: 'posts', label: 'الإعلانات', icon: '📣', hint: 'أخبار وعروض بالصور' },
  { id: 'notify', label: 'التبليغات', icon: '🔔', hint: 'رسائل فورية للهواتف' },
  { id: 'products', label: 'منتجات العمولة والصور', icon: '🖼', hint: 'صورة لكل منتج عمولة تظهر للبائعين' },
  { id: 'rules', label: 'الشبكات وقواعد الدوام', icon: '📶', hint: 'شبكات المحل والورديات والاستراحة' },
  { id: 'managers', label: 'صلاحيات المدراء', icon: '🛡', hint: 'ما يستطيعه كل مدير والأقسام التي يديرها' },
  { id: 'supervisors', label: 'مسؤولو الفرق', icon: '⭐', hint: 'موظف مسؤول عن موظفين آخرين وصلاحياته' },
  { id: 'accounts', label: 'حسابات المدراء والويب', icon: '🔑', hint: 'دخول المدراء وأوقات فتح الويب' },
  { id: 'app', label: 'التحديثات والإشعارات', icon: '📲', hint: 'رفع إصدار جديد للتطبيق وحالة إشعارات الهواتف' },
  { id: 'audit', label: 'سجل التدقيق', icon: '🧾', hint: 'كل إجراء في التطبيق' },
];

export function TeamHubPage() {
  const { tab = 'overview' } = useParams();
  const nav = useNavigate();
  const go = (id: string) => nav(id === 'overview' ? '/team' : `/team/${id}`);
  const active = TEAM_TABS.find(t => t.id === tab) ?? TEAM_TABS[0];

  // شارات حية على الأقسام
  const ov = useQuery({ queryKey: ['team-overview'], queryFn: api.teamOverview, retry: 0, refetchInterval: 30_000 });
  const board = useQuery({ queryKey: ['team-board'], queryFn: api.teamBoard, retry: 0, refetchInterval: 20_000 });
  const badge: Record<string, number | undefined> = {
    leave: ov.data?.pending || undefined,
    attend: board.data ? board.data.counts.over + board.data.counts.missing || undefined : undefined,
    rules: board.data && board.data.network.enforced && board.data.network.count === 0 ? 1 : undefined,
  };

  let body: ReactNode;
  switch (active.id) {
    case 'staff':
      body = <Staff />;
      break;
    case 'attend':
      body = <Attend />;
      break;
    case 'hours':
      body = <Hours />;
      break;
    case 'supervisors':
      body = <Supervisors />;
      break;
    case 'leave':
      body = <Leave />;
      break;
    case 'posts':
      body = <Posts />;
      break;
    case 'notify':
      body = <Notify />;
      break;
    case 'products':
      body = <Products />;
      break;
    case 'rules':
      body = <Rules />;
      break;
    case 'managers':
      body = <Managers />;
      break;
    case 'accounts':
      body = <Accounts />;
      break;
    case 'audit':
      body = <Audit />;
      break;
    case 'report':
      body = <Report />;
      break;
    case 'app':
      body = <AppPage />;
      break;
    default:
      body = <Overview go={go} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <HubOutdatedBanner onKey={() => go('app')} />
      <nav className="card flex shrink-0 items-center gap-1 overflow-x-auto p-1" aria-label="أقسام تطبيق الفريق">
        {TEAM_TABS.map(t => {
          const on = t.id === active.id;
          return (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => go(t.id)}
              className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[12.5px] font-semibold transition ${
                on ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {!!badge[t.id] && (
                <span className={`num rounded-full px-1.5 text-[10.5px] font-bold ${on ? 'bg-white/25 text-white' : 'bg-red-500 text-white'}`}>
                  {t.id === 'rules' ? '!' : badge[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <Suspense fallback={<TableSkeleton rows={8} />}>{body}</Suspense>
    </div>
  );
}
