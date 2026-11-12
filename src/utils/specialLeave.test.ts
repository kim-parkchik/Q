import { describe, expect, test } from "bun:test";
import {
  LEAVE_TYPE_TEMPLATES, dateInYear, describeExpiryRule, describeGrantRule, dueGrants, employedOn, expiryDateOf, isValidLeaveDays, latestGrantDate,
  leaveOptionValue, leaveTypeFromRow, leaveTypeToRow, maxHourlyLeave, parseExpiryRule, parseGrantRule, parseLeaveOption, specialLeaveLabel,
  specialLeaveOfRow, summarizeSpecialLeave, type LeaveType,
} from "./specialLeave";
import { formatLeaveMinutes, leaveHoursPerDay } from "./paidLeave";

const type = (over: Partial<LeaveType> = {}): LeaveType => ({
  id: 1,
  name: "夏季休暇",
  paid: true,
  trackBalance: true,
  allowHalf: true,
  allowHourly: false,
  grantRule: { month: 7, day: 1, days: 3 },
  expiryRule: { mode: "date", month: 9, day: 30 },
  active: true,
  sortOrder: 0,
  ...over,
});

describe("発生・消滅の決まりを読む", () => {
  test("発生：月日がその月にあり、日数が0.5日きざみのときだけ読む（2月29日は認める）", () => {
    expect(parseGrantRule(JSON.stringify({ month: 7, day: 1, days: 3 }))).toEqual({ month: 7, day: 1, days: 3 });
    expect(parseGrantRule(JSON.stringify({ month: 2, day: 29, days: 0.5 }))).toEqual({ month: 2, day: 29, days: 0.5 });
    expect(parseGrantRule(JSON.stringify({ month: 4, day: 31, days: 3 }))).toBeNull();
    expect(parseGrantRule(JSON.stringify({ month: 13, day: 1, days: 3 }))).toBeNull();
    expect(parseGrantRule(JSON.stringify({ month: 7, day: 1, days: 0 }))).toBeNull();
    expect(parseGrantRule(JSON.stringify({ month: 7, day: 1, days: 1.3 }))).toBeNull();
    expect(parseGrantRule("")).toBeNull();
    expect(parseGrantRule("こわれた値")).toBeNull();
    expect(isValidLeaveDays("2.5")).toBe(true);
    expect(isValidLeaveDays(-1)).toBe(false);
  });
  test("消滅：付与日から◯か月か、◯月◯日まで。読めないときは付与日から1年", () => {
    expect(parseExpiryRule(JSON.stringify({ mode: "months", months: 3 }))).toEqual({ mode: "months", months: 3 });
    expect(parseExpiryRule(JSON.stringify({ mode: "date", month: 9, day: 30 }))).toEqual({ mode: "date", month: 9, day: 30 });
    expect(parseExpiryRule(JSON.stringify({ mode: "date", month: 9, day: 31 }))).toEqual({ mode: "months", months: 12 });
    expect(parseExpiryRule(JSON.stringify({ mode: "months", months: 0 }))).toEqual({ mode: "months", months: 12 });
    expect(parseExpiryRule(null)).toEqual({ mode: "months", months: 12 });
  });
  test("会社の設定の行と行き来できる", () => {
    const t = type({ paid: false, trackBalance: true, allowHalf: false, allowHourly: true, grantRule: null, expiryRule: { mode: "months", months: 6 }, sortOrder: 2 });
    const { id: _id, ...rest } = t;
    const row = { id: 1, ...leaveTypeToRow(rest) };
    expect(row).toMatchObject({ is_paid: 0, track_balance: 1, allow_half: 0, allow_hourly: 1, grant_rule: null, is_active: 1, sort_order: 2 });
    expect(leaveTypeFromRow(row)).toEqual(t);
  });
  test("画面に出す書き方", () => {
    expect(describeGrantRule({ month: 7, day: 1, days: 3 })).toBe("毎年7月1日に3日");
    expect(describeGrantRule(null)).toBe("決まりなし（人ごとに付与する）");
    expect(describeExpiryRule({ mode: "months", months: 3 })).toBe("付与日から3か月");
    expect(describeExpiryRule({ mode: "months", months: 24 })).toBe("付与日から2年");
    expect(describeExpiryRule({ mode: "date", month: 9, day: 30 })).toBe("9月30日まで");
  });
});

describe("有効期限と付与日", () => {
  test("付与日から◯か月：応当日の前日（応当日がない日は、その月の末日）", () => {
    expect(expiryDateOf({ mode: "months", months: 3 }, "2026-07-01")).toBe("2026-09-30");
    expect(expiryDateOf({ mode: "months", months: 12 }, "2026-04-01")).toBe("2027-03-31");
    expect(expiryDateOf({ mode: "months", months: 1 }, "2026-01-31")).toBe("2026-02-28");
    expect(expiryDateOf({ mode: "months", months: 1 }, "2026-01-15")).toBe("2026-02-14");
  });
  test("◯月◯日まで：付与日以後で最初のその日（過ぎていれば次の年）", () => {
    expect(expiryDateOf({ mode: "date", month: 9, day: 30 }, "2026-07-01")).toBe("2026-09-30");
    expect(expiryDateOf({ mode: "date", month: 3, day: 31 }, "2026-10-01")).toBe("2027-03-31");
    expect(expiryDateOf({ mode: "date", month: 9, day: 30 }, "2026-09-30")).toBe("2026-09-30");
    expect(expiryDateOf({ mode: "date", month: 2, day: 29 }, "2026-03-01")).toBe("2027-02-28");
    expect(expiryDateOf({ mode: "date", month: 9, day: 30 }, "")).toBe("");
  });
  test("今日以前で最も新しい付与日（2月29日は、うるう年でない年は2月28日）", () => {
    const rule = { month: 7, day: 1, days: 3 };
    expect(latestGrantDate(rule, "2026-11-12")).toBe("2026-07-01");
    expect(latestGrantDate(rule, "2026-07-01")).toBe("2026-07-01");
    expect(latestGrantDate(rule, "2026-06-30")).toBe("2025-07-01");
    expect(latestGrantDate({ month: 2, day: 29, days: 1 }, "2027-03-01")).toBe("2027-02-28");
    expect(dateInYear(2028, 2, 29)).toBe("2028-02-29");
  });
});

describe("発生の日が来た付与の知らせ", () => {
  const staff = [
    { id: "A", name: "在籍", status: "active", join_date: "2020-04-01", retirement_date: null },
    { id: "B", name: "付与日のあとに入社", status: "active", join_date: "2026-08-01", retirement_date: null },
    { id: "C", name: "付与日の前に退職", status: "retired", join_date: "2020-04-01", retirement_date: "2026-06-30" },
    { id: "D", name: "退職（日がない）", status: "retired", join_date: "2020-04-01", retirement_date: null },
    { id: "E", name: "付与ずみ", status: "active", join_date: "2020-04-01", retirement_date: null },
    { id: "F", name: "付与しない印", status: "active", join_date: "", retirement_date: null },
    { id: "G", name: "付与日のあとに退職", status: "retired", join_date: "2020-04-01", retirement_date: "2026-07-31" },
  ];
  const grants = [
    { staff_id: "E", leave_type_id: 1, grant_date: "2026-07-01" },
    { staff_id: "F", leave_type_id: 1, grant_date: "2026-07-01" }, // 0日の「付与しない」の印
    { staff_id: "A", leave_type_id: 1, grant_date: "2025-07-01" }, // 去年の付与
  ];
  test("付与日に在籍していて、まだ付与していない人だけを出す", () => {
    const due = dueGrants([type()], staff, grants, "2026-08-15");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ grantDate: "2026-07-01", expiryDate: "2026-09-30", days: 3 });
    expect(due[0].staff.map((s) => s.id)).toEqual(["A", "G"]);
  });
  test("有効期限が過ぎた・まだ付与日の前（去年の分は期限切れ）なら出さない", () => {
    expect(dueGrants([type()], staff, grants, "2026-10-01")).toEqual([]);
    expect(dueGrants([type()], staff, grants, "2026-06-15")).toEqual([]);
  });
  test("使わない・残りを数えない・発生の決まりがない種類は出さない", () => {
    expect(dueGrants([type({ active: false })], staff, [], "2026-08-15")).toEqual([]);
    expect(dueGrants([type({ trackBalance: false })], staff, [], "2026-08-15")).toEqual([]);
    expect(dueGrants([type({ grantRule: null })], staff, [], "2026-08-15")).toEqual([]);
  });
  test("ほかの種類の付与は数えない", () => {
    const due = dueGrants([type({ id: 2 })], staff, grants, "2026-08-15");
    expect(due[0].staff.map((s) => s.id)).toEqual(["A", "E", "F", "G"]);
  });
  test("在籍の見方", () => {
    expect(employedOn({ id: 1, name: "", join_date: "2026-07-01" }, "2026-07-01")).toBe(true);
    expect(employedOn({ id: 1, name: "", join_date: "2026-07-02" }, "2026-07-01")).toBe(false);
    expect(employedOn({ id: 1, name: "", retirement_date: "2026-07-01", status: "retired" }, "2026-07-01")).toBe(true);
    expect(employedOn({ id: 1, name: "" }, "2026-07-01")).toBe(true);
  });
});

describe("残り（期限の早い付与から引く）", () => {
  const grants = [
    { id: 10, leave_type_id: 1, grant_date: "2025-07-01", expiry_date: "2025-09-30", days_granted: 3 },
    { id: 11, leave_type_id: 1, grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 3 },
    { id: 12, leave_type_id: 2, grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 5 },
  ];
  const days = [
    { work_date: "2026-06-20", work_type: "special", leave_type_id: 1 }, // 今年の付与の前（去年の分は期限切れ）
    { work_date: "2026-08-10", work_type: "special", leave_type_id: 1 },
    { work_date: "2026-08-11", work_type: "special_half", leave_type_id: 1 },
    { work_date: "2026-09-01", work_type: "special", leave_type_id: 1 },
    { work_date: "2026-09-02", work_type: "special", leave_type_id: 1 }, // 残りより多い
    { work_date: "2026-08-12", work_type: "special", leave_type_id: 2 }, // ほかの種類
    { work_date: "2026-08-13", work_type: "paid_full", leave_type_id: null },
  ];
  test("付与の前に取った日・残りより多く取った日は「残りが足りない」。期限が過ぎた分は消える", () => {
    const s = summarizeSpecialLeave(type(), grants, days, "2026-08-31");
    expect(s.hasGrants).toBe(true);
    expect(s.taken.map((t) => t.date)).toEqual(["2026-06-20", "2026-08-10", "2026-08-11", "2026-09-01", "2026-09-02"]);
    expect(s.remainingMinutes).toBe(720); // 1.5日（1日 8時間）
    expect(s.shortages.map((t) => [t.date, t.shortageMinutes])).toEqual([["2026-06-20", 480], ["2026-09-02", 240]]);
    const g2025 = s.grants.find((g) => g.grant.id === 10)!;
    expect(g2025).toMatchObject({ state: "expired", expiredMinutes: 1440, usedMinutes: 0 });
    const g2026 = s.grants.find((g) => g.grant.id === 11)!;
    expect(g2026).toMatchObject({ state: "active", usedMinutes: 720, laterMinutes: 720, remainingMinutes: 720 });
  });
  test("付与が1つもなければ、取った日はすべて足りない", () => {
    const s = summarizeSpecialLeave(type(), [], days, "2026-08-31");
    expect(s.hasGrants).toBe(false);
    expect(s.shortages).toHaveLength(5);
    expect(s.remainingMinutes).toBe(0);
  });
  test("残りを数えない種類（慶弔休暇など）は、取った日だけを出す", () => {
    const s = summarizeSpecialLeave(type({ trackBalance: false }), grants, days, "2026-08-31");
    expect(s.grants).toEqual([]);
    expect(s.shortages).toEqual([]);
    expect(s.taken.map((t) => [t.date, t.days])).toEqual([["2026-06-20", 1], ["2026-08-10", 1], ["2026-08-11", 0.5], ["2026-09-01", 1], ["2026-09-02", 1]]);
  });
});

describe("時間単位（子の看護等休暇・介護休暇など。育児・介護休業法施行規則34条・40条）", () => {
  test("1日分は、1日の所定労働時間（1時間に満たない端数は切り上げ）。7時間30分の人は8時間で1日", () => {
    const hours = leaveHoursPerDay(7.5).hours;
    expect(hours).toBe(8);
    const t = type({ id: 5, name: "子の看護等休暇", paid: false, allowHalf: false, allowHourly: true });
    const grants = [{ id: 1, leave_type_id: 5, grant_date: "2026-04-01", expiry_date: "2027-03-31", days_granted: 5 }];
    const days = [
      { work_date: "2026-05-11", work_type: "normal", leave_type_id: 5, special_leave_hours: 3 },
      { work_date: "2026-06-01", work_type: "special", leave_type_id: 5, special_leave_hours: 0 },
      { work_date: "2026-06-15", work_type: "normal", leave_type_id: 5, special_leave_hours: 2 },
      { work_date: "2026-06-16", work_type: "special", leave_type_id: 5, special_leave_hours: 4 }, // 1日の日の時間は数えない
    ];
    const s = summarizeSpecialLeave(t, grants, days, "2026-11-12", hours);
    expect(s.taken.map((x) => [x.date, x.days, x.hours])).toEqual([["2026-05-11", 0, 3], ["2026-06-01", 1, 0], ["2026-06-15", 0, 2], ["2026-06-16", 1, 0]]);
    // 5日（40時間）−（3時間 ＋ 1日 ＋ 2時間 ＋ 1日 ＝ 21時間）＝ 19時間 ＝ 2日と3時間
    expect(s.remainingMinutes).toBe(19 * 60);
    expect(formatLeaveMinutes(s.remainingMinutes, hours)).toBe("2日と3時間");
  });
  test("時間単位で取れるのは、1日の所定労働時間に満たない時間（8時間なら7時間、7時間30分なら7時間まで）", () => {
    expect(maxHourlyLeave(8)).toBe(7);
    expect(maxHourlyLeave(7.5)).toBe(7);
    expect(maxHourlyLeave(6)).toBe(5);
    expect(maxHourlyLeave(null)).toBe(7);
  });
  test("給与の計算に使う時間（区分が特別休暇の日の時間は使わない）", () => {
    expect(specialLeaveOfRow({ work_type: "normal", special_leave_hours: 3, leave_paid: 0 })).toEqual({ days: 0, hours: 3, paid: false });
    expect(specialLeaveOfRow({ work_type: "special_half", special_leave_hours: 3, leave_paid: 1 })).toEqual({ days: 0.5, hours: 0, paid: true });
  });
  test("見本：子の看護等休暇・介護休暇は、無給・毎年4月1日に5日・3月31日まで・時間単位でも取れる", () => {
    expect(LEAVE_TYPE_TEMPLATES.map((t) => t.name)).toEqual(["子の看護等休暇", "介護休暇"]);
    for (const t of LEAVE_TYPE_TEMPLATES) {
      expect(t).toMatchObject({ paid: false, trackBalance: true, allowHourly: true, grantRule: { month: 4, day: 1, days: 5 } });
      expect(expiryDateOf(t.expiryRule, "2026-04-01")).toBe("2027-03-31");
    }
  });
});

describe("勤怠の区分", () => {
  test("プルダウンの値と、区分・休暇の種類を行き来できる", () => {
    expect(leaveOptionValue("special_half", 3)).toBe("special_half:3");
    expect(parseLeaveOption("special_half:3")).toEqual({ workType: "special_half", leaveTypeId: 3 });
    expect(parseLeaveOption("special:12")).toEqual({ workType: "special", leaveTypeId: 12 });
    expect(parseLeaveOption("paid_full")).toEqual({ workType: "paid_full", leaveTypeId: null });
  });
  test("有給か無給かは確定したときに残した値。値がない日は、払う額が少なくならないように有給", () => {
    expect(specialLeaveOfRow({ work_type: "special", leave_paid: 0 })).toEqual({ days: 1, hours: 0, paid: false });
    expect(specialLeaveOfRow({ work_type: "special_half", leave_paid: 1 })).toEqual({ days: 0.5, hours: 0, paid: true });
    expect(specialLeaveOfRow({ work_type: "special", leave_paid: null })).toEqual({ days: 1, hours: 0, paid: true });
    expect(specialLeaveOfRow({ work_type: "normal", leave_paid: 0 })).toEqual({ days: 0, hours: 0, paid: false });
  });
  test("勤怠に出す名前", () => {
    expect(specialLeaveLabel({ name: "夏季休暇" }, "special")).toBe("夏季休暇");
    expect(specialLeaveLabel({ name: "夏季休暇" }, "special_half")).toBe("夏季休暇（半日）");
    expect(specialLeaveLabel(undefined, "special")).toBe("特別休暇");
  });
});
