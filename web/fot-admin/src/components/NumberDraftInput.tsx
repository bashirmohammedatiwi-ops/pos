import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number;
  /** يُستدعى بالقيمة بعد الحصر في [min, max] — عند كل كتابة صالحة وعند مغادرة الحقل. */
  onValueChange: (n: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  /** قيمة الحقل الفارغ (مثلاً 0). بدونها يعود الحقل الفارغ لآخر قيمة صالحة عند المغادرة. */
  emptyValue?: number;
};

/**
 * حقل رقمي يحتفظ بالنص الخام أثناء الكتابة — لا يقفز إلى الحد الأدنى مع كل ضغطة
 * (تحديد الكل ثم الكتابة، أو مسح الحقل). القيمة المرسلة للأب محصورة دائماً، فالحفظ يستخدم قيمة صالحة،
 * والنص يُوحَّد مع القيمة المحصورة عند مغادرة الحقل.
 */
export function NumberDraftInput({ value, onValueChange, min, max, integer, emptyValue, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  function clamp(n: number) {
    let v = integer ? Math.round(n) : n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  }

  return (
    <Input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={e => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === '') {
          if (emptyValue != null) onValueChange(clamp(emptyValue));
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onValueChange(clamp(n));
      }}
      onBlur={e => {
        focused.current = false;
        const n = Number(text);
        const next = text.trim() === '' || !Number.isFinite(n)
          ? (emptyValue != null ? clamp(emptyValue) : value)
          : clamp(n);
        if (next !== value) onValueChange(next);
        setText(String(next));
        onBlur?.(e);
      }}
    />
  );
}
