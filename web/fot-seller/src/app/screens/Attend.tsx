import { useEffect, useRef, useState } from 'react';
import { deviceInfo } from '../../team';
import { Badge, I, Skeleton, clockLabel, toast } from '../kit';
import {
  cancelBreakAlarms,
  haptic,
  openLocationSettings,
  openWifiSettings,
  readWifi,
  scheduleBreakAlarms,
  scheduleShiftReminders,
  type WifiState,
} from '../native';
import { attendApi, dateShort, useLoad, type AttendRec, type AttendState } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * الحضور والانصراف والاستراحة — من شبكة المحل فقط (يتحقق الخادم من BSSID و IP).
 * عدّاد حي للاستراحة، ومنبّه محلي قبل نهايتها وعندها يعمل والتطبيق مغلق.
 * ───────────────────────────────────────────────────────────────────────────── */

const two = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${two(min % 60)}`;
/** مدة مقروءة: «25 د» أو «2 س 10 د» */
export const dur = (min: number) => (min < 60 ? `${min} د` : `${Math.floor(min / 60)} س${min % 60 ? ` ${min % 60} د` : ''}`);
const iraqAt = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+03:00`);

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => set(x => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/** حالة الشبكة الحالية: يقرأ الواي فاي ويسأل الخادم إن كانت شبكة المحل. */
function useNetwork(enabled: boolean) {
  const [wifi, setWifi] = useState<WifiState | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; network: string | null; error: string | null } | null>(null);
  const check = async () => {
    const w = await readWifi();
    setWifi(w);
    try {
      setProbe(await attendApi.probe(w.bssid));
    } catch {
      setProbe(null);
    }
    return w;
  };
  useEffect(() => {
    if (!enabled) return;
    void check();
    const id = window.setInterval(() => void check(), 30_000);
    const vis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { wifi, probe, check };
}

function NetLine({ wifi, probe, onRetry }: { wifi: WifiState | null; probe: { ok: boolean; network: string | null; error: string | null } | null; onRetry: () => void }) {
  if (wifi?.permission === 'denied')
    return (
      <div className="t-net bad">
        <I.info size={16} /> اسمح للتطبيق بالموقع لقراءة شبكة المحل
        <button type="button" onClick={() => void openLocationSettings()}>
          الإعدادات
        </button>
      </div>
    );
  if (wifi && wifi.locationEnabled === false)
    return (
      <div className="t-net bad">
        <I.info size={16} /> شغّل خدمة الموقع (GPS) لقراءة الواي فاي
        <button type="button" onClick={() => void openLocationSettings()}>
          تشغيل
        </button>
      </div>
    );
  if (!probe) return <div className="t-net">جارٍ فحص الشبكة…</div>;
  if (probe.ok)
    return (
      <div className="t-net ok">
        <I.check size={15} /> متصل بشبكة المحل{probe.network ? ` · ${probe.network}` : ''}
      </div>
    );
  return (
    <div className="t-net bad">
      <I.info size={16} /> {wifi?.ssid ? `${wifi.ssid} — ` : ''}ليست شبكة المحل
      <button type="button" onClick={() => (wifi?.wifiEnabled === false ? void openWifiSettings() : onRetry())}>
        {wifi?.wifiEnabled === false ? 'الواي فاي' : 'إعادة'}
      </button>
    </div>
  );
}

export function AttendCard({ compact }: { compact?: boolean }) {
  const { data, err, reload, setData } = useLoad(() => attendApi.state(), ['attend']);
  const [busy, setBusy] = useState('');
  const net = useNetwork(!!data && (!data.attendance?.checkOut || !!data.openBreak));
  const ob = data?.openBreak ?? null;
  useTick(!!data?.attendance && !data.attendance.checkOut);
  const scheduled = useRef('');
  // فرق ساعة الهاتف عن ساعة الخادم: العداد والمنبّه يتبعان وقت الخادم حتى لو كانت ساعة الهاتف خاطئة
  const skew = useRef(0);
  useEffect(() => {
    if (data?.now) skew.current = Date.parse(data.now) - Date.now();
  }, [data]);
  const nowMs = () => Date.now() + skew.current;

  // منبّه الاستراحة وتذكير الدوام (مرة لكل حالة)
  useEffect(() => {
    if (!data) return;
    const key = `${data.attendance?.id ?? 0}:${ob?.id ?? 0}:${data.attendance?.checkOut ?? ''}`;
    if (scheduled.current === key) return;
    scheduled.current = key;
    if (ob) void scheduleBreakAlarms(new Date(Date.parse(ob.endsAt) - skew.current).toISOString(), data.breakWarnMinutes ?? 2);
    else void cancelBreakAlarms();
    const off = data.day?.off;
    void scheduleShiftReminders({
      startAt: !data.attendance && !off ? iraqAt(data.today, data.shift.start) - 5 * 60_000 : null,
      endAt: data.attendance && !data.attendance.checkOut ? iraqAt(data.today, data.shift.end) : null,
    });
  }, [data, ob]);

  async function act(action: 'in' | 'out' | 'break/start' | 'break/end') {
    if (busy) return;
    haptic('tap');
    setBusy(action);
    try {
      const w = await net.check();
      if (w.permission === 'denied' && data?.network.needsBssid) {
        toast('اسمح للتطبيق بالموقع أولاً لقراءة واي فاي المحل');
        return;
      }
      const dev = await deviceInfo();
      const next = await attendApi.act(action, w.bssid, dev.deviceId);
      setData(next);
      haptic('success');
      toast(
        action === 'in'
          ? next.attendance?.lateMinutes
            ? `سُجّل حضورك — متأخر ${dur(next.attendance.lateMinutes)}`
            : 'سُجّل حضورك — يوم موفق ✨'
          : action === 'out'
            ? 'سُجّل انصرافك — شكراً لجهودك'
            : action === 'break/start'
              ? `بدأت استراحتك — ${next.openBreak?.plannedMinutes ?? ''} دقيقة`
              : 'أهلاً بعودتك',
      );
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر التسجيل');
      void net.check();
    } finally {
      setBusy('');
    }
  }

  if (err && !data)
    return (
      <div className="t-attend">
        <div className="t-net bad">
          <I.info size={16} /> {err}
          <button type="button" onClick={() => void reload()}>
            إعادة
          </button>
        </div>
      </div>
    );
  if (!data) return <Skeleton h={compact ? 150 : 300} r={26} />;

  const a = data.attendance;
  const s = data.shift;
  const netLine = <NetLine wifi={net.wifi} probe={net.probe} onRetry={() => void net.check()} />;

  // في استراحة: عداد تنازلي حي
  if (a && !a.checkOut && ob) {
    const end = Date.parse(ob.endsAt);
    const left = (end - nowMs()) / 1000;
    const over = left < 0;
    const total = ob.plannedMinutes * 60;
    const frac = over ? 1 : Math.max(0, Math.min(1, 1 - left / total));
    const R = 84;
    const C = 2 * Math.PI * R;
    const abs = Math.abs(left);
    return (
      <section className={`t-attend ${over ? 'over' : 'on-break'}`}>
        <div className="row">
          <span className="label">{over ? 'تجاوزت وقت الاستراحة' : 'في استراحة'}</span>
          <span className="t-chip-glass">
            <I.coffee size={14} /> بدأت {clockLabel(ob.startAt)}
          </span>
        </div>
        <div className="t-countdown">
          <svg width="190" height="190" aria-hidden>
            <circle cx="95" cy="95" r={R} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="10" />
            <circle cx="95" cy="95" r={R} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * frac} style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="in">
            <div>
              <b className="num ltr">
                {over ? '+' : ''}
                {two(abs / 60)}:{two(abs % 60)}
              </b>
              <small>{over ? 'دقيقة تجاوز' : `تنتهي ${clockLabel(ob.endsAt)}`}</small>
            </div>
          </div>
        </div>
        <button type="button" className="t-btn white block press" style={{ marginTop: 14 }} disabled={!!busy} onClick={() => void act('break/end')}>
          {busy === 'break/end' ? <span className="spinner" style={{ borderTopColor: '#241245' }} /> : 'انتهت استراحتي — عدت للعمل'}
        </button>
        {netLine}
      </section>
    );
  }

  // في الدوام
  if (a && !a.checkOut) {
    const worked = Math.max(0, Math.round((nowMs() - Date.parse(a.checkIn)) / 60_000) - a.breakMinutes);
    // الأوفر تايم الجاري (للمفعّل لهم): ما زاد على الدوام الصافي
    const net = (() => {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      let len = eh * 60 + em - (sh * 60 + sm);
      if (len <= 0) len += 1440;
      return Math.max(0, len - s.breakMinutes);
    })();
    const otNow = s.overtime ? (data.day?.off ? worked : Math.max(0, worked - net)) : 0;
    return (
      <section className="t-attend live">
        <div className="row">
          <span className="label">في الدوام منذ {clockLabel(a.checkIn)}</span>
          {otNow > 0 ? (
            <span className="t-chip-glass up">أوفر تايم {dur(otNow)}</span>
          ) : a.lateMinutes > 0 ? (
            <span className="t-chip-glass down">متأخر {dur(a.lateMinutes)}</span>
          ) : (
            <span className="t-chip-glass up">في الموعد</span>
          )}
        </div>
        <div className="clock num ltr" style={{ marginTop: 8, textAlign: 'right' }}>
          {hhmm(worked)}
        </div>
        <div className="sub">
          ساعات العمل اليوم · ينتهي دوامك {s.end} · استراحة متبقية {data.breakLeftMinutes} د ({data.breaksLeft} مرات)
        </div>
        <div className="acts">
          <button type="button" className="t-btn glass press" disabled={!!busy || data.breakLeftMinutes <= 0 || data.breaksLeft <= 0} onClick={() => void act('break/start')}>
            {busy === 'break/start' ? <span className="spinner" /> : (
              <>
                <I.coffee size={18} /> استراحة
              </>
            )}
          </button>
          <button type="button" className="t-btn white press" disabled={!!busy} onClick={() => void act('out')}>
            {busy === 'out' ? <span className="spinner" style={{ borderTopColor: '#241245' }} /> : (
              <>
                <I.out size={18} /> انصراف
              </>
            )}
          </button>
        </div>
        {netLine}
      </section>
    );
  }

  // انتهى اليوم
  if (a && a.checkOut) {
    return (
      <section className="t-attend">
        <div className="row">
          <span className="label">انتهى دوامك اليوم</span>
          {a.autoClosed ? <Badge tone="warn">أُغلق تلقائياً</Badge> : <Badge tone="ok">مكتمل</Badge>}
        </div>
        <div className="t-stats" style={{ marginTop: 12 }}>
          <div className="t-stat">
            <span>العمل</span>
            <b className="num ltr">{hhmm(a.workedMinutes)}</b>
          </div>
          <div className="t-stat">
            <span>الاستراحة</span>
            <b className="num">{a.breakMinutes} د</b>
          </div>
          {a.overtimeMinutes ? (
            <div className="t-stat">
              <span>أوفر تايم</span>
              <b className="num">{dur(a.overtimeMinutes)}</b>
            </div>
          ) : (
            <div className="t-stat">
              <span>التأخير</span>
              <b className="num">{a.lateMinutes ? dur(a.lateMinutes) : '—'}</b>
            </div>
          )}
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          حضور {clockLabel(a.checkIn)} · انصراف {clockLabel(a.checkOut)}
          {a.overMinutes ? ` · تجاوز استراحة ${a.overMinutes} د` : ''}
          {a.overtimeMinutes && a.lateMinutes ? ` · تأخير ${dur(a.lateMinutes)}` : ''}
        </p>
      </section>
    );
  }

  // لم يحضر بعد
  const off = data.day?.off;
  return (
    <section className="t-attend" style={{ textAlign: 'center' }}>
      <div className="row">
        <span className="label" style={{ opacity: 1, color: 'var(--ink-3)' }}>
          {off ? 'اليوم عطلتك' : `دوامك ${s.start} – ${s.end}`}
        </span>
        <span className="t-badge mute">استراحة {s.breakMinutes} د</span>
      </div>
      {!data.network.configured && data.network.enforced ? (
        <p className="muted" style={{ margin: '18px 0 6px', fontSize: 13.5, lineHeight: 1.8 }}>
          لم تُضبط شبكات المحل بعد.
          <br />
          تُفعَّل البصمة حين تضيف الإدارة واي فاي المحل.
        </p>
      ) : (
        <button type="button" className="t-punch" disabled={!!busy} onClick={() => void act('in')}>
          <span>
            {busy === 'in' ? <span className="spinner" style={{ width: 30, height: 30 }} /> : <I.store size={40} />}
            <b>تسجيل الحضور</b>
            <small>{off ? 'يوم عطلة — تسجيل إضافي' : 'من شبكة المحل'}</small>
          </span>
        </button>
      )}
      {!compact && netLine}
    </section>
  );
}

export function AttendHistory() {
  const { data } = useLoad(() => attendApi.state(), ['attend']);
  const rows: AttendRec[] = data?.history ?? [];
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.workedMinutes, 0);
  const late = rows.filter(r => r.lateMinutes > 0).length;
  const ot = data?.overtime;
  return (
    <section className="t-section">
      <div className="t-section-head">
        <h2>سجل الحضور</h2>
        <small>
          {hhmm(total)} ساعة · {late ? `${late} تأخير` : 'بلا تأخير'}
        </small>
      </div>
      {ot && (
        <div className="t-ot-card">
          <div>
            <span>الأوفر تايم هذا الشهر</span>
            <b className="num ltr">{hhmm(ot.monthMinutes)}</b>
            <small>{ot.days ? `في ${ot.days} ${ot.days === 1 ? 'يوم' : ot.days === 2 ? 'يومين' : 'أيام'}` : 'لا ساعات إضافية بعد'}</small>
          </div>
          {ot.pay ? (
            <div className="pay">
              <span>المستحق</span>
              <b className="num">{ot.pay.toLocaleString('en-US')}</b>
              <small>دينار</small>
            </div>
          ) : null}
        </div>
      )}
      <div className="t-list">
        {rows.map(r => (
          <div key={r.id} className="t-row">
            <span className={`t-tile ${r.lateMinutes ? 'accent' : 'ok'}`}>
              <I.clock size={18} />
            </span>
            <div className="body">
              <div className="title">{dateShort(r.date)}</div>
              <div className="sub">
                {clockLabel(r.checkIn)} – {r.checkOut ? clockLabel(r.checkOut) : '—'}
                {r.breakMinutes ? ` · استراحة ${r.breakMinutes} د` : ''}
                {r.autoClosed ? ' · إغلاق تلقائي' : ''}
                {r.edited ? ' · معدّل' : ''}
              </div>
            </div>
            <div className="end">
              <b className="num ltr">{hhmm(r.workedMinutes)}</b>
              <small className={r.overtimeMinutes ? 'ot' : undefined}>
                {r.overtimeMinutes ? `+${dur(r.overtimeMinutes)} أوفر` : r.lateMinutes ? `تأخير ${dur(r.lateMinutes)}` : r.overMinutes ? `تجاوز ${r.overMinutes} د` : 'منضبط'}
              </small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export type { AttendState };
