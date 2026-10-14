import type { ReactNode } from 'react';
import { formatDate } from '@/api/client';
import { Badge, type Tone } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * عناصر مشتركة لصفحات النظام والربط (نقاط البيع، الأقسام، الأداري، الإعدادات).
 * ───────────────────────────────────────────────────────────────────────────── */

/** وقت نسبي مختصر: «الآن»، «منذ 5 د»، «منذ 3 س»، «منذ يومين»… ثم التاريخ. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `منذ ${days} أيام`;
  return formatDate(iso);
}

/** هل يبدو النص معرّف عتاد خام (مثل win:ee5482cb-… أو GUID)؟ */
export function looksLikeHwId(s?: string | null): boolean {
  if (!s) return false;
  const v = s.trim();
  return /^[a-z]{2,10}:[0-9a-f-]{6,}/i.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || /^[0-9a-f]{16,}$/i.test(v);
}

/** اختصار معرّف العتاد إلى 6 خانات للعرض. */
export function shortHwId(hw?: string | null): string {
  if (!hw) return '';
  const tail = hw.includes(':') ? hw.slice(hw.indexOf(':') + 1) : hw;
  return tail.replace(/[^0-9a-z]/gi, '').slice(0, 6).toUpperCase();
}

/** اسم ودّي لنقطة البيع بدل المعرّف الخام. */
export function terminalTitle(t: { id: number; name?: string | null; hwId?: string | null; sectionName?: string | null }): string {
  const name = t.name?.trim();
  if (name && !looksLikeHwId(name) && name !== t.hwId) return name;
  const base = t.sectionName?.trim() ? `نقطة بيع ${t.sectionName.trim()}` : 'نقطة بيع';
  const short = shortHwId(t.hwId);
  return short ? `${base} · ${short}` : `${base} #${t.id}`;
}

/** هل للجهاز اسم مخصص (غير المعرّف الخام)؟ */
export function terminalHasCustomName(t: { name?: string | null; hwId?: string | null }): boolean {
  const name = t.name?.trim();
  return !!name && !looksLikeHwId(name) && name !== t.hwId;
}

/** معرّف العتاد بشكل مختصر (6 خانات) مع المعرّف الكامل في التلميح — لا يلتف ولا يضخّم الصف. */
export function HwIdLabel({ hwId, className = '' }: { hwId?: string | null; className?: string }) {
  if (!hwId) return <span className="text-slate-300">—</span>;
  return (
    <span
      dir="ltr"
      title={hwId}
      className={`inline-block max-w-full truncate whitespace-nowrap rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-500 ${className}`}
    >
      {shortHwId(hwId) || hwId.slice(0, 8)}
    </span>
  );
}

/** نقطة حالة مع نبض للمتصل. */
export function PulseDot({ online, size = 'md', tone }: { online: boolean; size?: 'sm' | 'md'; tone?: 'ok' | 'warn' | 'danger' | 'off' }) {
  const t = tone ?? (online ? 'ok' : 'off');
  const color = { ok: 'bg-emerald-500', warn: 'bg-amber-500', danger: 'bg-red-500', off: 'bg-slate-300' }[t];
  const ring = { ok: 'bg-emerald-400', warn: 'bg-amber-400', danger: 'bg-red-400', off: '' }[t];
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <span className={`relative inline-flex shrink-0 ${dim}`} aria-hidden>
      {t !== 'off' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${ring}`} />}
      <span className={`relative inline-flex rounded-full ${dim} ${color}`} />
    </span>
  );
}

/** شارة متصل / غير متصل مع نبض. */
export function OnlineBadge({ online, onLabel = 'متصل', offLabel = 'غير متصل' }: { online: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <Badge tone={online ? 'ok' : 'default'} className="gap-1.5">
      <PulseDot online={online} size="sm" />
      {online ? onLabel : offLabel}
    </Badge>
  );
}

/** بطاقة قسم إعدادات: عنوان · وصف · محتوى. */
export function SettingsCard({
  title,
  description,
  icon,
  actions,
  children,
  tone,
  id,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'warn' | 'danger';
  id?: string;
  className?: string;
}) {
  const border = tone === 'danger' ? 'border-red-200' : tone === 'warn' ? 'border-amber-200' : '';
  return (
    <section id={id} className={`card scroll-mt-4 overflow-hidden ${border} ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="icon-tile mt-0.5 h-8 w-8 rounded-lg bg-brand-50 text-brand-700">{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-header">{title}</h3>
            {description && <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** صف معلومة مختصرة: عنوان صغير وقيمة. */
export function InfoTile({ label, value, tone, mono, title }: { label: ReactNode; value: ReactNode; tone?: Tone; mono?: boolean; title?: string }) {
  const color =
    tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'danger' ? 'text-red-700' : 'text-header';
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2" title={title}>
      <p className="truncate text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-[13px] font-semibold ${mono ? 'num' : ''} ${color}`}>{value}</p>
    </div>
  );
}

/** زر إجراء كبير بعنوان ووصف — للعمليات اليدوية (مزامنة…). */
export function ActionTile({
  title,
  description,
  icon,
  onClick,
  loading,
  disabled,
  primary,
  danger,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const tile = primary
    ? 'bg-brand-600 text-white'
    : danger
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`group flex min-w-0 items-start gap-3 rounded-xl border bg-white p-3 text-right transition disabled:cursor-not-allowed disabled:opacity-55 ${
        primary ? 'border-brand-200 hover:border-brand-400 hover:bg-brand-50/40' : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50/60'
      }`}
    >
      <span className={`icon-tile h-9 w-9 shrink-0 rounded-lg transition ${tile}`}>
        {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-header">{loading ? `${title}…` : title}</span>
        {description && <span className="mt-0.5 block text-[11.5px] leading-5 text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

/** شريط حفظ لاصق يظهر عند وجود تغييرات غير محفوظة. */
export function StickySaveBar({
  count,
  labels,
  onSave,
  onDiscard,
  saving,
  disabled,
  disabledReason,
}: {
  count: number;
  labels?: string[];
  onSave: () => void;
  onDiscard?: () => void;
  saving?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (count <= 0) return null;
  return (
    <div className="sticky bottom-0 z-20 mt-auto shrink-0 px-2 pb-2 pt-1">
      <div className="flex animate-slide-up flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-900 px-4 py-2.5 text-white shadow-pop">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="font-semibold">تغييرات غير محفوظة</span>
          {labels && labels.length > 0 && (
            <span className="truncate text-[12px] text-slate-300">— {labels.join('، ')}</span>
          )}
          {disabled && disabledReason && <span className="truncate text-[12px] text-amber-300">· {disabledReason}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] text-slate-400 sm:inline">Ctrl+S</span>
          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="h-8 rounded-lg px-3 text-[12px] font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              تجاهل
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || disabled}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-[12.5px] font-bold text-white transition hover:bg-brand-400 disabled:opacity-50"
          >
            {saving && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {saving ? 'جاري الحفظ…' : 'حفظ التغييرات'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** حقل بحث بأيقونة. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  icon,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">{icon}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pe-3 ps-9 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15"
      />
    </div>
  );
}

/** تخزين محلي آمن. */
export function readLocal<T>(key: string, storage: 'local' | 'session' = 'local'): T | null {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    return JSON.parse(s.getItem(key) || 'null') as T | null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown, storage: 'local' | 'session' = 'local') {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* تجاهل */
  }
}
