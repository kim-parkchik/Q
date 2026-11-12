/**
 * ブラウザ版の頼み（webApi.ts）と、パスワードの決まり（passwordRules.ts）のテスト
 * 実行方法: bun test timeqard
 *
 * パスワードの確かめ用の値は、テストでは簡単な形にする（本物は Rust の Argon2。src-tauri/src/lib.rs のテストで確かめている）。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildStaffFile, CSV_HEADERS, DAY_MS, jstMs, parseCsvRecords } from "../../shared/timeqard";
import { addPunch, addRequest, applyStaffFile, loadDayEvents, loadWebAccount, loadWebLogins, prepareDb, setSetting, type KioskDb } from "./store";
import { createWebApi, IP_MAX_FAILURES, LOCK_MS, MAX_FAILURES, SESSION_IDLE_MS } from "./webApi";
import { newInitialPassword, PASSWORD_ALPHABET, passwordProblem } from "./passwordRules";

const wrap = (db: Database): KioskDb => ({
  execute: async (sql, params = []) => {
    const r = db.prepare(sql).run(...(params as any[]));
    return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
  },
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const MARK = "K7M3QP2X";
const PC = "192.168.0.50";
const OTHER_PC = "192.168.0.77";

const staffFile = (staff: { id: string; name: string; join_date?: string }[]) =>
  buildStaffFile({ companyName: "○○株式会社", companyMark: MARK, exportedAt: "2026-11-01T09:00:00+09:00", staff, cardHashesByStaff: new Map() });

const setup = async () => {
  const db = wrap(new Database(":memory:"));
  await prepareDb(db);
  await applyStaffFile(
    db,
    staffFile([
      { id: "1001", name: "山田 太郎", join_date: "2019-04-01" },
      { id: "1002", name: "佐藤 花子", join_date: "2026-11-05" },
      { id: "A-7", name: "英字 ID" },
    ]),
    "2026-11-01T10:00:00+09:00"
  );
  await setSetting(db, "admin_password_hash", "h:kanri1234");
  await setSetting(db, "web_enabled", "1");
  const clock = { now: jstMs("2026-11-12", "08:55") };
  let changed = 0;
  const api = createWebApi({
    db,
    hash: async (pw) => `h:${pw}`,
    verify: async (pw, h) => h === `h:${pw}`,
    now: () => clock.now,
    onChanged: () => {
      changed++;
    },
  });
  const call = async (action: string, body: object = {}, ip = PC) => {
    const a = await api.handle(action, JSON.stringify(body), ip);
    return { status: a.status, body: a.body as any };
  };
  return { db, clock, api, call, changed: () => changed };
};

type T = Awaited<ReturnType<typeof setup>>;

/** はじめのパスワードを作り、本人が自分のパスワードに変えたところ（ログインしたまま） */
const ready = async (t: T, staffId: string, password: string) => {
  const issued = await t.api.issueInitialPassword(staffId);
  const first = await t.call("login", { staffId, password: issued.password });
  expect(first.body.mustChange).toBe(true);
  const changed = await t.call("change_password", { token: first.body.token, next: password });
  expect(changed.status).toBe(200);
  return first.body.token as string;
};

describe("パスワードの決まり", () => {
  test("8文字以上。スタッフID と同じもの・同じ文字ばかり・順に並んだだけのものは使えない。全角で入れても同じに扱う", () => {
    expect(passwordProblem("abc12", "1001")).toContain("8文字以上");
    expect(passwordProblem("x".repeat(65), "1001")).toContain("64文字まで");
    expect(passwordProblem("staff-0001", "STAFF-0001")).toContain("スタッフID と同じ");
    expect(passwordProblem("ＳＴＡＦＦ－０００１", "STAFF-0001")).toContain("スタッフID と同じ");
    expect(passwordProblem("aaaaaaaa", "1001")).toContain("同じ文字ばかり");
    expect(passwordProblem("abababab", "1001")).toContain("同じ文字ばかり");
    expect(passwordProblem("12345678", "1001")).toContain("順に並んだ");
    expect(passwordProblem("87654321", "1001")).toContain("順に並んだ");
    expect(passwordProblem("abcdefgh", "1001")).toContain("順に並んだ");
    expect(passwordProblem(" kanri-2026", "1001")).toContain("空白");
    expect(passwordProblem("kanri-2026", "1001")).toBeNull();
    expect(passwordProblem("ｋａｎｒｉ－２０２６", "1001")).toBeNull();
    expect(passwordProblem("山田のパスワード", "1001")).toBeNull();
  });

  test("はじめのパスワードは、見まちがえやすい文字（l・o・0・1）を使わない、ばらばらな8文字", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const pw = newInitialPassword();
      expect(pw).toHaveLength(8);
      expect([...pw].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
      expect(/[lo01]/.test(pw)).toBe(false);
      expect(/[0-9]/.test(pw) && /[a-z]/.test(pw)).toBe(true);
      expect(passwordProblem(pw, "1001")).toBeNull();
      seen.add(pw);
    }
    expect(seen.size).toBe(300);
    // ばらばらでない値しか来ないときは、作らずに止める
    expect(() => newInitialPassword((n) => new Uint8Array(n))).toThrow();
  });
});

describe("ブラウザ版の頼み", () => {
  test("はじめのパスワードでログインすると、自分のパスワードに変えるまで押せない。押したらログアウトにし、1分のあいだは取り消せる", async () => {
    const t = await setup();
    const issued = await t.api.issueInitialPassword("1001");
    expect(issued.name).toBe("山田 太郎");
    expect(issued.expiresMs).toBe(t.clock.now + 7 * DAY_MS);
    expect((await t.call("login", { staffId: "9999", password: issued.password })).status).toBe(401);

    // 全角の ID でも見つける
    const first = await t.call("login", { staffId: "１００１", password: issued.password });
    expect(first.status).toBe(200);
    expect(first.body.mustChange).toBe(true);
    const token = first.body.token;
    const blocked = await t.call("punch", { token, kind: "entry" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.mustChange).toBe(true);
    expect((await t.call("change_password", { token, next: "1001" })).body.error).toContain("8文字以上");
    expect((await t.call("change_password", { token, next: issued.password })).body.error).toContain("はじめのパスワードとは");
    const changed = await t.call("change_password", { token, next: "yamada-2026" });
    expect(changed.status).toBe(200);
    expect(changed.body.name).toBe("山田 太郎");
    expect(changed.body.state).toBe("before");
    expect(changed.body.suggested).toBe("entry");
    expect(changed.body.kinds).toEqual(["entry", "exit", "break_start", "break_end"]);
    expect(changed.body.block).toBeNull();

    const punched = await t.call("punch", { token, kind: "entry" });
    expect(punched.status).toBe(200);
    expect(punched.body.message).toBe("山田 太郎さん　出勤 8:55 を記録しました");
    expect(punched.body.loggedOut).toBe(true);
    expect(t.changed()).toBe(1);
    // 押したらログアウト
    expect((await t.call("status", { token })).status).toBe(401);
    // 記録：ブラウザで押した印と、つないできたパソコンのアドレス
    const events = await loadDayEvents(t.db, MARK, "2026-11-12");
    expect(events.map((e) => [e.staffId, e.kind, e.method, e.clientIp, e.cancelled])).toEqual([["1001", "entry", "web", PC, false]]);

    // 取り消し：ほかのパソコンからは使えない。1分のうちに1回だけ
    expect((await t.call("cancel", { ticket: punched.body.cancelTicket }, OTHER_PC)).status).toBe(409);
    t.clock.now += 30_000;
    expect((await t.call("cancel", { ticket: punched.body.cancelTicket })).status).toBe(200);
    expect((await t.call("cancel", { ticket: punched.body.cancelTicket })).status).toBe(409);
    expect((await loadDayEvents(t.db, MARK, "2026-11-12"))[0].cancelled).toBe(true);
    expect(t.changed()).toBe(2);

    // 次からは自分のパスワードで（全角で入れても同じ）。はじめのパスワードは使えない
    expect((await t.call("login", { staffId: "1001", password: issued.password })).status).toBe(401);
    const again = await t.call("login", { staffId: "1001", password: "ｙａｍａｄａ－２０２６" });
    expect(again.status).toBe(200);
    expect(again.body.mustChange).toBe(false);
    expect(again.body.state).toBe("before");

    // ログインの記録（はじめのパスワードを作った・まちがい・ログイン・変えた）
    const logs = await loadWebLogins(t.db, MARK, 20);
    expect(logs.map((l) => `${l.staffId}:${l.result}`).reverse()).toEqual([
      "1001:issued",
      "9999:wrong",
      "1001:ok",
      "1001:changed",
      "1001:wrong",
      "1001:ok",
    ]);
    expect(logs[0].clientIp).toBe(PC);
  });

  test("5回続けてまちがえたら、正しいパスワードでも15分は使えない。15分たてば使える", async () => {
    const t = await setup();
    await ready(t, "1001", "yamada-2026");
    for (let i = 1; i < MAX_FAILURES; i++) {
      const r = await t.call("login", { staffId: "1001", password: "wrong-pass" });
      expect(r.status).toBe(401);
      expect(r.body.error).toContain(`あと${MAX_FAILURES - i}回`);
    }
    const last = await t.call("login", { staffId: "1001", password: "wrong-pass" });
    expect(last.status).toBe(423);
    expect(last.body.error).toContain("9:10まで使えません");
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" })).status).toBe(423);
    t.clock.now += LOCK_MS;
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" })).status).toBe(200);
    const account = await loadWebAccount(t.db, MARK, "1001");
    expect([account?.failedCount, account?.lockedUntilMs]).toEqual([0, null]);
  });

  test("1台のパソコンから何人分も試すと、そのパソコンからのログインを止める（ほかのパソコンからは入れる）", async () => {
    const t = await setup();
    await ready(t, "1001", "yamada-2026");
    for (let i = 0; i < IP_MAX_FAILURES; i++) await t.call("login", { staffId: `X${i}`, password: "guess-1234" });
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" })).status).toBe(429);
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" }, OTHER_PC)).status).toBe(200);
  });

  test("はじめのパスワードは7日まで。作り直すと、前のはじめのパスワードは使えない", async () => {
    const t = await setup();
    const a = await t.api.issueInitialPassword("1001");
    t.clock.now += 7 * DAY_MS;
    const expired = await t.call("login", { staffId: "1001", password: a.password });
    expect(expired.status).toBe(403);
    expect(expired.body.error).toContain("期限");
    const b = await t.api.issueInitialPassword("1001");
    expect(b.password).not.toBe(a.password);
    expect((await t.call("login", { staffId: "1001", password: a.password })).status).toBe(401);
    expect((await t.call("login", { staffId: "1001", password: b.password })).body.mustChange).toBe(true);
  });

  test("管理者が自分で決めるはじめのパスワード：短いもの・ほかの人のはじめのパスワードと同じものは使えない", async () => {
    const t = await setup();
    await expect(t.api.issueInitialPassword("1001", "short")).rejects.toThrow("8文字以上");
    await t.api.issueInitialPassword("1001", "welcome-2026");
    await expect(t.api.issueInitialPassword("1002", "welcome-2026")).rejects.toThrow("ほかの人のはじめのパスワードと同じ");
    await t.api.issueInitialPassword("1002", "welcome-2027");
    await expect(t.api.issueInitialPassword("9999")).rejects.toThrow("いまの従業員ファイルにいません");
    expect((await t.call("login", { staffId: "1002", password: "welcome-2027" })).body.mustChange).toBe(true);
  });

  test("自分でパスワードを変えるときは、いまのパスワードを確かめる", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    expect((await t.call("change_password", { token, next: "new-pass-77" })).body.error).toContain("いまのパスワードを入れて");
    expect((await t.call("change_password", { token, current: "wrong", next: "new-pass-77" })).body.error).toContain("いまのパスワードがちがいます");
    expect((await t.call("change_password", { token, current: "yamada-2026", next: "yamada-2026" })).body.error).toContain("いまのパスワードとは");
    expect((await t.call("change_password", { token, current: "yamada-2026", next: "new-pass-77" })).status).toBe(200);
    expect((await t.call("login", { staffId: "1001", password: "new-pass-77" })).status).toBe(200);
    expect((await loadWebAccount(t.db, MARK, "1001"))?.failedCount).toBe(0);
  });

  test("押し忘れの申し出：入口のパソコンと同じ決まりで受け、自分の記録には本人の分だけを出す", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    const ask = (body: object) => t.call("request", { token, ...body });
    expect((await ask({ date: "2026-10-11", kind: "entry", time: "09:00", reason: "押し忘れた" })).body.error).toContain("31日前まで");
    expect((await ask({ date: "2026-11-12", kind: "exit", time: "18:00", reason: "押し忘れた" })).body.error).toContain("これからの時刻");
    // 外出のボタンを出していない会社では、外出は申し出られない
    expect((await ask({ date: "2026-11-11", kind: "out", time: "13:00", reason: "押し忘れた" })).body.error).toContain("この種類");
    expect((await ask({ date: "2026-11-11", kind: "exit", time: "18:00" })).body.error).toContain("理由");
    expect((await ask({ date: "2026-11-11", kind: "exit", time: "18:00", reason: "そのほか" })).body.error).toContain("ひとこと");

    const exit = await ask({ date: "2026-11-11", kind: "exit", time: "18:00", reason: "押し忘れた", note: "会議が長引いた" });
    expect(exit.status).toBe(200);
    expect(exit.body.message).toBe("11月11日の退勤 18:00 の申し出を受け付けました（担当者が確かめます）");
    const noBreak = await ask({ date: "2026-10-12", kind: "no_break", note: "来客が続いた" });
    expect(noBreak.body.message).toBe("10月12日の「休憩を取れなかった」の申し出を受け付けました（担当者が確かめます）");
    expect((await t.call("cancel", { ticket: noBreak.body.cancelTicket })).status).toBe(200);
    // 申し出ではログアウトしない（続けて申し出られる）
    expect((await t.call("status", { token })).status).toBe(200);

    // ほかの人の申し出（入口のパソコンで）
    await addRequest(t.db, { staffId: "1002", date: "2026-11-10", kind: "entry", time: "09:00", reason: "押し忘れた", note: "", at: t.clock.now, method: "card", companyMark: MARK });
    const nov = await t.call("records", { token, month: "2026-11" });
    expect(nov.status).toBe(200);
    expect(nov.body.requests.map((r: any) => [r.date, r.kind, r.time, r.note])).toEqual([["2026-11-11", "exit", "18:00", "会議が長引いた"]]);
    expect(nov.body.rows.map((r: any) => [r.date, r.requests, r.requestReason])).toEqual([
      ["2026-11-11", { exit: "18:00" }, "退勤：押し忘れた（会議が長引いた）"],
    ]);
    expect((await t.call("records", { token, month: "2026-10" })).body.requests).toEqual([]);
    expect((await t.call("records", { token, month: "2026-12" })).status).toBe(400);
    const events = await loadDayEvents(t.db, MARK, "2026-11-11");
    expect(events.map((e) => [e.type, e.method, e.clientIp])).toEqual([["request", "web", PC]]);
  });

  test("入社日より前の人・入口のパソコンの時計がおかしいときは押せない", async () => {
    const t = await setup();
    t.clock.now = jstMs("2026-11-04", "09:00");
    const sato = await ready(t, "1002", "sato-hanako");
    const r = await t.call("punch", { token: sato, kind: "entry" });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain("入社日（2026-11-05）より前");

    t.clock.now = jstMs("2026-11-12", "09:00");
    const yamada = await ready(t, "1001", "yamada-2026");
    // 前に押した時刻（10:00）より、いまの時計が前になっている
    await addPunch(t.db, { staffId: "1002", kind: "entry", at: jstMs("2026-11-12", "10:00"), method: "card", companyMark: MARK });
    expect((await t.call("status", { token: yamada })).body.block).toContain("時計がおかしい");
    expect((await t.call("punch", { token: yamada, kind: "entry" })).status).toBe(503);
  });

  test("5分のあいだ何もしなければログアウト。ほかのパソコンからは、そのログインを使えない", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    expect((await t.call("status", { token }, OTHER_PC)).status).toBe(401);
    t.clock.now += SESSION_IDLE_MS - 1000;
    expect((await t.call("status", { token })).status).toBe(200);
    t.clock.now += SESSION_IDLE_MS - 1000;
    expect((await t.call("status", { token })).status).toBe(200);
    t.clock.now += SESSION_IDLE_MS + 1;
    const r = await t.call("status", { token });
    expect(r.status).toBe(401);
    expect(r.body.loggedOut).toBe(true);
    expect(t.api.sessionCount()).toBe(0);
  });

  test("同じログインで2回続けて押しても、1回だけ記録する", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    const answers = await Promise.all([t.call("punch", { token, kind: "entry" }), t.call("punch", { token, kind: "entry" })]);
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect((await loadDayEvents(t.db, MARK, "2026-11-12")).length).toBe(1);
  });

  test("押してから1分を過ぎた札では取り消せない", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    const p = await t.call("punch", { token, kind: "entry" });
    t.clock.now += 60_001;
    expect((await t.call("cancel", { ticket: p.body.cancelTicket })).status).toBe(409);
    expect((await loadDayEvents(t.db, MARK, "2026-11-12"))[0].cancelled).toBe(false);
  });

  test("従業員ファイルから外れた人は、パスワードが消え、ログインできない", async () => {
    const t = await setup();
    const token = await ready(t, "1001", "yamada-2026");
    await applyStaffFile(t.db, staffFile([{ id: "1002", name: "佐藤 花子", join_date: "2026-11-05" }]), "2026-11-12T09:00:00+09:00");
    expect(await loadWebAccount(t.db, MARK, "1001")).toBeNull();
    expect((await t.call("status", { token })).status).toBe(401);
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" })).status).toBe(401);
  });

  test("ブラウザの管理の画面：管理のパスワードで入り、パスワードの一覧・作る・消す・CSV のダウンロードができる", async () => {
    const t = await setup();
    const yamada = await ready(t, "1001", "yamada-2026");
    await t.call("punch", { token: yamada, kind: "entry" });
    // 管理のパスワードも、5回続けてまちがえたら15分は入れない
    for (let i = 0; i < MAX_FAILURES; i++) await t.call("admin_login", { password: "wrong" });
    expect((await t.call("admin_login", { password: "kanri1234" })).status).toBe(423);
    t.clock.now += LOCK_MS;
    const admin = await t.call("admin_login", { password: "kanri1234" });
    expect(admin.status).toBe(200);
    const token = admin.body.token;
    // 従業員のログインでは、管理のことはできない。管理のログインでは、押せない
    const staff = (await t.call("login", { staffId: "1001", password: "yamada-2026" })).body.token;
    expect((await t.call("admin_accounts", { token: staff })).status).toBe(401);
    expect((await t.call("punch", { token, kind: "exit" })).status).toBe(401);

    const list = await t.call("admin_accounts", { token });
    expect(list.body.accounts.map((a: any) => [a.staffId, a.state])).toEqual([
      ["1001", "set"],
      ["1002", "none"],
      ["A-7", "none"],
    ]);
    const issued = await t.call("admin_issue", { token, staffId: "1002" });
    expect(issued.status).toBe(200);
    expect(issued.body.password).toHaveLength(8);
    expect((await t.call("admin_accounts", { token })).body.accounts[1].state).toBe("initial");
    // 消すと、その人のログインも終わる
    expect((await t.call("admin_clear", { token, staffId: "1001" })).status).toBe(200);
    expect((await t.call("status", { token: staff })).status).toBe(401);
    expect((await t.call("login", { staffId: "1001", password: "yamada-2026" })).body.error).toContain("まだありません");

    const csv = await t.call("admin_csv", { token, from: "2026-11-01", to: "2026-11-30" });
    expect(csv.status).toBe(200);
    expect(csv.body.fileName).toBe("○○株式会社_打刻_2026-11-01〜2026-11-30.csv");
    const { records } = parseCsvRecords(csv.body.csv);
    expect(records.map((r) => [r.values[CSV_HEADERS.staffId], r.values["出勤"], r.values[CSV_HEADERS.web]])).toEqual([["1001", "08:55", "出勤"]]);
    expect(csv.body.summary.web).toBe(1);
    expect(csv.body.summaryText).toContain("ブラウザで押した日 1日");
    expect((await t.call("admin_csv", { token, from: "2026-11-30", to: "2026-11-01" })).status).toBe(400);
    expect((await t.call("admin_csv", { token, from: "2026-12-01", to: "2026-12-31" })).status).toBe(404);
  });

  test("ブラウザ版を止めているとき・知らない頼み・読めない中身には答えない", async () => {
    const t = await setup();
    expect((await t.call("hello")).body.companyName).toBe("○○株式会社");
    expect((await t.api.handle("unknown", "{}", PC)).status).toBe(404);
    expect((await t.api.handle("toString", "{}", PC)).status).toBe(404);
    expect((await t.api.handle("login", "{oops", PC)).status).toBe(400);
    expect((await t.api.handle("login", "[1,2]", PC)).status).toBe(400);
    await setSetting(t.db, "web_enabled", "0");
    expect((await t.call("hello")).status).toBe(503);
  });
});
