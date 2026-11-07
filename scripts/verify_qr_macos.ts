/**
 * Q で作る QR コード（src/utils/qrCode.ts）を、Mac に入っている読み取り（CoreImage と Vision）で読めるか確かめる。
 *
 * 使い方（Mac で）:  bun scripts/verify_qr_macos.ts
 *
 * ・型番1〜10・誤り訂正の4つのレベルごとに、入るだけの英数字と日本語（8ビットの形）の QR コードを PNG にして読ませる。
 * ・8つのマスクと、打刻カードの中身（37文字）も読ませる。
 * ・どれか1つでも読めないか、中身が違えば、終わりのコードを 1 にする。
 * ・画像は一時フォルダに作り、終わったら消す。新しい部品はダウンロードしない（Swift は Xcode のコマンドラインツールのもの）。
 */
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeQr, qrDataCapacityBits, QR_ECC_LEVELS, QR_MAX_VERSION, type QrCode, type QrEcc } from "../src/utils/qrCode";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** 白黒の PNG（1マス scale 画素、まわりに quiet マスの白） */
const toPng = (qr: QrCode, scale = 6, quiet = 4) => {
  const n = (qr.size + quiet * 2) * scale;
  const raw = new Uint8Array(n * (n + 1));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my][mx];
      raw[y * (n + 1) + 1 + x] = dark ? 0 : 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, n);
  dv.setUint32(4, n);
  ihdr[8] = 8; // 8ビットの灰色
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./:";
let seed = 12345;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const maxAlnum = (v: number, ecc: QrEcc) => {
  const cap = qrDataCapacityBits(v, ecc);
  const cc = v <= 9 ? 9 : 11;
  let n = 0;
  while (4 + cc + 11 * Math.floor((n + 1) / 2) + 6 * ((n + 1) % 2) <= cap) n++;
  return n;
};
const maxBytes = (v: number, ecc: QrEcc) => Math.floor((qrDataCapacityBits(v, ecc) - 4 - (v <= 9 ? 8 : 16)) / 8);

const dir = mkdtempSync(join(tmpdir(), "q-qr-"));
try {
  const expected = new Map<string, string>();
  const save = (name: string, text: string, opts: Parameters<typeof encodeQr>[1], version?: number) => {
    const qr = encodeQr(text, opts);
    if (version !== undefined && qr.version !== version) throw new Error(`${name}: 型番が ${qr.version}（${version} のはず）`);
    writeFileSync(join(dir, `${name}.png`), toPng(qr));
    expected.set(`${name}.png`, text);
  };
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    for (const ecc of QR_ECC_LEVELS) {
      save(`alnum_v${v}_${ecc}`, Array.from({ length: maxAlnum(v, ecc) }, () => ALNUM[rand(ALNUM.length)]).join(""), { ecc, minVersion: v }, v);
      let jp = "";
      for (const ch of "打刻カード山田太郎".repeat(40)) {
        if (new TextEncoder().encode(jp + ch).length > maxBytes(v, ecc)) break;
        jp += ch;
      }
      save(`byte_v${v}_${ecc}`, jp, { ecc, minVersion: v }, v);
    }
  }
  const card = "TQ1K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let mask = 0; mask < 8; mask++) save(`mask${mask}`, card, { mask }, 3);
  save("card", card, {}, 3);

  const decoder = join(dir, "qr_decode");
  const build = Bun.spawnSync(["swiftc", "-O", join(import.meta.dir, "qr_decode_macos.swift"), "-o", decoder]);
  if (build.exitCode !== 0) throw new Error(`Swift のプログラムを作れませんでした:\n${build.stderr.toString()}`);
  const run = Bun.spawnSync([decoder, ...[...expected.keys()].map((n) => join(dir, n))]);
  if (run.exitCode !== 0) throw new Error(`読み取りに失敗しました:\n${run.stderr.toString()}`);

  let ng = 0;
  const lines = run.stdout.toString().trim().split("\n");
  for (const line of lines) {
    const [name, coreImage, vision] = line.split("\t");
    const want = expected.get(name);
    if (coreImage !== want || vision !== want) {
      ng++;
      console.log(`読めない: ${name}（CoreImage: ${coreImage === want ? "OK" : "NG"}・Vision: ${vision === want ? "OK" : "NG"}）`);
    }
  }
  if (lines.length !== expected.size) ng++;
  console.log(`${expected.size}枚のうち、${expected.size - ng}枚を CoreImage と Vision の両方で正しく読めました`);
  process.exitCode = ng === 0 ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
