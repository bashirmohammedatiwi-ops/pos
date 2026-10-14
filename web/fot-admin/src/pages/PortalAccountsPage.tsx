import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, formatDate, formatDateOnly, formatNum } from '@/api/client';
import type { PortalManagerAccountDto, PortalPublishResult, PortalSellerAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
} from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import {
  IconCheckCircle,
  IconClock,
  IconCopy,
  IconExternal,
  IconPencil,
  IconPrinter,
  IconRefresh,
  IconSend,
  IconShield,
  IconUser,
  IconUsers,
} from '@/components/icons';
import { Badge, Btn, EmptyState, Field, IconButton, Input, Modal, TableSkeleton, Tabs, useConfirm } from '@/components/ui';
import {
  CopyButton,
  ErrorBlock,
  IconDice,
  IconKey,
  IconPower,
  IconUserPlus,
  RowIconButton,
  RowMenu,
  SearchBox,
  randomPin,
  useCopy,
} from '@/components/people/PeopleKit';

type Tab = 'sellers' | 'managers';
type SellerFilter = 'all' | 'none' | 'active' | 'stopped' | 'never';
type ManagerFilter = 'all' | 'active' | 'stopped';

const SELLER_WEB_FALLBACK = 'http://187.124.23.65:4701';
const MANAGER_WEB_URL = 'http://187.124.23.65:4703';
const LINK_BTN = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900';

function sellerStatus(s: PortalSellerAccountDto) {
  if (!s.hasAccount) return 'بدون حساب';
  return s.isActive ? 'نشط' : 'متوقف';
}

function SellerBadge({ s }: { s: PortalSellerAccountDto }) {
  if (!s.hasAccount) return <Badge tone="warn" dot>بدون حساب</Badge>;
  return s.isActive ? <Badge tone="ok" dot>نشط</Badge> : <Badge dot>متوقف</Badge>;
}

function escapeHtml(v: string) {
  return v.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function printAccessCard(kind: 'بائع' | 'مدير', name: string, login: string, secret: string, url: string) {
  const w = window.open('', '_blank', 'width=420,height=560');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>بطاقة الدخول</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;margin:28px;color:#0f172a}
  .card{border:1px solid #cbd5e1;border-radius:16px;padding:22px}
  .k{font-size:11px;letter-spacing:.2em;color:#0f766e;font-weight:800}
  h1{margin:8px 0 4px;font-size:22px}
  .meta{color:#64748b;font-size:13px;font-weight:700}
  .pin{margin:22px 0 8px;padding:16px;border-radius:12px;background:#fffbeb;text-align:center;font-size:32px;letter-spacing:.28em;font-weight:800;font-family:Consolas,monospace}
  .hint{font-size:12px;color:#64748b;line-height:1.7}
  .url{direction:ltr;font-family:Consolas,monospace;font-size:12px;color:#0f172a}
</style></head><body>
<div class="card">
  <div class="k">FOT ${kind}</div>
  <h1>${escapeHtml(name)}</h1>
  <div class="meta">دخول: ${escapeHtml(login)}</div>
  <div class="pin">${escapeHtml(secret)}</div>
  <p class="hint">احتفظ بالرمز. الدخول من ويب ${kind === 'بائع' ? 'البائعين' : 'المدراء'} فقط:</p>
  <p class="url">${escapeHtml(url)}</p>
</div>
<script>window.onload=()=>{window.print();}</script>
</body></html>`);
  w.document.close();
  return true;
}

function accessMessage(kind: 'بائع' | 'مدير', name: string, login: string, secret: string, url: string) {
  return `مرحباً ${name}\nرابط ${kind === 'بائع' ? 'ويب البائعين' : 'ويب المدراء'}: ${url}\nالدخول: ${login}\nالرمز: ${secret}`;
}

function SecretBox({ value, label, onCopy }: { value?: string | null; label: string; onCopy: (v: string) => void }) {
  if (!value) {
    return (
      <div className="flex h-full min-h-[76px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-4 text-center text-[12.5px] text-slate-500">
        لا يوجد رمز ظاهر بعد
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      className="group block w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center transition hover:bg-amber-100"
      title="انقر للنسخ"
    >
      <p className="text-[11px] font-bold text-amber-800">{label}</p>
      <p className="mt-0.5 font-mono text-[24px] font-extrabold tracking-[0.22em] text-amber-950" dir="ltr">{value}</p>
      <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 opacity-80 group-hover:opacity-100">
        <IconCopy size={12} /> انقر للنسخ
      </p>
    </button>
  );
}

function InfoTile({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] text-slate-500">{icon}{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-header">{value}</p>
    </div>
  );
}

function PinBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[12.5px] font-extrabold tracking-widest text-amber-950 ring-1 ring-inset ring-amber-200" dir="ltr">{value}</span>;
}

/** لوحة تفاصيل تُفتح تحت الصف داخل الجدول (بدل لوحة جانبية تضيّق الجدول). */
function RowPanel({ children }: { children: ReactNode }) {
  return (
    <div className="grid items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 whitespace-normal lg:grid-cols-[240px_minmax(0,1fr)_auto]">
      {children}
    </div>
  );
}

export function PortalAccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const copy = useCopy();
  const [tab, setTab] = useState<Tab>('sellers');
  const [search, setSearch] = useState('');
  const [mgrSearch, setMgrSearch] = useState('');
  const [filter, setFilter] = useState<SellerFilter>('all');
  const [mgrFilter, setMgrFilter] = useState<ManagerFilter>('all');
  // التحديد (↑↓) منفصل عن الصف المفتوح (Enter/النقر) — الأسهم لا تفتح كل صف تمر عليه
  const [selectedSellerId, setSelectedSellerId] = useState<number | null>(null);
  const [expandedSellerId, setExpandedSellerId] = useState<number | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [expandedManagerId, setExpandedManagerId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [createTried, setCreateTried] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [editName, setEditName] = useState('');
  const [freshSellers, setFreshSellers] = useState<Set<number>>(new Set());
  const [freshManagers, setFreshManagers] = useState<Set<number>>(new Set());

  const sellersQ = useQuery({ queryKey: ['portal-sellers'], queryFn: api.portalSellers });
  const managersQ = useQuery({ queryKey: ['portal-managers'], queryFn: api.portalManagers });
  const webQ = useQuery({
    queryKey: ['portal-web-status'],
    queryFn: api.portalWebStatus,
    refetchInterval: 20_000,
    retry: 1,
  });
  const sellerWebUrl = webQ.data?.webUrl || SELLER_WEB_FALLBACK;

  async function copySecret(value: string) {
    await copy(value, 'الرمز');
  }

  function afterPublish(res: PortalPublishResult) {
    putSeller(res.account);
    markSeller(res.account.salesmanId);
    void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
    void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    if (res.savedOnShop && res.visibleOnWeb) {
      toast.success(`نُشر على الويب — ${res.account.name}${res.account.pinDisplay ? ` · ${res.account.pinDisplay}` : ''}`);
    } else if (res.savedOnShop) {
      toast.success(`حُفظ في نقطة البيع — ${res.account.name}`);
      toast.error(res.message);
    } else {
      toast.error(res.message);
    }
    if (res.account.pinDisplay) void copySecret(res.account.pinDisplay);
  }

  function markSeller(id: number) {
    setFreshSellers(prev => new Set(prev).add(id));
    setSelectedSellerId(id);
    setExpandedSellerId(id);
  }
  function markManager(id: number) {
    setFreshManagers(prev => new Set(prev).add(id));
    setSelectedManagerId(id);
    setExpandedManagerId(id);
  }

  function putSeller(row: PortalSellerAccountDto) {
    qc.setQueryData<PortalSellerAccountDto[]>(['portal-sellers'], old =>
      old ? old.map(s => (s.salesmanId === row.salesmanId ? row : s)) : [row]);
  }
  function putManager(row: PortalManagerAccountDto) {
    qc.setQueryData<PortalManagerAccountDto[]>(['portal-managers'], old =>
      old ? old.map(m => (m.id === row.id ? row : m)) : [row]);
  }

  const issue = useMutation({
    mutationFn: async (id: number) => {
      try {
        return await api.publishSellerToWeb(id);
      } catch {
        const account = await api.issueSellerPin(id);
        return {
          account,
          savedOnShop: true,
          visibleOnWeb: false,
          message: 'حُفظ في نقطة البيع — حدّث خادم نقطة البيع لفحص الويب',
          webUrl: SELLER_WEB_FALLBACK,
        } satisfies PortalPublishResult;
      }
    },
    onSuccess: afterPublish,
    onError: (e: Error) => toast.error(e.message),
  });
  const issueMissing = useMutation({
    mutationFn: api.issueMissingSellerPins,
    onSuccess: res => {
      qc.setQueryData(['portal-sellers'], res.sellers);
      toast.success(res.issued > 0
        ? `وُلّد ${formatNum(res.issued)} حساباً وحُفظت على سيرفر نقطة البيع`
        : 'كل البائعين لديهم حساب على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setSeller = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setSellerPortalActive(id, active),
    onSuccess: row => {
      putSeller(row);
      toast.success(row.isActive ? 'تم تفعيل الحساب على السيرفر' : 'تم إيقاف الحساب على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const createMgr = useMutation({
    mutationFn: () => api.createPortalManager(username.trim(), displayName.trim(), managerPin.trim()),
    onSuccess: row => {
      setUsername('');
      setDisplayName('');
      setManagerPin('');
      setCreateTried(false);
      setCreateOpen(false);
      qc.setQueryData<PortalManagerAccountDto[]>(['portal-managers'], old => [row, ...(old ?? [])]);
      markManager(row.id);
      setEditName(row.displayName);
      toast.success(`حُفظ ورُفع للويب — ${row.username} · ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMgr = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => api.resetPortalManager(id, password),
    onSuccess: row => {
      putManager(row);
      markManager(row.id);
      setResetPin('');
      toast.success(`حُفظ ورُفع للويب — رمز ${row.username}: ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const renameMgr = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.updatePortalManager(id, name),
    onSuccess: row => {
      putManager(row);
      toast.success('تم تحديث الاسم على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setMgr = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setPortalManagerActive(id, active),
    onSuccess: row => {
      putManager(row);
      toast.success(row.isActive ? 'تم تفعيل المدير على السيرفر' : 'تم إيقاف المدير على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allSellers = sellersQ.data ?? [];
  const sellers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSellers.filter(s => {
      if (filter === 'none' && s.hasAccount) return false;
      if (filter === 'active' && !(s.hasAccount && s.isActive)) return false;
      if (filter === 'stopped' && !(s.hasAccount && !s.isActive)) return false;
      if (filter === 'never' && !(s.hasAccount && !s.lastLoginAt)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || String(s.salesmanId).includes(q) || (s.pinDisplay ?? '').includes(q);
    });
  }, [allSellers, search, filter]);

  const managers = managersQ.data ?? [];
  const filteredManagers = useMemo(() => {
    const q = mgrSearch.trim().toLowerCase();
    return managers.filter(m => {
      if (mgrFilter === 'active' && !m.isActive) return false;
      if (mgrFilter === 'stopped' && m.isActive) return false;
      if (!q) return true;
      return m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || (m.passwordDisplay ?? '').includes(q);
    });
  }, [managers, mgrSearch, mgrFilter]);

  const withAccount = allSellers.filter(s => s.hasAccount).length;
  const activeCount = allSellers.filter(s => s.hasAccount && s.isActive).length;
  const stoppedCount = withAccount - activeCount;
  const withoutAccount = allSellers.length - withAccount;
  const neverLoggedCount = allSellers.filter(s => s.hasAccount && !s.lastLoginAt).length;
  const mgrActiveCount = managers.filter(m => m.isActive).length;

  async function askIssue(s: PortalSellerAccountDto) {
    if (s.hasAccount) {
      const ok = await confirm({
        title: `إعادة توليد رمز ${s.name}؟`,
        message: 'سيُحفظ رمز جديد في نقطة البيع ويُنشر على ويب البائعين. الرمز الحالي سيتوقف عن العمل فوراً.',
        confirmLabel: 'توليد ونشر',
        danger: true,
      });
      if (!ok) return;
    }
    issue.mutate(s.salesmanId);
  }

  async function askBulk() {
    const ok = await confirm({
      title: `توليد ${formatNum(withoutAccount)} حساباً؟`,
      message: 'يُنشأ رمز لكل بائع بلا حساب ويُحفظ مباشرة في قاعدة السيرفر.',
      confirmLabel: 'توليد الكل',
    });
    if (ok) issueMissing.mutate();
  }

  async function toggleSeller(s: PortalSellerAccountDto) {
    if (s.isActive) {
      const ok = await confirm({
        title: `إيقاف حساب ${s.name}؟`,
        message: 'لن يستطيع البائع الدخول إلى ويب البائعين حتى تعيد التفعيل. الرمز نفسه يبقى محفوظاً.',
        confirmLabel: 'إيقاف الحساب',
        danger: true,
      });
      if (!ok) return;
    }
    setSeller.mutate({ id: s.salesmanId, active: !s.isActive });
  }

  async function toggleManager(m: PortalManagerAccountDto) {
    if (m.isActive) {
      const ok = await confirm({
        title: `إيقاف حساب ${m.displayName}؟`,
        message: 'لن يستطيع المدير الدخول إلى ويب المدراء حتى تعيد التفعيل.',
        confirmLabel: 'إيقاف الحساب',
        danger: true,
      });
      if (!ok) return;
    }
    setMgr.mutate({ id: m.id, active: !m.isActive });
  }

  async function askResetManager(m: PortalManagerAccountDto) {
    const pin = resetPin.trim();
    if (pin.length < 4) return;
    const ok = await confirm({
      title: `تغيير رمز ${m.username}؟`,
      message: <>سيُستبدل الرمز الحالي بـ <b dir="ltr" className="font-mono">{pin}</b>. الرمز القديم لن يعمل بعد الحفظ.</>,
      confirmLabel: 'حفظ الرمز',
      danger: true,
    });
    if (ok) resetMgr.mutate({ id: m.id, password: pin });
  }

  function printCard(kind: 'بائع' | 'مدير', name: string, login: string, secret: string) {
    const ok = printAccessCard(kind, name, login, secret, kind === 'بائع' ? sellerWebUrl : MANAGER_WEB_URL);
    if (!ok) toast.error('تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة');
  }

  const createErrors = {
    username: username.trim().length < 2 ? 'حرفان على الأقل' : managers.some(m => m.username.toLowerCase() === username.trim().toLowerCase()) ? 'اسم الدخول مستخدم مسبقاً' : '',
    displayName: displayName.trim().length < 2 ? 'حرفان على الأقل' : '',
    pin: managerPin.trim().length < 4 ? '4 خانات على الأقل' : '',
  };
  const createValid = !createErrors.username && !createErrors.displayName && !createErrors.pin;

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateTried(true);
    if (!createValid || createMgr.isPending) return;
    createMgr.mutate();
  }

  // فتح/إغلاق الصف — الإغلاق يُبقي التحديد (↑↓ تتابع من نفس الصف)
  function toggleSellerRow(id: number) {
    setSelectedSellerId(id);
    setExpandedSellerId(expandedSellerId === id ? null : id);
  }

  function openManagerRow(m: PortalManagerAccountDto) {
    setSelectedManagerId(m.id);
    setExpandedManagerId(m.id);
    setEditName(m.displayName);
    setResetPin('');
  }

  function toggleManagerRow(m: PortalManagerAccountDto) {
    if (expandedManagerId === m.id) {
      setSelectedManagerId(m.id);
      setExpandedManagerId(null);
    } else openManagerRow(m);
  }

  const sellerCols: GridColumn<PortalSellerAccountDto>[] = [
    { key: 'salesmanId', header: '#', width: 60, mono: true },
    {
      key: 'name',
      header: 'البائع',
      width: 220,
      render: s => (
        <span className={`block truncate font-semibold ${s.hasAccount && s.isActive ? 'text-header' : 'text-slate-500'}`} title={s.name}>
          {s.name}
        </span>
      ),
    },
    { key: 'pinDisplay', header: 'الرمز', width: 130, sortable: false, render: s => <PinBadge value={s.pinDisplay} /> },
    {
      key: 'hasAccount',
      header: 'الحالة',
      width: 110,
      sortValue: s => sellerStatus(s),
      filterValue: s => sellerStatus(s),
      render: s => <SellerBadge s={s} />,
    },
    {
      key: 'lastLoginAt',
      header: 'آخر دخول',
      width: 150,
      sortValue: s => s.lastLoginAt ?? '',
      filterValue: s => (s.lastLoginAt ? formatDate(s.lastLoginAt) : 'لم يدخل'),
      render: s => (s.lastLoginAt ? formatDate(s.lastLoginAt) : <span className="text-slate-400">لم يدخل</span>),
    },
    {
      key: 'createdAt',
      header: 'أُنشئ',
      width: 110,
      sortValue: s => s.createdAt ?? '',
      exportValue: s => (s.createdAt ? formatDateOnly(s.createdAt) : ''),
      render: s => (s.createdAt ? formatDateOnly(s.createdAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'end',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          {s.pinDisplay ? (
            <RowIconButton label="نسخ الرمز" onClick={() => void copySecret(s.pinDisplay!)}>
              <IconCopy size={15} />
            </RowIconButton>
          ) : (
            <RowIconButton label="توليد حساب ونشره" tone="brand" disabled={issue.isPending} onClick={() => void askIssue(s)}>
              <IconKey size={15} />
            </RowIconButton>
          )}
          <RowMenu
            items={[
              {
                label: s.hasAccount ? 'إعادة توليد الرمز' : 'توليد حساب ونشره',
                icon: <IconKey size={15} />,
                onClick: () => void askIssue(s),
                disabled: issue.isPending,
              },
              s.pinDisplay
                ? {
                    label: 'نسخ رسالة الدخول',
                    icon: <IconSend size={15} />,
                    onClick: () => void copy(accessMessage('بائع', s.name, String(s.salesmanId), s.pinDisplay!, sellerWebUrl), 'رسالة الدخول'),
                  }
                : null,
              s.pinDisplay
                ? { label: 'طباعة بطاقة الدخول', icon: <IconPrinter size={15} />, onClick: () => printCard('بائع', s.name, String(s.salesmanId), s.pinDisplay!) }
                : null,
              s.hasAccount
                ? s.isActive
                  ? { label: 'إيقاف الحساب', icon: <IconPower size={15} />, danger: true, onClick: () => void toggleSeller(s) }
                  : { label: 'تفعيل الحساب', icon: <IconCheckCircle size={15} />, onClick: () => void toggleSeller(s) }
                : null,
            ]}
          />
        </div>
      ),
    },
  ];

  const managerCols: GridColumn<PortalManagerAccountDto>[] = [
    {
      key: 'displayName',
      header: 'المدير',
      width: 220,
      render: m => (
        <span className={`block truncate font-semibold ${m.isActive ? 'text-header' : 'text-slate-500'}`} title={m.displayName}>
          {m.displayName}
        </span>
      ),
    },
    {
      key: 'username',
      header: 'اسم الدخول',
      width: 150,
      render: m => <span className="block truncate font-mono text-[12px]" dir="ltr" style={{ textAlign: 'right' }} title={m.username}>{m.username}</span>,
    },
    { key: 'passwordDisplay', header: 'الرمز', width: 140, sortable: false, render: m => <PinBadge value={m.passwordDisplay} /> },
    {
      key: 'isActive',
      header: 'الحالة',
      width: 100,
      sortValue: m => (m.isActive ? 'نشط' : 'متوقف'),
      filterValue: m => (m.isActive ? 'نشط' : 'متوقف'),
      render: m => (m.isActive ? <Badge tone="ok" dot>نشط</Badge> : <Badge dot>متوقف</Badge>),
    },
    { key: 'createdAt', header: 'أُنشئ', width: 120, sortValue: m => m.createdAt, exportValue: m => formatDateOnly(m.createdAt), render: m => formatDateOnly(m.createdAt) },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'end',
      sortable: false,
      exportable: false,
      render: m => (
        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          {m.passwordDisplay && (
            <RowIconButton label="نسخ الرمز" onClick={() => void copySecret(m.passwordDisplay!)}>
              <IconCopy size={15} />
            </RowIconButton>
          )}
          <RowIconButton label="تعديل الاسم أو الرمز" tone="brand" onClick={() => openManagerRow(m)}>
            <IconPencil size={15} />
          </RowIconButton>
          <RowMenu
            items={[
              m.passwordDisplay
                ? {
                    label: 'نسخ رسالة الدخول',
                    icon: <IconSend size={15} />,
                    onClick: () => void copy(accessMessage('مدير', m.displayName, m.username, m.passwordDisplay!, MANAGER_WEB_URL), 'رسالة الدخول'),
                  }
                : null,
              m.passwordDisplay
                ? { label: 'طباعة بطاقة الدخول', icon: <IconPrinter size={15} />, onClick: () => printCard('مدير', m.displayName, m.username, m.passwordDisplay!) }
                : null,
              m.isActive
                ? { label: 'إيقاف الحساب', icon: <IconPower size={15} />, danger: true, onClick: () => void toggleManager(m) }
                : { label: 'تفعيل الحساب', icon: <IconCheckCircle size={15} />, onClick: () => void toggleManager(m) },
            ]}
          />
        </div>
      ),
    },
  ];

  function renderSellerPanel(s: PortalSellerAccountDto) {
    return (
      <RowPanel>
        <SecretBox value={s.pinDisplay} label="رمز الدخول" onCopy={v => void copySecret(v)} />
        <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="البائع" value={<>{s.name} <span className="num text-slate-400">#{s.salesmanId}</span></>} icon={<IconUser size={11} />} />
          <InfoTile label="دخول باسم" value={<span className="num">{s.salesmanId}</span>} icon={<IconKey size={11} />} />
          <InfoTile label="آخر دخول" value={s.lastLoginAt ? formatDate(s.lastLoginAt) : 'لم يدخل'} icon={<IconClock size={11} />} />
          <InfoTile
            label="على السيرفر"
            value={s.createdAt ? `منذ ${formatDateOnly(s.createdAt)}` : s.hasAccount ? 'محفوظ' : 'غير منشأ'}
          />
        </div>
        <div className="flex flex-wrap content-start items-start gap-2 lg:w-[220px] lg:flex-col lg:items-stretch">
          <Btn icon={<IconKey size={15} />} loading={issue.isPending} onClick={() => void askIssue(s)}>
            {s.hasAccount ? 'إعادة توليد الرمز ونشره' : 'توليد الحساب ونشره'}
          </Btn>
          {s.pinDisplay && (
            <div className="grid grid-cols-2 gap-2">
              <Btn
                size="sm"
                variant="secondary"
                icon={<IconSend size={14} />}
                onClick={() => void copy(accessMessage('بائع', s.name, String(s.salesmanId), s.pinDisplay!, sellerWebUrl), 'رسالة الدخول')}
                title="نص جاهز للإرسال: الرابط + الدخول + الرمز"
              >
                الرسالة
              </Btn>
              <Btn
                size="sm"
                variant="secondary"
                icon={<IconPrinter size={14} />}
                onClick={() => printCard('بائع', s.name, String(s.salesmanId), s.pinDisplay!)}
              >
                البطاقة
              </Btn>
            </div>
          )}
          {s.hasAccount && (
            <Btn
              size="sm"
              variant="ghost"
              className={s.isActive ? '!text-red-600 hover:!bg-red-50' : ''}
              icon={s.isActive ? <IconPower size={15} /> : <IconCheckCircle size={15} />}
              loading={setSeller.isPending}
              onClick={() => void toggleSeller(s)}
            >
              {s.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
            </Btn>
          )}
        </div>
      </RowPanel>
    );
  }

  function renderManagerPanel(m: PortalManagerAccountDto) {
    return (
      <RowPanel>
        <div className="space-y-2">
          <SecretBox value={m.passwordDisplay} label="رمز الدخول" onCopy={v => void copySecret(v)} />
          {m.passwordDisplay && (
            <div className="grid grid-cols-2 gap-2">
              <Btn
                size="sm"
                variant="secondary"
                icon={<IconSend size={14} />}
                onClick={() => void copy(accessMessage('مدير', m.displayName, m.username, m.passwordDisplay!, MANAGER_WEB_URL), 'رسالة الدخول')}
              >
                الرسالة
              </Btn>
              <Btn
                size="sm"
                variant="secondary"
                icon={<IconPrinter size={14} />}
                onClick={() => printCard('مدير', m.displayName, m.username, m.passwordDisplay!)}
              >
                البطاقة
              </Btn>
            </div>
          )}
        </div>

        <div className="grid content-start gap-3 md:grid-cols-2">
          <form
            className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
            onSubmit={e => {
              e.preventDefault();
              if (editName.trim().length < 2 || editName.trim() === m.displayName) return;
              renameMgr.mutate({ id: m.id, name: editName.trim() });
            }}
          >
            <Field label="الاسم الظاهر">
              <div className="flex gap-1.5">
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
                <Btn
                  type="submit"
                  variant="secondary"
                  icon={<IconPencil size={14} />}
                  loading={renameMgr.isPending}
                  disabled={editName.trim().length < 2 || editName.trim() === m.displayName}
                >
                  حفظ
                </Btn>
              </div>
            </Field>
          </form>

          <form
            className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
            onSubmit={e => { e.preventDefault(); void askResetManager(m); }}
          >
            <Field label="رمز جديد" hint={resetPin && resetPin.trim().length < 4 ? <span className="text-red-600">4 خانات على الأقل</span> : 'اكتب رمزاً أو ولّد واحداً عشوائياً'}>
              <div className="flex gap-1.5">
                <Input value={resetPin} onChange={e => setResetPin(e.target.value)} placeholder="الرمز الجديد" dir="ltr" className="font-mono" />
                <IconButton label="توليد رمز عشوائي" onClick={() => setResetPin(randomPin(6))}>
                  <IconDice size={15} />
                </IconButton>
                <Btn type="submit" icon={<IconKey size={15} />} loading={resetMgr.isPending} disabled={resetPin.trim().length < 4}>
                  حفظ
                </Btn>
              </div>
            </Field>
          </form>
        </div>

        <div className="flex flex-col items-stretch gap-2 lg:w-[160px]">
          <InfoTile label="اسم الدخول" value={<span dir="ltr" className="font-mono">{m.username}</span>} icon={<IconUser size={11} />} />
          <Btn
            size="sm"
            variant="ghost"
            className={m.isActive ? '!text-red-600 hover:!bg-red-50' : ''}
            icon={m.isActive ? <IconPower size={15} /> : <IconCheckCircle size={15} />}
            loading={setMgr.isPending}
            onClick={() => void toggleManager(m)}
          >
            {m.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
          </Btn>
        </div>
      </RowPanel>
    );
  }

  const web = webQ.data;
  const webTone = web?.visibleOnWeb ? 'ok' : web?.savedOnShop ? 'warn' : 'default';
  const webDot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', default: 'bg-slate-400' }[webTone];
  const sellerFiltersOn = !!search.trim() || filter !== 'all';
  const mgrFiltersOn = !!mgrSearch.trim() || mgrFilter !== 'all';

  return (
    <WorkspacePage>
      {/* حالة الاتصال بالويب — شريط رفيع */}
      <div
        className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border bg-white px-3 py-1.5 ${
          webTone === 'ok' ? 'border-emerald-200' : webTone === 'warn' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {webTone === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${webDot}`} />
          </span>
          <p className="min-w-0 truncate text-[12px] leading-5 text-slate-700" title={web?.message}>
            {webQ.isLoading ? (
              'جاري فحص وصول الحسابات إلى ويب البائعين…'
            ) : web ? (
              <>
                <b className={webTone === 'ok' ? 'text-emerald-700' : webTone === 'warn' ? 'text-amber-800' : 'text-header'}>
                  {web.visibleOnWeb ? 'الويب متصل' : 'الويب لا يصل للمحل'}
                </b>
                <span className="text-slate-500"> — {web.message} · محفوظ في نقطة البيع: <span className="num">{formatNum(web.sellerAccounts)}</span> حساباً</span>
              </>
            ) : webQ.isError ? (
              <span className="text-red-700">تعذّر فحص حالة الويب — {webQ.error instanceof Error ? webQ.error.message : ''}</span>
            ) : (
              'توليد الرمز يحفظه في نقطة البيع ثم يتحقق من ظهوره على ويب البائعين.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11.5px] font-semibold text-slate-500">ويب البائعين</span>
          <a href={sellerWebUrl} target="_blank" rel="noreferrer" className={LINK_BTN}><IconExternal size={13} />فتح</a>
          <CopyButton value={sellerWebUrl} what="رابط ويب البائعين" variant="ghost" />
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <span className="text-[11.5px] font-semibold text-slate-500">ويب المدراء</span>
          <a href={MANAGER_WEB_URL} target="_blank" rel="noreferrer" className={LINK_BTN}><IconExternal size={13} />فتح</a>
          <CopyButton value={MANAGER_WEB_URL} what="رابط ويب المدراء" variant="ghost" />
        </div>
      </div>

      <WorkspaceCard>
        <div className="shrink-0 border-b border-slate-200 px-3">
          <Tabs<Tab>
            className="border-b-0"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'sellers', label: 'بائعو الويب', icon: <IconUsers size={15} />, count: allSellers.length },
              { id: 'managers', label: 'مدراء المتابعة', icon: <IconShield size={15} />, count: managers.length },
            ]}
          />
        </div>

        {tab === 'sellers' ? (
          <>
            <FilterBar
              footer={
                <>
                  <SegmentedFilter<SellerFilter>
                    label="حالة الحساب"
                    value={filter}
                    onChange={setFilter}
                    items={[
                      { id: 'all', label: 'الكل', count: allSellers.length },
                      { id: 'active', label: 'نشط', count: activeCount },
                      { id: 'stopped', label: 'متوقف', count: stoppedCount },
                      { id: 'none', label: 'بدون حساب', count: withoutAccount, tone: withoutAccount ? 'warn' : undefined },
                      { id: 'never', label: 'لم يدخل بعد', count: neverLoggedCount },
                    ]}
                  />
                  {sellerFiltersOn && (
                    <Btn size="xs" variant="ghost" onClick={() => { setSearch(''); setFilter('all'); }}>مسح الفلاتر</Btn>
                  )}
                  <span className="ms-auto hidden text-[11px] text-slate-400 md:inline">انقر الصف لإدارة الحساب: الرمز، الطباعة، الإيقاف</span>
                </>
              }
            >
              <FilterLabel label="بحث بالاسم أو الرقم أو الرمز" grow>
                <SearchBox value={search} onChange={setSearch} placeholder="اكتب للبحث…" />
              </FilterLabel>
              <FilterActions>
                <IconButton label="تحديث" onClick={() => { void sellersQ.refetch(); void webQ.refetch(); }}>
                  <IconRefresh size={15} className={sellersQ.isFetching || webQ.isFetching ? 'animate-spin' : ''} />
                </IconButton>
                <Btn icon={<IconKey size={15} />} onClick={() => void askBulk()} loading={issueMissing.isPending} disabled={withoutAccount === 0}>
                  توليد لمن بلا حساب ({formatNum(withoutAccount)})
                </Btn>
              </FilterActions>
            </FilterBar>

            <SummaryStrip
              loading={sellersQ.isLoading}
              cells={[
                {
                  label: 'بحساب ويب',
                  value: formatNum(withAccount),
                  hint: `من ${formatNum(allSellers.length)} بائعاً`,
                  tone: 'brand',
                  onClick: () => setFilter('all'),
                  active: filter === 'all',
                },
                { label: 'نشط', value: formatNum(activeCount), hint: 'يمكنه الدخول الآن', tone: 'ok', onClick: () => setFilter('active'), active: filter === 'active' },
                { label: 'متوقف', value: formatNum(stoppedCount), onClick: () => setFilter('stopped'), active: filter === 'stopped' },
                {
                  label: 'بدون حساب',
                  value: formatNum(withoutAccount),
                  hint: withoutAccount ? 'يحتاج توليد رمز' : 'كل البائعين لديهم حساب',
                  tone: withoutAccount ? 'warn' : undefined,
                  onClick: () => setFilter('none'),
                  active: filter === 'none',
                },
                {
                  label: 'لم يدخل بعد',
                  value: formatNum(neverLoggedCount),
                  hint: 'لديه حساب ولم يسجّل دخولاً',
                  onClick: () => setFilter('never'),
                  active: filter === 'never',
                },
              ]}
            />

            <WorkspaceBody>
              {sellersQ.isError ? (
                <ErrorBlock error={sellersQ.error} title="تعذّر تحميل حسابات البائعين" onRetry={() => sellersQ.refetch()} />
              ) : sellersQ.isLoading ? (
                <div className="p-3"><TableSkeleton rows={10} cols={7} /></div>
              ) : (
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  dense
                  rows={sellers}
                  columns={sellerCols}
                  getRowId={r => r.salesmanId}
                  selectedId={selectedSellerId ?? undefined}
                  onSelect={r => setSelectedSellerId(r.salesmanId)}
                  onEnter={r => toggleSellerRow(r.salesmanId)}
                  expansion={{
                    isExpanded: r => expandedSellerId === r.salesmanId,
                    onToggle: r => toggleSellerRow(r.salesmanId),
                    render: r => renderSellerPanel(r),
                  }}
                  counterLabel="بائع"
                  exportName="حسابات-البائعين"
                  storageKey="portal-sellers"
                  emptyText={sellerFiltersOn ? 'لا نتائج — جرّب فلتراً آخر' : 'لا بائعين — نفّذ مزامنة الأداري من صفحة البائعين'}
                  rowTone={r => (freshSellers.has(r.salesmanId) ? 'bg-amber-50/80' : undefined)}
                />
              )}
            </WorkspaceBody>
          </>
        ) : (
          <>
            <FilterBar
              footer={
                <>
                  <SegmentedFilter<ManagerFilter>
                    label="حالة الحساب"
                    value={mgrFilter}
                    onChange={setMgrFilter}
                    items={[
                      { id: 'all', label: 'الكل', count: managers.length },
                      { id: 'active', label: 'نشط', count: mgrActiveCount },
                      { id: 'stopped', label: 'متوقف', count: managers.length - mgrActiveCount },
                    ]}
                  />
                  {mgrFiltersOn && (
                    <Btn size="xs" variant="ghost" onClick={() => { setMgrSearch(''); setMgrFilter('all'); }}>مسح الفلاتر</Btn>
                  )}
                  <span className="ms-auto hidden text-[11px] text-slate-400 md:inline">
                    انقر الصف لتعديل الاسم أو تغيير الرمز · الدخول من <span dir="ltr" className="font-mono">{MANAGER_WEB_URL}</span>
                  </span>
                </>
              }
            >
              <FilterLabel label="بحث بالاسم أو اسم الدخول أو الرمز" grow>
                <SearchBox value={mgrSearch} onChange={setMgrSearch} placeholder="اكتب للبحث…" />
              </FilterLabel>
              <FilterActions>
                <IconButton label="تحديث" onClick={() => void managersQ.refetch()}>
                  <IconRefresh size={15} className={managersQ.isFetching ? 'animate-spin' : ''} />
                </IconButton>
                <Btn icon={<IconUserPlus size={15} />} onClick={() => { setCreateTried(false); setCreateOpen(true); }}>
                  مدير جديد
                </Btn>
              </FilterActions>
            </FilterBar>

            <SummaryStrip
              loading={managersQ.isLoading}
              cells={[
                { label: 'مدراء المتابعة', value: formatNum(managers.length), tone: 'brand', onClick: () => setMgrFilter('all'), active: mgrFilter === 'all' },
                { label: 'نشط', value: formatNum(mgrActiveCount), hint: 'يمكنه الدخول الآن', tone: 'ok', onClick: () => setMgrFilter('active'), active: mgrFilter === 'active' },
                { label: 'متوقف', value: formatNum(managers.length - mgrActiveCount), onClick: () => setMgrFilter('stopped'), active: mgrFilter === 'stopped' },
              ]}
            />

            <WorkspaceBody>
              {managersQ.isError ? (
                <ErrorBlock error={managersQ.error} title="تعذّر تحميل حسابات المدراء" onRetry={() => managersQ.refetch()} />
              ) : managersQ.isLoading ? (
                <div className="p-3"><TableSkeleton rows={6} cols={6} /></div>
              ) : !managers.length ? (
                <EmptyState
                  icon={<IconShield size={24} />}
                  title="لا مدراء متابعة بعد"
                  description={<>أنشئ حساب مدير ليتابع المبيعات من ويب المدراء <span dir="ltr" className="font-mono">{MANAGER_WEB_URL}</span>.</>}
                  action={<Btn icon={<IconUserPlus size={15} />} onClick={() => setCreateOpen(true)}>مدير جديد</Btn>}
                />
              ) : (
                <DataGrid
                  variant="sheet"
                  embedded
                  fillHeight
                  dense
                  rows={filteredManagers}
                  columns={managerCols}
                  getRowId={r => r.id}
                  selectedId={selectedManagerId ?? undefined}
                  onSelect={r => setSelectedManagerId(r.id)}
                  onEnter={r => toggleManagerRow(r)}
                  expansion={{
                    isExpanded: r => expandedManagerId === r.id,
                    onToggle: r => toggleManagerRow(r),
                    render: r => renderManagerPanel(r),
                  }}
                  counterLabel="مدير"
                  exportName="حسابات-المدراء"
                  storageKey="portal-managers"
                  emptyText="لا نتائج مطابقة"
                  rowTone={r => (freshManagers.has(r.id) ? 'bg-amber-50/80' : undefined)}
                />
              )}
            </WorkspaceBody>
          </>
        )}
      </WorkspaceCard>

      {createOpen && (
        <Modal
          open
          size="md"
          icon={<IconUserPlus size={18} />}
          title="مدير متابعة جديد"
          subtitle={<>يدخل من ويب المدراء <span dir="ltr" className="font-mono">{MANAGER_WEB_URL}</span></>}
          onClose={() => setCreateOpen(false)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Btn variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Btn>
              <Btn type="submit" form="mgr-create-form" loading={createMgr.isPending}>إنشاء وحفظ</Btn>
            </div>
          }
        >
          <form id="mgr-create-form" onSubmit={submitCreate} noValidate className="space-y-4">
            <div>
              <Field label="الاسم الظاهر *">
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مثال: مدير الفرع" />
              </Field>
              {createTried && createErrors.displayName && <p className="mt-1 text-[11.5px] text-red-600">{createErrors.displayName}</p>}
            </div>
            <div>
              <Field label="اسم الدخول *" hint="أحرف إنجليزية أو أرقام — يكتبه المدير في شاشة الدخول">
                <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="manager1" dir="ltr" autoComplete="off" />
              </Field>
              {createTried && createErrors.username && <p className="mt-1 text-[11.5px] text-red-600">{createErrors.username}</p>}
            </div>
            <div>
              <Field label="الرمز *" hint="تختاره أنت — 4 خانات على الأقل">
                <div className="flex gap-1.5">
                  <Input value={managerPin} onChange={e => setManagerPin(e.target.value)} placeholder="رمز من اختيارك" dir="ltr" className="font-mono" autoComplete="off" />
                  <IconButton label="توليد رمز عشوائي" onClick={() => setManagerPin(randomPin(6))}>
                    <IconDice size={15} />
                  </IconButton>
                </div>
              </Field>
              {createTried && createErrors.pin && <p className="mt-1 text-[11.5px] text-red-600">{createErrors.pin}</p>}
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-500">
              يُحفظ الحساب ويُرفع للويب مباشرة، ويُنسخ الرمز تلقائياً بعد الإنشاء.
            </p>
          </form>
        </Modal>
      )}
    </WorkspacePage>
  );
}

export default PortalAccountsPage;
