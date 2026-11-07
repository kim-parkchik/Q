/**
 * QR コードを作る（TimeQard の打刻カードに印刷する。くわしくは timeqard/DESIGN.md の 5.2）
 *
 * ・JIS X 0510（ISO/IEC 18004）の QR コード（モデル2）。型番は1〜10、誤り訂正のレベルは L・M・Q・H。
 * ・英数字だけ（0〜9・A〜Z・空白・$%*+-./:）なら「英数字の形」、それ以外は UTF-8 の「8ビットの形」で入れる。
 * ・作り方は、公開されている QR コードの作り方（Project Nayuki の QR Code generator の考え方）に沿う。
 *   新しい部品をダウンロードしないで作れるように、Q の中に書いた。
 * ・Mac に入っている QR コードの読み取り（CoreImage・Vision）で、型番1〜10・4つのレベルのすべてを読めることを確かめた
 *   （scripts/verify_qr_macos.ts）。
 */

export type QrEcc = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  /** 1辺のマスの数（型番1は21） */
  size: number;
  ecc: QrEcc;
  mask: number;
  /** modules[y][x] が true なら黒 */
  modules: boolean[][];
}

const MAX_VERSION = 10;
const ECC_ORDER: QrEcc[] = ["L", "M", "Q", "H"];
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// 型番ごとの、1つのブロックの誤り訂正のコード語の数と、ブロックの数（添字0は使わない）
const ECC_CODEWORDS_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const NUM_ERROR_CORRECTION_BLOCKS: Record<QrEcc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** データを置けるマスの数（機能パターン・形式情報・型番情報を除く） */
const numRawDataModules = (ver: number) => {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
};

/** データのコード語の数（誤り訂正のコード語を除く） */
const numDataCodewords = (ver: number, ecc: QrEcc) =>
  Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];

// --- データを、ビットの並びにする ---

interface Segment {
  mode: "alphanumeric" | "byte";
  count: number;
  bits: number[];
}

const appendBits = (bits: number[], value: number, length: number) => {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
};

const makeSegment = (text: string): Segment => {
  if ([...text].every((c) => ALPHANUMERIC_CHARSET.includes(c))) {
    const bits: number[] = [];
    let i = 0;
    for (; i + 1 < text.length; i += 2) {
      appendBits(bits, ALPHANUMERIC_CHARSET.indexOf(text[i]) * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]), 11);
    }
    if (i < text.length) appendBits(bits, ALPHANUMERIC_CHARSET.indexOf(text[i]), 6);
    return { mode: "alphanumeric", count: text.length, bits };
  }
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];
  for (const b of bytes) appendBits(bits, b, 8);
  return { mode: "byte", count: bytes.length, bits };
};

const MODE_INDICATOR = { alphanumeric: 0x2, byte: 0x4 } as const;

const charCountBits = (mode: Segment["mode"], ver: number) =>
  mode === "alphanumeric" ? (ver <= 9 ? 9 : ver <= 26 ? 11 : 13) : ver <= 9 ? 8 : 16;

// --- リード・ソロモン符号（誤り訂正のコード語） ---

const rsMultiply = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};

const rsDivisor = (degree: number) => {
  const result: number[] = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
};

const rsRemainder = (data: number[], divisor: number[]) => {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
};

/** データのコード語をブロックに分け、ブロックごとに誤り訂正のコード語を足して、交互に並べる */
const addEccAndInterleave = (data: number[], ver: number, ecc: QrEcc) => {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccWords = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccWords));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
};

// --- マスを描く ---

class Matrix {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

const alignmentPositions = (ver: number, size: number) => {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
};

const drawFinder = (m: Matrix, cx: number, cy: number) => {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < m.size && y >= 0 && y < m.size) m.setFunction(x, y, dist !== 2 && dist !== 4);
    }
  }
};

const drawAlignment = (m: Matrix, cx: number, cy: number) => {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
};

const drawFormatBits = (m: Matrix, ecc: QrEcc, mask: number) => {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const size = m.size;
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, bit(i));
  m.setFunction(8, 7, bit(6));
  m.setFunction(8, 8, bit(7));
  m.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.setFunction(8, size - 15 + i, bit(i));
  m.setFunction(8, size - 8, true); // いつも黒
};

const drawVersion = (m: Matrix, ver: number) => {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.setFunction(a, b, dark);
    m.setFunction(b, a, dark);
  }
};

const drawFunctionPatterns = (m: Matrix, ver: number, ecc: QrEcc) => {
  const size = m.size;
  for (let i = 0; i < size; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, size - 4, 3);
  drawFinder(m, 3, size - 4);
  const pos = alignmentPositions(ver, size);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
      if (!onFinder) drawAlignment(m, pos[i], pos[j]);
    }
  }
  drawFormatBits(m, ecc, 0); // 仮の値（マスクを決めてから描き直す）
  drawVersion(m, ver);
};

const drawCodewords = (m: Matrix, data: number[]) => {
  const size = m.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!m.isFunction[y][x] && i < data.length * 8) {
          m.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
};

const maskApplies = (mask: number, x: number, y: number) => {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error(`マスクの番号が違います: ${mask}`);
  }
};

/** マスクをかける（2回かけると元に戻る） */
const applyMask = (m: Matrix, mask: number) => {
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.isFunction[y][x] && maskApplies(mask, x, y)) m.modules[y][x] = !m.modules[y][x];
    }
  }
};

/** 読み取りにくい模様の点数（JIS X 0510 の4つの決まり。小さいほどよい） */
export const penaltyScore = (modules: boolean[][]) => {
  const n = modules.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < n; y++) lines.push(modules[y]);
  for (let x = 0; x < n; x++) lines.push(modules.map((row) => row[x]));
  const finderLike = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (const line of lines) {
    // 決まり1：同じ色が5つ以上続く
    let runLen = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runLen = 1;
      }
    }
    // 決まり3：位置検出パターンに似た並び（1:1:3:1:1 と、片側の白4つ）
    for (let i = 0; i + 11 <= n; i++) {
      for (const pattern of finderLike) {
        if (pattern.every((v, k) => line[i + k] === v)) score += 40;
      }
    }
  }
  // 決まり2：2×2 の同じ色のかたまり
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  // 決まり4：黒の割合が50%から離れている
  let dark = 0;
  for (const row of modules) for (const c of row) if (c) dark++;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
};

/**
 * QR コードを作る。
 * @param ecc 誤り訂正のレベル（初めは Q：約25%が汚れても読める）
 * @param minVersion いちばん小さい型番（入るなら、この型番で作る）
 */
export const encodeQr = (text: string, options: { ecc?: QrEcc; minVersion?: number; mask?: number } = {}): QrCode => {
  const ecc = options.ecc ?? "Q";
  const seg = makeSegment(text);
  let ver = Math.max(1, options.minVersion ?? 1);
  for (; ver <= MAX_VERSION; ver++) {
    const used = 4 + charCountBits(seg.mode, ver) + seg.bits.length;
    if (seg.count < 1 << charCountBits(seg.mode, ver) && used <= numDataCodewords(ver, ecc) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error(`QR コードに入りきりません（${text.length}文字）`);

  const capacityBits = numDataCodewords(ver, ecc) * 8;
  const bits: number[] = [];
  appendBits(bits, MODE_INDICATOR[seg.mode], 4);
  appendBits(bits, seg.count, charCountBits(seg.mode, ver));
  bits.push(...seg.bits);
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length)); // 終わりの印
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  const size = ver * 4 + 17;
  const m = new Matrix(size);
  drawFunctionPatterns(m, ver, ecc);
  drawCodewords(m, addEccAndInterleave(data, ver, ecc));

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(m, candidate);
      drawFormatBits(m, ecc, candidate);
      const score = penaltyScore(m.modules);
      if (score < best) {
        best = score;
        mask = candidate;
      }
      applyMask(m, candidate); // 元に戻す
    }
  }
  applyMask(m, mask);
  drawFormatBits(m, ecc, mask);
  return { version: ver, size, ecc, mask, modules: m.modules };
};

/** 型番・レベルで入る文字数（テスト用） */
export const qrDataCapacityBits = (ver: number, ecc: QrEcc) => numDataCodewords(ver, ecc) * 8;
export const QR_ECC_LEVELS = ECC_ORDER;
export const QR_MAX_VERSION = MAX_VERSION;

/**
 * SVG の path の d（黒いマスを横につなげた四角）。まわりに quiet マス分の白い余白を空ける。
 * viewBox は「0 0 (size + quiet×2) (size + quiet×2)」にする。
 */
export const qrSvgPath = (qr: QrCode, quiet = 4) => {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => {
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < qr.size && row[x]) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join("");
};
