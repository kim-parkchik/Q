import { describe, expect, test } from "bun:test";
import {
  afterMonths, attendanceRateFor, describeAnnualLeaveRule, describeFiveDay, dueAnnualGrants, fiveDayStatuses, grantDaysFor, parseAnnualLeaveRule,
  otherLeaveRuleOf, periodMonths, plannedGrants, stageLabel, stringifyAnnualLeaveRule, workScaleOf, type AnnualLeaveRule,
} from "./annualLeaveGrant";
import { NORMAL_GRANT_DAYS } from "../constants/annualLeave";
import type { CalendarContext } from "./annualWorkDays";

const MON_FRI: CalendarContext = {
  patternId: 0,
  workDays: { sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false },
  holidays: new Set(),
  companyCalendar: {},
};

describe("会社の付与のしかた", () => {
  test("初めは入社日ごと。そろえるときは月日と初回の付与を読む", () => {
    expect(parseAnnualLeaveRule(null)).toEqual({ mode: "hire" });
    const r: AnnualLeaveRule = { mode: "unified", month: 4, day: 1, first: "sixMonths" };
    expect(parseAnnualLeaveRule(stringifyAnnualLeaveRule(r))).toEqual(r);
    expect(parseAnnualLeaveRule(JSON.stringify({ mode: "unified", month: 2, day: 30 }))).toEqual({ mode: "hire" });
    expect(describeAnnualLeaveRule(r)).toBe("毎年4月1日にそろえる（初回は入社6か月後、2回目から）");
  });
});

describe("付与日（6か月・1年は応当日。応当日がない月は翌月1日）", () => {
  test("6か月たった日", () => {
    expect(afterMonths("2026-04-01", 6)).toBe("2026-10-01");
    expect(afterMonths("2025-08-31", 6)).toBe("2026-03-01");
    expect(afterMonths("2026-10-01", 12)).toBe("2027-10-01");
  });
  test("入社日ごと：入社6か月後に10日、その後1年ごとに11・12・14・16・18・20日", () => {
    const p = plannedGrants("2026-04-01", { mode: "hire" }, "2033-12-31");
    expect(p.map((g) => [g.date, g.stage])).toEqual([
      ["2026-10-01", 0], ["2027-10-01", 1], ["2028-10-01", 2], ["2029-10-01", 3], ["2030-10-01", 4],
      ["2031-10-01", 5], ["2032-10-01", 6], ["2033-10-01", 7], ["2034-10-01", 8],
    ]);
    expect(p.map((g) => grantDaysFor(g.stage, { weeklyDays: 5, weeklyHours: 40, annualDays: null }).days)).toEqual([10, 11, 12, 14, 16, 18, 20, 20, 20]);
    expect(p[0]).toMatchObject({ periodFrom: "2026-04-01", periodTo: "2026-09-30", deemedFrom: null });
    expect(p[1]).toMatchObject({ periodFrom: "2026-10-01", periodTo: "2027-09-30" });
  });
  test("今日までの付与と、その次の1回だけを出す。退職日より後は出さない", () => {
    expect(plannedGrants("2026-04-01", { mode: "hire" }, "2027-01-01").map((g) => g.date)).toEqual(["2026-10-01", "2027-10-01"]);
    expect(plannedGrants("2026-04-01", { mode: "hire" }, "2030-01-01", "2028-03-31").map((g) => g.date)).toEqual(["2026-10-01", "2027-10-01"]);
  });
  test("4月1日にそろえる（初回は入社6か月後、2回目から）：2回目は前倒しで11日。前倒しで短くなった期間は出勤したものとみなす", () => {
    const p = plannedGrants("2026-04-01", { mode: "unified", month: 4, day: 1, first: "sixMonths" }, "2029-01-01");
    expect(p.map((g) => [g.date, g.stage, g.legalDate])).toEqual([
      ["2026-10-01", 0, "2026-10-01"], ["2027-04-01", 1, "2027-10-01"], ["2028-04-01", 2, "2028-10-01"], ["2029-04-01", 3, "2029-10-01"],
    ]);
    expect(p[1]).toMatchObject({ periodFrom: "2026-10-01", periodTo: "2027-03-31", deemedFrom: "2027-04-01", deemedTo: "2027-09-30" });
  });
  test("4月1日にそろえる（統一日が先なら初回から）：1月15日入社は4月1日に10日、4月10日入社は10月10日に10日", () => {
    const rule: AnnualLeaveRule = { mode: "unified", month: 4, day: 1, first: "unifiedFirst" };
    const jan = plannedGrants("2026-01-15", rule, "2027-06-01");
    expect(jan.map((g) => [g.date, g.stage])).toEqual([["2026-04-01", 0], ["2027-04-01", 1], ["2028-04-01", 2]]);
    expect(jan[0]).toMatchObject({ legalDate: "2026-07-15", deemedFrom: "2026-04-01", deemedTo: "2026-07-14" });
    const apr = plannedGrants("2026-04-10", rule, "2027-06-01");
    expect(apr.map((g) => [g.date, g.stage])).toEqual([["2026-10-10", 0], ["2027-04-01", 1], ["2028-04-01", 2]]);
  });
  test("どの決まりでも、法定の基準日より遅く付与しない", () => {
    for (const rule of [
      { mode: "unified", month: 4, day: 1, first: "sixMonths" },
      { mode: "unified", month: 10, day: 1, first: "unifiedFirst" },
      { mode: "unified", month: 2, day: 29, first: "sixMonths" },
    ] as AnnualLeaveRule[]) {
      for (const join of ["2025-01-31", "2025-03-01", "2025-08-31", "2025-12-15"]) {
        for (const g of plannedGrants(join, rule, "2032-12-31")) expect(g.date <= g.legalDate).toBe(true);
      }
    }
  });
});

describe("付与日数（比例付与）", () => {
  test("週30時間以上か、週5日以上なら通常の日数", () => {
    expect(grantDaysFor(0, { weeklyDays: 4, weeklyHours: 32, annualDays: null })).toEqual({ days: 10, proportional: false });
    expect(grantDaysFor(1, { weeklyDays: 5, weeklyHours: 25, annualDays: null })).toEqual({ days: 11, proportional: false });
  });
  test("週30時間未満で週4日以下なら比例付与（週4日：7・8・9・10・12・13・15日、週1日：1・2・2・2・3・3・3日）", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => grantDaysFor(s, { weeklyDays: 4, weeklyHours: 24, annualDays: null }).days)).toEqual([7, 8, 9, 10, 12, 13, 15]);
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => grantDaysFor(s, { weeklyDays: 1, weeklyHours: 6, annualDays: null }).days)).toEqual([1, 2, 2, 2, 3, 3, 3]);
    expect(grantDaysFor(9, { weeklyDays: 3, weeklyHours: 15, annualDays: null })).toEqual({ days: 11, proportional: true });
  });
  test("会社カレンダーで決めている人は、1年間の所定労働日数で決める（216日以下なら比例付与）", () => {
    expect(grantDaysFor(0, { weeklyDays: null, weeklyHours: 20, annualDays: 200 })).toEqual({ days: 7, proportional: true });
    expect(grantDaysFor(0, { weeklyDays: null, weeklyHours: 20, annualDays: 240 })).toEqual({ days: 10, proportional: false });
  });
  test("従業員の設定から、週の日数と時間を出す", () => {
    expect(workScaleOf({ calendar_pattern_id: 0, work_days: "mon,wed,fri", scheduled_work_hours: 6 }, null)).toEqual({ weeklyDays: 3, weeklyHours: 18, annualDays: null });
    expect(workScaleOf({ calendar_pattern_id: 1, scheduled_work_hours: 8 }, 245).weeklyDays).toBeNull();
    expect(stageLabel(0)).toBe("6か月");
    expect(stageLabel(9)).toBe(`${NORMAL_GRANT_DAYS.length - 1}年6か月以上`);
  });
});

describe("出勤率（全労働日の8割以上。年休・特別休暇・産休・育休は出勤したものとみなす）", () => {
  // 2026年6月1日〜12日の平日（10日）
  const row = (d: string, type = "normal", hours = 8) => ({ work_date: `2026-06-${d}`, work_type: type, work_hours: hours });
  const all = ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12"];
  test("出勤・年休の日は出勤、欠勤は出勤しない。8割以上か", () => {
    const rows = all.map((d, i) => (i < 7 ? row(d) : i === 7 ? row(d, "paid_full", 0) : row(d, "absent", 0)));
    const r = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, rows, []);
    expect([r.allDays, r.presentDays, r.missingDays, r.ok]).toEqual([10, 8, 0, true]);
    const low = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, all.map((d, i) => (i < 7 ? row(d) : row(d, "absent", 0))), []);
    expect([low.presentDays, low.ok]).toEqual([7, false]);
  });
  test("公休にした日は全労働日に入れない。休日の労働は数えない。産休・育休の期間は出勤したものとみなす", () => {
    const rows = [...all.slice(0, 8).map((d) => row(d)), row("11", "holiday", 0), row("13", "holiday_work")];
    const r = attendanceRateFor("2026-06-01", "2026-06-13", MON_FRI, rows, [{ type: "childcare", start: "2026-06-12", end: "2026-06-30" }]);
    expect([r.allDays, r.presentDays, r.missingDays, r.ok]).toEqual([9, 9, 0, true]);
  });
  test("Q に確定した勤怠がない日があれば、確かめられない（null）", () => {
    const r = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, all.slice(0, 5).map((d) => row(d)), []);
    expect([r.missingDays, r.ok]).toEqual([5, null]);
  });
  test("介護休業・業務上の負傷や疾病による休業も、出勤したものとみなす（労働基準法39条10項）", () => {
    const rows = all.slice(0, 6).map((d) => row(d));
    const r = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, rows, [
      { type: "family_care", start: "2026-06-09", end: "2026-06-10" },
      { type: "injury", start: "2026-06-11", end: "2026-06-12" },
    ]);
    expect([r.allDays, r.presentDays, r.leaveDays, r.missingDays, r.ok]).toEqual([10, 10, 4, 0, true]);
  });
  test("その他の休職は、会社の決まりで数える（初めは全労働日から除く。欠勤と同じにもできる。働いた日は出勤）", () => {
    const rows = [...all.slice(0, 5).map((d) => row(d)), row("09")];
    const other = [{ type: "other" as const, start: "2026-06-08", end: "2026-06-30" }];
    const excluded = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, rows, other);
    expect([excluded.allDays, excluded.presentDays, excluded.otherLeaveDays, excluded.ok, excluded.otherLeaveRule]).toEqual([6, 6, 4, true, "exclude"]);
    const absent = attendanceRateFor("2026-06-01", "2026-06-12", MON_FRI, rows, other, null, "absent");
    expect([absent.allDays, absent.presentDays, absent.otherLeaveDays, absent.ok]).toEqual([10, 6, 4, false]);
  });
  test("会社の決まり（JSON）に、その他の休職の数え方を残す（なければ全労働日から除く）", () => {
    expect(otherLeaveRuleOf(parseAnnualLeaveRule(null))).toBe("exclude");
    const hire = parseAnnualLeaveRule(stringifyAnnualLeaveRule({ mode: "hire", otherLeave: "absent" }));
    expect(hire).toEqual({ mode: "hire", otherLeave: "absent" });
    const unified = parseAnnualLeaveRule(JSON.stringify({ mode: "unified", month: 4, day: 1, first: "sixMonths", otherLeave: "absent" }));
    expect(otherLeaveRuleOf(unified)).toBe("absent");
    expect(otherLeaveRuleOf(parseAnnualLeaveRule(JSON.stringify({ mode: "unified", month: 4, day: 1, otherLeave: "何か" })))).toBe("exclude");
  });
  test("前倒しで短くなった期間は、全部出勤したものとみなす", () => {
    const rows = all.slice(0, 5).map((d, i) => (i < 3 ? row(d) : row(d, "absent", 0)));
    const r = attendanceRateFor("2026-06-01", "2026-06-05", MON_FRI, rows, [], { from: "2026-06-08", to: "2026-06-19" });
    expect([r.allDays, r.presentDays, r.deemedDays, r.ok]).toEqual([15, 13, 10, true]);
  });
});

describe("まだ登録していない付与", () => {
  const planned = plannedGrants("2024-04-01", { mode: "hire" }, "2026-11-13");
  test("付与が1つもない人は、有効期限（2年）が残っている付与を出す", () => {
    expect(dueAnnualGrants(planned, [], "2026-11-13").map((g) => g.date)).toEqual(["2025-10-01", "2026-10-01"]);
  });
  test("付与がある人は、いちばん新しい付与より後の付与だけ（日が違う前の付与で、知らせが出つづけないように）", () => {
    const grants = [{ id: 1, name: "法定有給", grant_date: "2025-09-20", expiry_date: "2027-09-19", days_granted: 11 }];
    expect(dueAnnualGrants(planned, grants, "2026-11-13").map((g) => g.date)).toEqual(["2026-10-01"]);
    const done = [...grants, { id: 2, name: "法定有給", grant_date: "2026-10-01", expiry_date: "2028-09-30", days_granted: 12 }];
    expect(dueAnnualGrants(planned, done, "2026-11-13")).toEqual([]);
    // 少し遅く登録した付与も、同じ付与とみなす
    const late = [{ id: 3, name: "法定有給", grant_date: "2026-10-05", expiry_date: "2028-10-04", days_granted: 12 }];
    expect(dueAnnualGrants(planned, late, "2026-11-13")).toEqual([]);
  });
});

describe("年5日（10日以上付与した人に、付与日から1年以内に5日。全休1日・半休0.5日。時間単位は数えない）", () => {
  const g = (id: number, date: string, days: number) => ({ id, name: "法定有給", grant_date: date, expiry_date: afterMonths(date, 24), days_granted: days });
  const t = (date: string, days: number, hours = 0) => ({ date, days, hours, source: "attendance" as const });
  const opts = { halfDayLeave: true, planned: [] };
  test("期間中で足りない・取れた・期間が過ぎて足りない", () => {
    const grants = [g(1, "2025-10-01", 10), g(2, "2026-10-01", 11), g(3, "2027-10-01", 12)];
    const taken = [t("2025-12-01", 1), t("2026-03-02", 0.5), t("2026-06-01", 0, 3), t("2026-11-02", 1), t("2026-11-03", 1)];
    const s = fiveDayStatuses(grants, taken, "2026-11-13", opts);
    expect(s.map((x) => [x.from, x.to, x.takenDays, x.requiredDays, x.merged, x.state])).toEqual([
      ["2025-10-01", "2026-09-30", 1.5, 5, false, "overdue"],
      ["2026-10-01", "2027-09-30", 2, 5, false, "ongoing"],
      ["2027-10-01", "2028-09-30", 0, 5, false, "upcoming"],
    ]);
    expect(fiveDayStatuses(grants, [...taken, t("2026-11-10", 1), t("2026-11-11", 1), t("2026-11-12", 1)], "2026-11-13", opts)[1].state).toBe("done");
  });
  test("10日より少ない付与（比例付与など）は対象にしない", () => {
    expect(fiveDayStatuses([g(1, "2026-10-01", 7)], [], "2026-11-13", opts)).toEqual([]);
  });
  test("期間の月数は、まるまるの月数に、余りの日をその次の1か月の日数で割った分を足す（ジョブカンと同じ）", () => {
    expect(periodMonths("2025-10-15", "2027-03-31")).toEqual({ months: 17, extraDays: 17, total: 17 + 17 / 31 });
    expect(periodMonths("2019-10-01", "2021-03-31")).toEqual({ months: 18, extraDays: 0, total: 18 });
    expect(periodMonths("2026-10-01", "2027-09-30")).toEqual({ months: 12, extraDays: 0, total: 12 });
  });
  test("1年の期間が重なるときは、まとめて按分（18か月で7.5日。半休を使わない会社は8日）。重なる半年に取った日は1回だけ数える", () => {
    const grants = [g(1, "2026-10-01", 10), g(2, "2027-04-01", 11)];
    const taken = ["2027-05-06", "2027-06-01", "2027-07-01", "2027-08-02", "2027-09-01"].map((d) => t(d, 1));
    const s = fiveDayStatuses(grants, taken, "2027-10-01", opts);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      grants: [{ date: "2026-10-01", days: 10 }, { date: "2027-04-01", days: 11 }],
      from: "2026-10-01", to: "2028-03-31", countFrom: "2026-10-01", merged: true,
      months: 18, extraDays: 0, exactDays: 7.5, requiredDays: 7.5, takenDays: 5, state: "ongoing",
    });
    expect(s[0].remainingDays).toBe(2.5);
    const noHalf = fiveDayStatuses(grants, taken, "2027-10-01", { ...opts, halfDayLeave: false })[0];
    expect([noHalf.requiredDays, noHalf.remainingDays]).toEqual([8, 3]);
    const more = [...taken, t("2027-11-01", 1), t("2027-12-01", 1), t("2028-01-05", 0.5)];
    expect(fiveDayStatuses(grants, more, "2028-01-06", opts)[0]).toMatchObject({ state: "done", remainingDays: 0 });
    // 半休を使わない会社でも、前に取った半休は0.5日で数え、取れたかは按分した7.5日で見る（4.5日取った人は、7.5日まで、あと3日）
    const withHalf = [...taken.slice(0, 4), t("2027-09-01", 0.5)];
    const h = fiveDayStatuses(grants, withHalf, "2027-10-01", { ...opts, halfDayLeave: false })[0];
    expect([h.takenDays, h.requiredDays, h.remainingDays]).toEqual([4.5, 7.5, 3]);
    const h2 = fiveDayStatuses(grants, [...withHalf, t("2027-11-01", 1), t("2027-12-01", 1), t("2028-01-05", 1)], "2028-01-06", { ...opts, halfDayLeave: false })[0];
    expect([h2.takenDays, h2.state]).toEqual([7.5, "done"]);
    // 2つめの付与の前は、1つめの付与から1年に5日
    expect(fiveDayStatuses([grants[0]], taken, "2027-03-01", opts)[0]).toMatchObject({ to: "2027-09-30", requiredDays: 5, merged: false });
  });
  test("端数は、取れる単位に切り上げる（15か月 → 6.25日 → 6.5日。半休を使わない会社は7日）", () => {
    const grants = [g(1, "2025-10-01", 10), g(2, "2026-01-01", 11)];
    const [s] = fiveDayStatuses(grants, [], "2026-02-01", opts);
    expect([s.to, s.months, s.exactDays, s.requiredDays]).toEqual(["2026-12-31", 15, 6.25, 6.5]);
    expect(fiveDayStatuses(grants, [], "2026-02-01", { ...opts, halfDayLeave: false })[0].requiredDays).toBe(7);
    // ジョブカンの例：2025-10-15〜2027-03-31（17か月と17日）→ 7.31日 → 7.5日
    const [j] = fiveDayStatuses([g(3, "2025-10-15", 10), g(4, "2026-04-01", 11)], [], "2026-05-01", opts);
    expect([j.to, j.months, j.extraDays, Math.round(j.exactDays * 100) / 100, j.requiredDays]).toEqual(["2027-03-31", 17, 17, 7.31, 7.5]);
    // 7.31日に 5日取った人は、あと 2.5日（半休を使わない会社は 3日）
    const five = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01"].map((d) => t(d, 1));
    expect(fiveDayStatuses([g(3, "2025-10-15", 10), g(4, "2026-04-01", 11)], five, "2026-10-01", opts)[0].remainingDays).toBe(2.5);
    expect(fiveDayStatuses([g(3, "2025-10-15", 10), g(4, "2026-04-01", 11)], five, "2026-10-01", { ...opts, halfDayLeave: false })[0].remainingDays).toBe(3);
  });
  test("重ならない付与は、付与ごとに5日。3回続けて重なるときは、最後の付与から1年までまとめる", () => {
    const s = fiveDayStatuses([g(1, "2024-10-01", 10), g(2, "2025-10-01", 11)], [], "2026-11-13", opts);
    expect(s.map((x) => [x.from, x.to, x.merged, x.requiredDays])).toEqual([
      ["2024-10-01", "2025-09-30", false, 5],
      ["2025-10-01", "2026-09-30", false, 5],
    ]);
    const chain = fiveDayStatuses([g(1, "2025-10-01", 10), g(2, "2026-04-01", 11), g(3, "2027-01-01", 12)], [], "2027-02-01", opts);
    expect(chain.map((x) => [x.from, x.to, x.months, x.requiredDays])).toEqual([["2025-10-01", "2027-12-31", 27, 11.5]]);
  });
  test("10日を分けて付与したときは、合わせて10日になった日から1年。はじめに付与した日からの取得も数える（施行規則24条の5第4項）", () => {
    const planned = plannedGrants("2026-04-01", { mode: "hire" }, "2026-11-13");
    const grants = [g(1, "2026-04-01", 5), g(2, "2026-10-01", 5)];
    const taken = [t("2026-06-01", 1), t("2026-09-01", 0.5), t("2026-11-02", 1)];
    const s = fiveDayStatuses(grants, taken, "2026-11-13", { halfDayLeave: true, planned });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      grants: [{ date: "2026-04-01", days: 5 }, { date: "2026-10-01", days: 5 }],
      from: "2026-10-01", to: "2027-09-30", countFrom: "2026-04-01", merged: false, requiredDays: 5, takenDays: 2.5, state: "ongoing",
    });
    // 入社日がわからない（付与の予定がない）ときは、分けた付与を合わせない
    expect(fiveDayStatuses(grants, taken, "2026-11-13", opts)).toEqual([]);
  });
  test("比例付与の人が、付与日をそろえて半年で次の付与を受けても、別の段の付与なので合わせて10日にはしない", () => {
    const rule: AnnualLeaveRule = { mode: "unified", month: 4, day: 1, first: "sixMonths" };
    const planned = plannedGrants("2026-04-01", rule, "2027-05-01");
    expect(fiveDayStatuses([g(1, "2026-10-01", 5), g(2, "2027-04-01", 6)], [], "2027-05-01", { halfDayLeave: true, planned })).toEqual([]);
  });
  test("取った日は、全休1日・半休0.5日で数える（時間単位と、前の記録の半日に満たない半端は数えない）", () => {
    const manual = (date: string, days: number) => ({ date, days, hours: 0, source: "manual" as const });
    const taken = [t("2026-11-02", 1), t("2026-11-03", 0.5), t("2026-11-04", 0, 4), manual("2026-11-05", 0.3), manual("2026-11-06", 0.75)];
    expect(fiveDayStatuses([g(1, "2026-10-01", 10)], taken, "2026-11-13", opts)[0].takenDays).toBe(2);
  });
  test("按分・分けた付与の説明", () => {
    const [m] = fiveDayStatuses([g(1, "2026-10-01", 10), g(2, "2027-04-01", 11)], [], "2027-05-01", opts);
    expect(describeFiveDay(m)).toEqual(["1年の期間が重なったので、2026-10-01〜2028-03-31（18か月）をまとめて、18 ÷ 12 × 5 = 7.5日（比例按分。労働基準法施行規則24条の5第2項）"]);
    const [n] = fiveDayStatuses([g(1, "2026-10-01", 10), g(2, "2027-04-01", 11)], [], "2027-05-01", { ...opts, halfDayLeave: false });
    expect(describeFiveDay(n)[0]).toContain("= 7.5日を1日単位（半休を使わないので）に切り上げて 8日");
    const [j] = fiveDayStatuses([g(3, "2025-10-15", 10), g(4, "2026-04-01", 11)], [], "2026-05-01", opts);
    expect(describeFiveDay(j)[0]).toContain("（17か月と17日）をまとめて、17.55か月 ÷ 12 × 5 = 7.31日を半日単位に切り上げて 7.5日");
    const [k] = fiveDayStatuses([g(3, "2025-10-15", 10), g(4, "2026-04-01", 11)], [t("2026-04-10", 0.5)], "2026-05-01", { ...opts, halfDayLeave: false });
    expect(describeFiveDay(k)[0]).toContain("7.31日を半日単位（前に取った半休があるので）に切り上げて 7.5日");
    expect(k.remainingDays).toBe(7);
    const planned = plannedGrants("2026-04-01", { mode: "hire" }, "2026-11-13");
    const [p] = fiveDayStatuses([g(1, "2026-04-01", 5), g(2, "2026-10-01", 5)], [], "2026-11-13", { halfDayLeave: true, planned });
    expect(describeFiveDay(p)).toEqual(["10日を分けて付与したので、合わせて10日になった 2026-10-01 から数え、はじめに付与した 2026-04-01 からの取得も入れています（労働基準法施行規則24条の5第4項）"]);
    expect(describeFiveDay(fiveDayStatuses([g(1, "2026-10-01", 10)], [], "2026-11-13", opts)[0])).toEqual([]);
  });
});
