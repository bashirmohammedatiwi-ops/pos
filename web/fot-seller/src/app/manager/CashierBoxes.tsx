import { Link } from 'react-router-dom';
import { I } from '../kit';
import { haptic } from '../native';
import type { CashBox, CashBoxes, CashierLive } from '../work';
import { cashAmount } from './cashPdf';

/* ─────────────────────────────────────────────────────────────────────────────
 * صناديق الكاشير التي تعمل اليوم — من فواتير المحل لحظة بلحظة:
 *   النقد المتوقع في الدرج، البطاقة، المرتجعات، الخصم، الحذف، القطع، الساعات، ونقطة البيع.
 * اختيار ما يظهر في «عرض المزيد» من لوحة التحكم (تقرير الصناديق)؛ بلا اختيار: كل كاشير يعمل اليوم.
 * ───────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => cashAmount(n, 'IQD');
/** الوقت كما سُجّل في المحل (توقيت بغداد) دون تحويل منطقة */
const hm12 = (iso?: string | null) => {
  if (!iso || iso.length < 16) return '';
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'ص' : 'م'}`;
};
/** «قبل 3 د» لوقت المحل (بغداد +03:00) */
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso.slice(0, 19)}+03:00`);
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  return h < 24 ? `قبل ${h} س${m % 60 ? ` و${m % 60} د` : ''}` : `قبل ${Math.floor(h / 24)} يوم`;
};

/** ما يظهر في «عرض المزيد»: المختار من لوحة التحكم بترتيبه، أو تلقائياً كل كاشير يعمل اليوم */
export function moreBoxes(data: CashBoxes) {
  const live = data.cashiers ?? [];
  const byNum = new Map(data.boxes.map(b => [b.num, b]));
  const bySeq = new Map(data.boxes.map(b => [b.seq, b]));
  const manual = Array.isArray(data.extra);
  if (manual) {
    const items = (data.extra ?? [])
      .map(num => byNum.get(num))
      .filter((b): b is CashBox => !!b && !b.featured)
      .map(b => ({ box: b, live: live.find(l => l.seq === b.seq) ?? null }));
    return {
      manual,
      cashiers: items.filter(x => x.live).map(x => ({ box: x.box, live: x.live! })),
      others: items.filter(x => !x.live).map(x => x.box),
      hidden: data.boxes.filter(b => !b.featured && !data.extra?.includes(b.num)),
    };
  }
  const cashiers = live.map(l => ({ box: bySeq.get(l.seq) ?? null, live: l }));
  const liveSeqs = new Set(live.map(l => l.seq));
  const rest = data.boxes.filter(b => !b.featured && !liveSeqs.has(b.seq));
  return {
    manual,
    cashiers,
    others: rest.filter(b => b.balance !== 0 || b.todayCount > 0),
    hidden: rest.filter(b => !(b.balance !== 0 || b.todayCount > 0)),
  };
}

/** نشاط الكاشير بالساعة (من أول ساعة عمل إلى آخرها) */
function HourBars({ hours }: { hours: number[] }) {
  const idx = hours.map((v, i) => (v !== 0 ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  const a = Math.max(0, Math.min(...idx) - 1);
  const b = Math.min(23, Math.max(...idx) + 1);
  const span = hours.slice(a, b + 1);
  const peak = Math.max(1, ...span.map(v => Math.abs(v)));
  const best = span.indexOf(Math.max(...span)) + a;
  const label = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'ص' : 'م'}`;
  return (
    <div className="cz-hours" role="img" aria-label={`أنشط ساعة ${label(best)}`}>
      <div className="bars">
        {span.map((v, i) => (
          <span key={i} className={`bar ${a + i === best ? 'peak' : ''} ${v < 0 ? 'neg' : ''}`} style={{ height: `${Math.max(v ? 8 : 3, (Math.abs(v) / peak) * 100)}%` }} title={`${label(a + i)} · ${fmt(v)} د.ع`} />
        ))}
      </div>
      <div className="axis">
        <span>{label(a)}</span>
        <span>أنشط ساعة {label(best)}</span>
        <span>{label(b)}</span>
      </div>
    </div>
  );
}

export function CashierCard({ live, box, link = true }: { live: CashierLive; box: CashBox | null; link?: boolean }) {
  const receipts = live.sales + live.cardCount;
  const avg = receipts ? live.total / receipts : 0;
  const who = live.cashiers.length ? live.cashiers.join(' · ') : box?.name ?? 'كاشير';
  const working = live.online && live.lastAt && Date.now() - Date.parse(`${live.lastAt.slice(0, 19)}+03:00`) < 90 * 60_000;
  const body = (
    <>
      <div className="cz-head">
        <span className={`cz-ico ${working ? 'on' : ''}`}>
          <I.user size={20} />
        </span>
        <span className="cz-who">
          <b>{who}</b>
          <small>
            {box ? (
              <>
                {box.name} <span className="num">· {box.num}</span>
              </>
            ) : (
              'صندوق كاشير'
            )}
            {live.pos ? ` · ${live.pos}` : ''}
          </small>
        </span>
        <span className={`cz-state ${working ? 'on' : live.online ? 'idle' : 'off'}`}>
          <i aria-hidden />
          {working ? 'يعمل الآن' : live.online ? 'متصل' : 'غير متصل'}
        </span>
      </div>

      <div className="cz-cash">
        <span>النقد المتوقع في الدرج</span>
        <b className="num ltr">
          {fmt(live.cash)}
          <small>د.ع</small>
        </b>
        <em>
          مجموع ما باعه اليوم <span className="num ltr">{fmt(live.total)}</span> د.ع
        </em>
      </div>

      <div className="cz-stats">
        <div>
          <small>بطاقة كي</small>
          <b className="num ltr">{fmt(live.cardTotal)}</b>
          <em>{live.cardCount} فاتورة</em>
        </div>
        <div>
          <small>الفواتير</small>
          <b className="num">{receipts}</b>
          <em>
            متوسط <span className="num ltr">{fmt(Math.round(avg))}</span>
          </em>
        </div>
        <div className={live.returns ? 'warn' : ''}>
          <small>المرتجعات</small>
          <b className="num ltr">{fmt(live.returnsTotal)}</b>
          <em>{live.returns} مرتجع</em>
        </div>
        <div>
          <small>الخصم اليدوي</small>
          <b className="num ltr">{fmt(live.discount)}</b>
          <em>{live.pieces ? `${Math.round(live.pieces)} قطعة` : ' '}</em>
        </div>
        <div className={live.voids ? 'bad' : ''}>
          <small>حذف مواد</small>
          <b className="num">{live.voids}</b>
          <em>
            بقيمة <span className="num ltr">{fmt(live.voidsAmount)}</span>
          </em>
        </div>
        <div>
          <small>الهدايا</small>
          <b className="num">{live.gifts}</b>
          <em>فاتورة هدية</em>
        </div>
      </div>

      <HourBars hours={live.hours ?? []} />

      <div className="cz-foot">
        <span>
          <I.clock size={14} /> بدأ {hm12(live.firstAt)} · آخر فاتورة {hm12(live.lastAt)} <span className="mute">({ago(live.lastAt)})</span>
        </span>
        {box && (
          <span className="cz-edari">
            في الإداري <span className="num ltr">{fmt(box.balance)}</span>
          </span>
        )}
      </div>
    </>
  );
  if (!link || !box) return <article className="cz-card">{body}</article>;
  return (
    <Link to={`/m/cash/${box.seq}`} className="cz-card press" onClick={() => haptic('tap')}>
      {body}
    </Link>
  );
}

/** ملخص أعلى قسم الكاشير: كم يعمل الآن ومجموع النقد والبطاقة */
export function CashiersSummary({ items }: { items: { live: CashierLive }[] }) {
  if (!items.length) return null;
  const cash = items.reduce((s, x) => s + x.live.cash, 0);
  const card = items.reduce((s, x) => s + x.live.cardTotal, 0);
  const on = items.filter(x => x.live.online).length;
  return (
    <div className="cz-sum">
      <div>
        <small>يعمل الآن</small>
        <b className="num">
          {on}
          <span> / {items.length}</span>
        </b>
      </div>
      <div>
        <small>نقد الأدراج</small>
        <b className="num ltr">{fmt(cash)}</b>
      </div>
      <div>
        <small>بطاقة كي</small>
        <b className="num ltr">{fmt(card)}</b>
      </div>
    </div>
  );
}
