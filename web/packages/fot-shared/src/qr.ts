/**
 * رمز QR بلا مكتبات (ISO/IEC 18004) — يُرسم SVG داخل قوالب الطباعة المتزامنة (receiptHtml).
 * وضعا الترميز: أبجدي رقمي (رموز الطلبات ORD-… بحجم أصغر) أو بايتات UTF-8 لأي نص آخر.
 * الخوارزمية على نهج Project Nayuki؛ اختيار القناع بنفس عقوبات مكتبة qrcode، وقد طوبقت النتيجة معها.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export type QrMatrix = {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] — true = داكن */
  modules: boolean[][];
};

const ECC_ORDINAL: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// الفهرس 0 غير مستخدم (الإصدارات 1..40)
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

type Segment = { mode: 'alnum' | 'byte'; bits: number[]; count: number };

function utf8(text: string): number[] {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  return Array.from(unescape(encodeURIComponent(text)), c => c.charCodeAt(0));
}

function pushBits(out: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function makeSegment(text: string, mode?: 'alnum' | 'byte'): Segment {
  const useAlnum = mode ? mode === 'alnum' : text.length > 0 && [...text].every(ch => ALNUM.includes(ch));
  const bits: number[] = [];
  if (useAlnum) {
    let i = 0;
    for (; i + 1 < text.length; i += 2) pushBits(bits, ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (i < text.length) pushBits(bits, ALNUM.indexOf(text[i]), 6);
    return { mode: 'alnum', bits, count: text.length };
  }
  const bytes = utf8(text);
  for (const b of bytes) pushBits(bits, b, 8);
  return { mode: 'byte', bits, count: bytes.length };
}

function charCountBits(mode: Segment['mode'], version: number) {
  if (mode === 'alnum') return version <= 9 ? 9 : version <= 26 ? 11 : 13;
  return version <= 9 ? 8 : 16;
}

function numRawDataModules(ver: number) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver: number, ecl: QrEcc) {
  const e = ECC_ORDINAL[ecl];
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ERROR_CORRECTION_BLOCKS[e][ver];
}

function rsMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data: number[], ver: number, ecl: QrEcc) {
  const e = ECC_ORDINAL[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function alignmentPositions(ver: number, size: number) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function maskHit(mask: number, x: number, y: number) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function penalty(m: boolean[][], size: number) {
  let points = 0;
  // N1: صفوف/أعمدة من 5 وحدات متماثلة فأكثر
  for (let r = 0; r < size; r++) {
    let sameRow = 0, sameCol = 0;
    let lastRow: boolean | null = null, lastCol: boolean | null = null;
    for (let c = 0; c < size; c++) {
      const a = m[r][c];
      if (a === lastRow) sameRow++;
      else { if (sameRow >= 5) points += 3 + (sameRow - 5); lastRow = a; sameRow = 1; }
      const b = m[c][r];
      if (b === lastCol) sameCol++;
      else { if (sameCol >= 5) points += 3 + (sameCol - 5); lastCol = b; sameCol = 1; }
    }
    if (sameRow >= 5) points += 3 + (sameRow - 5);
    if (sameCol >= 5) points += 3 + (sameCol - 5);
  }
  // N2: مربعات 2×2 بلون واحد
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const sum = +m[r][c] + +m[r][c + 1] + +m[r + 1][c] + +m[r + 1][c + 1];
      if (sum === 4 || sum === 0) points += 3;
    }
  }
  // N3: أنماط تشبه علامة الزاوية
  for (let r = 0; r < size; r++) {
    let rowBits = 0, colBits = 0;
    for (let c = 0; c < size; c++) {
      rowBits = ((rowBits << 1) & 0x7ff) | +m[r][c];
      if (c >= 10 && (rowBits === 0x5d0 || rowBits === 0x05d)) points += 40;
      colBits = ((colBits << 1) & 0x7ff) | +m[c][r];
      if (c >= 10 && (colBits === 0x5d0 || colBits === 0x05d)) points += 40;
    }
  }
  // N4: توازن الداكن والفاتح
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const k = Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10);
  return points + k * 10;
}

/** مصفوفة QR للنص. mask/version/mode للاختبار فقط؛ الافتراضي يختار الأصغر والأفضل. */
export function qrMatrix(
  text: string,
  opts?: { ecc?: QrEcc; mask?: number; minVersion?: number; mode?: 'alnum' | 'byte' },
): QrMatrix {
  const ecl = opts?.ecc ?? 'M';
  const seg = makeSegment(text, opts?.mode);
  let ver = Math.max(1, opts?.minVersion ?? 1);
  let used = 0;
  for (; ; ver++) {
    if (ver > 40) throw new Error('النص أطول من سعة رمز QR');
    const cap = numDataCodewords(ver, ecl) * 8;
    used = 4 + charCountBits(seg.mode, ver) + seg.bits.length;
    if (seg.count < 1 << charCountBits(seg.mode, ver) && used <= cap) break;
  }
  const capBits = numDataCodewords(ver, ecl) * 8;
  const bb: number[] = [];
  pushBits(bb, seg.mode === 'alnum' ? 0x2 : 0x4, 4);
  pushBits(bb, seg.count, charCountBits(seg.mode, ver));
  bb.push(...seg.bits);
  pushBits(bb, 0, Math.min(4, capBits - bb.length));
  pushBits(bb, 0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capBits; pad ^= 0xec ^ 0x11) pushBits(bb, pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bb.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bb[i + j];
    data.push(b);
  }
  const codewords = addEccAndInterleave(data, ver, ecl);

  const size = ver * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver, size);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const drawFormat = (mask: number) => {
    const d = (ECC_FORMAT_BITS[ecl] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit(bits, i));
      setFn(b, a, bit(bits, i));
    }
  }

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!isFn[y][x] && maskHit(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  };
  let mask = opts?.mask ?? -1;
  if (mask < 0 || mask > 7) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      drawFormat(m);
      applyMask(m);
      const score = penalty(modules, size);
      if (score < best) {
        best = score;
        mask = m;
      }
      applyMask(m);
    }
  }
  drawFormat(mask);
  applyMask(mask);
  return { version: ver, size, mask, modules };
}

/**
 * QR كـ SVG بحجم ثابت بالبكسل. margin بالوحدات (المعيار 4؛ 2 يكفي على ورق أبيض).
 * يرجع نصاً فارغاً إن تعذر الترميز حتى لا تفشل الفاتورة.
 */
export function qrSvg(text: string, opts?: { sizePx?: number; margin?: number; ecc?: QrEcc }): string {
  const value = String(text ?? '');
  if (!value) return '';
  let m: QrMatrix;
  try {
    m = qrMatrix(value, { ecc: opts?.ecc ?? 'M' });
  } catch {
    return '';
  }
  const margin = Math.max(0, Math.round(opts?.margin ?? 2));
  const dim = m.size + margin * 2;
  const px = Math.max(dim, Math.round(opts?.sizePx ?? dim * 4));
  let d = '';
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.modules[y][x]) continue;
      let run = 1;
      while (x + run < m.size && m.modules[y][x + run]) run++;
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
