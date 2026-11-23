/**
 * ログインのまちがいの回数と、ログインの記録（loginGuard.ts）のテスト
 * 実行方法: bun test
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_SCHEMAS } from "../../types/dbSchema";
import { setLogUser } from "../../utils/logUtils";
import {
  attemptLogin,
  isLoginLocked,
  LOGIN_LOCK_MS,
  lockedUntilMs,
  MAX_LOGIN_FAILURES,
  unlockLogin,
  untilLabel,
  WRONG_LOGIN,
  type LoginDb,
} from "./loginGuard";

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
const wrap = (db: Database): LoginDb => ({
  execute: async (sql, params = []) => db.prepare(sql).run(...(params as any[])),
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const open = () => {
  const raw = new Database(":memory:");
  for (const s of DB_SCHEMAS) raw.exec(s);
  raw.exec(`INSERT INTO users (id, login_id, display_name, password_hash, role) VALUES
    (1, 'admin', '管理者', 'hash:kanri-2026', 'admin'),
    (2, 'hanako', '事務 花子', 'hash:hanako-2026', 'staff')`);
  raw.exec("INSERT INTO users (id, login_id, display_name, password_hash, role, status) VALUES (3, 'old', '使わない 人', 'hash:old-2026', 'staff', 'inactive')");
  return { raw, db: wrap(raw) };
};

/** パスワードを確かめる（アプリでは Rust の Argon2） */
const verify = async (password: string, hash: string) => hash === `hash:${password}`;
/** このパソコンの時刻（2026年11月23日 15:00） */
const T0 = new Date(2026, 10, 23, 15, 0, 0).getTime();
const login = (db: LoginDb, loginId: string, password: string, now = T0) => attemptLogin(db, loginId, password, { verify, now: () => now });

const user = (raw: Database, loginId: string) =>
  raw.query("SELECT failed_logins, locked_until, last_login FROM users WHERE login_id = ?").get(loginId) as {
    failed_logins: number;
    locked_until: string | null;
    last_login: string | null;
  };
const logs = (raw: Database) =>
  (raw.query("SELECT level, category, message, user_name FROM app_logs ORDER BY id").all() as any[]).map((r) => [r.level, r.category, r.message, r.user_name]);

afterEach(() => setLogUser(null));

describe("ログインのまちがいの回数", () => {
  test("正しいパスワードならログインし、最終ログインを入れ、操作の記録に「ログインしました」を残す", async () => {
    const { raw, db } = open();
    const r = await login(db, "hanako", "hanako-2026");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.login_id).toBe("hanako");
    expect(user(raw, "hanako").last_login).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(logs(raw)).toEqual([["INFO", "auth", "ログインしました", "事務 花子（hanako）"]]);
  });

  test("まちがえるたびに、あと何回で止めるかを知らせ、5回続けてまちがえたら15分止める。止めているあいだは、正しいパスワードでも入れない", async () => {
    const { raw, db } = open();
    for (let i = 1; i < MAX_LOGIN_FAILURES; i++) {
      const r = await login(db, "hanako", "ちがう");
      expect(r).toEqual({ ok: false, message: `${WRONG_LOGIN}（あと${MAX_LOGIN_FAILURES - i}回続けてまちがえると、15分ログインできなくなります）` });
      expect(user(raw, "hanako").failed_logins).toBe(i);
    }
    const locked = await login(db, "hanako", "ちがう");
    expect(locked).toEqual({
      ok: false,
      message: "パスワードを5回続けてまちがえたので、15:15までログインできません。急ぐときは、管理者に、システム設定のユーザー管理で「止めたのを解く」を押してもらってください。",
    });
    expect(user(raw, "hanako")).toEqual({ failed_logins: 0, locked_until: new Date(T0 + LOGIN_LOCK_MS).toISOString(), last_login: null });
    // 止めているあいだ（15:14:59）は、正しいパスワードでも入れない
    expect((await login(db, "hanako", "hanako-2026", T0 + LOGIN_LOCK_MS - 1000)).ok).toBe(false);
    // ほかの人は入れる
    expect((await login(db, "admin", "kanri-2026")).ok).toBe(true);
    // 15分たてば入れる。入れたら数え直す
    expect((await login(db, "hanako", "hanako-2026", T0 + LOGIN_LOCK_MS)).ok).toBe(true);
    expect(user(raw, "hanako").failed_logins).toBe(0);
    expect(user(raw, "hanako").locked_until).toBeNull();
    expect(logs(raw)).toEqual([
      ["INFO", "auth", "パスワードがちがったので、ログインできませんでした（続けて1回め）", "事務 花子（hanako）"],
      ["INFO", "auth", "パスワードがちがったので、ログインできませんでした（続けて2回め）", "事務 花子（hanako）"],
      ["INFO", "auth", "パスワードがちがったので、ログインできませんでした（続けて3回め）", "事務 花子（hanako）"],
      ["INFO", "auth", "パスワードがちがったので、ログインできませんでした（続けて4回め）", "事務 花子（hanako）"],
      ["WARN", "auth", "パスワードを5回続けてまちがえたので、15:15までログインを止めました", "事務 花子（hanako）"],
      ["INFO", "auth", "ログインを止めているあいだ（15:15まで）に、ログインしようとしました", "事務 花子（hanako）"],
      ["INFO", "auth", "ログインしました", "管理者（admin）"],
      ["INFO", "auth", "ログインしました", "事務 花子（hanako）"],
    ]);
  });

  test("続けてまちがえた回数だけを数える（4回まちがえてもログインできたら、次は1回めから）", async () => {
    const { raw, db } = open();
    for (let i = 0; i < 4; i++) await login(db, "hanako", "ちがう");
    expect((await login(db, "hanako", "hanako-2026")).ok).toBe(true);
    expect(user(raw, "hanako").failed_logins).toBe(0);
    const r = await login(db, "hanako", "ちがう");
    expect(r.ok ? "" : r.message).toContain("あと4回");
  });

  test("登録されていないログインID・使えなくなったユーザーは、同じ知らせにし、入れた字は記録に残さない（止めない）", async () => {
    const { raw, db } = open();
    for (let i = 0; i < 6; i++) expect(await login(db, "hanako-2026", "なにか")).toEqual({ ok: false, message: WRONG_LOGIN });
    expect(await login(db, "old", "old-2026")).toEqual({ ok: false, message: WRONG_LOGIN });
    const all = raw.query("SELECT level, message, user_name FROM app_logs").all() as any[];
    expect(all.length).toBe(7);
    expect(new Set(all.map((r) => r.message))).toEqual(new Set(["登録されていないログインIDで、ログインしようとしました"]));
    expect(all.every((r) => r.level === "INFO" && r.user_name === null)).toBe(true);
    expect(JSON.stringify(all)).not.toContain("hanako-2026");
  });

  test("管理者が止めたのを解ける（操作の記録の使った人は、ログインしている管理者）。パスワードを変えたときも解く", async () => {
    const { raw, db } = open();
    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) await login(db, "hanako", "ちがう");
    expect(isLoginLocked(user(raw, "hanako"), T0)).toBe(true);
    setLogUser("管理者（admin）");
    await unlockLogin(db, { id: 2, login_id: "hanako", display_name: "事務 花子" });
    expect(user(raw, "hanako")).toEqual({ failed_logins: 0, locked_until: null, last_login: null });
    expect(logs(raw).at(-1)).toEqual(["INFO", "auth", "事務 花子（hanako）の、パスワードのまちがいで止めていたログインを解きました", "管理者（admin）"]);
    expect((await login(db, "hanako", "hanako-2026")).ok).toBe(true);
    // パスワードを変えるとき（システム設定のユーザー管理）も、止めていたのを解く
    const settings = readFileSync(join(import.meta.dir, "../settings/useSystemSettings.ts"), "utf8");
    expect(settings).toContain('"UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE login_id = ?"');
  });

  test("止めている終わりの時刻の書き方（同じ日は時刻だけ）と読み方", () => {
    expect(untilLabel(new Date(2026, 10, 23, 9, 5).getTime(), T0)).toBe("9:05");
    expect(untilLabel(new Date(2026, 10, 24, 0, 10).getTime(), T0)).toBe("11月24日 0:10");
    expect(lockedUntilMs({ locked_until: null })).toBeNull();
    expect(lockedUntilMs({ locked_until: "こわれた値" })).toBeNull();
    expect(isLoginLocked({ locked_until: "こわれた値" }, T0)).toBe(false);
    expect(isLoginLocked({ locked_until: new Date(T0 - 1).toISOString() }, T0)).toBe(false);
  });

  test("ログインの画面は、かならずこの決まりを通る（パスワードを確かめるのは loginGuard.ts の attemptLogin だけ）", () => {
    const SRC = join(import.meta.dir, "../..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        if (e.isDirectory()) return files(path);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
      });
    const verifying = files(SRC).filter((path) => /verifyPassword\(|verify_password/.test(readFileSync(path, "utf8")));
    expect(verifying.map((p) => p.slice(SRC.length + 1)).sort()).toEqual(["utils/authUtils.ts"]);
    const useLogin = readFileSync(join(import.meta.dir, "useLogin.ts"), "utf8");
    expect(useLogin).toContain("await attemptLogin(db, loginId, password, { verify: verifyPassword })");
  });
});
