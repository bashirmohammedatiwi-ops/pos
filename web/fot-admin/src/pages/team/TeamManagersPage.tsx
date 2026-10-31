import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { TeamManagerPermsDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Badge, Btn, Checkbox, Switch, TableSkeleton } from '@/components/ui';
import { ErrorBlock } from '@/components/people/PeopleKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← صلاحيات المدراء: ما يستطيع كل مدير فعله في التطبيق، والأقسام التي يديرها.
 * تُطبَّق على الخادم فوراً، ويختفي من تطبيق المدير كل ما ليس من صلاحيته.
 * ───────────────────────────────────────────────────────────────────────────── */

const PERMS: { key: keyof TeamManagerPermsDto['perms']; label: string; hint: string }[] = [
  { key: 'approveLeave', label: 'الإجازات والعطل', hint: 'قبول/رفض الطلبات وتعديل العطل الأسبوعية' },
  { key: 'viewAttendance', label: 'رؤية الحضور', hint: 'لوحة الحضور الحيّة والسجل وشبكات المحل' },
  { key: 'editAttendance', label: 'تعديل الحضور', hint: 'تصحيح الأوقات، الورديات، التقاط الشبكات' },
  { key: 'sendPosts', label: 'الإعلانات والتبليغات', hint: 'نشر إعلانات وإرسال تبليغات للفريق' },
  { key: 'manageChat', label: 'إدارة المحادثات', hint: 'إنشاء المجموعات وحذف الرسائل المسيئة' },
  { key: 'viewSales', label: 'مبيعات المحل', hint: 'المبيعات المباشرة والأيام السابقة والكاشيرية والبائعين والمنتجات' },
  { key: 'viewInvoices', label: 'الفواتير', hint: 'كل فواتير المحل بتفاصيلها وتصديرها PDF' },
  { key: 'viewPay', label: 'المبالغ والرواتب', hint: 'مستحقات الساعات والأوفر تايم في التقارير' },
];

function ManagerCard({ m, sections, onSaved }: { m: TeamManagerPermsDto; sections: { id: number; name: string; staffCount: number }[]; onSaved: () => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState(m.perms);
  const [secs, setSecs] = useState<number[]>(m.sections);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPerms(m.perms);
    setSecs(m.sections);
  }, [m]);
  const dirty = JSON.stringify(perms) !== JSON.stringify(m.perms) || JSON.stringify([...secs].sort()) !== JSON.stringify([...m.sections].sort());

  async function save() {
    setBusy(true);
    try {
      await api.saveTeamManagerPerms(m.id, { perms, sections: secs });
      toast.success(`حُفظت صلاحيات ${m.displayName} — تُطبَّق فوراً على هاتفه`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`card flex flex-col gap-3 p-4 ${m.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-slate-800">{m.displayName}</div>
          <div className="text-[12px] text-slate-400" dir="ltr" style={{ textAlign: 'right' }}>
            @{m.username}
          </div>
        </div>
        {!m.isActive ? <Badge>متوقف</Badge> : secs.length ? <Badge tone="info">{secs.length} قسم</Badge> : <Badge tone="ok">كل الأقسام</Badge>}
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {PERMS.map(p => (
          <div key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <div className="text-[13px] font-semibold text-slate-700">{p.label}</div>
              <div className="text-[11.5px] text-slate-400">{p.hint}</div>
            </div>
            <Switch checked={perms[p.key]} onChange={v => setPerms(x => ({ ...x, [p.key]: v }))} />
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1.5 text-[12.5px] font-semibold text-slate-600">الأقسام التي يديرها (فارغ = كل الفريق)</div>
        {sections.length ? (
          <div className="flex flex-wrap gap-3">
            {sections.map(s => (
              <Checkbox
                key={s.id}
                label={
                  <span>
                    {s.name} <span className="text-[11px] text-slate-400">({s.staffCount})</span>
                  </span>
                }
                checked={secs.includes(s.id)}
                onChange={v => setSecs(x => (v ? [...x, s.id] : x.filter(y => y !== s.id)))}
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-slate-400">لا أقسام محددة للموظفين بعد — حدّد قسم كل موظف من «الموظفون».</p>
        )}
      </div>
      <Btn className="self-start" loading={busy} disabled={!dirty} onClick={() => void save()}>
        حفظ الصلاحيات
      </Btn>
    </section>
  );
}

/** هل وصلت فواتير المحل لخادم الفريق؟ تظهر في تطبيق المدير لمن يملك صلاحية «الفواتير» */
function InvoiceSyncCard() {
  const q = useQuery({ queryKey: ['team-invoice-status'], queryFn: api.teamInvoiceStatus, retry: 0, refetchInterval: 60_000 });
  if (q.isError || !q.data) return null;
  const s = q.data;
  const stamp = (v?: string | null) => (v ? new Date(/(?:[zZ]|[+-]dd:dd)$/.test(v) ? v : `${v}+03:00`).toLocaleString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const waiting = !s.count && s.checkedAt == null;
  const moving = (s.pendingDays ?? 0) > 0;
  return (
    <div className="card mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 p-3 text-[12.5px] text-slate-600">
      <span className="flex items-center gap-2 font-bold text-slate-800">
        فواتير التطبيق
        <Badge tone={waiting ? 'warn' : moving ? 'info' : 'ok'}>{waiting ? 'بانتظار تحديث السيرفر' : moving ? `ينقل · بقي ${s.pendingDays} يوم` : 'مكتملة'}</Badge>
      </span>
      {!waiting && (
        <>
          <span>
            على الخادم: <b className="tabular-nums">{s.count.toLocaleString('en-US')}</b>
            {s.shopCount != null && <> من <b className="tabular-nums">{s.shopCount.toLocaleString('en-US')}</b></>}
          </span>
          <span>أحدث فاتورة: <b className="tabular-nums">{stamp(s.lastAt)}</b></span>
          <span>آخر فحص: <b className="tabular-nums">{stamp(s.checkedAt)}</b></span>
        </>
      )}
    </div>
  );
}

export function TeamManagersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['team-managers'], queryFn: api.teamManagers, retry: 0 });
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <TableSkeleton rows={6} />;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <InvoiceSyncCard />
      <p className="mb-3 text-[12.5px] leading-6 text-slate-500">
        المدراء هم حسابات «حسابات المدراء والويب». كل صلاحية تُفرض على الخادم، وما ليس من صلاحية المدير يختفي من تطبيقه فوراً. تحديد الأقسام يجعله يرى ويتصرف بموظفي أقسامه فقط.
      </p>
      {!q.data.managers.length ? (
        <div className="card p-8 text-center text-[13px] text-slate-500">لا حسابات مدراء بعد — أنشئها من «حسابات المدراء والويب».</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {q.data.managers.map(m => (
            <ManagerCard key={m.id} m={m} sections={q.data!.sections} onSaved={() => void qc.invalidateQueries({ queryKey: ['team-managers'] })} />
          ))}
        </div>
      )}
    </div>
  );
}
