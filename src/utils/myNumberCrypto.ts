/**
 * マイナンバーの暗号化（鍵の作り方と、番号の暗号化・復号）
 * 画面やデータベースには触らない（開け閉めとデータベースは features/mynumber/myNumberVault.ts）
 *
 * ■ なぜ暗号化するか
 *   会社ファイル（.qp）とバックアップ（.qb）は、持ち出されると中が読める。番号は暗号化して置く。
 *   個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」（令和7年6月一部改正）（別添1）2：
 *   ・F 技術的安全管理措置 d 漏えい等の防止《手法の例示》
 *     「情報システム内に保存されている特定個人情報等の漏えい等の防止策としては、データの暗号化又はパスワードによる保護等が考えられる」
 *   ・E 物理的安全管理措置 c：電子媒体を持ち運ぶときは、容易に個人番号が判明しないよう、データの暗号化など
 *
 * ■ 鍵のしくみ
 *   ・番号を暗号化する鍵（データ鍵。32バイトの乱数）を1つ作り、それを2通りに包んで（暗号化して）my_number_keys に置く
 *       1. パスワードから作った鍵で包む（Argon2id。下の KDF_DEFAULT）
 *       2. 回復用キー（32バイトの乱数。紙に書いて別にしまう）から作った鍵で包む（HKDF-SHA-256）
 *     どちらか一方があれば、データ鍵を取り出せる。パスワードや回復用キーを変えても、包み直すだけで番号は暗号化し直さない。
 *   ・データ鍵から HKDF-SHA-256 で2つの鍵を作る：番号の暗号化（AES-256-GCM）と、同じ番号かどうかの確かめ（HMAC-SHA-256）
 *   ・番号は「v1:」＋ base64（IV 12バイト＋暗号文＋認証タグ）で置く。従業員IDと人の印を AAD に入れて、
 *     ほかの人の行に写しても解けないようにする
 *   ・パスワードを忘れ、回復用キーもなくすと、番号は戻せない。同ガイドライン（別添2）1 C では、
 *     暗号化した特定個人情報の復号キーをなくして復元できなくなることは「毀損」に当たる（同じデータがほかに保管されていれば当たらない）
 *
 * ■ パスワード
 *   ・15文字以上。英数字を混ぜるなどのきまりは付けない（NIST SP 800-63B-4 3.1.1.2：パスワードだけで守るときは15文字以上。
 *     ほかの組み合わせのきまりは付けない）。文字数は Unicode の1文字を1と数える（同）
 *   ・全角・半角の違いで開けなくならないように、NFKC で正規化してから鍵を作る
 *
 * ■ パスワードから鍵を作る強さ
 *   Argon2id、メモリ 46 MiB・2回・並列1（OWASP「Password Storage Cheat Sheet」の最低線の1つ m=47104 (46 MiB), t=1, p=1 より回数を増やす）。
 *   強さは my_number_keys に一緒に置くので、後から上げられる（上げたら、次にパスワードを変えるときに新しい強さで包み直す）
 */

/** パスワードから鍵を作る方式と強さ */
export interface KdfParams {
  name: "argon2id";
  /** メモリ（KiB） */
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

/** パスワードから32バイトの鍵を作る（アプリでは Rust の Argon2id。テストでは軽いものに差し替える） */
export type DeriveKey = (password: string, salt: Uint8Array, kdf: KdfParams) => Promise<Uint8Array>;

export const KDF_DEFAULT: KdfParams = { name: "argon2id", memoryKib: 47104, iterations: 2, parallelism: 1 };

/** パスワードの最低の文字数（NIST SP 800-63B-4 3.1.1.2） */
export const PASSWORD_MIN_LENGTH = 15;

/** 包んだデータ鍵（my_number_keys の1行） */
export interface KeyRecord {
  kdf: KdfParams;
  /** パスワードから鍵を作るときの salt（base64） */
  salt: string;
  wrappedByPassword: string;
  recoverySalt: string;
  wrappedByRecovery: string;
}

/** 開けたデータ鍵（メモリにだけ置く） */
export interface OpenKeys {
  readonly master: Uint8Array;
  readonly enc: CryptoKey;
  readonly mac: CryptoKey;
}

const text = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

const PASSWORD_AAD = "Q:mynumber:key:password:v1";
const RECOVERY_AAD = "Q:mynumber:key:recovery:v1";
const NUMBER_PREFIX = "v1:";

/** パスワードを鍵にする前の形（全角・半角をそろえる） */
const normalizePassword = (password: string) => password.normalize("NFKC");

/** パスワードの決まりに合わないときの説明（合えば null） */
export const passwordError = (password: string): string | null => {
  const length = [...normalizePassword(password)].length;
  if (length < PASSWORD_MIN_LENGTH) return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください（いまは${length}文字）。`;
  return null;
};

const aesKey = (raw: Uint8Array) => subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: string, alg: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) => {
  const base = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: text.encode(info) }, base, alg, false, usages);
};

/** 暗号化して base64（IV＋暗号文＋認証タグ）にする */
const seal = async (key: CryptoKey, plain: Uint8Array, aad: string) => {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: text.encode(aad) }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64(out);
};

/** seal の逆（鍵や AAD が違う・書き換えられているときは throw） */
const unseal = async (key: CryptoKey, sealed: string, aad: string) => {
  const b = fromBase64(sealed);
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: text.encode(aad) }, key, b.slice(12)));
};

const openKeys = async (master: Uint8Array): Promise<OpenKeys> => {
  const none = new Uint8Array(0);
  return {
    master,
    enc: await hkdf(master, none, "Q mynumber number v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    mac: await hkdf(master, none, "Q mynumber hash v1", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
  };
};

const passwordKek = async (password: string, salt: Uint8Array, kdf: KdfParams, derive: DeriveKey) =>
  aesKey(await derive(normalizePassword(password), salt, kdf));

const recoveryKek = (recovery: Uint8Array, salt: Uint8Array) =>
  hkdf(recovery, salt, "Q mynumber recovery v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);

const wrapWithPassword = async (master: Uint8Array, password: string, derive: DeriveKey, kdf: KdfParams) => {
  const salt = randomBytes(16);
  return { kdf, salt: toBase64(salt), wrappedByPassword: await seal(await passwordKek(password, salt, kdf, derive), master, PASSWORD_AAD) };
};

const wrapWithRecovery = async (master: Uint8Array) => {
  const recovery = randomBytes(32);
  const salt = randomBytes(16);
  return {
    part: { recoverySalt: toBase64(salt), wrappedByRecovery: await seal(await recoveryKek(recovery, salt), master, RECOVERY_AAD) },
    recoveryKey: formatRecoveryKey(encodeBase32(recovery)),
  };
};

/** はじめて鍵を作る（データ鍵をパスワードと回復用キーで包む。回復用キーはこの1回だけ返す） */
export const createKeys = async (password: string, derive: DeriveKey, kdf: KdfParams = KDF_DEFAULT) => {
  const master = randomBytes(32);
  const byPassword = await wrapWithPassword(master, password, derive, kdf);
  const byRecovery = await wrapWithRecovery(master);
  const record: KeyRecord = { ...byPassword, ...byRecovery.part };
  return { record, keys: await openKeys(master), recoveryKey: byRecovery.recoveryKey };
};

/** パスワードで開ける（違えば null） */
export const openWithPassword = async (record: KeyRecord, password: string, derive: DeriveKey): Promise<OpenKeys | null> => {
  const kek = await passwordKek(password, fromBase64(record.salt), record.kdf, derive);
  try {
    return await openKeys(await unseal(kek, record.wrappedByPassword, PASSWORD_AAD));
  } catch {
    return null;
  }
};

/** 回復用キーで開ける（違えば null） */
export const openWithRecovery = async (record: KeyRecord, recoveryKey: string): Promise<OpenKeys | null> => {
  const recovery = decodeRecoveryKey(recoveryKey);
  if (!recovery) return null;
  const kek = await recoveryKek(recovery, fromBase64(record.recoverySalt));
  try {
    return await openKeys(await unseal(kek, record.wrappedByRecovery, RECOVERY_AAD));
  } catch {
    return null;
  }
};

/** パスワードを変える（データ鍵を新しいパスワードで包み直す。回復用キーはそのまま） */
export const rewrapWithPassword = async (record: KeyRecord, keys: OpenKeys, password: string, derive: DeriveKey, kdf: KdfParams = KDF_DEFAULT): Promise<KeyRecord> =>
  ({ ...record, ...(await wrapWithPassword(keys.master, password, derive, kdf)) });

/** 回復用キーを作り直す（前の回復用キーでは開けなくなる） */
export const rewrapWithRecovery = async (record: KeyRecord, keys: OpenKeys) => {
  const byRecovery = await wrapWithRecovery(keys.master);
  return { record: { ...record, ...byRecovery.part }, recoveryKey: byRecovery.recoveryKey };
};

const numberAad = (staffId: string, person: string) => JSON.stringify(["Q:mynumber:number:v1", staffId, person]);

/** 暗号化した番号か（暗号化を始める前に登録した番号は、そのままの12桁） */
export const isEncryptedNumber = (stored: string) => stored.startsWith(NUMBER_PREFIX);

/** 番号を暗号化する（従業員IDと人の印に結び付ける） */
export const encryptNumber = async (keys: OpenKeys, number: string, staffId: string, person: string) =>
  NUMBER_PREFIX + (await seal(keys.enc, text.encode(number), numberAad(staffId, person)));

/** 番号を戻す（鍵が違う・ほかの行から写した・書き換えられたときは throw） */
export const decryptNumber = async (keys: OpenKeys, stored: string, staffId: string, person: string) => {
  if (!isEncryptedNumber(stored)) throw new Error("暗号化されていないマイナンバーがあります");
  try {
    return new TextDecoder().decode(await unseal(keys.enc, stored.slice(NUMBER_PREFIX.length), numberAad(staffId, person)));
  } catch {
    throw new Error("マイナンバーを戻せませんでした（鍵が違うか、データが壊れています）");
  }
};

/** 同じ番号かどうかを確かめるための値（鍵がないと、番号から逆に求められない） */
export const numberHash = async (keys: OpenKeys, number: string) =>
  toHex(new Uint8Array(await subtle().sign("HMAC", keys.mac, text.encode(number))));

// ─── 回復用キー（32バイトを Crockford の Base32 で52文字。見間違えやすい I・L・O・U は使わない） ───

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_KEY_LENGTH = 52;

const encodeBase32 = (bytes: Uint8Array) => {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/** 打ち込んだ回復用キーを、空白・ハイフンを除いた大文字にする（O は 0、I・L は 1 と読む） */
export const normalizeRecoveryKey = (input: string) =>
  input.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/** 回復用キーを32バイトに戻す（形が違えば null） */
export const decodeRecoveryKey = (input: string): Uint8Array | null => {
  const s = normalizeRecoveryKey(input);
  if (s.length !== RECOVERY_KEY_LENGTH) return null;
  let value = 0;
  let bits = 0;
  const out: number[] = [];
  for (const c of s) {
    const v = BASE32.indexOf(c);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  // 52文字 = 260ビット。最後の4ビットは0
  if (out.length !== 32 || (value & ((1 << bits) - 1)) !== 0) return null;
  return new Uint8Array(out);
};

/** 回復用キーの形が違うときの説明（合えば null） */
export const recoveryKeyError = (input: string): string | null => {
  const s = normalizeRecoveryKey(input);
  if (s.length !== RECOVERY_KEY_LENGTH) return `回復用キーは${RECOVERY_KEY_LENGTH}文字です（いまは${s.length}文字）。`;
  const bad = [...new Set([...s].filter((c) => !BASE32.includes(c)))];
  if (bad.length > 0) return `回復用キーに使わない文字があります：${bad.join(" ")}`;
  if (!decodeRecoveryKey(s)) return "回復用キーの最後の文字が違います。";
  return null;
};

/** 紙に書きやすいように4文字ずつに分ける */
export const formatRecoveryKey = (key: string) => normalizeRecoveryKey(key).match(/.{1,4}/g)!.join(" ");
