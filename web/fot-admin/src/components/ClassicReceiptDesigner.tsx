import {
  CLASSIC_BLOCK_LABELS,
  CLASSIC_PART_IDS,
  CLASSIC_PART_LABELS,
  CLASSIC_TABLE_COL_LABELS,
  TABLE_PART_IDS,
  TABLE_SIZE_MAX,
  TABLE_SIZE_MIN,
  classicStyleToDto,
  isClassicBlockVisible,
  moveClassicItem,
  resolveClassicStyle,
  type ClassicDateFormat,
  type ClassicPartId,
  type ClassicStyleDto,
  type ClassicStylePart,
  type ClassicTablePartId,
  type PrintSettingsDto,
  type ReceiptAlign,
  type ResolvedClassicStyle,
} from '@fot/shared';
import { Btn, Checkbox, Field, Input, Select } from '@/components/ui';
import { FormSection } from '@/components/workspace';

const SIZES = Array.from({ length: 15 }, (_, i) => i + 8);
const TABLE_SIZES = Array.from({ length: TABLE_SIZE_MAX - TABLE_SIZE_MIN + 1 }, (_, i) => i + TABLE_SIZE_MIN);
const TABLE_FONT_ROWS: { id: ClassicTablePartId; label: string }[] = [
  { id: 'tableHead', label: 'عناوين الأعمدة' },
  { id: 'tableProduct', label: 'اسم المادة' },
  { id: 'tableValues', label: 'الأرقام — كمية / إفرادي / حسم / إجمالي' },
  { id: 'tableDisc', label: 'باركود ورقم المادة' },
];
const WEIGHTS: { value: number; label: string }[] = [
  { value: 300, label: 'خفيف' },
  { value: 400, label: 'عادي' },
  { value: 500, label: 'متوسط' },
  { value: 600, label: 'شبه عريض' },
  { value: 700, label: 'عريض' },
];
const ALIGNS: { value: ReceiptAlign; label: string }[] = [
  { value: 'right', label: 'يمين' },
  { value: 'center', label: 'وسط' },
  { value: 'left', label: 'يسار' },
];
const DATE_FORMATS: { value: ClassicDateFormat; label: string }[] = [
  { value: 'datetime', label: 'التاريخ والوقت معاً' },
  { value: 'split', label: 'التاريخ ثم الوقت في سطرين' },
  { value: 'date', label: 'التاريخ فقط' },
  { value: 'time', label: 'الوقت فقط' },
];

export function ClassicReceiptDesigner({
  settings,
  onChange,
}: {
  settings: Pick<PrintSettingsDto, 'fontSize' | 'fontWeight' | 'classicStyle'>;
  onChange: (next: ClassicStyleDto | null) => void;
}) {
  let style: ResolvedClassicStyle;
  try {
    style = resolveClassicStyle(settings);
  } catch {
    style = resolveClassicStyle({ fontSize: 13, fontWeight: 400, classicStyle: null });
  }

  function commit(next: typeof style) {
    try {
      onChange(classicStyleToDto(next));
    } catch {
      /* keep the last good style */
    }
  }

  function patchPart(id: ClassicPartId, patch: Partial<ClassicStylePart>) {
    commit({
      ...style,
      parts: { ...style.parts, [id]: { ...style.parts[id], ...patch } },
    });
  }

  function toggleBlock(id: (typeof style.order)[number], visible: boolean) {
    const hidden = new Set(Array.isArray(style.hiddenBlocks) ? style.hiddenBlocks : []);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    const next = { ...style, hiddenBlocks: Array.from(hidden) };
    if ((CLASSIC_PART_IDS as readonly string[]).includes(id)) {
      next.parts = {
        ...next.parts,
        [id]: { ...next.parts[id as ClassicPartId], show: visible },
      };
    }
    commit(next);
  }

  return (
    <div className="space-y-3">
      <FormSection
        compact
        title="ترتيب أجزاء النموذج الجدولي"
        hint="حرّك أي جزء لأعلى أو أسفل، أو أخفه — المعاينة تتحدث فوراً"
      >
        <div className="space-y-1">
          {(style.order ?? []).map((id, index) => {
            const visible = isClassicBlockVisible(style, id);
            return (
              <div
                key={id}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                  visible ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-70'
                }`}
              >
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => commit({ ...style, order: moveClassicItem(style.order, index, -1) })}
                    className="h-5 w-6 rounded text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    aria-label="أعلى"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={index === style.order.length - 1}
                    onClick={() => commit({ ...style, order: moveClassicItem(style.order, index, 1) })}
                    className="h-5 w-6 rounded text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    aria-label="أسفل"
                  >
                    ▼
                  </button>
                </div>
                <div className="min-w-0 flex-1 text-[12.5px] font-semibold text-header">
                  {CLASSIC_BLOCK_LABELS[id] ?? id}
                </div>
                <Checkbox
                  label={visible ? 'ظاهر' : 'مخفي'}
                  checked={visible}
                  onChange={v => toggleBlock(id, v)}
                />
              </div>
            );
          })}
        </div>
      </FormSection>

      <FormSection
        compact
        title="حجم وسماكة ومحاذاة كل جزء"
        hint="كل سطر مستقل عن حجم الخط العام — غيّر العنوان أو التاريخ أو الذيل دون الباقي"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="text-[11px] text-slate-500">
                <th className="pb-1.5 text-right font-semibold">الجزء</th>
                <th className="pb-1.5 font-semibold">الحجم</th>
                <th className="pb-1.5 font-semibold">السماكة</th>
                <th className="pb-1.5 font-semibold">المحاذاة</th>
              </tr>
            </thead>
            <tbody>
              {CLASSIC_PART_IDS.filter(id => !(TABLE_PART_IDS as readonly string[]).includes(id)).map(id => {
                const part = style.parts[id];
                if (!part) return null;
                return (
                  <tr key={id} className="border-t border-slate-100">
                    <td className="py-1.5 pe-2 font-semibold text-slate-700">{CLASSIC_PART_LABELS[id]}</td>
                    <td className="py-1.5 pe-1">
                      <Select value={part.size} onChange={e => patchPart(id, { size: Number(e.target.value) })}>
                        {SIZES.map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5 pe-1">
                      <Select value={part.weight} onChange={e => patchPart(id, { weight: Number(e.target.value) })}>
                        {WEIGHTS.map(w => (
                          <option key={w.value} value={w.value}>{w.label}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5">
                      <Select value={part.align} onChange={e => patchPart(id, { align: e.target.value as ReceiptAlign })}>
                        {ALIGNS.map(a => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection compact title="التاريخ والوقت والعناوين" hint="صيغة التاريخ وتسميات البائع والصندوق والكاشير">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="شكل التاريخ والوقت">
            <Select
              value={style.dateFormat}
              onChange={e => commit({ ...style, dateFormat: e.target.value as ClassicDateFormat })}
            >
              {DATE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="تسمية الكاشير">
            <Input value={style.cashierLabel} onChange={e => commit({ ...style, cashierLabel: e.target.value })} />
          </Field>
          <Field label="تسمية البائع">
            <Input value={style.salesmanLabel} onChange={e => commit({ ...style, salesmanLabel: e.target.value })} />
          </Field>
          <Field label="تسمية الصندوق">
            <Input value={style.cashboxLabel} onChange={e => commit({ ...style, cashboxLabel: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection compact title="جدول الأصناف" hint="خطوط الجدول مستقلة عن حجم الخط العام — من 5 إلى 16">
        <ClassicTableFontFields style={style} onPatchPart={patchPart} onMasterSize={n => {
          const size = Math.min(TABLE_SIZE_MAX, Math.max(TABLE_SIZE_MIN, n));
          commit({
            ...style,
            parts: {
              ...style.parts,
              tableValues: { ...style.parts.tableValues, size },
              tableProduct: { ...style.parts.tableProduct, size },
              tableHead: { ...style.parts.tableHead, size: Math.max(TABLE_SIZE_MIN, size - 1) },
              tableDisc: { ...style.parts.tableDisc, size: Math.max(TABLE_SIZE_MIN, size - 1) },
            },
          });
        }} />
        <div className="mb-3 mt-3 flex flex-wrap gap-3">
          <Checkbox
            label="إظهار عناوين الجدول"
            checked={style.showTableHead}
            onChange={v => commit({ ...style, showTableHead: v })}
          />
        </div>
        <p className="mb-1.5 text-[11px] text-slate-500">عرض الأعمدة — الترتيب: المادة · الكمية · الإفرادي · الحسم · الإجمالي</p>
        <div className="space-y-1">
          {(['product', 'qty', 'unit', 'disc', 'total'] as const).map(col => {
            return (
            <div key={col} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <div className="w-20 shrink-0 text-[12.5px] font-semibold">{CLASSIC_TABLE_COL_LABELS[col]}</div>
              <input
                type="range"
                min={0.4}
                max={4}
                step={0.05}
                value={style.cols[col] ?? 1}
                onChange={e => commit({
                  ...style,
                  cols: { ...style.cols, [col]: Number(e.target.value) },
                })}
                className="min-w-0 flex-1"
              />
              <span className="w-10 text-left text-[11px] text-slate-500">{Number(style.cols[col] ?? 0).toFixed(2)}</span>
            </div>
            );
          })}
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Btn variant="ghost" onClick={() => onChange(null)}>
          إعادة تصميم النموذج للافتراضي
        </Btn>
      </div>
    </div>
  );
}

function ClassicTableFontFields({
  style,
  onPatchPart,
  onMasterSize,
}: {
  style: ResolvedClassicStyle;
  onPatchPart: (id: ClassicPartId, patch: Partial<ClassicStylePart>) => void;
  onMasterSize: (n: number) => void;
}) {
  const master = style.parts.tableValues?.size ?? 8;
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
        <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-slate-700">
          <span>حجم خطوط الجدول معاً</span>
          <span className="tabular-nums text-slate-500">{master}</span>
        </div>
        <input
          type="range"
          min={TABLE_SIZE_MIN}
          max={TABLE_SIZE_MAX}
          step={1}
          value={master}
          onChange={e => onMasterSize(Number(e.target.value))}
          className="w-full"
        />
        <p className="mt-1 text-[11px] text-slate-500">من {TABLE_SIZE_MIN} صغير جداً إلى {TABLE_SIZE_MAX} — لا يتأثر بحجم الخط العام</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12px]">
          <thead>
            <tr className="text-[11px] text-slate-500">
              <th className="pb-1.5 text-right font-semibold">جزء الجدول</th>
              <th className="pb-1.5 font-semibold">الحجم</th>
              <th className="pb-1.5 font-semibold">السماكة</th>
            </tr>
          </thead>
          <tbody>
            {TABLE_FONT_ROWS.map(row => {
              const part = style.parts[row.id];
              if (!part) return null;
              return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-1.5 pe-2 font-semibold text-slate-700">{row.label}</td>
                  <td className="py-1.5 pe-1">
                    <Select value={part.size} onChange={e => onPatchPart(row.id, { size: Number(e.target.value) })}>
                      {TABLE_SIZES.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1.5">
                    <Select value={part.weight} onChange={e => onPatchPart(row.id, { weight: Number(e.target.value) })}>
                      {WEIGHTS.map(w => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ClassicTableFontControls({
  settings,
  onChange,
}: {
  settings: Pick<PrintSettingsDto, 'fontSize' | 'fontWeight' | 'classicStyle'>;
  onChange: (next: ClassicStyleDto) => void;
}) {
  let style: ResolvedClassicStyle;
  try {
    style = resolveClassicStyle(settings);
  } catch {
    style = resolveClassicStyle({ fontSize: 13, fontWeight: 400, classicStyle: null });
  }

  function commit(next: ResolvedClassicStyle) {
    try {
      onChange(classicStyleToDto(next));
    } catch {
      /* keep last good style */
    }
  }

  function patchPart(id: ClassicPartId, patch: Partial<ClassicStylePart>) {
    commit({
      ...style,
      parts: { ...style.parts, [id]: { ...style.parts[id], ...patch } },
    });
  }

  return (
    <ClassicTableFontFields
      style={style}
      onPatchPart={patchPart}
      onMasterSize={n => {
        const size = Math.min(TABLE_SIZE_MAX, Math.max(TABLE_SIZE_MIN, n));
        commit({
          ...style,
          parts: {
            ...style.parts,
            tableValues: { ...style.parts.tableValues, size },
            tableProduct: { ...style.parts.tableProduct, size },
            tableHead: { ...style.parts.tableHead, size: Math.max(TABLE_SIZE_MIN, size - 1) },
            tableDisc: { ...style.parts.tableDisc, size: Math.max(TABLE_SIZE_MIN, size - 1) },
          },
        });
      }}
    />
  );
}
