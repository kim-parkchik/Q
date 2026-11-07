/**
 * Q の側の TimeQard（会社の印・打刻カード・従業員ファイル）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../../types/dbSchema";
import { cardHash, parseStaffFile, serializeStaffFile } from "../../../shared/timeqard";
import type { SqlStatement } from "../../utils/dbBatch";
import {
  ensureCompanyMark,
  issueCards,
  loadActiveCards,
  loadTimeQardSettings,
  makeStaffFile,
  recordStaffFileExport,
  reissueCard,
  staffFileChangedSinceExport,
  type TimeQardDb,
} from "./timeqardStore";

/** bun:sqlite を、アプリの Database と同じ使い方（Promise を返す・まとめて書く）に合わせる */
const wrap = (db: Database): TimeQardDb => ({
  execute: async (sql, params = []) => db.prepare(sql).run(...(params as any[])),
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
  executeBatch: async (statements: SqlStatement[]) =>
    db.transaction(() =>
      statements.map((s) => {
        const r = db.prepare(s.sql).run(...((s.values ?? []) as any[]));
        return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
      })
    )(),
});

const open = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  // 従業員の外部キーの参照先（アプリが会社ファイルを開いたときに入れる初期データ）
  db.exec("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
  db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社共通規定', 99, 0, 25)");
  db.exec("INSERT INTO social_insurance_groups (id, name) VALUES (1, '協会けんぽ')");
  db.exec(`INSERT INTO staff (id, name, base_wage, status, join_date, retirement_date, address, my_number) VALUES
    ('1001', '山田 太郎', 300000, 'active', '2019-04-01', NULL, '東京都千代田区', '123456789012'),
    ('1002', '佐藤 花子', 280000, 'active', '2026-12-01', NULL, '', NULL),
    ('1003', '鈴木 一郎', 250000, 'retired', '2015-04-01', '2026-10-31', '', NULL)`);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
};

// 決まったでたらめな値（テストのため。呼ぶたびに違う値）
const fixedRandom = (seed: number) => {
  let call = 0;
  return (n: number) => {
    call++;
    return new Uint8Array(Array.from({ length: n }, (_, i) => (seed * 7 + call * 31 + i * 13) & 255));
  };
};

describe("会社の印", () => {
  test("初めて使うときに作り、2回目からは同じ印を返す", async () => {
    const db = wrap(open());
    expect(await loadTimeQardSettings(db)).toBeNull();
    const mark = await ensureCompanyMark(db);
    expect(mark).toMatch(/^[A-Z2-7]{8}$/);
    expect(await ensureCompanyMark(db)).toBe(mark);
  });
});

describe("打刻カード", () => {
  test("カードのない人にだけ作り、作り直すと前のカードは使えなくなる", async () => {
    const raw = open();
    const db = wrap(raw);
    expect(await issueCards(db, ["1001", "1002"], "2026-11-07T10:00:00+09:00", fixedRandom(1))).toBe(2);
    expect(await issueCards(db, ["1001", "1002"], "2026-11-07T10:05:00+09:00")).toBe(0);
    const before = (await loadActiveCards(db)).get("1001")!;
    expect(before.cardNumber).toMatch(/^[A-Z2-7]{26}$/);

    await reissueCard(db, "1001", "2026-11-08T09:00:00+09:00", fixedRandom(2));
    const after = (await loadActiveCards(db)).get("1001")!;
    expect(after.cardNumber).not.toBe(before.cardNumber);
    expect(after.issuedAt).toBe("2026-11-08T09:00:00+09:00");
    expect(raw.query("SELECT revoked_at FROM timeqard_cards WHERE card_number = ?").get(before.cardNumber)).toEqual({
      revoked_at: "2026-11-08T09:00:00+09:00",
    });
  });

  test("いま使えるカードは、1人に1枚だけ（表で止める）", () => {
    const raw = open();
    raw.exec("INSERT INTO timeqard_cards (staff_id, card_number, issued_at) VALUES ('1001', 'AAAAAAAAAAAAAAAAAAAAAAAAAA', 'x')");
    expect(() =>
      raw.exec("INSERT INTO timeqard_cards (staff_id, card_number, issued_at) VALUES ('1001', 'BBBBBBBBBBBBBBBBBBBBBBBBBB', 'y')")
    ).toThrow();
  });

  test("カードがあっても、記録のない従業員は削除できる（カードも一緒に消える）", () => {
    const raw = open();
    raw.exec("INSERT INTO timeqard_cards (staff_id, card_number, issued_at) VALUES ('1002', 'AAAAAAAAAAAAAAAAAAAAAAAAAA', 'x')");
    raw.exec("DELETE FROM staff WHERE id = '1002'");
    expect(raw.query("SELECT COUNT(*) AS n FROM timeqard_cards").get()).toEqual({ n: 0 });
  });
});

describe("従業員ファイル", () => {
  test("入れるのは ID・名前・入社日・退職日・カードの確かめ用の値だけ（住所・マイナンバーは入れない）", async () => {
    const db = wrap(open());
    await issueCards(db, ["1001"], "2026-11-07T10:00:00+09:00");
    const file = await makeStaffFile(db, "○○株式会社", "2026-11-07T16:30:00+09:00");
    const text = serializeStaffFile(file);
    expect(text).not.toContain("千代田");
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("300000");
    expect(file.staff.map((s) => s.id)).toEqual(["1001", "1002"]); // 退職した 1003 は入れない。これから入社する 1002 は入れる
    const card = (await loadActiveCards(db)).get("1001")!;
    expect(file.staff[0].cardHashes).toEqual([await cardHash(card.cardNumber)]);
    expect(text).not.toContain(card.cardNumber); // カードの番号そのものは入れない
    expect(file.staff[1].cardHashes).toEqual([]);
    expect(parseStaffFile(text)).toEqual({ ok: true, file });
  });

  test("書き出したあとに、カード・入社・名前が変わったら知らせる", async () => {
    const raw = open();
    const db = wrap(raw);
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBeNull(); // まだ書き出していない
    const file = await makeStaffFile(db, "○○株式会社", "2026-11-07T16:30:00+09:00");
    await recordStaffFileExport(db, file);
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(false);

    await issueCards(db, ["1001"], "2026-11-08T09:00:00+09:00");
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(true);
    await recordStaffFileExport(db, await makeStaffFile(db, "○○株式会社", "2026-11-08T09:10:00+09:00"));
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(false);

    raw.exec("INSERT INTO staff (id, name, base_wage) VALUES ('1004', '新人 一人', 200000)");
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(true);
    raw.exec("DELETE FROM staff WHERE id = '1004'");
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(false);

    raw.exec("UPDATE staff SET retirement_date = '2026-11-30' WHERE id = '1001'");
    expect(await staffFileChangedSinceExport(db, "○○株式会社")).toBe(true);
    raw.exec("UPDATE staff SET retirement_date = NULL WHERE id = '1001'");

    expect(await staffFileChangedSinceExport(db, "△△株式会社")).toBe(true); // 会社名が変わった
  });
});
