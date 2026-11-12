import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api, formatNum } from '@/api/client';
import type { OnlineOrdersSettingsDto, PosCreditAccountDto, ProductDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Alert, Badge, Btn, Field, FieldRow, Input, Skeleton, Switch } from '@/components/ui';
import { IconCart, IconPrinter, IconRefresh, IconSearch, IconWallet, IconX } from '@/components/icons';
import { SettingsCard } from '@/components/system/systemUi';

type Form = Omit<OnlineOrdersSettingsDto, 'updatedAt'>;

function toForm(s: OnlineOrdersSettingsDto): Form {
  const { updatedAt: _, ...rest } = s;
  return {
    ...rest,
    receiptCopies: s.receiptCopies ?? 1,
    invoiceCopies: s.invoiceCopies ?? 1,
    labelCopies: s.labelCopies ?? 1,
  };
}

function useDebounced(value: string, ms = 280) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value.trim()), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Picked({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-0.5 pe-1 ps-2.5 text-[12px] font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">
      <span className="truncate">{text}</span>
      <button type="button" onClick={onClear} className="rounded-full p-0.5 text-brand-400 hover:bg-red-50 hover:text-red-600" aria-label="إزالة">
        <IconX size={12} />
      </button>
    </span>
  );
}

/** حساب إداري واحد (آجل) — نفس بحث حسابات الآجل في صفحة الكاشيرية. */
function AccountPicker({
  value,
  num,
  name,
  emptyHint,
  onChange,
}: {
  value?: number | null;
  num?: string | null;
  name?: string | null;
  emptyHint: string;
  onChange: (a: PosCreditAccountDto | null) => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useQuery({
    queryKey: ['credit-accounts-edari', debounced],
    queryFn: () => api.creditAccountsEdari(debounced || undefined),
    enabled: debounced.length >= 1,
  });
  const label = value ? (num && name ? `${num} — ${name}` : name || num || `#${value}`) : null;
  return (
    <div className="space-y-2">
      <div className="min-h-[28px]">
        {label ? <Picked text={label} onClear={() => onChange(null)} /> : <span className="text-[12px] text-red-600">{emptyHint}</span>}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-slate-400"><IconSearch size={14} /></span>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث باسم الحساب أو رقمه في الإداري" className="w-full ps-7" />
      </div>
      {debounced && (
        <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
          {search.isLoading && <div className="p-2 text-[12px] text-slate-400">جاري البحث…</div>}
          {search.isError && <div className="p-2 text-[12px] text-red-600">تعذر البحث في الإداري</div>}
          {(search.data ?? []).slice(0, 40).map(a => (
            <button
              key={a.edariSeq}
              type="button"
              onClick={() => { onChange(a); setQ(''); }}
              className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-right text-[12.5px] last:border-b-0 hover:bg-slate-50 ${a.edariSeq === value ? 'bg-brand-50' : ''}`}
            >
              <span className="truncate"><b className="tabular-nums">{a.num}</b> — {a.name}</span>
              <span className="shrink-0 tabular-nums text-[11px] text-slate-500">{formatNum(a.balance)}</span>
            </button>
          ))}
          {search.data && search.data.length === 0 && <div className="p-2 text-[12px] text-slate-400">لا نتائج</div>}
        </div>
      )}
    </div>
  );
}

/** مادة الكتالوج التي تحمل أجور التوصيل + التغليف في إيصال المحل. */
function ArticlePicker({ value, name, onChange }: { value?: number | null; name?: string | null; onChange: (p: ProductDto | null) => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useQuery({
    queryKey: ['products-search', debounced],
    queryFn: () => api.searchProducts(debounced),
    enabled: debounced.length >= 2,
  });
  return (
    <div className="space-y-2">
      <div className="min-h-[28px]">
        {value ? <Picked text={name || `#${value}`} onClear={() => onChange(null)} /> : (
          <span className="text-[12px] text-amber-700">لم تُختر — الطلبات التي فيها أجور توصيل لن تُفوتر.</span>
        )}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-slate-400"><IconSearch size={14} /></span>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث «أجور توصيل» أو الباركود" className="w-full ps-7" />
      </div>
      {debounced.length >= 2 && (
        <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
          {search.isLoading && <div className="p-2 text-[12px] text-slate-400">جاري البحث…</div>}
          {(search.data ?? []).map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p); setQ(''); }}
              className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-right text-[12.5px] last:border-b-0 hover:bg-slate-50 ${p.id === value ? 'bg-brand-50' : ''}`}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-slate-500" dir="ltr">{p.barcode || p.num}</span>
            </button>
          ))}
          {search.data && search.data.length === 0 && <div className="p-2 text-[12px] text-slate-400">لا نتائج</div>}
        </div>
      )}
    </div>
  );
}

function CopiesInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={0}
        max={5}
        value={String(value)}
        onChange={e => onChange(Math.max(0, Math.min(5, Math.round(Number(e.target.value) || 0))))}
        className="w-24 tabular-nums"
      />
    </Field>
  );
}

/** الإعدادات ← «طلبات التطبيق»: تشغيل كاشير الطلبات، الحسابات، مادة التوصيل، الطباعة، وحالة الربط. */
export function OnlineOrdersSettingsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['online-orders-settings'], queryFn: api.onlineOrdersSettings });
  const [form, setForm] = useState<Form | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);

  useEffect(() => {
    if (q.data && !form) setForm(toForm(q.data.settings));
  }, [q.data, form]);

  useEffect(() => {
    void window.fotDesktop?.listPrinters?.().then(list => setPrinters(list.map(p => p.name))).catch(() => undefined);
  }, []);

  const ping = useMutation({
    mutationFn: api.pingOnlineOrders,
    onSuccess: r => (r.ok ? toast.success('الاتصال بموقع الطلبات سليم') : toast.error(r.error || 'تعذر الاتصال')),
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الاتصال'),
  });

  const save = useMutation({
    mutationFn: () => api.saveOnlineOrdersSettings(form!),
    onSuccess: r => {
      qc.setQueryData(['online-orders-settings'], r);
      setForm(toForm(r.settings));
      toast.success('حُفظت إعدادات طلبات التطبيق');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  if (q.isError) {
    return (
      <Alert title="تعذر تحميل إعدادات طلبات التطبيق">
        {q.error instanceof Error ? q.error.message : 'حدّث برنامج الخادم (migration 089) ثم أعد المحاولة.'}
      </Alert>
    );
  }
  if (!q.data || !form) return <Skeleton className="h-64 rounded-xl" />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const dirty = JSON.stringify(toForm(q.data.settings)) !== JSON.stringify(form);
  const pingResult = ping.data;

  return (
    <div className="max-w-5xl space-y-3">
      <SettingsCard
        title="كاشير الطلبات"
        description="فوترة طلبات تطبيق ديما الحياة من نقطة البيع: إيصال محل حقيقي ثم شحنة هاي إكسبريس والملصق."
        icon={<IconCart size={16} />}
        actions={
          <Btn size="sm" variant="secondary" icon={<IconRefresh size={13} />} loading={ping.isPending} onClick={() => ping.mutate()}>
            فحص الاتصال
          </Btn>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone={q.data.keyConfigured ? 'ok' : 'danger'} dot>
              {q.data.keyConfigured ? `مفتاح الربط موجود (${q.data.keySource === 'settings' ? 'appsettings' : 'ملف'})` : 'مفتاح الربط غير موجود'}
            </Badge>
            {pingResult && (
              <Badge tone={pingResult.ok ? 'ok' : 'danger'} dot>
                {pingResult.ok ? `الموقع متصل${pingResult.serverTime ? ` · ${new Date(pingResult.serverTime).toLocaleTimeString('en-GB')}` : ''}` : 'الموقع غير متصل'}
              </Badge>
            )}
            <span className="font-mono text-[11.5px] text-slate-500" dir="ltr">{q.data.url}</span>
          </div>
          {!q.data.keyConfigured && (
            <Alert type="warning">
              ضع ملف المفتاح المشترك مع الموقع في <span className="font-mono" dir="ltr">C:\ProgramData\FOT.Pos\online-orders.key</span> على سيرفر المحل
              (64 حرفاً)، ثم اضغط «فحص الاتصال».
            </Alert>
          )}
          {pingResult && !pingResult.ok && pingResult.error && <Alert>{pingResult.error}</Alert>}
          <Switch
            label="تشغيل كاشير الطلبات"
            description="حين يتوقف لا يُفوتر أي طلب من الكاشير."
            checked={form.enabled}
            onChange={v => set('enabled', v)}
          />
        </div>
      </SettingsCard>

      <div className="grid items-start gap-3 xl:grid-cols-2">
        <SettingsCard
          title="حساب «هاي إكسبريس» (الدفع عند الاستلام)"
          description="فاتورة الطلب تُقيَّد عليه آجلاً بالمبلغ الذي تستلمه شركة التوصيل."
          icon={<IconWallet size={16} />}
          tone={form.hiExpressAccount ? undefined : 'danger'}
        >
          <AccountPicker
            value={form.hiExpressAccount}
            num={form.hiExpressAccountNum}
            name={form.hiExpressAccountName}
            emptyHint="لم يُختر — طلبات الدفع عند الاستلام لن تُفوتر."
            onChange={a => setForm(f => (f ? { ...f, hiExpressAccount: a?.edariSeq ?? null, hiExpressAccountNum: a?.num ?? null, hiExpressAccountName: a?.name ?? null } : f))}
          />
        </SettingsCard>
        <SettingsCard
          title="حساب الدفع المسبق بالبطاقة"
          description="الطلبات المدفوعة في التطبيق تُقيَّد عليه آجلاً."
          icon={<IconWallet size={16} />}
          tone={form.prepaidAccount ? undefined : 'danger'}
        >
          <AccountPicker
            value={form.prepaidAccount}
            num={form.prepaidAccountNum}
            name={form.prepaidAccountName}
            emptyHint="لم يُختر — الطلبات المدفوعة مسبقاً لن تُفوتر."
            onChange={a => setForm(f => (f ? { ...f, prepaidAccount: a?.edariSeq ?? null, prepaidAccountNum: a?.num ?? null, prepaidAccountName: a?.name ?? null } : f))}
          />
        </SettingsCard>
        <SettingsCard
          title="مادة أجور التغليف (الاستلام من المحل)"
          description="طلبات التوصيل: أجور التوصيل وتغليف الهدية لا تدخل الفاتورة ولا الإداري — تحصّلها شركة التوصيل مع الطلب، وتظهر ملاحظةً على الفاتورة في قائمة الفواتير. هذه المادة تُستعمل فقط لتغليف هدية في طلب «استلام من المحل»."
          icon={<IconCart size={16} />}
        >
          <ArticlePicker
            value={form.deliveryArticleId}
            name={form.deliveryArticleName}
            onChange={p => setForm(f => (f ? { ...f, deliveryArticleId: p?.id ?? null, deliveryArticleName: p?.name ?? null } : f))}
          />
        </SettingsCard>
        <SettingsCard
          title="الطباعة"
          description="الإيصال والفاتورة على الطابعة الحرارية 80مم. ملصق الشحن هو ملصق هاي إكسبريس نفسه ويُطبع على طابعة الملصقات فقط. 0 نسخ = لا يُطبع."
          icon={<IconPrinter size={16} />}
        >
          <div className="space-y-3">
            <FieldRow>
              <CopiesInput label="إيصال المحل" value={form.receiptCopies} onChange={n => set('receiptCopies', n)} />
              <CopiesInput label="فاتورة الزبونة" value={form.invoiceCopies} onChange={n => set('invoiceCopies', n)} />
              <CopiesInput label="ملصق الشحن (لكل طرد)" value={form.labelCopies} onChange={n => set('labelCopies', n)} />
            </FieldRow>
            <Field
              label="طابعة الملصقات (افتراضية)"
              hint="اسم طابعة الملصقات كما في ويندوز. جهاز كاشير الطلبات يختار طابعته من زر «الطابعات» فيه، وهذا الاسم يُستعمل إن لم يُختر. لا يُطبع الملصق على الطابعة الحرارية."
            >
              <Input
                value={form.labelPrinterName ?? ''}
                onChange={e => set('labelPrinterName', e.target.value || null)}
                list="online-orders-printers"
                className="w-full"
                dir="ltr"
              />
              <datalist id="online-orders-printers">
                {printers.map(p => <option key={p} value={p} />)}
              </datalist>
            </Field>
            <Switch
              label="طباعة قائمة كل طلب جديد جاهز تلقائياً"
              description="عند وصول طلب إلى «جاهزة للفوترة» تُطبع قائمته (بلا أسعار) مع QR الطلب على جهاز كاشير الطلبات."
              checked={form.autoPrintNewSlips}
              onChange={v => set('autoPrintNewSlips', v)}
            />
            <Switch
              label="مراجعة مزدوجة قبل الإتمام"
              description="يمسح الكاشير كل قطعة من الطلب قبل أن يُفتح زر «إتمام وطباعة»."
              checked={form.doubleCheck}
              onChange={v => set('doubleCheck', v)}
            />
          </div>
        </SettingsCard>
      </div>

      <div className="flex items-center gap-2">
        <Btn onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>حفظ إعدادات الطلبات</Btn>
        {dirty && <Btn variant="ghost" onClick={() => setForm(toForm(q.data.settings))}>تجاهل التغييرات</Btn>}
        {dirty && <Badge tone="warn" dot>تغييرات غير محفوظة</Badge>}
      </div>

      <HeldInvoicesCard />
    </div>
  );
}

/** فواتير طلبات التطبيق المحجوزة عن الترحيل التلقائي — تُرحَّل يدوياً من هنا أو من كاشير الطلبات. */
function HeldInvoicesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = useQuery({ queryKey: ['online-orders-held'], queryFn: api.onlineOrdersHeld, refetchInterval: 30_000 });
  const post = useMutation({
    mutationFn: (body: { orderIds?: string[]; all?: boolean }) => api.postOnlineOrders(body),
    onSuccess: r => {
      toast.success(r.message);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['online-orders-held'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الترحيل'),
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.total, 0);
  const confirmPost = (body: { orderIds?: string[]; all?: boolean }, n: number) => {
    if (window.confirm(`ترحيل ${n === 1 ? 'فاتورة واحدة' : `${n} فواتير`} إلى الإداري؟ بعد الترحيل لا تُعدّل من كاشير الطلبات.`)) post.mutate(body);
  };

  return (
    <SettingsCard
      title="فواتير طلبات التطبيق بانتظار الترحيل"
      description="لا تُرحَّل فواتير طلبات التطبيق إلى الإداري تلقائياً. تبقى قابلة للتعديل في كاشير الطلبات (ويتعدّل معها الموقع وهاي إكسبريس) حتى تُرحَّل من هنا أو من الكاشير."
      icon={<IconCart size={16} />}
      actions={
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="secondary" icon={<IconRefresh size={13} />} loading={q.isFetching} onClick={() => void q.refetch()}>
            تحديث
          </Btn>
          <Btn size="sm" disabled={!picked.size} loading={post.isPending} onClick={() => confirmPost({ orderIds: [...picked] }, picked.size)}>
            ترحيل المحدد ({formatNum(picked.size)})
          </Btn>
          <Btn size="sm" variant="secondary" disabled={!rows.length} loading={post.isPending} onClick={() => confirmPost({ all: true }, rows.length)}>
            ترحيل الكل
          </Btn>
        </div>
      }
    >
      {q.isError ? (
        <Alert>{q.error instanceof Error ? q.error.message : 'حدّث برنامج الخادم (migration 090) ثم أعد المحاولة.'}</Alert>
      ) : !q.data ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="py-4 text-center text-[13px] text-slate-500">لا توجد فواتير بانتظار الترحيل</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-200 text-right text-slate-500">
                <th className="w-8 py-1.5">
                  <input
                    type="checkbox"
                    checked={rows.every(r => picked.has(r.orderId))}
                    onChange={e => setPicked(e.target.checked ? new Set(rows.map(r => r.orderId)) : new Set())}
                  />
                </th>
                <th className="py-1.5 font-bold">الطلب</th>
                <th className="py-1.5 font-bold">الإيصال</th>
                <th className="py-1.5 font-bold">الكاشير</th>
                <th className="py-1.5 font-bold">التاريخ</th>
                <th className="py-1.5 font-bold">التعديلات</th>
                <th className="py-1.5 text-left font-bold">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.clientReceiptId} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.has(r.orderId)}
                      onChange={e => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(r.orderId);
                        else next.delete(r.orderId);
                        setPicked(next);
                      }}
                    />
                  </td>
                  <td className="py-1.5 font-mono" dir="ltr">{r.orderNumber ?? r.orderId}</td>
                  <td className="py-1.5 font-mono">{r.receiptNumber ?? '—'}</td>
                  <td className="py-1.5">{r.cashierName ?? '—'}</td>
                  <td className="py-1.5">{new Date(r.createdAt).toLocaleString('en-GB', { hour12: false })}</td>
                  <td className="py-1.5">{r.edits > 0 ? <Badge tone="warn">{formatNum(r.edits)}</Badge> : '—'}</td>
                  <td className="py-1.5 text-left font-bold">{formatNum(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-slate-700">
                <td colSpan={6} className="pt-2 font-bold">{formatNum(rows.length)} فاتورة</td>
                <td className="pt-2 text-left font-bold">{formatNum(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </SettingsCard>
  );
}
