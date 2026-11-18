/**
 * 文字をシフトJIS のバイトにする（会計ソフトに取り込む CSV など。届書のファイルのような字の決まりはない）
 * ・半角の英数字・記号（0x20〜0x7E）と半角カナは1バイト、ほかの字は、シフトJIS の2バイトの範囲を TextDecoder で読んだ表で引く
 * ・シフトJIS にない字（絵文字・一部の旧字など）は「?」にして、その字を返す（呼ぶ側で知らせる）
 */
let table: Map<string, number> | null = null;

const doubleByteTable = (): Map<string, number> => {
  if (table) return table;
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const map = new Map<string, number>();
  const leads = [...Array.from({ length: 0x9f - 0x81 + 1 }, (_, i) => 0x81 + i), ...Array.from({ length: 0xfc - 0xe0 + 1 }, (_, i) => 0xe0 + i)];
  for (const hi of leads) {
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      try {
        const c = decoder.decode(Uint8Array.of(hi, lo));
        if ([...c].length === 1 && !map.has(c)) map.set(c, (hi << 8) | lo);
      } catch {
        // その2バイトには字がない
      }
    }
  }
  table = map;
  return map;
};

/** 文字列をシフトJIS のバイトにする（改行は呼ぶ側で "\r\n" にしておく）。シフトJIS にない字は「?」にして unknown に入れる */
export const encodeSjisText = (text: string): { bytes: Uint8Array; unknown: string[] } => {
  const map = doubleByteTable();
  const out: number[] = [];
  const unknown = new Set<string>();
  for (const c of text) {
    const code = c.codePointAt(0)!;
    if (code === 0x0d || code === 0x0a || (code >= 0x20 && code <= 0x7e)) {
      out.push(code);
    } else if (code >= 0xff61 && code <= 0xff9f) {
      out.push(code - 0xff61 + 0xa1);
    } else {
      const v = map.get(c);
      if (v === undefined) {
        unknown.add(c);
        out.push(0x3f);
      } else {
        out.push(v >> 8, v & 0xff);
      }
    }
  }
  return { bytes: Uint8Array.from(out), unknown: [...unknown] };
};
