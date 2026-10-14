import { useEffect, useRef, useState } from 'react';
import { daysAgoIso, monthStartIso, todayIso } from '@/api/client';
import type { BusinessPeriodSettingsDto } from '@/api/types';
import { IconCalendar, IconCheck, IconChevronDown, IconInfo } from '@/components/icons';
import {
  businessWeekLabel,
  currentMonthIso,
  currentWeekIso,
  previousMonthIso,
  previousWeekIso,
} from '@/lib/businessPeriod';

export type DatePresetMode = 'commissions' | 'targets' | 'all';

type Preset = { id: string; label: string; from: string; to: string; title?: string };

/** قائمة الفترات السريعة حسب النمط وإعدادات أسبوع العمل. */
function buildPresets(mode: DatePresetMode, periodSettings?: BusinessPeriodSettingsDto | null): Preset[] {
  const weekStart = periodSettings?.weekStartDay ?? 6;
  const weekLen = periodSettings?.weekLengthDays ?? 7;
  const weekLabel = businessWeekLabel(periodSettings);

  const currentWeek = periodSettings
    ? { from: periodSettings.currentWeekStart.slice(0, 10), to: periodSettings.currentWeekEnd.slice(0, 10) }
    : currentWeekIso(weekStart, weekLen);
  const previousWeek = periodSettings
    ? { from: periodSettings.previousWeekStart.slice(0, 10), to: periodSettings.previousWeekEnd.slice(0, 10) }
    : previousWeekIso(weekStart, weekLen);
  const currentMonth = periodSettings
    ? { from: periodSettings.currentMonthStart.slice(0, 10), to: periodSettings.currentMonthEnd.slice(0, 10) }
    : currentMonthIso();
  const prevMonth = previousMonthIso();

  const showWeek = mode === 'all' || mode === 'commissions' || mode === 'targets';
  const showMonth = mode === 'all' || mode === 'targets';
  const today = todayIso();

  const list: Preset[] = [{ id: 'today', label: 'اليوم', from: today, to: today }];
  if (mode === 'all') list.push({ id: 'yesterday', label: 'أمس', from: daysAgoIso(1), to: daysAgoIso(1) });
  if (showWeek) {
    list.push({ id: 'week', label: 'هذا الأسبوع', from: currentWeek.from, to: currentWeek.to, title: weekLabel });
    list.push({ id: 'prev-week', label: 'الأسبوع الماضي', from: previousWeek.from, to: previousWeek.to, title: weekLabel });
  }
  if (showMonth) {
    list.push({ id: 'month', label: 'هذا الشهر', from: currentMonth.from, to: currentMonth.to });
    list.push({ id: 'prev-month', label: 'الشهر الماضي', from: prevMonth.from, to: prevMonth.to });
  }
  if (mode === 'all') {
    list.push({ id: '7d', label: 'آخر 7 أيام', from: daysAgoIso(7), to: today });
    list.push({ id: 'mtd', label: 'من بداية الشهر', from: monthStartIso(), to: today });
    list.push({ id: '30d', label: 'آخر 30 يوماً', from: daysAgoIso(30), to: today });
  }
  list.push({ id: 'all', label: 'كل الفترات', from: '', to: '', title: 'قد يكون بطيئاً مع بيانات كثيرة' });
  return list;
}

/**
 * فترات سريعة.
 * - `variant="chips"` (الافتراضي): أزرار صغيرة متجاورة.
 * - `variant="menu"`: زر واحد يفتح قائمة — مناسب لشريط فلاتر مضغوط.
 * مرّر `from`/`to` لتمييز الفترة المختارة حالياً.
 */
export function DatePresets({
  onPick,
  periodSettings,
  mode = 'all',
  variant = 'chips',
  from,
  to,
}: {
  onPick: (from: string, to: string) => void;
  periodSettings?: BusinessPeriodSettingsDto | null;
  mode?: DatePresetMode;
  variant?: 'chips' | 'menu';
  from?: string;
  to?: string;
}) {
  const presets = buildPresets(mode, periodSettings);
  const hasValue = from !== undefined && to !== undefined;
  const active = hasValue ? presets.find(p => p.from === from && p.to === to) : undefined;

  if (variant === 'menu') {
    return <PresetMenu presets={presets} active={active} hasValue={hasValue} onPick={onPick} />;
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {presets.map(p => {
        const on = active?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            title={p.title}
            onClick={() => onPick(p.from, p.to)}
            className={`h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition ${
              on
                ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-brand-200'
                : p.id === 'all'
                  ? 'text-slate-400 hover:bg-white hover:text-slate-700'
                  : 'text-slate-600 hover:bg-white hover:text-header'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function PresetMenu({
  presets,
  active,
  hasValue,
  onPick,
}: {
  presets: Preset[];
  active?: Preset;
  hasValue: boolean;
  onPick: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = active?.label ?? (hasValue ? 'فترة مخصصة' : 'فترة سريعة');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[12.5px] font-semibold transition ${
          active
            ? 'border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <IconCalendar size={15} />
        {label}
        <IconChevronDown size={13} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="animate-pop-in absolute end-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[var(--shadow-lift)]"
        >
          {presets.map(p => {
            const on = active?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                title={p.title}
                onClick={() => {
                  onPick(p.from, p.to);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right text-[12.5px] transition ${
                  on ? 'bg-brand-50 font-bold text-brand-800' : 'text-slate-700 hover:bg-slate-50'
                } ${p.id === 'all' ? 'mt-1 border-t border-slate-100 pt-2 text-slate-500' : ''}`}
              >
                <span>{p.label}</span>
                {on && <IconCheck size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** وصف الفترة المعروضة — سطر صغير بدل شريط كبير. */
export function PeriodBanner({
  from,
  to,
  periodSettings,
  hint,
}: {
  from: string;
  to: string;
  periodSettings?: BusinessPeriodSettingsDto | null;
  hint?: string;
}) {
  if (!from || !to) {
    return (
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] text-amber-900">
        <IconInfo size={13} className="shrink-0" />
        <span className="truncate">
          عرض <strong>كل الفترات</strong> — قد يكون بطيئاً. يُفضّل اختيار أسبوع عمل ({businessWeekLabel(periodSettings)}).
        </span>
      </div>
    );
  }

  const f = new Date(from);
  const t = new Date(to);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  const label = from === to
    ? f.toLocaleDateString('ar-IQ', opts)
    : `${f.toLocaleDateString('ar-IQ', opts)} — ${t.toLocaleDateString('ar-IQ', opts)}`;

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] text-slate-600">
      <IconCalendar size={13} className="shrink-0 text-brand-600" />
      <span className="truncate">
        <span className="font-semibold text-header">{label}</span>
        {hint && <span className="text-slate-500"> · {hint}</span>}
        {periodSettings && (
          <span className="text-slate-400">
            {' '}· أسبوع العمل: {periodSettings.weekStartDayName} ← {periodSettings.weekEndDayName}
          </span>
        )}
      </span>
    </div>
  );
}
