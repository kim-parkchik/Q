/**
 * マイナンバーの鍵の開け閉め（myNumberVault.ts）のテスト
 * 実行方法: bun test
 */
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../../types/dbSchema";
import { SELF_KEY } from "../../utils/myNumber";
import { isEncryptedNumber, numberHash, type DeriveKey } from "../../utils/myNumberCrypto";
import { loadMyNumbers } from "./myNumberStore";
import {
  changeVaultPassword,
  loadKeyRecord,
  lockVault,
  recoverVault,
  renewVaultRecoveryKey,
  setupVault,
  unlockVault,
  vaultExpiresAt,
  vaultKeys,
  VAULT_IDLE_MINUTES,
} from "./myNumberVault";

/** テストでは Argon2id（Rust）の代わりに、軽い PBKDF2 で鍵を作る */
const testDerive: DeriveKey = async (password, salt) => {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, base, 256));
};

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
const wrap = (db: Database) => ({
  execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...(params as any[])),
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const PASSWORD = "きゅうよの しめは まいつき にじゅうごにち";
const NEW_PASSWORD = "あたらしい ぱすわーど です よ";
const user = { id: 1, login_id: "admin", display_name: "管理者" };

const open = () => {
  const raw = new Database(":memory:");
  for (const s of DB_SCHEMAS) raw.exec(s);
  raw.exec("INSERT INTO staff (id, name, base_wage) VALUES ('1001', '国税 太郎', 300000)");
  return { raw, db: wrap(raw) };
};
const logs = (raw: Database) => (raw.query("SELECT message FROM app_logs WHERE category = 'mynumber' ORDER BY id").all() as { message: string }[]).map((r) => r.message);

afterEach(() => {
  lockVault("close");
  setSystemTime();
});

describe("暗号化を始める", () => {
  test("登録済みの番号を暗号化し、鍵を開けた状態にする（回復用キーはこの1回だけ）", async () => {
    const { raw, db } = open();
    raw.exec("INSERT INTO my_numbers (staff_id, person, number) VALUES ('1001', 'self', '123456789018')");
    const recoveryKey = await setupVault(db, user, PASSWORD, testDerive);
    expect(recoveryKey.replace(/ /g, "")).toHaveLength(52);
    const row = raw.query("SELECT number, number_hash AS h FROM my_numbers").get() as { number: string; h: string };
    expect(isEncryptedNumber(row.number)).toBe(true);
    expect(row.number).not.toContain("123456789018");
    const keys = vaultKeys(db)!;
    expect(row.h).toBe(await numberHash(keys, "123456789018"));
    expect(await loadMyNumbers(db, keys)).toEqual({ "1001": { [SELF_KEY]: "123456789018" } });
    expect(await loadKeyRecord(db)).not.toBeNull();
    expect(logs(raw)).toEqual(["マイナンバーの暗号化を始めました（パスワードと回復用キーを作りました。登録済みの1件を暗号化しました）"]);
    // 記録や鍵の表に、番号もパスワードも残さない
    const dump = JSON.stringify([raw.query("SELECT * FROM app_logs").all(), raw.query("SELECT * FROM my_number_keys").all()]);
    expect(dump).not.toContain("123456789018");
    expect(dump).not.toContain(PASSWORD);
    // 2回目は始められない
    await expect(setupVault(db, user, PASSWORD, testDerive)).rejects.toThrow("もう始めています");
  });
});

describe("開け閉め", () => {
  test("パスワードで開け、手で閉じる。違うパスワードは記録に残す", async () => {
    const { raw, db } = open();
    await setupVault(db, user, PASSWORD, testDerive);
    lockVault("manual");
    expect(vaultKeys(db)).toBeNull();
    expect(await unlockVault(db, user, PASSWORD + "x", testDerive)).toBe(false);
    expect(vaultKeys(db)).toBeNull();
    expect(await unlockVault(db, user, PASSWORD, testDerive)).toBe(true);
    expect(vaultKeys(db)).not.toBeNull();
    expect(logs(raw).slice(1)).toEqual([
      "マイナンバーの鍵を閉じました（手で閉じました）",
      "パスワードが違ったため、マイナンバーの鍵を開けられませんでした",
      "マイナンバーの鍵を開けました",
    ]);
  });

  test("最後に使ってから15分で閉じる（使うたびに延びる）", async () => {
    const { raw, db } = open();
    const start = new Date("2026-11-04T10:00:00");
    setSystemTime(start);
    await setupVault(db, user, PASSWORD, testDerive);
    setSystemTime(new Date(start.getTime() + 10 * 60 * 1000));
    expect(vaultKeys(db)).not.toBeNull(); // 10分後に使った → そこから15分
    expect(vaultExpiresAt(db)).toBe(start.getTime() + 25 * 60 * 1000);
    setSystemTime(new Date(start.getTime() + 24 * 60 * 1000));
    expect(vaultKeys(db)).not.toBeNull();
    setSystemTime(new Date(start.getTime() + (24 + VAULT_IDLE_MINUTES) * 60 * 1000));
    expect(vaultKeys(db)).toBeNull();
    expect(logs(raw).at(-1)).toBe("マイナンバーの鍵を閉じました（15分使わなかったため）");
  });

  test("ほかの会社ファイルでは、開けた鍵を使わない", async () => {
    const a = open();
    const b = open();
    await setupVault(a.db, user, PASSWORD, testDerive);
    expect(vaultKeys(a.db)).not.toBeNull();
    expect(vaultKeys(b.db)).toBeNull();
  });
});

describe("パスワードを忘れたとき・変えるとき", () => {
  test("回復用キーで開けて新しいパスワードを決める。回復用キーも作り直し、前のものは使えない", async () => {
    const { raw, db } = open();
    const first = await setupVault(db, user, PASSWORD, testDerive);
    lockVault("manual");
    expect(await recoverVault(db, user, "0".repeat(52), NEW_PASSWORD, testDerive)).toBeNull();
    const second = await recoverVault(db, user, first.toLowerCase(), NEW_PASSWORD, testDerive);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(vaultKeys(db)).not.toBeNull();
    lockVault("close");
    expect(await unlockVault(db, user, PASSWORD, testDerive)).toBe(false);
    expect(await unlockVault(db, user, NEW_PASSWORD, testDerive)).toBe(true);
    lockVault("close");
    expect(await recoverVault(db, user, first, PASSWORD, testDerive)).toBeNull();
    expect(logs(raw)).toContain("回復用キーでマイナンバーの鍵を開け、パスワードを決め直しました（回復用キーも作り直しました。前の回復用キーは使えません）");
    expect(logs(raw)).toContain("回復用キーが違ったため、マイナンバーの鍵を開けられませんでした");
  });

  test("パスワードを変える（今のパスワードが要る）。番号は暗号化し直さない", async () => {
    const { raw, db } = open();
    raw.exec("INSERT INTO my_numbers (staff_id, person, number) VALUES ('1001', 'self', '123456789018')");
    await setupVault(db, user, PASSWORD, testDerive);
    const before = (raw.query("SELECT number FROM my_numbers").get() as { number: string }).number;
    expect(await changeVaultPassword(db, user, "ちがう ぱすわーど です よ ね", NEW_PASSWORD, testDerive)).toBe(false);
    expect(await changeVaultPassword(db, user, PASSWORD, NEW_PASSWORD, testDerive)).toBe(true);
    expect((raw.query("SELECT number FROM my_numbers").get() as { number: string }).number).toBe(before);
    // 開けていた鍵はそのまま使える
    expect(await loadMyNumbers(db, vaultKeys(db)!)).toEqual({ "1001": { [SELF_KEY]: "123456789018" } });
    lockVault("close");
    expect(await unlockVault(db, user, NEW_PASSWORD, testDerive)).toBe(true);
    expect(await loadMyNumbers(db, vaultKeys(db)!)).toEqual({ "1001": { [SELF_KEY]: "123456789018" } });
  });

  test("回復用キーを作り直す（パスワードが要る。前の回復用キーは使えない）", async () => {
    const { db } = open();
    const first = await setupVault(db, user, PASSWORD, testDerive);
    expect(await renewVaultRecoveryKey(db, user, NEW_PASSWORD, testDerive)).toBeNull();
    const second = await renewVaultRecoveryKey(db, user, PASSWORD, testDerive);
    expect(second).not.toBeNull();
    lockVault("close");
    expect(await recoverVault(db, user, first, NEW_PASSWORD, testDerive)).toBeNull();
    expect(await recoverVault(db, user, second!, NEW_PASSWORD, testDerive)).not.toBeNull();
  });
});
