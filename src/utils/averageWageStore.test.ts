/**
 * 平均賃金を会社ファイルから読んで計算する（utils/averageWageStore.ts。決まりは averageWage.test.ts）
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../types/dbSchema";
import { deleteAverageWageOverride, loadAverageWage, loadAverageWagePay, saveAverageWageOverride } from "./averageWageStore";

const ledger = (base: number) => JSON.stringify({
  periodStart: null, periodEnd: null, workDays: 0, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0,
  earnings: [{ name: "基本給", amount: base, avg: "month" }], deductions: [], totalEarnings: base, totalDeductions: 0, netPay: base, yearEndSettlement: 0,
});

/** 末日締め・翌月25日払いの会社。山田さん（月給 310,000円）の 9〜11月支給（8〜10月の分）の給与を確定してある */
const open = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  db.exec("INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day, shutdown_allowance_rate) VALUES (1, '全社', 99, 1, 25, 70)");
  db.exec("INSERT INTO staff (id, name, base_wage, wage_type, join_date, payroll_group_id) VALUES ('1001', '山田 太郎', 310000, 'monthly', '2020-04-01', 1)");
  const add = db.prepare("INSERT INTO salary_results (staff_id, target_year, target_month, total_earnings, ledger) VALUES ('1001', 2026, ?, 310000, ?)");
  for (const m of [9, 10, 11]) add.run(m, ledger(310000));
  return db;
};
const wrap = (db: Database) => ({
  select: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])),
  execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...(params as any[])),
});
const staffOf = (db: Database) => db.query("SELECT * FROM staff WHERE id = '1001'").get() as any;

describe("平均賃金を会社ファイルから読む", () => {
  test("3か月の確定した給与から計算する（930,000円 ÷ 92日 ＝ 10,108円69銭）", async () => {
    const db = open();
    const r = await loadAverageWage(wrap(db), staffOf(db), "2026-11-10");
    expect([r.from, r.to, r.totalDays, r.amountSen, r.error]).toEqual(["2026-08-01", "2026-10-31", 92, 1010869, null]);
  });
  test("手で入れた額があれば、その額にする（消せば Q の計算に戻る）", async () => {
    const db = open();
    await saveAverageWageOverride(wrap(db), "1001", "2026-11-10", 1234567, "労働基準監督署に確かめた額");
    const r = await loadAverageWage(wrap(db), staffOf(db), "2026-11-10");
    expect([r.amountSen, r.manual]).toEqual([1234567, { amountSen: 1234567, note: "労働基準監督署に確かめた額" }]);
    expect(r.principleSen).toBe(1010869); // Q の計算も見られる
    await deleteAverageWageOverride(wrap(db), "1001", "2026-11-10");
    expect((await loadAverageWage(wrap(db), staffOf(db), "2026-11-10")).amountSen).toBe(1010869);
  });
  test("給与の材料：前の計算期間から続く休業は、その初めの日で数え、休業手当の率は給与規定グループの値", async () => {
    const db = open();
    // 10月30日(金)から休ませ、11月2日(月)・4日(水)も休ませた（11月3日は祝日だが、Q の会社カレンダーの祝日の表は空なので所定労働日）
    db.exec("INSERT INTO attendance (staff_id, work_date, work_type, is_finalized) VALUES ('1001', '2026-10-30', 'company_leave', 1)");
    const rows = [
      { work_date: "2026-11-02", work_type: "company_leave", work_hours: 0 },
      { work_date: "2026-11-04", work_type: "company_leave", work_hours: 0 },
      { work_date: "2026-11-05", work_type: "normal", work_hours: 8 },
    ];
    const pay = await loadAverageWagePay(wrap(db), staffOf(db), { start: "2026-11-01", end: "2026-11-30" }, rows);
    expect(pay?.shutdownRate).toBe(70);
    expect(pay?.shutdownEvents).toEqual({ "2026-11-02": "2026-10-30", "2026-11-04": "2026-11-04" });
    // 10月30日の平均賃金は 7〜9月の分（8〜10月支給）で、7月の分（8月支給）を確定していないので出せない
    expect(pay?.wages["2026-10-30"].amountSen).toBeNull();
    expect(pay?.wages["2026-10-30"].error).toContain("2026年8月支給の給与");
    // 11月4日の平均賃金は 8〜10月の分。10月30日の休業の日を除くので 930,000円 ÷ 91日 ＝ 10,219円78銭
    expect(pay?.wages["2026-11-04"].amountSen).toBe(1021978);
  });
  test("労災の待期の日があれば、事故の日の平均賃金を読む。休業手当も待期もなければ null", async () => {
    const db = open();
    db.exec(`UPDATE staff SET leave_periods = '${JSON.stringify([{ type: "injury", start: "2026-11-11", end: "2026-11-30", accident: "2026-11-10" }])}' WHERE id = '1001'`);
    const pay = await loadAverageWagePay(wrap(db), staffOf(db), { start: "2026-11-01", end: "2026-11-30" }, []);
    expect(pay?.waitingEvents).toEqual({ "2026-11-11": "2026-11-10", "2026-11-12": "2026-11-10", "2026-11-13": "2026-11-10" });
    expect(pay?.wages["2026-11-10"].amountSen).toBe(1010869);
    expect(await loadAverageWagePay(wrap(db), staffOf(db), { start: "2026-12-01", end: "2026-12-31" }, [])).toBeNull();
  });
});
