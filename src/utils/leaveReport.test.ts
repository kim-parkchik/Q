import { describe, expect, test } from "bun:test";
import { SHAHO_IKUKYU_FIELDS, SHAHO_SANKYU_FIELDS } from "../constants/shahoTodoke";
import type { LeavePeriod } from "./leaveExemption";
import {
  buildIkukyuRow, buildSankyuRow, leaveReportDeadline, maternityReportedOf, sameMonthChildcareGroups, suggestIkukyuGroupKind, suggestIkukyuKind,
  suggestSankyuKind, type IkukyuInput, type SankyuInput,
} from "./leaveReport";
import { fillMyNumbers, shahoOfficeValues } from "./shahoCsv";

/** 仕様書の作成例の事業所（事業所整理記号 01-ケイト。東京都） */
const office = shahoOfficeValues({
  prefecture: "東京都", symbol: "01-ケイト", number: "123", zip: "100-0000", address: "東京都千代田区霞が関1-2-2",
  name: "健保サービス株式会社", owner: "健保 良一", phone: "03-1234-5678",
}).values;
const masako = { id: "2001", name: "年金　正子", furigana: "ネンキン マサコ", birthday: "1980-10-10", gender: "female", pension_num: "10", basic_pension_number: "0123012345" };

const sankyu = (leave: Partial<LeavePeriod>, o: Partial<SankyuInput> = {}): SankyuInput => ({
  staff: masako, leaveIndex: 0, leave: { type: "maternity", start: "2022-08-30", end: "", ...leave }, kind: "apply", reported: null,
  remarks: "", myNumber: true, today: "2022-10-20", ...o,
});
const ikukyu = (leave: Partial<LeavePeriod>, o: Partial<IkukyuInput> = {}): IkukyuInput => ({
  staff: masako, leaveIndex: 1,
  leave: { type: "childcare", start: "2022-12-07", end: "2023-10-09", childName: "年金　正明", childKana: "ネンキン マサアキ", childBirthday: "2022-10-10", ...leave },
  kind: "apply", reported: null, remarks: "", myNumber: true, today: "2022-12-10", ...o,
});
const line = (row: { staffId: string; values: string[] }) => fillMyNumbers([row], { [row.staffId]: "123456789000" })[0].join(",");

describe("産前産後休業取得者申出書／変更（終了）届", () => {
  test("仕様書の作成例（図4.12.1-2）：出産後に提出（出産予定日 令和4年10月10日・出産日 10月11日・8月30日から12月6日まで）", () => {
    // 作成例は個人番号と基礎年金番号の両方を書き、出産種別を空にしているが、項目構成の図（図4.12.1-1）と e-Gov の自動チェックでは
    // 出産種別は必ず書く（0：単胎）。Q は個人番号を書く人には基礎年金番号を書かない
    const row = buildSankyuRow(sankyu({ end: "2022-12-06", dueDate: "2022-10-10", birthDate: "2022-10-11" }), office);
    expect(row.problems).toEqual([]);
    expect(line(row)).toBe("2273700,21,01,ｹｲﾄ,10,ﾈﾝｷﾝ ﾏｻｺ,年金　正子,123456789000,,,5,551010,9,041010,0,9,040830,9,041206,,,9,041011,,,,,,,,,,");
    expect(row.values).toHaveLength(SHAHO_SANKYU_FIELDS.length);
    expect(row.deadline).toBe("2023-01-05");
    expect(row.reported).toEqual({ kind: "apply", on: "2022-10-20", start: "2022-08-30", end: "2022-12-06", dueDate: "2022-10-10", birthDate: "2022-10-11" });
  });

  test("出産前に申出：終了日が入っていなければ出産予定日の56日後。基礎年金番号で届ける。多胎は98日前から", () => {
    const row = buildSankyuRow(sankyu({ start: "2022-07-04", dueDate: "2022-10-10", multiple: true }, { myNumber: false, today: "2022-07-05" }), office);
    expect(row.problems).toEqual([]);
    expect(row.end).toBe("2022-12-05");
    expect(row.values.slice(7, 23)).toEqual(["", "0123", "012345", "5", "551010", "9", "041010", "1", "9", "040704", "9", "041205", "", "", "", ""]);
    expect(row.notes).toContain("終了日が入っていないので、終了予定日を出産予定日の56日後（2022-12-05）にします");
  });

  test("開始日より前は、まだ届け出られない。出産予定日がなければ直すところ", () => {
    const row = buildSankyuRow(sankyu({}, { today: "2022-08-29" }), office);
    expect(row.problems).toEqual([
      "出産予定日を従業員の画面（休業・休職の産前産後休業）に入れてください",
      "産前産後休業の開始日（2022-08-30）になってから届け出ます（e-Gov は、開始日が届け出る日より後の申出書を受け付けません）",
    ]);
  });

  test("出産予定日より前に出産したら変更届（共通記載欄は申出のときの内容、変更欄は4つとも書く。出産年月日も書く）", () => {
    // 記入例：出産予定日 令和7年6月30日・5月20日から8月25日までで申出 → 6月12日に出産、開始日を5月2日に、終了予定日を8月7日に変更
    const leave: LeavePeriod = {
      type: "maternity", start: "2025-05-02", end: "2025-08-07", dueDate: "2025-06-30", birthDate: "2025-06-12",
      reported: { kind: "apply", on: "2025-05-21", start: "2025-05-20", end: "2025-08-25", dueDate: "2025-06-30" },
    };
    expect(suggestSankyuKind(leave)).toBe("change");
    const row = buildSankyuRow(sankyu(leave, { kind: "change", reported: maternityReportedOf(leave), today: "2025-06-13" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(12, 33)).toEqual([
      "9", "070630", "0", "9", "070520", "9", "070825", "", "", "9", "070612", "",
      "9", "070612", "0", "9", "070502", "9", "070807", "", "",
    ]);
    expect(row.reported).toMatchObject({ kind: "change", start: "2025-05-02", end: "2025-08-07", dueDate: "2025-06-12", birthDate: "2025-06-12" });
  });

  test("予定より早く終わったら終了届（終了年月日は届けた終了予定日より前。出産年月日も書く）", () => {
    const leave: LeavePeriod = {
      type: "maternity", start: "2025-05-20", end: "2025-08-10", dueDate: "2025-06-30", birthDate: "2025-06-30",
      reported: { kind: "apply", on: "2025-07-01", start: "2025-05-20", end: "2025-08-25", dueDate: "2025-06-30", birthDate: "2025-06-30" },
    };
    expect(suggestSankyuKind(leave)).toBe("end");
    const row = buildSankyuRow(sankyu(leave, { kind: "end", reported: maternityReportedOf(leave), today: "2025-08-11" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(21, 33)).toEqual(["9", "070630", "", "", "", "", "", "", "", "", "9", "070810"]);
  });

  test("出産予定日どおりに出産したときは、変更届は要らない（次に出す届書がない）", () => {
    const leave: LeavePeriod = {
      type: "maternity", start: "2025-05-20", end: "2025-08-25", dueDate: "2025-06-30", birthDate: "2025-06-30",
      reported: { kind: "apply", on: "2025-05-21", start: "2025-05-20", end: "2025-08-25", dueDate: "2025-06-30" },
    };
    expect(suggestSankyuKind(leave)).toBeNull();
    expect(suggestSankyuKind({ type: "maternity", start: "2025-05-20", end: "" })).toBe("apply");
    // 終了日を入れずに申出した期間は、出産の日の56日後を終了予定日として届けている
    const applied = buildSankyuRow(sankyu({ end: "", dueDate: "2022-10-10", birthDate: "2022-10-11" }), office);
    expect(suggestSankyuKind({ type: "maternity", start: "2022-08-30", end: "", dueDate: "2022-10-10", birthDate: "2022-10-11", reported: applied.reported })).toBeNull();
  });
});

describe("育児休業等取得者申出書（新規・延長）／終了届", () => {
  test("仕様書の作成例（図4.13.1-2）：年金 正子・子 年金 正明（令和4年10月10日生まれ・実子）・12月7日から令和5年10月9日まで", () => {
    // 作成例は個人番号と基礎年金番号の両方を書いているが、Q は個人番号を書く人には基礎年金番号を書かない
    const row = buildIkukyuRow(ikukyu({}), office);
    expect(row.problems).toEqual([]);
    expect(line(row)).toBe(
      "2263700,21,01,ｹｲﾄ,10,ﾈﾝｷﾝ ﾏｻｺ,年金　正子,123456789000,,,5,551010,2,ﾈﾝｷﾝ ﾏｻｱｷ,年金　正明,9,041010,1,,,9,041207,9,051009,,,,"
      + ",".repeat(28),
    );
    expect(row.values).toHaveLength(SHAHO_IKUKYU_FIELDS.length);
    expect(row.deadline).toBe("2023-11-08");
  });

  test("開始日と終了日の翌日が同じ月なら、取得日数と就業予定日数を書く（産後パパ育休）。14日に足りなければ申出できない", () => {
    const papa = { ...masako, id: "2002", name: "年金　正男", furigana: "ネンキン マサオ", gender: "male", scheduled_work_hours: 8 };
    // 10月10日〜27日（18日）に産後パパ育休を取り、労使協定で16時間働かせる：就業予定日数 16時間 ÷ 8時間 ＝ 2日、
    // 育児休業等取得日数は 18日 − 2日 ＝ 16日（申出書の記入方法：「就業予定日数」を差し引いた日数）
    const row = buildIkukyuRow(ikukyu({ start: "2022-10-10", end: "2022-10-27", papaLeave: true, plannedWorkHours: 16 }, { staff: papa, today: "2022-10-28" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(20, 27)).toEqual(["9", "041010", "9", "041027", "16", "2", ""]);
    expect(row.notes).toContain("産後パパ育休（2022-10-10〜2022-10-27）で働かせる 16:00 ÷ 1日の所定労働時間 8:00 ＝ 2日（小数点以下切り捨て）を就業予定日数にします");
    expect(row.reported).toEqual({ kind: "apply", on: "2022-10-28", start: "2022-10-10", end: "2022-10-27", workDays: 2 });
    // 産後パパ育休でなければ就業予定日数は0日で、取得日数は期間の日数のまま
    const plain = buildIkukyuRow(ikukyu({ start: "2022-10-10", end: "2022-10-27" }, { staff: papa, today: "2022-10-28" }), office);
    expect(plain.values.slice(24, 26)).toEqual(["18", "0"]);
    const short = buildIkukyuRow(ikukyu({ start: "2022-10-10", end: "2022-10-20" }, { staff: papa, today: "2022-10-28" }), office);
    expect(short.problems).toEqual(["同じ月のうちに始まって終わる育児休業等が11日で、14日に足りないので、保険料は免除されません（申出書は出せません）"]);
  });

  test("産後パパ育休：働かせる時間を除くと14日に足りなければ申出できない。半端な時間は切り捨て。1日の所定労働時間がなければ直すところ", () => {
    const papa = { ...masako, id: "2002", name: "年金　正男", furigana: "ネンキン マサオ", gender: "male", scheduled_work_hours: 7.5 };
    // 10月1日〜15日（15日）。7時間30分の人に 15時間 → ちょうど2日 → 13日で足りない
    const two = buildIkukyuRow(ikukyu({ start: "2026-10-01", end: "2026-10-15", papaLeave: true, plannedWorkHours: 15, childBirthday: "2026-09-25" }, { staff: papa, today: "2026-10-16" }), office);
    expect(two.problems).toEqual([
      "同じ月のうちに始まって終わる育児休業等が15日で、産後パパ育休の就業予定日数（2日）を除くと13日になり、14日に足りないので、保険料は免除されません（申出書は出せません）",
    ]);
    // 14時間59分なら 1.99… → 1日 → 14日で申出できる
    const one = buildIkukyuRow(ikukyu({ start: "2026-10-01", end: "2026-10-15", papaLeave: true, plannedWorkHours: 14 + 59 / 60, childBirthday: "2026-09-25" }, { staff: papa, today: "2026-10-16" }), office);
    expect(one.problems).toEqual([]);
    expect(one.values.slice(24, 26)).toEqual(["14", "1"]);
    // 1日の所定労働時間を入れていない人は、日数を数えられない
    const missing = buildIkukyuRow(ikukyu({ start: "2026-10-01", end: "2026-10-20", papaLeave: true, plannedWorkHours: 8, childBirthday: "2026-09-25" }, {
      staff: { ...papa, scheduled_work_hours: null }, today: "2026-10-21",
    }), office);
    expect(missing.problems).toContain("1日の所定労働時間を従業員の画面に入れてください（産後パパ育休の就業予定日数を、働かせる時間 ÷ 1日の所定労働時間で数えます）");
    // 月をまたぐ育休は、取得日数・就業予定日数を書かない
    const across = buildIkukyuRow(ikukyu({ start: "2026-10-20", end: "2026-11-10", papaLeave: true, plannedWorkHours: 16, childBirthday: "2026-09-25" }, { staff: papa, today: "2026-10-21" }), office);
    expect(across.problems).toEqual([]);
    expect(across.values.slice(24, 26)).toEqual(["", ""]);
  });

  test("同じ月に2回以上取った育休は、1つの届書にまとめ、開始日に初めの日・終了予定日に最後の日、日数は合計、育休等取得内訳に1回ずつ書く", () => {
    const papa = { ...masako, id: "2002", name: "年金　正男", furigana: "ネンキン マサオ", gender: "male" };
    const child = { childName: "年金　正明", childKana: "ネンキン マサアキ", childBirthday: "2026-09-25" };
    const leaves: LeavePeriod[] = [
      { type: "childcare", start: "2026-10-01", end: "2026-10-07", ...child },
      { type: "maternity", start: "2026-08-01", end: "2026-11-20" },
      { type: "childcare", start: "2026-10-15", end: "2026-10-21", ...child },
      { type: "childcare", start: "2026-12-01", end: "2027-03-31", ...child },
    ];
    // 同じ月のうちに始まって終わる育休が2つある10月だけ、まとめる（12月からの育休は月をまたぐので入れない）
    expect(sameMonthChildcareGroups(leaves)).toEqual([[0, 2]]);
    expect(suggestIkukyuGroupKind([leaves[0], leaves[2]])).toBe("apply");
    const row = buildIkukyuRow(ikukyu(leaves[0], {
      staff: papa, leaveIndex: 0, today: "2026-10-22",
      group: [{ leave: leaves[0], leaveIndex: 0 }, { leave: leaves[2], leaveIndex: 2 }],
    }), office);
    expect(row.problems).toEqual([]);
    // 開始日 10月1日・終了予定日 10月21日・取得日数 7＋7＝14日・就業予定日数 0日（産後パパ育休でない）
    expect(row.values.slice(20, 26)).toEqual(["9", "081001", "9", "081021", "14", "0"]);
    // 内訳①（10月1日〜7日・7日・0日）・内訳②（10月15日〜21日・7日・0日）・③④は空
    expect(row.values.slice(34, 46)).toEqual(["9", "081001", "9", "081007", "7", "0", "9", "081015", "9", "081021", "7", "0"]);
    expect(row.values.slice(46)).toEqual(Array(10).fill(""));
    expect(row.values).toHaveLength(SHAHO_IKUKYU_FIELDS.length);
    expect(row.notes.join("")).toContain("育休等取得内訳に1回ずつ書きます");
    // 期間ごとに、届け出た内容を残す
    expect(row.group?.map((g) => [g.leaveIndex, g.reported.start, g.reported.end])).toEqual([[0, "2026-10-01", "2026-10-07"], [2, "2026-10-15", "2026-10-21"]]);
    // 1回ずつでは14日に足りなくても、合わせて14日以上なら申出できる。合わせても足りなければ申出できない
    const short = buildIkukyuRow(ikukyu(leaves[0], {
      staff: papa, leaveIndex: 0, today: "2026-10-22",
      group: [{ leave: leaves[0], leaveIndex: 0 }, { leave: { ...leaves[2], end: "2026-10-18" }, leaveIndex: 2 }],
    }), office);
    expect(short.problems).toEqual(["同じ月のうちに始まって終わる育児休業等が合わせて11日で、14日に足りないので、保険料は免除されません（申出書は出せません）"]);
    // 2回とも産後パパ育休で、10月1日〜12日（12日）に8時間・10月15日〜26日（12日）に20時間働かせる（1日8時間）：
    // 就業予定日数 1＋2＝3日、取得日数（12−1）＋（12−2）＝21日。内訳①②にも、差し引いた日数と就業予定日数を書く
    const papaLeaves = [
      { ...leaves[0], end: "2026-10-12", papaLeave: true, plannedWorkHours: 8 },
      { ...leaves[2], end: "2026-10-26", papaLeave: true, plannedWorkHours: 20 },
    ];
    const both = buildIkukyuRow(ikukyu(papaLeaves[0], {
      staff: { ...papa, scheduled_work_hours: 8 }, leaveIndex: 0, today: "2026-10-27",
      group: [{ leave: papaLeaves[0], leaveIndex: 0 }, { leave: papaLeaves[1], leaveIndex: 2 }],
    }), office);
    expect(both.problems).toEqual([]);
    expect(both.values.slice(24, 26)).toEqual(["21", "3"]);
    expect(both.values.slice(34, 46)).toEqual(["9", "081001", "9", "081012", "11", "1", "9", "081015", "9", "081026", "10", "2"]);
    expect(both.group?.map((g) => g.reported.workDays)).toEqual([1, 2]);
    // 届けたあとで、最後の期間を早く終えたら終了届
    const reported = (l: LeavePeriod) => ({ ...l, reported: { kind: "apply", on: "2026-10-22", start: l.start, end: l.end } });
    expect(suggestIkukyuGroupKind([reported(leaves[0]), reported(leaves[2])])).toBeNull();
    expect(suggestIkukyuGroupKind([reported(leaves[0]), { ...reported(leaves[2]), end: "2026-10-19" }])).toBe("end");
  });

  test("延長：終了日を延ばしたら延長（共通記載欄は申出のときの開始日・終了予定日）", () => {
    const leave: LeavePeriod = {
      type: "childcare", start: "2022-12-07", end: "2024-04-09", childName: "年金　正明", childKana: "ネンキン マサアキ", childBirthday: "2022-10-10",
      reported: { kind: "apply", on: "2022-12-10", start: "2022-12-07", end: "2023-10-09" },
    };
    expect(suggestIkukyuKind(leave)).toBe("extend");
    const row = buildIkukyuRow(ikukyu(leave, { kind: "extend", reported: { start: "2022-12-07", end: "2023-10-09" }, today: "2023-10-01" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(20, 34)).toEqual(["9", "041207", "9", "051009", "", "", "", "", "9", "060409", "", "", "", ""]);
    expect(row.reported).toEqual({ kind: "extend", on: "2023-10-01", start: "2022-12-07", end: "2024-04-09", workDays: 0 });
  });

  test("産後パパ育休の延長・終了：共通記載欄には申出のときに届けた就業予定日数、変更後の取得日数は、いまの就業予定日数を差し引いた日数", () => {
    const papa = { ...masako, id: "2002", name: "年金　正男", furigana: "ネンキン マサオ", gender: "male", scheduled_work_hours: 8 };
    const base: LeavePeriod = {
      type: "childcare", start: "2026-10-01", end: "2026-10-20", childName: "年金　正明", childKana: "ネンキン マサアキ", childBirthday: "2026-09-25",
      papaLeave: true, plannedWorkHours: 24,
      reported: { kind: "apply", on: "2026-10-01", start: "2026-10-01", end: "2026-10-16", workDays: 2 },
    };
    // 10月16日までで届け（16日 − 2日 ＝ 14日）、20日まで延ばして働かせる時間を24時間（3日）にした：
    // 共通記載欄は 14日・2日（届けた日数）、変更後の取得日数は 20日 − 3日 ＝ 17日
    const extend = buildIkukyuRow(ikukyu(base, { staff: papa, kind: "extend", reported: { start: "2026-10-01", end: "2026-10-16", workDays: 2 }, today: "2026-10-17" }), office);
    expect(extend.problems).toEqual([]);
    expect(extend.values.slice(24, 26)).toEqual(["14", "2"]);
    expect(extend.values.slice(28, 31)).toEqual(["9", "081020", "17"]);
    expect(extend.reported).toEqual({ kind: "extend", on: "2026-10-17", start: "2026-10-01", end: "2026-10-20", workDays: 3 });
    // 届けた就業予定日数がわからない（Q で届けていない）ときは、いまの就業予定日数を書く
    const unknown = buildIkukyuRow(ikukyu(base, { staff: papa, kind: "extend", reported: { start: "2026-10-01", end: "2026-10-16" }, today: "2026-10-17" }), office);
    expect(unknown.values.slice(24, 26)).toEqual(["13", "3"]);
    // 10月12日で早く終えたら終了届：変更後の取得日数は 12日 − 3日 ＝ 9日（終了届は1〜30日）
    const end = buildIkukyuRow(ikukyu({ ...base, end: "2026-10-12" }, {
      staff: papa, kind: "end", reported: { start: "2026-10-01", end: "2026-10-16", workDays: 2 }, today: "2026-10-13",
    }), office);
    expect(end.problems).toEqual([]);
    expect(end.values.slice(31, 34)).toEqual(["9", "081012", "9"]);
  });

  test("終了：予定より早く終わったら終了届", () => {
    const leave: LeavePeriod = {
      type: "childcare", start: "2022-12-07", end: "2023-06-30", childName: "年金　正明", childKana: "ネンキン マサアキ", childBirthday: "2022-10-10",
      reported: { kind: "apply", on: "2022-12-10", start: "2022-12-07", end: "2023-10-09" },
    };
    expect(suggestIkukyuKind(leave)).toBe("end");
    const row = buildIkukyuRow(ikukyu(leave, { kind: "end", reported: { start: "2022-12-07", end: "2023-10-09" }, today: "2023-07-03" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(28, 34)).toEqual(["", "", "", "9", "050630", ""]);
  });

  test("役員・子の情報がない・3歳以後まで・養子で養育を始めた日がないときは直すところ", () => {
    expect(buildIkukyuRow(ikukyu({}, { staff: { ...masako, is_executive: 1 } }), office).problems)
      .toEqual(["役員は、育児・介護休業法の育児休業等を取れないので、保険料の免除の申出はできません（日本年金機構）"]);
    expect(buildIkukyuRow(ikukyu({ childKana: "", childBirthday: "" }), office).problems).toEqual([
      "養育する子の氏名のフリガナを、従業員の画面（休業・休職の育児休業）に入れてください",
      "養育する子の生年月日を、従業員の画面（休業・休職の育児休業）に入れてください",
    ]);
    expect(buildIkukyuRow(ikukyu({ end: "2025-10-10" }), office).problems).toEqual(["終了（予定）日は、子が3歳に達する日（2025-10-09）より前にします"]);
    const adopted = buildIkukyuRow(ikukyu({ adopted: true }), office);
    expect(adopted.problems).toEqual(["養子など実子でない子は、養育を始めた日を従業員の画面に入れてください"]);
    expect(adopted.values[17]).toBe("2");
  });

  test("申出の期限は、終了日から起算して1か月以内", () => {
    expect(leaveReportDeadline("2026-03-31")).toBe("2026-04-30");
    expect(leaveReportDeadline("")).toBe("");
  });
});
