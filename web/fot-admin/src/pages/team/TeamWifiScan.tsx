import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import type { TeamNetworkDto, WifiScanDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { IconRefresh } from '@/components/icons';
import { Badge, Btn, Checkbox, Field, Input, Modal, Switch, TableSkeleton } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * البحث عن شبكات المحل: جهاز السيرفر (داخل المحل) يقرأ شبكات الواي فاي المحيطة،
 * وخادم الفريق يخبرنا بعنوان الإنترنت العام للمحل. يختار المدير ما يخص المحل
 * فتُضاف كل نقطة بث (BSSID) كقاعدة جاهزة مع العنوان، دون كتابة شيء يدوياً.
 * ───────────────────────────────────────────────────────────────────────────── */

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

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

export function WifiScanModal({ open, onClose, existing, onAdded }: { open: boolean; onClose: () => void; existing: TeamNetworkDto[]; onAdded: () => void }) {
  const toast = useToast();
  const [scan, setScan] = useState<WifiScanDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ip, setIp] = useState('');
  const [ipNote, setIpNote] = useState<string | null>(null);
  const [withIp, setWithIp] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const known = useMemo(() => new Set(existing.map(n => n.bssid?.toLowerCase()).filter(Boolean) as string[]), [existing]);

  async function run() {
    setLoading(true);
    setFailure(null);
    // لوحة التحكم المكتبية تبحث من جهازها (بصلاحيات المستخدم)؛ وإلا — أو إن لم يكن فيه واي فاي — يبحث سيرفر المحل
    const scanBoth = async (): Promise<WifiScanDto> => {
      const local = await window.fotDesktop?.wifiScan?.().catch(() => null);
      if (local && local.networks.length) return local;
      try {
        const remote = await api.teamWifiScan();
        if (remote.networks.length || !local) return remote;
      } catch (e) {
        if (!local) throw e;
      }
      return local!;
    };
    const [s, w] = await Promise.allSettled([scanBoth(), api.teamShopIp()]);
    if (s.status === 'fulfilled') {
      setScan(s.value);
      // تحديد مسبق: شبكة السيرفر الحالية = واي فاي المحل غالباً
      const cur = s.value.current?.ssid;
      const pre = new Set<string>();
      for (const n of s.value.networks) if (cur && n.ssid === cur) for (const a of n.accessPoints) if (!known.has(a.bssid)) pre.add(a.bssid);
      setPicked(pre);
      setNames(Object.fromEntries(s.value.networks.map(n => [n.ssid, n.ssid || 'واي فاي المحل'])));
    } else {
      setScan(null);
      setFailure(s.reason instanceof Error ? s.reason.message : 'تعذر البحث عن الشبكات');
    }
    if (w.status === 'fulfilled') {
      setIp(w.value.ip);
      setIpNote(PRIVATE_IP.test(w.value.ip) ? 'العنوان المقروء داخلي — أدخل عنوان إنترنت المحل يدوياً أو التقطه من تطبيق المدير' : null);
    } else {
      setIpNote('تعذر قراءة عنوان الإنترنت من خادم الفريق — حدّث الـ VPS أو أدخله يدوياً');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (open) void run();
    else {
      setScan(null);
      setPicked(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (bssid: string, on: boolean) =>
    setPicked(p => {
      const n = new Set(p);
      if (on) n.add(bssid);
      else n.delete(bssid);
      return n;
    });

  async function add() {
    if (!scan) return;
    const list = scan.networks.flatMap(n => n.accessPoints.filter(a => picked.has(a.bssid)).map(a => ({ n, a })));
    if (!list.length) return;
    setSaving(true);
    let ok = 0;
    const errors: string[] = [];
    for (const { n, a } of list) {
      const base = (names[n.ssid] || n.ssid || 'واي فاي المحل').trim();
      const many = n.accessPoints.filter(x => picked.has(x.bssid)).length > 1;
      const name = many ? `${base} · ${a.band ?? `قناة ${a.channel ?? '?'}`} · ${a.bssid.slice(-5)}` : base;
      try {
        await api.saveTeamNetwork({ name, bssid: a.bssid, ip: withIp && ip.trim() ? ip.trim() : null, ssid: n.ssid || null, isActive: true });
        ok++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : a.bssid);
      }
    }
    setSaving(false);
    if (ok) {
      toast.success(`أُضيفت ${ok} ${ok === 1 ? 'شبكة' : ok === 2 ? 'شبكتان' : 'شبكات'} — البصمة تعمل منها الآن`);
      onAdded();
      onClose();
    }
    if (errors.length) toast.error(errors[0]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="البحث عن شبكات المحل"
      subtitle="الشبكات التي يراها جهاز السيرفر داخل المحل الآن"
      footer={
        <>
          <Btn variant="ghost" icon={<IconRefresh size={14} />} disabled={loading} onClick={() => void run()}>
            بحث مجدداً
          </Btn>
          <Btn variant="secondary" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn loading={saving} disabled={!picked.size} onClick={() => void add()}>
            إضافة المحدد ({picked.size})
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="عنوان الإنترنت العام للمحل" hint={ipNote ?? 'قرأه خادم الفريق تلقائياً — يمنع البصمة من خارج المحل حتى لو عُرف BSSID'}>
            <Input
              dir="ltr"
              value={ip}
              disabled={!withIp}
              onChange={e => {
                setIp(e.target.value);
                setIpNote(PRIVATE_IP.test(e.target.value.trim()) ? 'هذا عنوان داخلي — البصمة تحتاج عنوان إنترنت المحل العام' : null);
              }}
              placeholder="5.6.7.8"
            />
          </Field>
          <Switch label="ربط الشبكات بالعنوان" checked={withIp} onChange={setWithIp} />
        </div>
        {!withIp && (
          <div className="rounded-lg bg-amber-50 p-2.5 text-[12px] font-semibold leading-5 text-amber-800">
            بدون العنوان يكفي إرسال BSSID لتسجيل الحضور — وهو سهل التزوير. إن كان «اشتراط عنوان الإنترنت» مفعّلاً فلن تُقبل هذه الشبكات.
          </div>
        )}

        {loading ? (
          <TableSkeleton rows={5} />
        ) : failure ? (
          <div className="rounded-lg bg-red-50 p-3 text-[12.5px] font-semibold text-red-700">{failure}</div>
        ) : scan?.error ? (
          <div className="rounded-lg bg-amber-50 p-3 text-[12.5px] font-semibold leading-6 text-amber-800">{scan.error}</div>
        ) : scan && !scan.networks.length ? (
          <div className="p-6 text-center text-[13px] text-slate-500">لا شبكات ظاهرة الآن.</div>
        ) : (
          scan && (
            <div className="max-h-[52vh] space-y-2 overflow-auto">
              {scan.networks.map(n => {
                const isCurrent = !!scan.current?.ssid && scan.current.ssid === n.ssid;
                const anyPicked = n.accessPoints.some(a => picked.has(a.bssid));
                return (
                  <section key={n.ssid + n.accessPoints[0]?.bssid} className={`rounded-lg border ${anyPicked ? 'border-sky-300 bg-sky-50/40' : 'border-slate-200'}`}>
                    <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                      <span className="text-[14px] font-bold text-slate-800">{n.ssid || <span className="text-slate-400">شبكة مخفية</span>}</span>
                      {isCurrent && <Badge tone="ok">متصل بها السيرفر</Badge>}
                      {n.auth && <span className="text-[11px] text-slate-400">{n.auth}</span>}
                      <span className="ms-auto text-[11.5px] text-slate-500">{n.accessPoints.length} نقطة بث</span>
                      {anyPicked && (
                        <Input
                          className="!h-7 w-44 text-[12px]"
                          value={names[n.ssid] ?? ''}
                          onChange={e => setNames(x => ({ ...x, [n.ssid]: e.target.value }))}
                          placeholder="اسم الشبكة"
                          aria-label="اسم الشبكة في القائمة"
                        />
                      )}
                    </header>
                    <div className="divide-y divide-slate-100">
                      {n.accessPoints.map(a => {
                        const added = known.has(a.bssid);
                        return (
                          <div key={a.bssid} className="flex items-center gap-3 px-3 py-1.5">
                            <Checkbox
                              checked={added || picked.has(a.bssid)}
                              disabled={added}
                              onChange={v => toggle(a.bssid, v)}
                              label={
                                <span className="num text-[12.5px] text-slate-700" dir="ltr">
                                  {a.bssid}
                                </span>
                              }
                            />
                            {scan.current?.bssid === a.bssid && <Badge tone="info">الأقرب</Badge>}
                            {added && <Badge>مضافة</Badge>}
                            <span className="ms-auto flex items-center gap-3 text-[11.5px] text-slate-500">
                              {a.band && <span dir="ltr">{a.band}</span>}
                              {a.channel != null && <span>قناة {a.channel}</span>}
                              <span className="num w-9 text-left">{a.signal ?? '—'}%</span>
                              <SignalBars value={a.signal} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )
        )}
        <p className="text-[11.5px] leading-5 text-slate-400">
          للمحلات بأكثر من جهاز بث (راوتر + مقويات) اختر كل نقاط شبكة المحل حتى تُقبل البصمة من أي مكان فيه. إن لم يكن في جهاز السيرفر واي فاي، استخدم «التقاط هذه الشبكة» من تطبيق المدير.
        </p>
      </div>
    </Modal>
  );
}
