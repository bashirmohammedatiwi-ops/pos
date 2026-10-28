import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { TeamNetworkDto, WifiScanDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { IconRefresh } from '@/components/icons';
import { Badge, Btn, Checkbox, Modal } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * البحث عن شبكات المحل: هذا الجهاز (لوحة التحكم المكتبية) يطلب من ويندوز بحثاً جديداً،
 * وإلا يبحث سيرفر المحل. تختار الشبكة كاملة فتُضاف بكل نقاط بثها (راوتر + مقويات + النطاقان)،
 * والشبكة المضافة سابقاً تُحدَّث بالنقاط الجديدة. عنوان الإنترنت يتبع عنوان المحل تلقائياً.
 * ───────────────────────────────────────────────────────────────────────────── */

type ScanNet = WifiScanDto['networks'][number];
type Row = { key: string; ssid: string; auth?: string | null; aps: ScanNet['accessPoints']; best: number; existing?: TeamNetworkDto; fresh: string[] };

function SignalBars({ value }: { value?: number | null }) {
  const v = value ?? 0;
  const level = v >= 75 ? 4 : v >= 50 ? 3 : v >= 25 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-[2px]" title={`${v}%`} aria-label={`الإشارة ${v}%`}>
      {[1, 2, 3, 4].map(i => (
        <span key={i} className={`w-[3px] rounded-sm ${i <= level ? 'bg-emerald-500' : 'bg-slate-200'}`} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  );
}

async function scan(): Promise<WifiScanDto> {
  // لوحة التحكم المكتبية تبحث من جهازها (بصلاحيات المستخدم)؛ وإلا — أو إن لم يكن فيه واي فاي — يبحث سيرفر المحل
  const local = await window.fotDesktop?.wifiScan?.().catch(() => null);
  if (local && local.networks.length) return local;
  try {
    const remote = await api.teamWifiScan();
    if (remote.networks.length || !local) return remote;
  } catch (e) {
    if (!local) throw e;
  }
  return local!;
}

export function WifiScanModal({
  open,
  onClose,
  existing,
  shopIp,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  existing: TeamNetworkDto[];
  shopIp?: string | null;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<'scanning' | 'ready' | 'error'>('scanning');
  const [result, setResult] = useState<WifiScanDto | null>(null);
  const [failure, setFailure] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const runId = useRef(0);
  // لقطة من الشبكات الحالية عند الفتح — لا تتغير القائمة أثناء الاختيار
  const existingRef = useRef(existing);

  async function run() {
    const id = ++runId.current;
    setPhase('scanning');
    setFailure('');
    setExpanded(null);
    try {
      const r = await scan();
      if (id !== runId.current) return;
      setResult(r);
      setPhase(r.networks.length ? 'ready' : 'error');
      if (!r.networks.length) setFailure(r.error || 'لا شبكات ظاهرة الآن');
    } catch (e) {
      if (id !== runId.current) return;
      setResult(null);
      setPhase('error');
      setFailure(e instanceof Error ? e.message : 'تعذر البحث عن الشبكات');
    }
  }

  useEffect(() => {
    if (!open) {
      runId.current++;
      return;
    }
    existingRef.current = existing;
    setPicked(new Set());
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // صف لكل شبكة (بالاسم)، مرتبة مرة واحدة حسب أقوى إشارة — ثابتة أثناء الاختيار
  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    const byName = new Map<string, Row>();
    for (const n of result.networks) {
      const key = n.ssid || `hidden:${n.accessPoints[0]?.bssid}`;
      const cur = byName.get(key);
      if (cur) cur.aps = [...cur.aps, ...n.accessPoints.filter(a => !cur.aps.some(x => x.bssid === a.bssid))];
      else byName.set(key, { key, ssid: n.ssid, auth: n.auth, aps: [...n.accessPoints], best: 0, fresh: [] });
    }
    const list = [...byName.values()].map(r => {
      const existingNet = r.ssid ? existingRef.current.find(e => e.ssid === r.ssid || (!e.ssid && e.name === r.ssid)) : undefined;
      const known = new Set(existingRef.current.flatMap(e => e.bssids ?? (e.bssid ? [e.bssid] : [])));
      return {
        ...r,
        aps: [...r.aps].sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0)),
        best: Math.max(...r.aps.map(a => a.signal ?? 0)),
        existing: existingNet,
        fresh: r.aps.map(a => a.bssid).filter(b => !known.has(b)),
      };
    });
    return list.sort((a, b) => Number(!!b.ssid) - Number(!!a.ssid) || b.best - a.best);
  }, [result]);

  // تحديد مسبق: شبكة هذا الجهاز الحالية إن لم تكن مضافة بكاملها
  useEffect(() => {
    const cur = result?.current?.ssid;
    if (phase !== 'ready' || !cur) return;
    const row = rows.find(r => r.ssid === cur);
    if (row && row.fresh.length) setPicked(new Set([row.key]));
  }, [phase, rows, result]);

  const toggle = (key: string, on: boolean) =>
    setPicked(p => {
      const n = new Set(p);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  async function save() {
    const chosen = rows.filter(r => picked.has(r.key) && r.fresh.length);
    if (!chosen.length) return;
    setSaving(true);
    let added = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const r of chosen) {
      try {
        if (r.existing) {
          const before = r.existing.bssids ?? (r.existing.bssid ? [r.existing.bssid] : []);
          await api.saveTeamNetwork(
            { name: r.existing.name, ssid: r.existing.ssid ?? r.ssid, bssids: [...before, ...r.aps.map(a => a.bssid)], ip: r.existing.ip ?? null, isActive: r.existing.isActive },
            r.existing.id,
          );
          updated++;
        } else {
          await api.saveTeamNetwork({ name: r.ssid || 'شبكة مخفية', ssid: r.ssid || null, bssids: r.aps.map(a => a.bssid), ip: null, isActive: true });
          added++;
        }
      } catch (e) {
        errors.push(`${r.ssid || 'شبكة مخفية'}: ${e instanceof Error ? e.message : 'تعذر الحفظ'}`);
      }
    }
    setSaving(false);
    if (added || updated) {
      toast.success([added && `أُضيفت ${added} ${added === 1 ? 'شبكة' : 'شبكات'}`, updated && `حُدّثت ${updated}`].filter(Boolean).join(' · ') + ' — البصمة تعمل منها الآن');
      onAdded();
      onClose();
    }
    if (errors.length) toast.error(errors[0]);
  }

  const pickedRows = rows.filter(r => picked.has(r.key));
  const pickedAps = pickedRows.reduce((s, r) => s + r.aps.length, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="البحث عن شبكات المحل"
      subtitle="اختر شبكة المحل — تُضاف بكل نقاط بثها"
      footer={
        <>
          <Btn variant="ghost" icon={<IconRefresh size={14} />} disabled={phase === 'scanning' || saving} onClick={() => void run()}>
            بحث مجدداً
          </Btn>
          <Btn variant="secondary" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn loading={saving} disabled={!pickedRows.some(r => r.fresh.length) || phase !== 'ready'} onClick={() => void save()}>
            {pickedRows.length ? `حفظ ${pickedRows.length} ${pickedRows.length === 1 ? 'شبكة' : 'شبكات'} (${pickedAps} نقطة بث)` : 'اختر شبكة'}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          <span className="font-semibold">عنوان الإنترنت:</span>
          <span>يتبع عنوان المحل تلقائياً{shopIp ? ' — الحالي ' : ''}</span>
          {shopIp && (
            <span className="num font-bold text-slate-800" dir="ltr">
              {shopIp}
            </span>
          )}
        </div>

        {/* ارتفاع ثابت: لا قفز بين البحث والنتائج */}
        <div className="h-[min(56vh,460px)] overflow-y-auto rounded-lg border border-slate-200">
          {phase === 'scanning' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" aria-hidden />
              <div className="text-[13.5px] font-semibold text-slate-700">جاري البحث عن الشبكات…</div>
              <div className="text-[12px]">يستغرق حتى 6 ثوانٍ</div>
            </div>
          ) : phase === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-[13.5px] font-semibold leading-6 text-amber-800">{failure}</div>
              <p className="text-[12px] leading-5 text-slate-500">
                إن لم يكن في هذا الجهاز واي فاي: من تطبيق المدير داخل المحل ← شبكات المحل ← «التقاط هذه الشبكة».
              </p>
              <Btn size="sm" variant="secondary" icon={<IconRefresh size={14} />} onClick={() => void run()}>
                حاول مجدداً
              </Btn>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map(r => {
                const isCurrent = !!r.ssid && result?.current?.ssid === r.ssid;
                const complete = !!r.existing && !r.fresh.length;
                const on = picked.has(r.key);
                const open = expanded === r.key;
                return (
                  <li key={r.key} className={on ? 'bg-sky-50/60' : complete ? 'bg-slate-50/60' : ''}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Checkbox
                        checked={on || complete}
                        disabled={complete}
                        onChange={v => toggle(r.key, v)}
                        label={
                          <span className="flex min-w-0 flex-col">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[14px] font-bold text-slate-800">{r.ssid || <span className="text-slate-400">شبكة مخفية</span>}</span>
                              {isCurrent && <Badge tone="ok">متصل بها هذا الجهاز</Badge>}
                              {complete ? (
                                <Badge>مضافة</Badge>
                              ) : r.existing ? (
                                <Badge tone="info">مضافة · {r.fresh.length} نقطة جديدة</Badge>
                              ) : null}
                            </span>
                            <span className="text-[11.5px] text-slate-400">
                              {r.aps.length} نقطة بث{r.auth ? ` · ${r.auth}` : ''}
                            </span>
                          </span>
                        }
                      />
                      <span className="ms-auto flex shrink-0 items-center gap-2 text-[11.5px] text-slate-500">
                        <span className="num w-9 text-left">{r.best}%</span>
                        <SignalBars value={r.best} />
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-brand-700 hover:bg-brand-50"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : r.key)}
                        >
                          {open ? 'إخفاء' : 'التفاصيل'}
                        </button>
                      </span>
                    </div>
                    {open && (
                      <div className="mx-3 mb-2.5 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                        {r.aps.map(a => (
                          <div key={a.bssid} className="flex items-center gap-3 px-3 py-1.5 text-[12px]">
                            <span className="num text-slate-700" dir="ltr">
                              {a.bssid}
                            </span>
                            {r.fresh.includes(a.bssid) ? r.existing && <Badge tone="info">جديدة</Badge> : <Badge>مضافة</Badge>}
                            {result?.current?.bssid === a.bssid && <Badge tone="ok">الأقرب</Badge>}
                            <span className="ms-auto flex items-center gap-3 text-slate-500">
                              {a.band && <span dir="ltr">{a.band}</span>}
                              {a.channel != null && <span>قناة {a.channel}</span>}
                              <span className="num w-9 text-left">{a.signal ?? '—'}%</span>
                              <SignalBars value={a.signal} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-[11.5px] leading-5 text-slate-400">
          البحث يرى نقاط البث القريبة من هذا الجهاز فقط. للمقويات البعيدة في أطراف المحل: ابحث من جهاز قريب منها، أو التقطها من تطبيق المدير — تُضاف لنفس الشبكة تلقائياً.
        </p>
      </div>
    </Modal>
  );
}
