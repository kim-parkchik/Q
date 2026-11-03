/**
 * マイナンバーの暗号化（myNumberCrypto.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  createKeys,
  decodeRecoveryKey,
  decryptNumber,
  encryptNumber,
  formatRecoveryKey,
  isEncryptedNumber,
  numberHash,
  openWithPassword,
  openWithRecovery,
  passwordError,
  recoveryKeyError,
  rewrapWithPassword,
  rewrapWithRecovery,
  RECOVERY_KEY_LENGTH,
  type DeriveKey,
} from "./myNumberCrypto";

/** テストでは Argon2id（Rust）の代わりに、軽い PBKDF2 で鍵を作る */
const testDerive: DeriveKey = async (password, salt) => {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, base, 256));
};

const PASSWORD = "きゅうよの しめは まいつき にじゅうごにち";

describe("パスワードの決まり", () => {
  test("15文字以上（1文字は Unicode の1文字。全角・半角はそろえて数える）", () => {
    expect(passwordError("a".repeat(14))).toBe("パスワードは15文字以上にしてください（いまは14文字）。");
    expect(passwordError("a".repeat(15))).toBeNull();
    expect(passwordError("あ".repeat(15))).toBeNull();
    // 英数字を混ぜるなどのきまりは付けない
    expect(passwordError("aaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
});

describe("鍵", () => {
  test("パスワードで開けられる。違うパスワードでは開けられない", async () => {
    const { record, keys } = await createKeys(PASSWORD, testDerive);
    const opened = await openWithPassword(record, PASSWORD, testDerive);
    expect(opened).not.toBeNull();
    expect([...opened!.master]).toEqual([...keys.master]);
    expect(await openWithPassword(record, PASSWORD + "x", testDerive)).toBeNull();
  });

  test("全角・半角の違いでは開けなくならない", async () => {
    const { record } = await createKeys("Ｑｙｕｕｙｏ　Ｋｅｉｓａｎ　２０２６", testDerive);
    expect(await openWithPassword(record, "Qyuuyo Keisan 2026", testDerive)).not.toBeNull();
  });

  test("回復用キーだけで開けられる（空白・小文字・O と 0 の取り違えも読む）", async () => {
    const { record, keys, recoveryKey } = await createKeys(PASSWORD, testDerive);
    expect(recoveryKey.replace(/ /g, "")).toHaveLength(RECOVERY_KEY_LENGTH);
    expect(recoveryKey.split(" ")).toHaveLength(13);
    const opened = await openWithRecovery(record, recoveryKey.toLowerCase().replace(/0/g, "o"));
    expect([...opened!.master]).toEqual([...keys.master]);
    // 1文字違えば開けられない
    const wrong = (recoveryKey[0] === "A" ? "B" : "A") + recoveryKey.slice(1);
    expect(await openWithRecovery(record, wrong)).toBeNull();
    expect(await openWithRecovery(record, "ABCD")).toBeNull();
  });

  test("パスワードを変えると、前のパスワードでは開けない（回復用キーはそのまま）", async () => {
    const { record, keys, recoveryKey } = await createKeys(PASSWORD, testDerive);
    const next = await rewrapWithPassword(record, keys, "あたらしい ぱすわーど です よ", testDerive);
    expect(await openWithPassword(next, PASSWORD, testDerive)).toBeNull();
    expect(await openWithPassword(next, "あたらしい ぱすわーど です よ", testDerive)).not.toBeNull();
    expect(await openWithRecovery(next, recoveryKey)).not.toBeNull();
  });

  test("回復用キーを作り直すと、前の回復用キーでは開けない（パスワードはそのまま）", async () => {
    const { record, keys, recoveryKey } = await createKeys(PASSWORD, testDerive);
    const renewed = await rewrapWithRecovery(record, keys);
    expect(renewed.recoveryKey).not.toBe(recoveryKey);
    expect(await openWithRecovery(renewed.record, recoveryKey)).toBeNull();
    expect(await openWithRecovery(renewed.record, renewed.recoveryKey)).not.toBeNull();
    expect(await openWithPassword(renewed.record, PASSWORD, testDerive)).not.toBeNull();
  });
});

describe("番号", () => {
  test("暗号化して戻せる。同じ番号でも毎回違う暗号文になる", async () => {
    const { keys } = await createKeys(PASSWORD, testDerive);
    const a = await encryptNumber(keys, "123456789018", "1001", "self");
    const b = await encryptNumber(keys, "123456789018", "1001", "self");
    expect(isEncryptedNumber(a)).toBe(true);
    expect(a).not.toContain("123456789018");
    expect(a).not.toBe(b);
    expect(await decryptNumber(keys, a, "1001", "self")).toBe("123456789018");
  });

  test("ほかの人の行に写したもの・違う鍵・暗号化していない番号は戻せない", async () => {
    const { keys } = await createKeys(PASSWORD, testDerive);
    const other = (await createKeys(PASSWORD, testDerive)).keys;
    const a = await encryptNumber(keys, "123456789018", "1001", "self");
    await expect(decryptNumber(keys, a, "1002", "self")).rejects.toThrow("戻せませんでした");
    await expect(decryptNumber(keys, a, "1001", "family:1972-01-01:国税 花子")).rejects.toThrow("戻せませんでした");
    await expect(decryptNumber(other, a, "1001", "self")).rejects.toThrow("戻せませんでした");
    await expect(decryptNumber(keys, "123456789018", "1001", "self")).rejects.toThrow("暗号化されていない");
  });

  test("同じ番号の確かめ：同じ鍵なら同じ値、鍵が違えば違う値（番号そのものは出ない）", async () => {
    const { keys } = await createKeys(PASSWORD, testDerive);
    const other = (await createKeys(PASSWORD, testDerive)).keys;
    const h = await numberHash(keys, "123456789018");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await numberHash(keys, "123456789018")).toBe(h);
    expect(await numberHash(keys, "987654321093")).not.toBe(h);
    expect(await numberHash(other, "123456789018")).not.toBe(h);
  });
});

describe("回復用キーの形", () => {
  test("52文字・4文字ずつ。打ち間違いを知らせる", () => {
    const key = "0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJ0";
    expect(decodeRecoveryKey(key)).toHaveLength(32);
    expect(formatRecoveryKey(key)).toBe("0123 4567 89AB CDEF GHJK MNPQ RSTV WXYZ 0123 4567 89AB CDEF GHJ0");
    expect(recoveryKeyError(key)).toBeNull();
    expect(recoveryKeyError(key.slice(1))).toBe("回復用キーは52文字です（いまは51文字）。");
    expect(recoveryKeyError(key.slice(0, 51) + "U")).toBe("回復用キーに使わない文字があります：U");
    // 最後の文字は、残りの4ビットが0でなければならない
    expect(recoveryKeyError(key.slice(0, 51) + "1")).toBe("回復用キーの最後の文字が違います。");
  });
});
