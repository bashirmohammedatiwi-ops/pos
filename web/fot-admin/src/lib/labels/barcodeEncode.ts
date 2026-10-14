/**
 * ترميز الباركود إلى «وحدات» (modules) — مصفوفة true = خط أسود.
 * الرسم يتم لاحقاً بعرض صحيح من النقاط لكل وحدة كي تبقى الخطوط حادة وقابلة للقراءة.
 *   · EAN-13 فقط لكود من 13 رقماً برقم تحقق صحيح (الماسح يقرأ نفس الرقم المخزّن).
 *   · Code 128 لكل ما عداها، مع التبديل التلقائي إلى المجموعة C للأرقام (أقصر).
 */

export type EncodedBarcode = {
  /** الوحدات من اليسار إلى اليمين — بلا منطقة هادئة. */
  modules: boolean[];
  /** النص المقروء أسفل الخطوط. */
  text: string;
  kind: 'EAN13' | 'CODE128';
  /** EAN-13: مواضع خطوط الحماية الأطول (بداية/وسط/نهاية). */
  guards?: Set<number>;
};

/* ── EAN-13 ── */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function encodeEan13(code13: string): EncodedBarcode {
  const d = code13.split('').map(Number);
  const parity = EAN_PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[d[i]];
  bits += '101';
  const guards = new Set<number>([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  return { modules: bits.split('').map(b => b === '1'), text: code13, kind: 'EAN13', guards };
}

/* ── Code 128 ── */

const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

function digitRunAt(s: string, i: number) {
  let n = 0;
  while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++;
  return n;
}

function encodeCode128(text: string): EncodedBarcode {
  // B للنص (ASCII 32..127)، C لأزواج الأرقام عند تسلسل 4+ (أو 2+ في البداية/النهاية)
  const codes: number[] = [];
  let set: 'B' | 'C';
  let i = 0;
  const firstRun = digitRunAt(text, 0);
  if (firstRun >= 4 || (firstRun === text.length && firstRun >= 2 && firstRun % 2 === 0)) {
    set = 'C';
    codes.push(START_C);
  } else {
    set = 'B';
    codes.push(START_B);
  }
  while (i < text.length) {
    const run = digitRunAt(text, i);
    if (set === 'B' && run >= 4 && (run >= 6 || i + run === text.length)) {
      // انتقل إلى C لعدد زوجي من الأرقام
      if (run % 2 === 1) {
        codes.push(text.charCodeAt(i) - 32);
        i++;
      }
      codes.push(CODE_C);
      set = 'C';
      continue;
    }
    if (set === 'C') {
      if (run >= 2) {
        codes.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      codes.push(CODE_B);
      set = 'B';
      continue;
    }
    const ch = text.charCodeAt(i);
    if (ch < 32 || ch > 127) throw new Error('رمز غير مدعوم في الباركود');
    codes.push(ch - 32);
    i++;
  }
  let check = codes[0];
  for (let k = 1; k < codes.length; k++) check += codes[k] * k;
  codes.push(check % 103);
  codes.push(STOP);

  const modules: boolean[] = [];
  for (const c of codes) {
    const widths = C128[c];
    for (let w = 0; w < widths.length; w++) {
      const n = Number(widths[w]);
      for (let k = 0; k < n; k++) modules.push(w % 2 === 0);
    }
  }
  return { modules, text, kind: 'CODE128' };
}

/** يختار الترميز المناسب للكود. يرمي خطأ عند كود فارغ أو أحرف غير مدعومة. */
export function encodeBarcode(raw: string): EncodedBarcode {
  const code = String(raw ?? '').trim();
  if (!code) throw new Error('لا يوجد باركود');
  if (/^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])) return encodeEan13(code);
  return encodeCode128(code);
}
