import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  formatDate,
  formatNum,
  type ApiEndpointDescriptorDto,
  type ApiKeyDto,
  type ApiWebhookDto,
} from '@/api/client';
import { getApiBase } from '@/lib/apiBase';
import {
  Badge,
  Btn,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  useConfirm,
} from '@/components/ui';
import { SegmentedFilter, SummaryStrip } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import {
  ICONS,
  IconCheck,
  IconCopy,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconTrash,
  IconWifi,
} from '@/components/icons';

const SCOPE_LABELS: Record<string, { label: string; desc: string }> = {
  '*': { label: 'كامل الصلاحيات (*)', desc: 'وصول شامل لجميع نقاط القراءة والكتابة في النظام' },
  'catalog:read': { label: 'قراءة الكتالوج والأسعار', desc: 'المواد، الباركودات، العروض، الشجرة، ومحرك تسعير السلة' },
  'catalog:write': { label: 'تعديل الكتالوج والخصومات', desc: 'تحديث أسعار وخصومات المواد ودفعها للكاشير' },
  'sales:read': { label: 'قراءة المبيعات والفواتير', desc: 'ملخصات اليوم، التقارير، واستعراض الفواتير وتفاصيلها' },
  'sales:write': { label: 'إنشاء فواتير ومبيعات', desc: 'إصدار فواتير بيع أو مرتجع أو تعليق من تطبيق خارجي' },
  'inventory:read': { label: 'المخزون والنواقص', desc: 'فحص الأرصدة، توقعات النواقص، والمواد الراكدة' },
  'team:read': { label: 'الفريق والأقسام ونقاط البيع', desc: 'البائعون، الكاشير، الأقسام، وحالة أجهزة الكاشير' },
  'customers:read': { label: 'الحسابات ورموز الخصم', desc: 'حسابات الآجل والتحقق من رموز QR للخصم' },
  'events:publish': { label: 'بث أحداث على الشبكة', desc: 'إرسال إشعارات وأحداث مخصّصة لبقية الأجهزة عبر SSE/Webhooks' },
};

const WEBHOOK_EVENTS = [
  { id: '*', label: 'كل الأحداث (*)' },
  { id: 'receipt.created', label: 'إنشاء فاتورة جديدة (receipt.created)' },
  { id: 'catalog.updated', label: 'تحديث الكتالوج أو العروض (catalog.updated)' },
  { id: 'edari.synced', label: 'مزامنة الأداري (edari.synced)' },
];

type TabKey = 'keys' | 'explorer' | 'webhooks';
type CodeLang = 'js' | 'python' | 'dart' | 'csharp' | 'curl';

export function ApiPlatformPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const KeyIcon = ICONS.key;

  const [tab, setTab] = useState<TabKey>('keys');
  const [createdKeySecret, setCreatedKeySecret] = useState<{ name: string; plain: string } | null>(null);

  // Create API Key Modal state
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyNotes, setKeyNotes] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['*']);

  // Create Webhook Modal state
  const [hookModalOpen, setHookModalOpen] = useState(false);
  const [hookName, setHookName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [hookSecret, setHookSecret] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>(['*']);

  // Explorer state
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [epSearch, setEpSearch] = useState('');
  const [selectedEp, setSelectedEp] = useState<ApiEndpointDescriptorDto | null>(null);
  const [customPath, setCustomPath] = useState('/api/v1/system/status');
  const [customMethod, setCustomMethod] = useState('GET');
  const [customBody, setCustomBody] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [codeLang, setCodeLang] = useState<CodeLang>('js');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: number;
    elapsedMs: number;
    catalogRevision?: string | null;
    body: unknown;
  } | null>(null);

  // Custom event broadcast state
  const [customEventType, setCustomEventType] = useState('custom.notification');
  const [customEventMsg, setCustomEventMsg] = useState('رسالة تجريبية للأجهزة على الشبكة');

  const overviewQ = useQuery({
    queryKey: ['api-platform-overview'],
    queryFn: api.apiPlatformOverview,
    refetchInterval: 20_000,
  });

  const keysQ = useQuery({
    queryKey: ['api-platform-keys'],
    queryFn: api.apiKeys,
  });

  const hooksQ = useQuery({
    queryKey: ['api-platform-webhooks'],
    queryFn: api.apiWebhooks,
  });

  const ov = overviewQ.data;
  const primaryBaseUrl = useMemo(() => {
    if (ov?.baseUrls?.length) return ov.baseUrls[0];
    const b = getApiBase();
    return b || window.location.origin;
  }, [ov?.baseUrls]);

  const endpoints = useMemo(() => (Array.isArray(ov?.endpoints) ? ov.endpoints : []), [ov?.endpoints]);
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const e of endpoints) s.add(e.group);
    return Array.from(s);
  }, [endpoints]);

  const filteredEndpoints = useMemo(() => {
    const q = epSearch.trim().toLowerCase();
    return endpoints.filter(e => {
      if (groupFilter !== 'all' && e.group !== groupFilter) return false;
      if (!q) return true;
      return (
        e.path.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q)
      );
    });
  }, [endpoints, groupFilter, epSearch]);

  const keys = Array.isArray(keysQ.data) ? keysQ.data : [];
  const webhooks = Array.isArray(hooksQ.data) ? hooksQ.data : [];
  const recentEvents = Array.isArray(ov?.recentEvents) ? ov.recentEvents : [];

  const createKeyMut = useMutation({
    mutationFn: () =>
      api.createApiKey({
        name: keyName.trim(),
        notes: keyNotes.trim() || undefined,
        scopes: keyScopes.includes('*') ? ['*'] : keyScopes,
      }),
    onSuccess: res => {
      setCreatedKeySecret({ name: res.key.name, plain: res.plainTextKey });
      setKeyModalOpen(false);
      setKeyName('');
      setKeyNotes('');
      setKeyScopes(['*']);
      toast.success('تم توليد مفتاح الـ API بنجاح — انسخه الآن');
      void qc.invalidateQueries({ queryKey: ['api-platform-keys'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleKeyMut = useMutation({
    mutationFn: (k: ApiKeyDto) => api.updateApiKey(k.id, { isActive: !k.isActive }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['api-platform-keys'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteKeyMut = useMutation({
    mutationFn: (id: number) => api.deleteApiKey(id),
    onSuccess: () => {
      toast.success('تم حذف المفتاح');
      void qc.invalidateQueries({ queryKey: ['api-platform-keys'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createHookMut = useMutation({
    mutationFn: () =>
      api.createApiWebhook({
        name: hookName.trim(),
        targetUrl: hookUrl.trim(),
        secret: hookSecret.trim() || undefined,
        events: hookEvents.includes('*') ? ['*'] : hookEvents,
      }),
    onSuccess: () => {
      setHookModalOpen(false);
      setHookName('');
      setHookUrl('');
      setHookSecret('');
      setHookEvents(['*']);
      toast.success('تم تسجيل الويب هوك بنجاح');
      void qc.invalidateQueries({ queryKey: ['api-platform-webhooks'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleHookMut = useMutation({
    mutationFn: (w: ApiWebhookDto) => api.updateApiWebhook(w.id, { isActive: !w.isActive }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['api-platform-webhooks'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteHookMut = useMutation({
    mutationFn: (id: number) => api.deleteApiWebhook(id),
    onSuccess: () => {
      toast.success('تم حذف الويب هوك');
      void qc.invalidateQueries({ queryKey: ['api-platform-webhooks'] });
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testHookMut = useMutation({
    mutationFn: (id: number) => api.testApiWebhook(id),
    onSuccess: res => {
      if (res.ok) toast.success(`${res.message} (${res.elapsedMs}ms)`);
      else toast.error(`فشل الإرسال: ${res.message}`);
      void qc.invalidateQueries({ queryKey: ['api-platform-webhooks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishEventMut = useMutation({
    mutationFn: () => api.publishNetworkEvent(customEventType.trim(), { message: customEventMsg, sentAt: new Date().toISOString() }),
    onSuccess: () => {
      toast.success('تم بث الحدث لجميع المشتركين على الشبكة');
      void qc.invalidateQueries({ queryKey: ['api-platform-overview'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function copyText(text: string, label = 'تم النسخ إلى الحافظة') {
    void navigator.clipboard.writeText(text);
    toast.success(label);
  }

  function selectEndpointForTest(ep: ApiEndpointDescriptorDto) {
    setSelectedEp(ep);
    setCustomMethod(ep.method);
    const sample = ep.sampleQueryOrBody ?? '';
    if (ep.method === 'GET') {
      const basePath = ep.path.replace('{id}', '1').replace('{number}', '1').replace('{treeSeq}', '1');
      setCustomPath(sample.startsWith('?') ? `${basePath}${sample}` : basePath);
      setCustomBody('');
    } else {
      setCustomPath(ep.path.replace('{id}', '1'));
      setCustomBody(sample.startsWith('{') ? sample : '{\n  \n}');
    }
    setTestResult(null);
  }

  async function runLiveTest() {
    setTestLoading(true);
    try {
      const res = await api.callNetworkEndpoint(customMethod, customPath, customBody, customApiKey);
      setTestResult(res);
    } catch (e) {
      setTestResult({
        ok: false,
        status: 0,
        elapsedMs: 0,
        body: { error: e instanceof Error ? e.message : 'فشل الاتصال' },
      });
    } finally {
      setTestLoading(false);
    }
  }

  const codeSnippet = useMemo(() => {
    const fullUrl = `${primaryBaseUrl}${customPath.startsWith('/') ? customPath : `/${customPath}`}`;
    const keyHeader = customApiKey.trim() || 'fot_k_YOUR_API_KEY';
    const hasBody = customMethod !== 'GET' && customBody.trim().length > 0;

    switch (codeLang) {
      case 'js':
        return `const res = await fetch('${fullUrl}', {
  method: '${customMethod}',
  headers: {
    'X-API-Key': '${keyHeader}',${hasBody ? "\n    'Content-Type': 'application/json'," : ''}
  },${hasBody ? `\n  body: JSON.stringify(${customBody.trim()}),` : ''}
});
const data = await res.json();
console.log(data);`;

      case 'python':
        return `import requests

url = "${fullUrl}"
headers = {"X-API-Key": "${keyHeader}"}
${hasBody ? `payload = ${customBody.trim()}\nresp = requests.request("${customMethod}", url, headers=headers, json=payload)` : `resp = requests.get(url, headers=headers)`}
print(resp.status_code, resp.json())`;

      case 'dart':
        return `import 'dart:convert';
import 'package:http/http.dart' as http;

final uri = Uri.parse('${fullUrl}');
final res = await http.${customMethod.toLowerCase()}(
  uri,
  headers: {
    'X-API-Key': '${keyHeader}',${hasBody ? "\n    'Content-Type': 'application/json'," : ''}
  },${hasBody ? `\n  body: jsonEncode(${customBody.trim()}),` : ''}
);
final data = jsonDecode(res.body);`;

      case 'csharp':
        return `using var client = new HttpClient { BaseAddress = new Uri("${primaryBaseUrl}") };
client.DefaultRequestHeaders.Add("X-API-Key", "${keyHeader}");
${
  hasBody
    ? `var content = new StringContent(${JSON.stringify(customBody.trim())}, System.Text.Encoding.UTF8, "application/json");\nvar response = await client.PostAsync("${customPath}", content);`
    : `var response = await client.GetAsync("${customPath}");`
}
var json = await response.Content.ReadAsStringAsync();`;

      case 'curl':
        return `curl -X ${customMethod} "${fullUrl}" \\
  -H "X-API-Key: ${keyHeader}"${hasBody ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${customBody.trim()}'` : ''}`;
    }
  }, [primaryBaseUrl, customPath, customMethod, customBody, customApiKey, codeLang]);

  function toggleScopeSelection(scope: string) {
    if (scope === '*') {
      setKeyScopes(['*']);
      return;
    }
    setKeyScopes(prev => {
      const withoutStar = prev.filter(s => s !== '*');
      if (withoutStar.includes(scope)) {
        const next = withoutStar.filter(s => s !== scope);
        return next.length === 0 ? ['*'] : next;
      }
      return [...withoutStar, scope];
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="بوابة الـ API والربط الشبكي (Network API v1)"
        subtitle="منصة موحّدة لبناء وربط أي تطبيق، شاشة، جهاز جرد، متجر، أو بوت على الشبكة المحلية"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              variant="secondary"
              size="sm"
              icon={<IconRefresh size={14} />}
              onClick={() => {
                void overviewQ.refetch();
                void keysQ.refetch();
                void hooksQ.refetch();
              }}
            >
              تحديث
            </Btn>
            <a href={`${primaryBaseUrl}/swagger`} target="_blank" rel="noreferrer">
              <Btn variant="secondary" size="sm" icon={<IconSparkle size={14} />}>
                فتح Swagger UI
              </Btn>
            </a>
            <Btn size="sm" icon={<IconPlus size={14} />} onClick={() => setKeyModalOpen(true)}>
              مفتاح API جديد
            </Btn>
          </div>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <SummaryStrip
          cells={[
            {
              label: 'العنوان الأساسي على الشبكة (LAN)',
              value: <span className="num text-[13.5px] font-bold" dir="ltr">{primaryBaseUrl}/api/v1</span>,
              hint: ov?.lanIps?.length ? `عناوين متاحة: ${ov.lanIps.join(' · ')}` : `${ov?.serverName ?? 'FOT Server'}`,
              tone: 'brand',
              onClick: () => copyText(`${primaryBaseUrl}/api/v1`, 'تم نسخ رابط الـ API الأساسي'),
            },
            {
              label: 'مفاتيح الـ API الفعّالة',
              value: <span className="num">{formatNum(ov?.activeKeysCount ?? keys.filter(k => k.isActive).length)}</span>,
              hint: `إجمالي الطلبات المخدومة: ${formatNum(ov?.totalApiKeyRequests ?? 0)}`,
              tone: 'ok',
              active: tab === 'keys',
              onClick: () => setTab('keys'),
            },
            {
              label: 'نقاط النهاية الجاهزة (/api/v1)',
              value: <span className="num">{formatNum(endpoints.length || 22)} نقطة</span>,
              hint: 'كتالوج · تسعير · فواتير · مخزون · فريق · أحداث',
              tone: 'brand',
              active: tab === 'explorer',
              onClick: () => setTab('explorer'),
            },
            {
              label: 'البث اللحظي (SSE & Webhooks)',
              value: <span className="num">{formatNum(ov?.activeWebhooksCount ?? webhooks.filter(w => w.isActive).length)} ويب هوك</span>,
              hint: `مراجعة الكتالوج الحية #${formatNum(ov?.catalogRevision ?? 0)}`,
              tone: 'warn',
              active: tab === 'webhooks',
              onClick: () => setTab('webhooks'),
            },
          ]}
        />
      </Card>

      {/* روابط الوصول السريع على الشبكة */}
      <Card className="!p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-extrabold text-slate-700">
              <IconWifi size={15} className="text-brand-600" />
              روابط الربط المباشر:
            </span>
            {[
              { label: 'دليل الـ API', url: `${primaryBaseUrl}/api/v1` },
              { label: 'Swagger التفاعلي', url: `${primaryBaseUrl}/swagger` },
              { label: 'بث الأحداث (SSE)', url: `${primaryBaseUrl}/api/v1/events/stream` },
              { label: 'SignalR Hub', url: `${primaryBaseUrl}/hubs/pos` },
            ].map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => copyText(item.url, `تم نسخ رابط ${item.label}`)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-800"
                title="اضغط للنسخ"
              >
                <span className="font-bold">{item.label}:</span>
                <code className="num text-[11.5px] text-slate-600" dir="ltr">{item.url}</code>
                <IconCopy size={12} className="text-slate-400" />
              </button>
            ))}
          </div>
          <SegmentedFilter<TabKey>
            label="أقسام بوابة الـ API"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'keys', label: 'مفاتيح الـ API', count: keys.length },
              { id: 'explorer', label: 'مستكشف ومختبر الـ API', count: endpoints.length },
              { id: 'webhooks', label: 'البث اللحظي والويب هوك', count: webhooks.length },
            ]}
          />
        </div>
      </Card>

      {/* الشريط التنبيهي للمفتاح المُنشأ حديثاً */}
      {createdKeySecret && (
        <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50/90 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[14px] font-extrabold text-emerald-950">
                <KeyIcon size={16} className="text-emerald-700" />
                تم إنشاء مفتاح الـ API لـ «{createdKeySecret.name}» — انسخه الآن (لن يظهر كاملاً مرة أخرى)
              </div>
              <p className="text-[12px] text-emerald-800">
                أرسله في ترويسة الطلب <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11.5px]" dir="ltr">X-API-Key: {createdKeySecret.plain}</code> أو في الرابط <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11.5px]" dir="ltr">?api_key={createdKeySecret.plain}</code>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Btn
                size="sm"
                icon={<IconCopy size={14} />}
                onClick={() => copyText(createdKeySecret.plain, 'تم نسخ مفتاح الـ API بالكامل')}
              >
                نسخ المفتاح
              </Btn>
              <Btn
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCustomApiKey(createdKeySecret.plain);
                  setTab('explorer');
                  toast.success('تم وضع المفتاح في المختبر الحي');
                }}
              >
                تجربة في المختبر
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setCreatedKeySecret(null)}>
                إخفاء
              </Btn>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-emerald-300 bg-white px-3.5 py-2 font-mono text-[13px] font-bold text-slate-900" dir="ltr">
            <span className="select-all break-all">{createdKeySecret.plain}</span>
          </div>
        </div>
      )}

      {/* التبويب الأول: مفاتيح الـ API */}
      {tab === 'keys' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel
            title="مفاتيح الوصول للتطبيقات (API Keys)"
            subtitle="أنشئ مفتاحاً خاصاً لكل تطبيق أو جهاز على الشبكة للتحكم بصلاحياته ومراقبة استخدامه بدون انتهاء صلاحية مفاجئ"
            actions={
              <Btn size="sm" icon={<IconPlus size={14} />} onClick={() => setKeyModalOpen(true)}>
                إنشاء مفتاح جديد
              </Btn>
            }
            className="lg:col-span-2"
            bodyClassName="p-4"
          >
            {keys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                <p className="text-[13.5px] font-bold text-slate-700">لا توجد مفاتيح API مسجّلة بعد</p>
                <p className="mt-1 text-[12px] text-slate-500">
                  نقاط الكتالوج العامة تعمل مباشرة بدون مفتاح، أما المبيعات والفواتير والمخزون والفريق فتعمل عبر مفاتيح الـ API.
                </p>
                <Btn size="sm" className="mt-3" icon={<IconPlus size={14} />} onClick={() => setKeyModalOpen(true)}>
                  إنشاء أول مفتاح API
                </Btn>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11.5px] font-bold text-slate-600">
                      <th className="px-3 py-2.5 text-start">التطبيق / الاسم</th>
                      <th className="px-3 py-2.5 text-start">البادئة</th>
                      <th className="px-3 py-2.5 text-start">الصلاحيات (Scopes)</th>
                      <th className="px-3 py-2.5 text-start">الطلبات</th>
                      <th className="px-3 py-2.5 text-start">آخر استخدام</th>
                      <th className="px-3 py-2.5 text-center">الحالة</th>
                      <th className="px-3 py-2.5 text-end">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {keys.map(k => (
                      <tr key={k.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-900">{k.name}</div>
                          {k.notes && <div className="text-[11px] text-slate-500">{k.notes}</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[12px] text-slate-700" dir="ltr">
                            {k.keyPrefix}…
                          </code>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(k.scopes ?? ['*']).map(sc => (
                              <Badge key={sc} tone={sc === '*' ? 'brand' : 'default'}>
                                {SCOPE_LABELS[sc]?.label ?? sc}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="num px-3 py-2.5 font-bold text-slate-800">{formatNum(k.requestCount)}</td>
                        <td className="px-3 py-2.5 text-[11.5px] text-slate-600">
                          {k.lastUsedAt ? (
                            <div>
                              <div>{formatDate(k.lastUsedAt)}</div>
                              {k.lastUsedIp && <div className="num text-[10.5px] text-slate-400" dir="ltr">{k.lastUsedIp}</div>}
                            </div>
                          ) : (
                            <span className="text-slate-400">لم يُستخدم بعد</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge tone={k.isActive ? 'ok' : 'danger'}>{k.isActive ? 'فعّال' : 'موقوف'}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            <Btn
                              size="sm"
                              variant="secondary"
                              onClick={() => toggleKeyMut.mutate(k)}
                              loading={toggleKeyMut.isPending}
                            >
                              {k.isActive ? 'إيقاف' : 'تفعيل'}
                            </Btn>
                            <Btn
                              size="sm"
                              variant="danger"
                              icon={<IconTrash size={13} />}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `حذف مفتاح «${k.name}»؟`,
                                  message: 'أي تطبيق يستخدم هذا المفتاح سيتوقف عن الوصول فوراً.',
                                  confirmLabel: 'حذف نهائي',
                                  danger: true,
                                });
                                if (ok) deleteKeyMut.mutate(k.id);
                              }}
                            >
                              حذف
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="كيف تبني أي تطبيق على الشبكة؟" subtitle="3 طرق للربط الفوري مع السيرفر" bodyClassName="p-4">
            <div className="space-y-3 text-[12.5px] text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="font-extrabold text-slate-900">1. مصادقة بسيطة وثابتة (X-API-Key)</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">
                  بدل التعامل مع تسجيل الدخول وانتهاء الجلسة، مرّر المفتاح في الترويسة <code className="font-mono" dir="ltr">X-API-Key</code> أو في الرابط <code className="font-mono" dir="ltr">?api_key=...</code> من أي لغة برمجة.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="font-extrabold text-slate-900">2. محرك تسعير السلة المدمج</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">
                  أرسل قائمة الباركودات والكميات إلى <code className="font-mono" dir="ltr">POST /api/v1/catalog/quote</code> ليحسب السيرفر تلقائياً جميع العروض الفعّالة والخصومات ورموز QR ويعيد الصافي بالدينار.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="font-extrabold text-slate-900">3. اكتشاف تلقائي على الشبكة (UDP + SSE)</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">
                  يبث السيرفر عنوانه تلقائياً على منفذ UDP <code className="font-mono" dir="ltr">47015</code>، ويبث جميع أحداث المبيعات والكتالوج مباشرة عبر <code className="font-mono" dir="ltr">/api/v1/events/stream</code>.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* التبويب الثاني: مستكشف ومختبر الـ API الحي */}
      {tab === 'explorer' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel
            title="دليل نقاط النهاية (/api/v1)"
            subtitle="اضغط على أي نقطة لتجربتها وتوليد كود الربط لها"
            className="lg:col-span-5"
            bodyClassName="p-4"
          >
            <div className="mb-3 space-y-2">
              <div className="relative">
                <IconSearch size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={epSearch}
                  onChange={e => setEpSearch(e.target.value)}
                  placeholder="ابحث بالمسار أو الوظيفة… (مثال: quote, sales, stock)"
                  className="pr-8"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setGroupFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition ${
                    groupFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  الكل ({endpoints.length})
                </button>
                {groups.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroupFilter(g)}
                    className={`rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition ${
                      groupFilter === g ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[580px] space-y-1.5 overflow-y-auto pr-1">
              {filteredEndpoints.map(ep => {
                const active = selectedEp?.path === ep.path && selectedEp?.method === ep.method;
                const methodCls =
                  ep.method === 'GET'
                    ? 'bg-emerald-100 text-emerald-800'
                    : ep.method === 'POST'
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-amber-100 text-amber-800';
                return (
                  <button
                    key={`${ep.method}:${ep.path}`}
                    type="button"
                    onClick={() => selectEndpointForTest(ep)}
                    className={`w-full rounded-xl border p-2.5 text-right transition ${
                      active
                        ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-300'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-extrabold ${methodCls}`} dir="ltr">
                        {ep.method}
                      </span>
                      <code className="flex-1 truncate text-left font-mono text-[12px] font-bold text-slate-800" dir="ltr">
                        {ep.path}
                      </code>
                      <Badge tone={ep.anonymousAllowed ? 'ok' : 'warn'}>
                        {ep.anonymousAllowed ? 'عام LAN' : ep.scope}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11.5px] text-slate-600">{ep.summary}</p>
                  </button>
                );
              })}
            </div>
          </Panel>

          <div className="space-y-4 lg:col-span-7">
            <Panel
              title="المختبر التفاعلي الحي (Live API Runner)"
              subtitle="نفّذ أي طلب مباشرة على السيرفر وعاين النتيجة وزمن الاستجابة"
              actions={
                <Btn size="sm" onClick={() => void runLiveTest()} loading={testLoading} icon={<IconSparkle size={14} />}>
                  إرسال الطلب الآن
                </Btn>
              }
              bodyClassName="p-4"
            >
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={customMethod}
                    onChange={e => setCustomMethod(e.target.value)}
                    aria-label="HTTP Method"
                    className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-[13px] font-bold text-slate-800"
                    dir="ltr"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PATCH">PATCH</option>
                    <option value="PUT">PUT</option>
                  </select>
                  <Input
                    value={customPath}
                    onChange={e => setCustomPath(e.target.value)}
                    className="flex-1 font-mono text-[13px]"
                    dir="ltr"
                    placeholder="/api/v1/..."
                  />
                </div>

                {customMethod !== 'GET' && (
                  <Field label="جسم الطلب (JSON Body)">
                    <textarea
                      value={customBody}
                      onChange={e => setCustomBody(e.target.value)}
                      rows={4}
                      dir="ltr"
                      aria-label="JSON Body"
                      className="w-full rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[12.5px] text-emerald-300 focus:border-brand-500 focus:outline-none"
                    />
                  </Field>
                )}

                <Field label="مفتاح API للاختبار (اختياري — إذا تُرك فارغاً تُستخدم جلسة الإدارة الحالية)">
                  <Input
                    value={customApiKey}
                    onChange={e => setCustomApiKey(e.target.value)}
                    placeholder="fot_k_..."
                    dir="ltr"
                    className="font-mono text-[12.5px]"
                  />
                </Field>

                {testResult && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
                      <div className="flex items-center gap-2">
                        <Badge tone={testResult.ok ? 'ok' : 'danger'}>
                          HTTP {testResult.status} {testResult.ok ? 'OK' : 'Error'}
                        </Badge>
                        <span className="num font-semibold text-slate-600">{testResult.elapsedMs} ms</span>
                        {testResult.catalogRevision && (
                          <span className="num text-slate-500">Catalog Rev #{testResult.catalogRevision}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(JSON.stringify(testResult.body, null, 2), 'تم نسخ JSON الاستجابة')}
                        className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline"
                      >
                        <IconCopy size={13} /> نسخ الاستجابة
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="max-h-[280px] overflow-auto rounded-xl bg-slate-900 p-3.5 font-mono text-[12px] leading-relaxed text-slate-100"
                    >
                      {JSON.stringify(testResult.body, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </Panel>

            <Panel
              title="مولّد الكود الجاهز للنسخ (Code Generator)"
              subtitle="انسخ الكود مباشرة إلى مشروعك (موبايل، ويب، بايثون، أو سطح مكتب)"
              actions={
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: 'js', label: 'JS / Fetch' },
                      { id: 'python', label: 'Python' },
                      { id: 'dart', label: 'Flutter / Dart' },
                      { id: 'csharp', label: 'C#' },
                      { id: 'curl', label: 'cURL' },
                    ] as const
                  ).map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setCodeLang(l.id)}
                      className={`rounded-lg px-2.5 py-1 font-mono text-[11.5px] font-bold transition ${
                        codeLang === l.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                  <Btn size="sm" variant="secondary" icon={<IconCopy size={13} />} onClick={() => copyText(codeSnippet, 'تم نسخ الكود')}>
                    نسخ
                  </Btn>
                </div>
              }
              bodyClassName="p-4"
            >
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-xl bg-slate-900 p-3.5 font-mono text-[12px] leading-relaxed text-sky-200"
              >
                {codeSnippet}
              </pre>
            </Panel>
          </div>
        </div>
      )}

      {/* التبويب الثالث: البث اللحظي والويب هوك */}
      {tab === 'webhooks' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel
            title="الويب هوك الصادر على الشبكة (Outbound Webhooks)"
            subtitle="عند حدوث بيع أو تحديث كتالوج أو مزامنة أداري، يرسل السيرفر إشعار HTTP POST فوري إلى أي خدمة تحددها"
            actions={
              <Btn size="sm" icon={<IconPlus size={14} />} onClick={() => setHookModalOpen(true)}>
                إضافة ويب هوك
              </Btn>
            }
            className="lg:col-span-7"
            bodyClassName="p-4"
          >
            {webhooks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                <p className="text-[13.5px] font-bold text-slate-700">لا توجد روابط ويب هوك مسجّلة</p>
                <p className="mt-1 text-[12px] text-slate-500">
                  أضف رابط خدمة على الشبكة (مثل بوت واتساب/تليجرام أو شاشة عرض أو نظام محاسبي) ليصله إشعار فوري مع كل عملية.
                </p>
                <Btn size="sm" className="mt-3" icon={<IconPlus size={14} />} onClick={() => setHookModalOpen(true)}>
                  تسجيل أول ويب هوك
                </Btn>
              </div>
            ) : (
              <div className="space-y-2.5">
                {webhooks.map(w => (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-slate-900">{w.name}</span>
                        <Badge tone={w.isActive ? 'ok' : 'default'}>{w.isActive ? 'نشط' : 'موقوف'}</Badge>
                        {w.hasSecret && <Badge tone="brand">موقّع HMAC</Badge>}
                        {w.lastStatusCode != null && (
                          <Badge tone={w.lastStatusCode >= 200 && w.lastStatusCode < 300 ? 'ok' : 'danger'}>
                            HTTP {w.lastStatusCode}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate font-mono text-[12px] text-slate-600" dir="ltr">
                        {w.targetUrl}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <span>الأحداث: {(w.events ?? ['*']).join(', ')}</span>
                        <span>نجاح: <b className="num text-emerald-700">{formatNum(w.deliveryCount)}</b></span>
                        <span>فشل: <b className="num text-rose-600">{formatNum(w.failureCount)}</b></span>
                        {w.lastError && <span className="text-rose-600">آخر خطأ: {w.lastError}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => testHookMut.mutate(w.id)}
                        loading={testHookMut.isPending}
                      >
                        اختبار حي
                      </Btn>
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => toggleHookMut.mutate(w)}
                      >
                        {w.isActive ? 'إيقاف' : 'تفعيل'}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="danger"
                        icon={<IconTrash size={13} />}
                        onClick={() => deleteHookMut.mutate(w.id)}
                      >
                        حذف
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="space-y-4 lg:col-span-5">
            <Panel
              title="بث حدث مباشر على الشبكة (SSE & Webhook Bus)"
              subtitle="أرسل حدثاً مخصّصاً يصل فوراً لكل الأجهزة المستمعة عبر /api/v1/events/stream"
              bodyClassName="p-4"
            >
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="نوع الحدث (Event Type)">
                    <Input
                      value={customEventType}
                      onChange={e => setCustomEventType(e.target.value)}
                      dir="ltr"
                      className="font-mono text-[12.5px]"
                    />
                  </Field>
                  <Field label="رسالة / بيانات الحدث">
                    <Input
                      value={customEventMsg}
                      onChange={e => setCustomEventMsg(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Btn
                    size="sm"
                    icon={<IconSparkle size={14} />}
                    loading={publishEventMut.isPending}
                    onClick={() => publishEventMut.mutate()}
                  >
                    بث الحدث الآن
                  </Btn>
                </div>
              </div>
            </Panel>

            <Panel
              title="آخر الأحداث اللحظية على الشبكة"
              subtitle="سجل آخر الإشعارات التي بثّها السيرفر"
              bodyClassName="p-4"
            >
              {recentEvents.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-slate-400">لا توجد أحداث مسجّلة منذ بدء تشغيل السيرفر</p>
              ) : (
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {recentEvents.map(ev => (
                    <div key={ev.id} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-[12px]">
                      <div className="flex items-center justify-between">
                        <Badge tone="brand">{ev.eventType}</Badge>
                        <span className="num text-[11px] text-slate-400">#{ev.id} · {formatDate(ev.timestampUtc)}</span>
                      </div>
                      <pre dir="ltr" className="mt-1.5 overflow-x-auto font-mono text-[11px] text-slate-700">
                        {JSON.stringify(ev.data)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* نافذة إنشاء مفتاح API جديد */}
      <Modal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        title="إنشاء مفتاح API جديد للتطبيقات الشبكية"
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setKeyModalOpen(false)}>
              إلغاء
            </Btn>
            <Btn
              icon={<IconCheck size={14} />}
              disabled={!keyName.trim()}
              loading={createKeyMut.isPending}
              onClick={() => createKeyMut.mutate()}
            >
              توليد المفتاح
            </Btn>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Field label="اسم التطبيق أو الجهاز" hint="مثال: تطبيق الجرد، شاشة العروض، بوت التليجرام، نظام المحاسبة">
            <Input
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder="أدخل اسماً واضحاً…"
              autoFocus
            />
          </Field>

          <Field label="ملاحظات إضافية (اختياري)">
            <Input
              value={keyNotes}
              onChange={e => setKeyNotes(e.target.value)}
              placeholder="وصف مختصر لوظيفة التطبيق أو الجهاز…"
            />
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-slate-700">الصلاحيات المسموحة (Scopes)</span>
              <div className="flex gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setKeyScopes(['*'])}
                  className="font-bold text-brand-700 hover:underline"
                >
                  كامل الصلاحيات
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setKeyScopes(['catalog:read', 'sales:read', 'inventory:read', 'team:read'])}
                  className="font-bold text-slate-600 hover:underline"
                >
                  قراءة فقط (شامل)
                </button>
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              {Object.entries(SCOPE_LABELS).map(([scopeKey, info]) => {
                const checked = keyScopes.includes('*') ? scopeKey === '*' : keyScopes.includes(scopeKey);
                return (
                  <label
                    key={scopeKey}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-2 transition ${
                      checked ? 'bg-brand-50/90 text-brand-950' : 'hover:bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleScopeSelection(scopeKey)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12.5px] font-bold">
                        <span>{info.label}</span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-500" dir="ltr">
                          {scopeKey}
                        </code>
                      </div>
                      <p className="text-[11px] text-slate-500">{info.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* نافذة إضافة ويب هوك جديد */}
      <Modal
        open={hookModalOpen}
        onClose={() => setHookModalOpen(false)}
        title="إضافة ويب هوك شبكي (Outbound Webhook)"
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setHookModalOpen(false)}>
              إلغاء
            </Btn>
            <Btn
              icon={<IconCheck size={14} />}
              disabled={!hookName.trim() || !hookUrl.trim()}
              loading={createHookMut.isPending}
              onClick={() => createHookMut.mutate()}
            >
              حفظ الويب هوك
            </Btn>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Field label="اسم الخدمة المستقبِلة">
            <Input
              value={hookName}
              onChange={e => setHookName(e.target.value)}
              placeholder="مثال: بوت إشعارات المبيعات"
              autoFocus
            />
          </Field>
          <Field label="رابط الاستقبال (Target URL)" hint="يجب أن يبدأ بـ http:// أو https://">
            <Input
              value={hookUrl}
              onChange={e => setHookUrl(e.target.value)}
              placeholder="http://192.168.1.50:8080/webhook"
              dir="ltr"
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="مفتاح التوقيع السري HMAC (اختياري)" hint="يُرسل في ترويسة X-FOT-Signature: sha256=...">
            <Input
              value={hookSecret}
              onChange={e => setHookSecret(e.target.value)}
              placeholder="اتركه فارغاً إذا لم تكن بحاجة لتوقيع HMAC"
              dir="ltr"
              className="font-mono text-[12.5px]"
            />
          </Field>
          <div>
            <span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">الأحداث المطلوب إرسالها</span>
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              {WEBHOOK_EVENTS.map(ev => {
                const checked = hookEvents.includes('*') ? ev.id === '*' : hookEvents.includes(ev.id);
                return (
                  <label key={ev.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 text-[12.5px] font-semibold">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        if (ev.id === '*') {
                          setHookEvents(['*']);
                          return;
                        }
                        setHookEvents(prev => {
                          const base = prev.filter(x => x !== '*');
                          if (base.includes(ev.id)) {
                            const next = base.filter(x => x !== ev.id);
                            return next.length === 0 ? ['*'] : next;
                          }
                          return [...base, ev.id];
                        });
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    />
                    <span>{ev.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
export default ApiPlatformPage;
