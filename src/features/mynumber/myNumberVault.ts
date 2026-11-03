/**
 * マイナンバーの鍵（金庫）を開け閉めする。開けている間だけ、データ鍵をメモリに置く（ファイルには置かない）
 * 暗号のしくみと出典は utils/myNumberCrypto.ts
 * ・最後に使ってから15分で自動で閉じる（VAULT_IDLE_MINUTES）。会社ファイルを閉じたときも閉じる
 * ・開けた・開けられなかった・閉じた・パスワードを変えた・回復用キーを使った／作り直したことは、取扱いの記録に残す
 *   （同ガイドライン（別添1）2 C b：情報システムの利用状況（ログイン実績等）の記録）
 */
import { invoke } from "@tauri-apps/api/core";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import {
  createKeys,
  encryptNumber,
  isEncryptedNumber,
  numberHash,
  openWithPassword,
  openWithRecovery,
  rewrapWithPassword,
  rewrapWithRecovery,
  type DeriveKey,
  type KeyRecord,
  type OpenKeys,
} from "../../utils/myNumberCrypto";
import { logMyNumber, type MyNumberUser } from "./myNumberStore";

/** 使わなくなってから自動で閉じるまで（分） */
export const VAULT_IDLE_MINUTES = 15;

/** アプリでの鍵の作り方（Rust の Argon2id。src-tauri/src/lib.rs の derive_key） */
export const deriveKeyArgon2: DeriveKey = async (password, salt, kdf) => {
  if (kdf.name !== "argon2id") throw new Error(`知らない鍵の作り方です：${kdf.name}`);
  const key = await invoke<number[]>("derive_key", {
    password, salt: Array.from(salt), memoryKib: kdf.memoryKib, iterations: kdf.iterations, parallelism: kdf.parallelism,
  });
  return new Uint8Array(key);
};

interface VaultState {
  db: Database;
  user: MyNumberUser | null;
  keys: OpenKeys;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

let state: VaultState | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version += 1;
  listeners.forEach((f) => f());
};

/** 開け閉めを知らせてもらう（React の useSyncExternalStore 用） */
export const subscribeVault = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const vaultVersion = () => version;

const idleMs = () => VAULT_IDLE_MINUTES * 60 * 1000;

/** 使ったので、閉じるまでの時間を延ばす */
const touch = (s: VaultState) => {
  clearTimeout(s.timer);
  s.expiresAt = Date.now() + idleMs();
  s.timer = setTimeout(() => lockVault("idle"), idleMs());
};

const open = (db: Database, user: MyNumberUser | null, keys: OpenKeys) => {
  if (state) lockVault("replace");
  state = { db, user, keys, expiresAt: Date.now() + idleMs(), timer: setTimeout(() => lockVault("idle"), idleMs()) };
  notify();
};

/**
 * 鍵を閉じる（データ鍵をメモリから消す）
 * idle：15分使わなかった／manual：手で閉じた（記録に残す）。close：会社ファイルを閉じる／replace：開け直す（記録に残さない）
 */
export function lockVault(reason: "idle" | "manual" | "close" | "replace" = "manual") {
  if (!state) return;
  const { db, user, keys, timer } = state;
  clearTimeout(timer);
  keys.master.fill(0);
  state = null;
  notify();
  if (reason === "idle" || reason === "manual") {
    const why = reason === "idle" ? `${VAULT_IDLE_MINUTES}分使わなかったため` : "手で閉じました";
    logMyNumber(db, user, `マイナンバーの鍵を閉じました（${why}）`).catch((e) => console.error(e));
  }
}

/** 開いている鍵（この会社ファイルで開けていなければ null）。使うたびに、閉じるまでの時間を延ばす */
export const vaultKeys = (db: Database): OpenKeys | null => {
  if (!state || state.db !== db) return null;
  // 眠っていた間などで時計が先に進んでいたら閉じる
  if (Date.now() >= state.expiresAt) {
    lockVault("idle");
    return null;
  }
  touch(state);
  return state.keys;
};

/** 自動で閉じる時刻（開いていなければ null） */
export const vaultExpiresAt = (db: Database): number | null => (state && state.db === db ? state.expiresAt : null);

/** 包んだデータ鍵を読む（暗号化をまだ始めていなければ null） */
export const loadKeyRecord = async (db: Database): Promise<KeyRecord | null> => {
  const rows = await db.select<any[]>("SELECT kdf, salt, wrapped_by_password, recovery_salt, wrapped_by_recovery FROM my_number_keys WHERE id = 1");
  const r = rows?.[0];
  if (!r) return null;
  return { kdf: JSON.parse(r.kdf), salt: r.salt, wrappedByPassword: r.wrapped_by_password, recoverySalt: r.recovery_salt, wrappedByRecovery: r.wrapped_by_recovery };
};

const saveKeyRecord = (db: Database, r: KeyRecord) =>
  db.execute(
    `INSERT INTO my_number_keys (id, kdf, salt, wrapped_by_password, recovery_salt, wrapped_by_recovery)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kdf = excluded.kdf, salt = excluded.salt, wrapped_by_password = excluded.wrapped_by_password,
       recovery_salt = excluded.recovery_salt, wrapped_by_recovery = excluded.wrapped_by_recovery,
       updated_at = DATETIME('now', 'localtime')`,
    [JSON.stringify(r.kdf), r.salt, r.wrappedByPassword, r.recoverySalt, r.wrappedByRecovery]
  );

/**
 * 暗号化していない番号（暗号化を始める前に登録したもの・始める途中で止まったもの）を暗号化する
 * 暗号化したら、消した元の番号がファイルの空き場所に残らないように、ファイルを作り直す（VACUUM）
 * 戻り値: 暗号化した件数
 */
const encryptPlainRows = async (db: Database, keys: OpenKeys): Promise<number> => {
  const rows = await db.select<any[]>("SELECT staff_id, person, number FROM my_numbers");
  const plain = rows.filter((r) => !isEncryptedNumber(String(r.number)));
  for (const r of plain) {
    const id = String(r.staff_id);
    const person = String(r.person);
    const number = String(r.number);
    await db.execute("UPDATE my_numbers SET number = ?, number_hash = ? WHERE staff_id = ? AND person = ?", [
      await encryptNumber(keys, number, id, person), await numberHash(keys, number), id, person,
    ]);
  }
  if (plain.length > 0) {
    try {
      await db.execute("VACUUM");
      await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (e) {
      console.error("VACUUM に失敗しました", e);
    }
  }
  return plain.length;
};

/**
 * 暗号化を始める（はじめに1回）。パスワードを決め、登録済みの番号を暗号化し、鍵を開けた状態にする
 * 戻り値: 回復用キー（この1回だけ。紙に書いてしまってもらう）
 */
export const setupVault = async (db: Database, user: MyNumberUser | null, password: string, derive: DeriveKey = deriveKeyArgon2): Promise<string> => {
  if (await loadKeyRecord(db)) throw new Error("マイナンバーの暗号化は、もう始めています");
  const { record, keys, recoveryKey } = await createKeys(password, derive);
  // 先に鍵を置いてから番号を暗号化する（途中で止まっても、次に開けたときに残りを暗号化する）
  await saveKeyRecord(db, record);
  open(db, user, keys);
  const n = await encryptPlainRows(db, keys);
  await logMyNumber(db, user, `マイナンバーの暗号化を始めました（パスワードと回復用キーを作りました${n > 0 ? `。登録済みの${n}件を暗号化しました` : ""}）`);
  return recoveryKey;
};

/** パスワードで開ける（違えば false） */
export const unlockVault = async (db: Database, user: MyNumberUser | null, password: string, derive: DeriveKey = deriveKeyArgon2): Promise<boolean> => {
  const record = await loadKeyRecord(db);
  if (!record) throw new Error("マイナンバーの暗号化をまだ始めていません");
  const keys = await openWithPassword(record, password, derive);
  if (!keys) {
    await logMyNumber(db, user, "パスワードが違ったため、マイナンバーの鍵を開けられませんでした");
    return false;
  }
  open(db, user, keys);
  await logMyNumber(db, user, "マイナンバーの鍵を開けました");
  await encryptPlainRows(db, keys);
  return true;
};

/**
 * 回復用キーで開け、新しいパスワードを決める。回復用キーも作り直す（打ち込んだときに見られたかもしれないので）
 * 戻り値: 新しい回復用キー（回復用キーが違えば null）
 */
export const recoverVault = async (
  db: Database, user: MyNumberUser | null, recoveryKey: string, newPassword: string, derive: DeriveKey = deriveKeyArgon2
): Promise<string | null> => {
  const record = await loadKeyRecord(db);
  if (!record) throw new Error("マイナンバーの暗号化をまだ始めていません");
  const keys = await openWithRecovery(record, recoveryKey);
  if (!keys) {
    await logMyNumber(db, user, "回復用キーが違ったため、マイナンバーの鍵を開けられませんでした");
    return null;
  }
  const renewed = await rewrapWithRecovery(await rewrapWithPassword(record, keys, newPassword, derive), keys);
  await saveKeyRecord(db, renewed.record);
  open(db, user, keys);
  await logMyNumber(db, user, "回復用キーでマイナンバーの鍵を開け、パスワードを決め直しました（回復用キーも作り直しました。前の回復用キーは使えません）");
  await encryptPlainRows(db, keys);
  return renewed.recoveryKey;
};

/** パスワードを変える（今のパスワードが違えば false） */
export const changeVaultPassword = async (
  db: Database, user: MyNumberUser | null, current: string, next: string, derive: DeriveKey = deriveKeyArgon2
): Promise<boolean> => {
  const record = await loadKeyRecord(db);
  if (!record) throw new Error("マイナンバーの暗号化をまだ始めていません");
  const keys = await openWithPassword(record, current, derive);
  if (!keys) {
    await logMyNumber(db, user, "パスワードが違ったため、マイナンバーの鍵のパスワードを変えられませんでした");
    return false;
  }
  await saveKeyRecord(db, await rewrapWithPassword(record, keys, next, derive));
  keys.master.fill(0);
  await logMyNumber(db, user, "マイナンバーの鍵のパスワードを変えました");
  return true;
};

/**
 * 回復用キーを作り直す（紙をなくした・見られたかもしれないとき。前の回復用キーは使えなくなる）
 * 戻り値: 新しい回復用キー（パスワードが違えば null）
 */
export const renewVaultRecoveryKey = async (
  db: Database, user: MyNumberUser | null, password: string, derive: DeriveKey = deriveKeyArgon2
): Promise<string | null> => {
  const record = await loadKeyRecord(db);
  if (!record) throw new Error("マイナンバーの暗号化をまだ始めていません");
  const keys = await openWithPassword(record, password, derive);
  if (!keys) {
    await logMyNumber(db, user, "パスワードが違ったため、回復用キーを作り直せませんでした");
    return null;
  }
  const renewed = await rewrapWithRecovery(record, keys);
  await saveKeyRecord(db, renewed.record);
  keys.master.fill(0);
  await logMyNumber(db, user, "回復用キーを作り直しました（前の回復用キーは使えません）");
  return renewed.recoveryKey;
};
