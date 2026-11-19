import { describe, expect, test } from "bun:test";
import {
  breakMinutesFor, defaultFormType, laborDefaults, parseStaffLaborConditions, resolveLaborConditions, stringifyCompanyLaborConditions,
  stringifyStaffLaborConditions, type LaborContext,
} from "./laborConditions";

const company = { name: "サンプル商事株式会社", address: "東京都千代田区丸の内1-1-1", representative: "代表取締役 見本 太郎", annual_holidays: 120, hourly_leave: 1 };
const base = (staff: any, extra: Partial<LaborContext> = {}): LaborContext => ({
  staff, company, branch: { name: "本社", address: "東京都千代田区丸の内1-1-1" },
  group: { closing_day: 99, is_next_month: 1, payment_day: 25, fixed_break: JSON.stringify({ mode: "time", start: "12:00", end: "13:00", combine: "record" }) },
  allowances: [{ name: "役職手当", amount: 20000 }], leaveTypes: [{ name: "慶弔休暇", isPaid: true }, { name: "生理休暇", isPaid: false }],
  hasBankAccount: true, annualDays: 245, socialInsured: true, today: "2026-11-18", ...extra,
});

describe("労働条件通知書", () => {
  test("正社員：Q の設定から契約期間・場所・時刻・休日・有給・賃金・保険を作る", () => {
    const staff = {
      id: "1", join_date: "2026-04-01", job_type: "営業", scheduled_in: "09:00", scheduled_work_hours: 8, calendar_pattern_id: 1,
      wage_type: "monthly", base_wage: 250000, commute_type: "monthly", commute_amount: 12000, is_employment_ins_eligible: 1, is_overtime_eligible: 1,
    };
    const d = laborDefaults(base(staff));
    expect(d.contractPeriod).toBe("期間の定めなし");
    expect(d.workplace).toBe("サンプル商事株式会社　東京都千代田区丸の内1-1-1");
    expect(d.placeNow).toBe("本社　東京都千代田区丸の内1-1-1");
    expect(d.jobNow).toBe("営業");
    expect(d.workHours).toBe("始業（9時00分） 終業（18時00分）");
    expect(d.breakTime).toBe("60分");
    expect(d.holidays).toBe("会社カレンダーによる（年間 120日）");
    expect(d.annualLeave).toBe("６か月継続勤務した場合→ 10日　時間単位年休（有）");
    expect(d.otherLeave).toBe("有給（慶弔休暇）　無給（生理休暇）");
    expect(d.basePay).toBe("月給（250,000円）");
    expect(d.allowances).toBe("役職手当 20,000円\n通勤手当 12,000円");
    expect(d.premiumRates.split("\n")).toEqual([
      "所定時間外、法定超 月６０時間以内（25）％　月６０時間超（50）％　所定超（0）％",
      "休日 法定休日（35）％、法定外休日（25）％",
      "深夜（25）％",
    ]);
    expect(d.closingDay).toBe("毎月 末日");
    expect(d.payDay).toBe("翌月 25日");
    expect(d.payMethod).toBe("本人が指定する金融機関の口座への振込");
    expect(d.socialInsurance).toBe("厚生年金・健康保険");
    expect(d.employmentInsurance).toBe("有");
    expect(defaultFormType(staff)).toBe("general");
  });
  test("割増賃金率は、その人の給与規定グループの率（就業規則・36協定で決めた率）", () => {
    const staff = { id: "1", join_date: "2026-04-01", scheduled_work_hours: 8, wage_type: "monthly", base_wage: 250000, is_overtime_eligible: 1 };
    const group = { closing_day: 99, is_next_month: 1, payment_day: 25, fixed_break: null,
      premium_rates: JSON.stringify({ overtime: 30, overLimitMonth: 35, over60: 50, overLimitYear: 35, holiday: 40, night: 30, statutory: 25 }) };
    expect(laborDefaults(base(staff, { group })).premiumRates.split("\n")).toEqual([
      "所定時間外、法定超 月６０時間以内（30）％　月６０時間超（50）％　所定超（25）％",
      "限度時間を超えた時間外労働 月４５時間超（35）％　年３６０時間超（35）％",
      "休日 法定休日（40）％、法定外休日（30）％",
      "深夜（30）％",
    ]);
  });

  test("パート（有期・曜日で決める・週15時間）：短時間労働者用で、勤務日・比例付与・更新の明示事項", () => {
    const staff = {
      id: "2", join_date: "2026-04-01", job_type: "販売", scheduled_in: "10:00", scheduled_work_hours: 5, calendar_pattern_id: 0, work_days: "mon,wed,fri",
      wage_type: "hourly", base_wage: 1200, is_employment_ins_eligible: 0,
      koyo_info: JSON.stringify({ contract: { has: true, start: "2026-04-01", end: "2027-03-31", renewal: "有" } }),
    };
    const ctx = base(staff, { group: { closing_day: 20, is_next_month: 0, payment_day: 25, fixed_break: null }, allowances: [], leaveTypes: [], hasBankAccount: false, annualDays: null, socialInsured: false });
    const d = laborDefaults(ctx);
    expect(defaultFormType(staff)).toBe("parttime");
    expect(d.contractPeriod).toBe("期間の定めあり（令和8年4月1日～令和9年3月31日）");
    expect(d.renewal).toBe("更新する場合があり得る");
    expect(d.workHours).toBe("始業（10時00分） 終業（15時00分）");
    expect(d.breakTime).toBeUndefined();
    expect(d.holidays).toBe("定例日；毎週 火・木・土・日曜日");
    expect(d.workDays).toBe("毎週（月・水・金）");
    expect(d.annualLeave).toBe("６か月継続勤務した場合→ 5日（比例付与）　時間単位年休（有）");
    expect(d.basePay).toBe("時間給（1,200円）");
    expect(d.closingDay).toBe("毎月 20日");
    expect(d.payDay).toBe("当月 25日");
    expect(d.payMethod).toBe("通貨で直接支払う");
    expect(d.socialInsurance).toBe("加入しない");
    expect(d.employmentInsurance).toBe("無");

    const r = resolveLaborConditions({ formType: "", fields: {} }, { renewalCriteria: "契約期間満了時の業務量・勤務成績、態度" }, d, staff);
    expect(r.formType).toBe("parttime");
    expect(r.fixedTerm).toBe(true);
    expect(r.values.renewalCriteria).toBe("契約期間満了時の業務量・勤務成績、態度");
    expect("workDays" in r.values).toBe(true);
    // 書面で明示する事項：変更の範囲・休憩・更新上限・定年など・昇給賞与退職金・相談窓口が空
    const titles = r.problems.join("\n");
    for (const w of ["就業の場所：（変更の範囲）", "休憩時間", "更新上限の有無", "定年制", "昇給", "賞与", "退職金", "相談窓口"]) expect(titles).toContain(w);
  });

  test("従業員ごとの値 → 会社の初めの値 → Q の設定の順。正社員は短時間用の欄と昇給などの明示を求めない", () => {
    const staff = { id: "1", scheduled_work_hours: 8, calendar_pattern_id: 1, join_date: "2020-04-01" };
    const r = resolveLaborConditions(
      { formType: "", fields: { jobNow: "経理" } },
      { jobNow: "（会社の値は使わない欄）", placeRange: "会社の定める営業所", retirementAge: "有（60歳）" },
      { jobNow: "営業", contractPeriod: "期間の定めなし", placeNow: "本社" },
      staff,
    );
    expect(r.values.jobNow).toBe("経理");
    expect(r.values.placeRange).toBe("会社の定める営業所");
    expect(r.values.retirementAge).toBe("有（60歳）");
    expect("workDays" in r.values).toBe(false);
    expect(r.problems.join("\n")).not.toContain("昇給");
  });

  test("通算5年を超える有期労働契約は、無期転換を書くよう知らせる", () => {
    const staff = { id: "3", join_date: "2021-04-01", scheduled_work_hours: 8 };
    const r = resolveLaborConditions({ formType: "general", fields: {} }, {}, { contractPeriod: "期間の定めあり（令和8年4月1日～令和9年3月31日）" }, staff);
    expect(r.problems.some((p) => p.includes("無期転換"))).toBe(true);
    const r2 = resolveLaborConditions({ formType: "general", fields: { conversion: "令和9年4月1日から転換できる" } }, {}, { contractPeriod: "期間の定めあり（令和8年4月1日～令和9年3月31日）" }, staff);
    expect(r2.problems.some((p) => p.includes("無期転換"))).toBe(false);
  });

  test("決まった休憩の分と、保存の形", () => {
    expect(breakMinutesFor(JSON.stringify({ mode: "length", rules: [{ overMinutes: 360, breakMinutes: 45 }, { overMinutes: 480, breakMinutes: 60 }] }), 480)).toBe(45);
    expect(breakMinutesFor(JSON.stringify({ mode: "length", rules: [{ overMinutes: 360, breakMinutes: 45 }, { overMinutes: 480, breakMinutes: 60 }] }), 540)).toBe(60);
    expect(breakMinutesFor(null, 480)).toBeNull();
    expect(stringifyStaffLaborConditions({ formType: "", fields: {} })).toBeNull();
    expect(parseStaffLaborConditions(stringifyStaffLaborConditions({ formType: "parttime", fields: { jobNow: "販売" } }))).toEqual({ formType: "parttime", fields: { jobNow: "販売" } });
    expect(stringifyCompanyLaborConditions({ a: " ", b: "x" })).toBe(JSON.stringify({ b: "x" }));
  });
});
