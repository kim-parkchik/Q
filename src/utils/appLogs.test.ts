/**
 * 操作の記録（会社ファイルの app_logs）の残し方（logUtils.ts）と、見る画面の絞り込み（appLogs.ts）のテスト
 * 実行方法: bun test
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_SCHEMAS } from "../types/dbSchema";
import {
  ALL_USERS,
  EMPTY_FILTER,
  NO_USER,
  appLogQuery,
  categoryLabel,
  formatLogTime,
  levelLabel,
  loadAppLogChoices,
  loadAppLogs,
} from "./appLogs";
import { logUserName, setLogUser, writeLog } from "./logUtils";

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す）に合わせる */
const wrap = (db: Database) => ({
  execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...(params as any[])),
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const open = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  return db;
};

/** このパソコンの時刻の日時を、記録の日時の形（世界標準時の ISO）にする */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString();

const insert = (db: Database, createdAt: string, category: string, message: string, user: string | null, level = "INFO") =>
  db.prepare("INSERT INTO app_logs (created_at, level, category, message, user_name) VALUES (?, ?, ?, ?, ?)").run(createdAt, level, category, message, user);

const SRC = join(import.meta.dir, "..");
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

afterEach(() => setLogUser(null));

describe("操作の記録を残す（logUtils.ts）", () => {
  test("会社ファイルの中に残し、使った人を渡さなければ、いまログインしている人を残す", async () => {
    const db = open();
    await writeLog(wrap(db) as any, "info", "system", "会社ファイルを開きました");
    setLogUser(logUserName({ display_name: "管理者", login_id: "admin" }));
    await writeLog(wrap(db) as any, "INFO", "attendance", "年次有給休暇を付与しました");
    await writeLog(wrap(db) as any, "INFO", "staff", "TimeQard の打刻カードを作りました（3人）", "事務 花子（hanako）");
    setLogUser(null);
    await writeLog(wrap(db) as any, "INFO", "salary", "振込データを保存しました");
    const rows = db.prepare("SELECT level, category, message, user_name, created_at FROM app_logs ORDER BY id").all() as any[];
    expect(rows.map((r) => [r.category, r.user_name])).toEqual([
      ["system", null],
      ["attendance", "管理者（admin）"],
      ["staff", "事務 花子（hanako）"],
      ["salary", null],
    ]);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 会社ファイルが開いていなければ、何もしない
    await writeLog(null, "INFO", "system", "開いていない");
  });

  test("記録はファイルに書かない（ログのファイル .qlog はなくした）", () => {
    const log = readFileSync(join(SRC, "utils/logUtils.ts"), "utf8");
    expect(log).not.toContain("plugin-fs");
    const qlog = sourceFiles(SRC).filter((path) => /qlog|LOG_DIR_NAME|EXT_LOG/.test(readFileSync(path, "utf8")));
    expect(qlog).toEqual([]);
  });
});

describe("操作の記録を見る（appLogs.ts）", () => {
  const sample = () => {
    const db = open();
    insert(db, at(2026, 11, 20, 23, 59, 59), "system", "会社ファイルを開きました", null);
    insert(db, at(2026, 11, 21, 0, 0, 0), "attendance", "年次有給休暇 10日を付与しました", "管理者（admin）");
    insert(db, at(2026, 11, 21, 18, 30, 0), "mynumber", "マイナンバーを表示しました：国税 太郎（本人）", "事務 花子（hanako）");
    insert(db, at(2026, 11, 22, 0, 0, 0), "salary", "振込データを保存しました", "管理者（admin）", "WARN");
    insert(db, at(2026, 11, 22, 9, 0, 0), "salary", "振込元口座を足しました", "");
    return db;
  };
  const messages = async (db: Database, filter = EMPTY_FILTER, limit = 100) =>
    (await loadAppLogs(wrap(db), filter, limit)).rows.map((r) => r.message);

  test("新しい順に出し、日付はこのパソコンの時刻の1日（0時から次の日の0時まで）で絞る", async () => {
    const db = sample();
    expect(await messages(db)).toEqual([
      "振込元口座を足しました",
      "振込データを保存しました",
      "マイナンバーを表示しました：国税 太郎（本人）",
      "年次有給休暇 10日を付与しました",
      "会社ファイルを開きました",
    ]);
    // 21日だけ：20日の 23:59:59 と、22日の 0:00 は入らない
    expect(await messages(db, { ...EMPTY_FILTER, from: "2026-11-21", to: "2026-11-21" })).toEqual([
      "マイナンバーを表示しました：国税 太郎（本人）",
      "年次有給休暇 10日を付与しました",
    ]);
    expect(await messages(db, { ...EMPTY_FILTER, from: "2026-11-22" })).toEqual(["振込元口座を足しました", "振込データを保存しました"]);
    expect(await messages(db, { ...EMPTY_FILTER, to: "2026-11-20" })).toEqual(["会社ファイルを開きました"]);
    // 日付でないものは使わない
    expect((await messages(db, { ...EMPTY_FILTER, from: "11/21" })).length).toBe(5);
  });

  test("種類と使った人で絞る（使った人が残っていない記録も選べる）", async () => {
    const db = sample();
    expect(await messages(db, { ...EMPTY_FILTER, category: "salary" })).toEqual(["振込元口座を足しました", "振込データを保存しました"]);
    expect(await messages(db, { ...EMPTY_FILTER, user: "管理者（admin）" })).toEqual(["振込データを保存しました", "年次有給休暇 10日を付与しました"]);
    expect(await messages(db, { ...EMPTY_FILTER, user: NO_USER })).toEqual(["振込元口座を足しました", "会社ファイルを開きました"]);
    expect(await messages(db, { ...EMPTY_FILTER, category: "salary", user: "管理者（admin）", from: "2026-11-22", to: "2026-11-22" }))
      .toEqual(["振込データを保存しました"]);
    expect(await messages(db, { ...EMPTY_FILTER, user: ALL_USERS })).toHaveLength(5);
    const choices = await loadAppLogChoices(wrap(db));
    expect(choices.categories).toEqual(["attendance", "mynumber", "salary", "system"]);
    expect(choices.users).toEqual(["事務 花子（hanako）", "管理者（admin）"].sort());
    expect(choices.hasNoUser).toBe(true);
  });

  test("一度に出す数ずつ、古い記録を足す", async () => {
    const db = sample();
    const first = await loadAppLogs(wrap(db), EMPTY_FILTER, 2);
    expect(first.rows.map((r) => r.message)).toEqual(["振込元口座を足しました", "振込データを保存しました"]);
    expect(first.more).toBe(true);
    const all = await loadAppLogs(wrap(db), EMPTY_FILTER, 5);
    expect(all.rows).toHaveLength(5);
    expect(all.more).toBe(false);
    // 値は ? で渡す（記録の字を SQL に入れない）
    const q = appLogQuery({ ...EMPTY_FILTER, user: "x' OR '1'='1", category: "salary" }, 10);
    expect(q.sql).not.toContain("x'");
    expect(q.params).toEqual(["salary", "x' OR '1'='1", 11]);
  });

  test("画面に出す字", () => {
    expect(formatLogTime(at(2026, 11, 23, 9, 5, 7))).toBe("2026/11/23 09:05:07");
    expect(formatLogTime("こわれた日時")).toBe("こわれた日時");
    expect(categoryLabel("mynumber")).toBe("マイナンバー");
    expect(categoryLabel("attendance")).toBe("勤怠・休暇");
    expect(categoryLabel("新しい種類")).toBe("新しい種類");
    expect(levelLabel("WARN")).toBe("注意");
    expect(levelLabel("error")).toBe("エラー");
    expect(levelLabel("info")).toBeNull();
  });
});
