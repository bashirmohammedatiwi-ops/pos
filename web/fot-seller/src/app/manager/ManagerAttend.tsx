import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, Empty, ErrorLine, I, Screen, Sheet, Skeleton, clockLabel, toast } from '../kit';
import { haptic, openLocationSettings, readWifi, scanWifi, type WifiScanResult, type WifiState } from '../native';
import { BackBtn } from '../parts';
import { dur, hhmm } from '../screens/Attend';
import { dateShort, dateTiny, managerAttendApi, relTime, useLoad, usePerms, type AttendRec, type BoardRow, type BoardStatus, type ShopNetwork } from '../work';
import { KIND_LABEL } from '../../team';

/* ─────────────────────────────────────────────────────────────────────────────
 * المدير: لوحة الحضور الحيّة (من في الدوام، في استراحة، متأخر، غائب)،
 * تفاصيل كل موظف مع تعديل الوردية وتصحيح الأوقات، وشبكات المحل.
 * ───────────────────────────────────────────────────────────────────────────── */

const STATUS: Record<BoardStatus, { label: string; color: string }> = {
  in: { label: 'في الدوام', color: 'var(--ok)' },
  break: { label: 'في استراحة', color: 'var(--accent)' },
  over: { label: 'تجاوز الاستراحة', color: 'var(--bad)' },
  out: { label: 'انصرف', color: 'var(--ink-4)' },
  off: { label: 'عطلة', color: 'var(--brand-2)' },
  soon: { label: 'لم يبدأ دوامه', color: 'var(--ink-4)' },
  missing: { label: 'لم يحضر', color: 'var(--bad)' },
  absent: { label: 'غائب', color: 'var(--bad)' },
};
type Filter = 'all' | 'in' | 'break' | 'missing' | 'out' | 'off';
const FILTER_OF: Record<Filter, BoardStatus[]> = {
  all: [],
  in: ['in'],
  break: ['break', 'over'],
  missing: ['missing', 'absent', 'soon'],
  out: ['out'],
  off: ['off'],
};

function line(r: BoardRow) {
  const a = r.attendance;
  const ob = a?.breaks.find(b => !b.endAt);
  if (r.status === 'break' && ob) return `في استراحة · باقي ${Math.max(0, Math.ceil((Date.parse(ob.endsAt) - Date.now()) / 60_000))} د`;
  if (r.status === 'over' && ob) return `تجاوز الاستراحة ${Math.max(0, Math.floor((Date.now() - Date.parse(ob.endsAt)) / 60_000))} دقيقة`;
  if (a && r.status === 'in') return `حضر ${clockLabel(a.checkIn)}${a.lateMinutes ? ` · متأخر ${dur(a.lateMinutes)}` : ''}`;
  if (a && r.status === 'out') return `${clockLabel(a.checkIn)} – ${clockLabel(a.checkOut)} · ${hhmm(a.workedMinutes)} ساعة`;
  if (r.status === 'off') return r.day?.reason === 'weekly' ? 'عطلة أسبوعية' : 'في إجازة';
  if (r.status === 'soon') return `دوامه ${r.shift.start}`;
  return `لم يسجّل حضوره — دوامه ${r.shift.start}`;
}

export function MAttend() {
  const { data, err, loading, reload } = useLoad(() => managerAttendApi.board(), ['attend', 'leave']);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<BoardRow | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick(x => x + 1), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const wanted = FILTER_OF[filter];
    const order: BoardStatus[] = ['over', 'missing', 'break', 'in', 'soon', 'out', 'off', 'absent'];
    return (wanted.length ? all.filter(r => wanted.includes(r.status)) : all).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [data, filter]);
  const c = data?.counts;

  return (
    <Screen title="الحضور اليوم" subtitle={data ? `${dateShort(data.date)} · يتحدث لحظياً` : 'لوحة حيّة'} onRefresh={reload}>
      {data && data.network.enforced && data.network.count === 0 && (
        <Link to="/m/networks" className="t-net bad press" style={{ marginBottom: 12 }}>
          <I.info size={16} /> لم تُضبط شبكات المحل — الموظفون لا يستطيعون البصمة
          <span style={{ marginInlineStart: 'auto', fontWeight: 700 }}>ضبطها</span>
        </Link>
      )}
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={300} r={20} />
      ) : data && c ? (
        <>
          <div className="t-board-counts">
            {(
              [
                ['in', 'في الدوام', c.in],
                ['break', 'استراحة', c.break],
                ['missing', 'لم يحضر', c.missing + c.soon],
                ['out', 'انصرف', c.out],
              ] as [Filter, string, number][]
            ).map(([k, l, n]) => (
              <button
                key={k}
                type="button"
                className={`press ${filter === k ? 'on' : ''}`}
                onClick={() => {
                  haptic('select');
                  setFilter(f => (f === k ? 'all' : k));
                }}
              >
                <b className="num" style={k === 'break' && c.over ? { color: 'var(--bad)' } : undefined}>
                  {n}
                </b>
                {l}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, fontSize: 12.5, color: 'var(--ink-3)' }}>
            {c.late > 0 && <Badge tone="warn">{c.late} متأخر اليوم</Badge>}
            {c.over > 0 && <Badge tone="bad">{c.over} تجاوز الاستراحة</Badge>}
            {c.off > 0 && (
              <button type="button" onClick={() => setFilter('off')}>
                <Badge tone="mute">{c.off} في عطلة</Badge>
              </button>
            )}
          </div>
          <div className="t-list" style={{ marginTop: 12 }}>
            {rows.length === 0 && <Empty title="لا أحد في هذه الحالة" />}
            {rows.map(r => (
              <button
                key={r.staffId}
                type="button"
                className="t-row press-soft"
                onClick={() => {
                  haptic('tap');
                  setOpen(r);
                }}
              >
                <Avatar name={r.name} size="sm" />
                <div className="body">
                  <div className="title">{r.name}</div>
                  <div className="sub" style={r.status === 'over' || r.status === 'missing' ? { color: 'var(--bad)' } : undefined}>
                    {line(r)}
                  </div>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
                  <span className="t-status-dot" style={{ background: STATUS[r.status].color }} />
                  {STATUS[r.status].label}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <StaffAttendSheet row={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />
    </Screen>
  );
}

const toLocalInput = (iso?: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(11, 16) : '');
const iraqDay = (ms: number) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
const atHm = (ms: number, hm: string) => Date.parse(`${iraqDay(ms)}T${hm}:00+03:00`);
/** الساعة hm الأقرب إلى الحضور الأصلي (حضور 23:45 لوردية 00:30 يبقى في يومه) */
const nearestHm = (ref: number, hm: string) => [-86_400_000, 0, 86_400_000].map(d => atHm(ref, hm) + d).reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
/** أول hm بعد الحضور: انصراف بعد منتصف الليل في الوردية الليلية = اليوم التالي */
const afterHm = (ref: number, hm: string) => (atHm(ref, hm) > ref ? atHm(ref, hm) : atHm(ref, hm) + 86_400_000);

function StaffAttendSheet({ row, onClose, onChanged }: { row: BoardRow | null; onClose: () => void; onChanged: () => void }) {
  const perms = usePerms();
  const [shift, setShift] = useState({ start: '', end: '', breakMinutes: '', maxBreaks: '' });
  const [fix, setFix] = useState({ in: '', out: '', note: '' });
  const [busy, setBusy] = useState('');
  const from = new Date(Date.now() - 13 * 86_400_000 + 3 * 3600e3).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const hist = useLoad<AttendRec[] | null>(() => (row ? managerAttendApi.log(from, to, row.staffId) : Promise.resolve(null)), ['attend'], [row?.staffId]);

  useEffect(() => {
    if (!row) return;
    setShift({ start: row.shift.start, end: row.shift.end, breakMinutes: String(row.shift.breakMinutes), maxBreaks: String(row.shift.maxBreaks) });
    setFix({ in: toLocalInput(row.attendance?.checkIn), out: toLocalInput(row.attendance?.checkOut), note: '' });
  }, [row]);

  async function saveShift() {
    if (!row) return;
    setBusy('shift');
    try {
      await managerAttendApi.setShift(row.staffId, { start: shift.start, end: shift.end, breakMinutes: Number(shift.breakMinutes), maxBreaks: Number(shift.maxBreaks) });
      haptic('success');
      toast('حُفظت الوردية');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy('');
    }
  }
  async function saveFix() {
    if (!row?.attendance) return;
    setBusy('fix');
    try {
      const inMs = fix.in ? nearestHm(Date.parse(row.attendance.checkIn), fix.in) : Date.parse(row.attendance.checkIn);
      await managerAttendApi.correct(row.attendance.id, {
        checkIn: fix.in ? new Date(inMs).toISOString() : undefined,
        checkOut: fix.out ? new Date(afterHm(inMs, fix.out)).toISOString() : undefined,
        note: fix.note || 'تصحيح من المدير',
      });
      haptic('success');
      toast('صُحّح السجل — يظهر «معدّل» للموظف');
      onChanged();
      void hist.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر التصحيح');
    } finally {
      setBusy('');
    }
  }

  const a = row?.attendance;
  return (
    <Sheet open={!!row} onClose={onClose} title={row?.name} subtitle={row ? `${KIND_LABEL[row.kind] ?? row.kind} · ${STATUS[row.status].label}` : ''}>
      {row && (
        <div className="t-form">
          {a ? (
            <div className="t-stats">
              <div className="t-stat">
                <span>الحضور</span>
                <b className="num">{clockLabel(a.checkIn)}</b>
                <em>{a.lateMinutes ? `متأخر ${dur(a.lateMinutes)}` : 'في الموعد'}</em>
              </div>
              <div className="t-stat">
                <span>العمل</span>
                <b className="num ltr">{hhmm(a.workedMinutes)}</b>
                <em>{a.overtimeMinutes ? `+${dur(a.overtimeMinutes)} أوفر تايم` : a.checkOut ? `انصرف ${clockLabel(a.checkOut)}` : 'مستمر'}</em>
              </div>
              <div className="t-stat">
                <span>الاستراحة</span>
                <b className="num">{a.breakMinutes} د</b>
                <em>{a.overMinutes ? `تجاوز ${a.overMinutes} د` : `${a.breaks.length} مرات`}</em>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13.5 }}>
              لم يسجّل حضوراً اليوم. دوامه {row.shift.start} – {row.shift.end}.
            </p>
          )}

          {a && perms.editAttendance && (
            <div className="t-card pad" style={{ display: 'grid', gap: 10 }}>
              <b style={{ fontSize: 14 }}>تصحيح أوقات اليوم</b>
              <div className="t-row-2">
                <label className="t-field">
                  <span>الحضور</span>
                  <input className="t-input sm" type="time" value={fix.in} onChange={e => setFix(f => ({ ...f, in: e.target.value }))} />
                </label>
                <label className="t-field">
                  <span>الانصراف</span>
                  <input className="t-input sm" type="time" value={fix.out} onChange={e => setFix(f => ({ ...f, out: e.target.value }))} />
                </label>
              </div>
              <input className="t-input sm" placeholder="سبب التصحيح" value={fix.note} onChange={e => setFix(f => ({ ...f, note: e.target.value }))} />
              <button type="button" className="t-btn soft sm press" disabled={busy === 'fix'} onClick={() => void saveFix()}>
                {busy === 'fix' ? 'جارٍ الحفظ…' : 'حفظ التصحيح'}
              </button>
            </div>
          )}

          {perms.editAttendance && (
          <div className="t-card pad" style={{ display: 'grid', gap: 10 }}>
            <b style={{ fontSize: 14 }}>الوردية والاستراحة{row.shift.custom ? '' : ' (الافتراضية)'}</b>
            <div className="t-row-2">
              <label className="t-field">
                <span>البداية</span>
                <input className="t-input sm" type="time" value={shift.start} onChange={e => setShift(s => ({ ...s, start: e.target.value }))} />
              </label>
              <label className="t-field">
                <span>النهاية</span>
                <input className="t-input sm" type="time" value={shift.end} onChange={e => setShift(s => ({ ...s, end: e.target.value }))} />
              </label>
              <label className="t-field">
                <span>دقائق الاستراحة</span>
                <input className="t-input sm num" inputMode="numeric" value={shift.breakMinutes} onChange={e => setShift(s => ({ ...s, breakMinutes: e.target.value.replace(/\D/g, '') }))} />
              </label>
              <label className="t-field">
                <span>عدد الاستراحات</span>
                <input className="t-input sm num" inputMode="numeric" value={shift.maxBreaks} onChange={e => setShift(s => ({ ...s, maxBreaks: e.target.value.replace(/\D/g, '') }))} />
              </label>
            </div>
            <button type="button" className="t-btn soft sm press" disabled={busy === 'shift'} onClick={() => void saveShift()}>
              {busy === 'shift' ? 'جارٍ الحفظ…' : 'حفظ الوردية'}
            </button>
          </div>
          )}

          <div className="t-field">
            <span>آخر أسبوعين</span>
            {!hist.data ? (
              <Skeleton h={120} r={16} />
            ) : !hist.data.length ? (
              <p className="muted" style={{ fontSize: 13 }}>
                لا سجلات.
              </p>
            ) : (
              <div className="t-list flat">
                {hist.data.map(r => (
                  <div key={r.id} className="t-row">
                    <div className="body">
                      <div className="title">{dateTiny(r.date)}</div>
                      <div className="sub">
                        {clockLabel(r.checkIn)} – {r.checkOut ? clockLabel(r.checkOut) : '—'}
                        {r.autoClosed ? ' · تلقائي' : ''}
                        {r.edited ? ' · معدّل' : ''}
                      </div>
                    </div>
                    <div className="end">
                      <b className="num ltr">{hhmm(r.workedMinutes)}</b>
                      <small>{r.overtimeMinutes ? `+${dur(r.overtimeMinutes)} أوفر` : r.lateMinutes ? `تأخير ${dur(r.lateMinutes)}` : 'منضبط'}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** ملخص الحضور في رئيسية المدير */
export function AttendSummary() {
  const { data } = useLoad(() => managerAttendApi.board(), ['attend']);
  if (!data) return null;
  const c = data.counts;
  const alert = c.over + c.missing;
  return (
    <Link to="/m/attend" className="t-card pad press" style={{ display: 'block', marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ fontSize: 15 }}>الحضور الآن</b>
        {alert > 0 ? <Badge tone="bad">{alert} يحتاج انتباهك</Badge> : <Badge tone="ok">كل شيء منتظم</Badge>}
      </div>
      <div className="t-board-counts" style={{ marginTop: 12 }}>
        {(
          [
            ['في الدوام', c.in, 'var(--ok)'],
            ['استراحة', c.break, c.over ? 'var(--bad)' : 'var(--accent)'],
            ['لم يحضر', c.missing, c.missing ? 'var(--bad)' : undefined],
            ['انصرف', c.out, undefined],
          ] as [string, number, string | undefined][]
        ).map(([l, n, color]) => (
          <span key={l} className="t-stat" style={{ textAlign: 'center', padding: '10px 4px' }}>
            <b className="num" style={color ? { color } : undefined}>
              {n}
            </b>
            <span>{l}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

/* ═════════════ شبكات المحل ═════════════ */
/* البحث عن الشبكات القريبة من هاتف المدير وإضافة شبكة المحل بكل نقاط بثها */
const signalPct = (dbm: number) => Math.max(0, Math.min(100, Math.round((dbm + 100) * 2)));
function NetScanSheet({
  open,
  networks,
  current,
  legacy,
  ip,
  onClose,
  onSaved,
}: {
  open: boolean;
  networks: ShopNetwork[];
  current?: string | null;
  /** خادم الفريق على الـ VPS قديم: كل نقطة بث تُحفظ منفصلة مع عنوان المحل */
  legacy: boolean;
  /** عنوان إنترنت المحل كما يراه الخادم من هاتف المدير */
  ip?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [res, setRes] = useState<WifiScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState('');

  async function run() {
    setScanning(true);
    setRes(await scanWifi());
    setScanning(false);
  }
  useEffect(() => {
    if (open) void run();
    else setRes(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const known = new Set(networks.flatMap(n => n.bssids ?? (n.bssid ? [n.bssid] : [])));
  const groups = (() => {
    const map = new Map<string, { ssid: string; aps: WifiScanResult['networks'] }>();
    for (const n of res?.networks ?? []) {
      if (!n.ssid) continue;
      const g = map.get(n.ssid) ?? { ssid: n.ssid, aps: [] };
      if (!g.aps.some(a => a.bssid === n.bssid)) g.aps.push(n);
      map.set(n.ssid, g);
    }
    return [...map.values()]
      .map(g => ({ ...g, best: Math.max(...g.aps.map(a => a.level)), fresh: g.aps.filter(a => !known.has(a.bssid)).length, existing: networks.find(n => n.ssid === g.ssid) }))
      .sort((a, b) => Number(b.ssid === current) - Number(a.ssid === current) || b.best - a.best);
  })();

  async function add(g: (typeof groups)[number]) {
    setSaving(g.ssid);
    try {
      const bssids = g.aps.map(a => a.bssid);
      if (legacy) {
        // الخادم القديم يفهم BSSID واحداً لكل شبكة: نقطة بث = سطر، مع عنوان المحل
        const fresh = bssids.filter(b => !known.has(b));
        for (const b of fresh) {
          await managerAttendApi.saveNetwork({ name: bssids.length > 1 || g.existing ? `${g.ssid} · ${b.slice(-5)}` : g.ssid, ssid: g.ssid, bssid: b, ip: ip ?? null });
        }
      } else if (g.existing) {
        const before = g.existing.bssids ?? (g.existing.bssid ? [g.existing.bssid] : []);
        await managerAttendApi.saveNetwork({ name: g.existing.name, ssid: g.ssid, bssids: [...before, ...bssids], ip: g.existing.ip ?? null, isActive: g.existing.isActive }, g.existing.id);
      } else {
        await managerAttendApi.saveNetwork({ name: g.ssid, ssid: g.ssid, bssids });
      }
      haptic('success');
      toast(g.existing ? `حُدّثت «${g.ssid}» — ${g.fresh} نقطة جديدة` : `أُضيفت «${g.ssid}» بـ ${bssids.length} نقطة بث`);
      onSaved();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setSaving('');
    }
  }

  const blocked = res && (res.permission === 'denied' || res.locationEnabled === false);
  return (
    <Sheet open={open} onClose={onClose} title="الشبكات القريبة" subtitle="اختر شبكة المحل — تُضاف بكل نقاط بثها">
      {scanning ? (
        <div className="t-scan-wait">
          <span className="spinner" />
          <b>جاري البحث عن الشبكات…</b>
          <small>بضع ثوانٍ</small>
        </div>
      ) : blocked ? (
        <div className="t-scan-wait">
          <b>{res?.permission === 'denied' ? 'اسمح للتطبيق بالموقع' : 'شغّل خدمة الموقع'}</b>
          <small>أندرويد لا يعرض شبكات الواي فاي دون إذن الموقع</small>
          <button type="button" className="t-btn sm press" onClick={() => void openLocationSettings()}>
            فتح الإعدادات
          </button>
        </div>
      ) : !groups.length ? (
        <div className="t-scan-wait">
          <b>لا شبكات ظاهرة</b>
          <small>تأكد أن الواي فاي مفعّل ثم أعد البحث</small>
        </div>
      ) : (
        <div className="t-list">
          {groups.map(g => {
            const complete = !!g.existing && !g.fresh;
            return (
              <div key={g.ssid} className="t-row">
                <span className={`t-tile ${complete ? 'ok' : g.ssid === current ? 'accent' : 'mute'}`}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" />
                    <circle cx="12" cy="19.3" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <div className="body">
                  <div className="title">
                    {g.ssid} {g.ssid === current && <Badge tone="ok">متصل</Badge>}
                  </div>
                  <div className="sub">
                    {g.aps.length} نقطة بث · إشارة {signalPct(g.best)}%{g.existing && g.fresh ? ` · ${g.fresh} جديدة` : ''}
                  </div>
                </div>
                {complete ? (
                  <Badge tone="ok">مضافة</Badge>
                ) : (
                  <button type="button" className="t-btn sm press" disabled={!!saving} onClick={() => void add(g)}>
                    {saving === g.ssid ? <span className="spinner" /> : g.existing ? 'تحديث' : 'إضافة'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!scanning && (
        <button type="button" className="t-btn plain block sm press" style={{ marginTop: 12 }} onClick={() => void run()}>
          بحث مجدداً
        </button>
      )}
    </Sheet>
  );
}

export function MNetworks() {
  const perms = usePerms();
  const { data, err, reload } = useLoad(() => managerAttendApi.settings(), []);
  const [wifi, setWifi] = useState<WifiState | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; ip: string; network: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  async function scan() {
    const w = await readWifi();
    setWifi(w);
    try {
      setProbe(await managerAttendApi.probe(w.bssid));
    } catch {
      setProbe(null);
    }
  }
  useEffect(() => {
    void scan();
  }, []);

  async function capture() {
    setBusy(true);
    try {
      const w = await readWifi();
      await managerAttendApi.capture({ bssid: w.bssid, ssid: w.ssid, name: w.ssid || 'واي فاي المحل' });
      haptic('success');
      toast('أُضيفت نقطة البث لشبكة المحل — البصمة تعمل منها الآن');
      void reload();
      void scan();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الالتقاط');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await managerAttendApi.deleteNetwork(id);
      haptic('success');
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  const s = data?.settings;
  return (
    <Screen title="شبكات المحل" subtitle="البصمة مسموحة من هذه الشبكات فقط" start={<BackBtn to="/m/more" />} onRefresh={reload}>
      <section className="t-attend live">
        <span className="label">شبكتك الآن</span>
        <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>{wifi?.ssid || (wifi?.permission === 'denied' ? 'لا إذن بالموقع' : 'غير معروفة')}</div>
        <div className="sub num ltr" style={{ textAlign: 'right' }}>
          {wifi?.bssid || '—'} · {probe?.ip || '…'}
        </div>
        <div className="t-net">{probe ? (probe.ok ? `✓ مسجّلة: ${probe.network}` : '✗ ليست ضمن شبكات المحل') : 'جارٍ الفحص…'}</div>
        {perms.editAttendance && (
        <div className="acts">
          <button type="button" className="t-btn white press" disabled={busy} onClick={() => (haptic('tap'), setScanOpen(true))}>
            الشبكات القريبة
          </button>
          <button type="button" className="t-btn glass press" disabled={busy || !wifi?.bssid || !!probe?.ok} onClick={() => void capture()}>
            {busy ? <span className="spinner" /> : 'إضافة شبكتي'}
          </button>
        </div>
        )}
        <p className="sub" style={{ fontSize: 12, lineHeight: 1.7 }}>
          من داخل المحل: «البحث عن الشبكات» يعرض الشبكات حولك، تختار شبكة المحل فتُضاف بكل نقاط بثها. عنوان الإنترنت يتبع المحل تلقائياً.
        </p>
      </section>

      {err && <ErrorLine text={err} onRetry={() => void reload()} />}
      <section className="t-section">
        <div className="t-section-head">
          <h2>الشبكات المسموحة</h2>
          <small>{data ? `${data.networks.length} شبكة` : ''}</small>
        </div>
        {!data ? (
          <Skeleton h={120} r={18} />
        ) : !data.networks.length ? (
          <div className="t-card pad muted" style={{ textAlign: 'center', fontSize: 13.5 }}>
            لا شبكات بعد — التقط شبكة المحل من الأعلى.
          </div>
        ) : (
          <div className="t-list">
            {data.networks.map(n => (
              <div key={n.id} className="t-row">
                <span className={`t-tile ${n.isActive ? 'ok' : 'mute'}`}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" />
                    <circle cx="12" cy="19.3" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <div className="body">
                  <div className="title">{n.name}</div>
                  <div className="sub">
                    {n.bssids?.length ?? (n.bssid ? 1 : 0)} نقطة بث · {n.ip ? <span className="num ltr">IP {n.ip}</span> : 'عنوان المحل تلقائياً'}
                  </div>
                  <div className="sub">
                    {n.createdBy?.replace(/^manager:/, '')} · {relTime(n.createdAt)}
                  </div>
                </div>
                {perms.editAttendance && (
                <button type="button" className="t-icon-btn ghost press" aria-label="حذف" onClick={() => void remove(n.id)}>
                  <I.close size={18} />
                </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {s && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>قواعد الحضور</h2>
            <small>تُعدَّل من لوحة التحكم</small>
          </div>
          <div className="t-list flat t-card">
            {[
              ['الإلزام بشبكة المحل', s.enforceNetwork ? 'مفعّل' : 'متوقف'],
              ['الدوام الافتراضي', `${s.shiftStart} – ${s.shiftEnd}`],
              ['الاستراحة اليومية', `${s.breakMinutes} دقيقة · ${s.maxBreaks} مرات`],
              ['مهلة التأخير', `${s.graceMinutes} دقيقة`],
              ['الحضور المبكر', `حتى ${s.earlyMinutes} دقيقة قبل الدوام`],
              ['الإغلاق التلقائي', `بعد نهاية الدوام بـ ${s.autoCloseHours} ساعات`],
            ].map(([k, v]) => (
              <div key={k} className="t-row" style={{ minHeight: 48 }}>
                <div className="body">
                  <div className="title" style={{ fontWeight: 500 }}>
                    {k}
                  </div>
                </div>
                <b style={{ fontSize: 13.5 }}>{v}</b>
              </div>
            ))}
          </div>
        </section>
      )}
      <NetScanSheet open={scanOpen} networks={data?.networks ?? []} current={wifi?.ssid} legacy={!!data && !('shopIp' in data)} ip={probe?.ip} onClose={() => setScanOpen(false)} onSaved={() => { void reload(); void scan(); }} />
    </Screen>
  );
}
