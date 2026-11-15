import { describe, expect, test } from "bun:test";
import { SHAHO_IKUKYU_FIELDS, SHAHO_SANKYU_FIELDS } from "../constants/shahoTodoke";
import type { LeavePeriod } from "./leaveExemption";
import {
  buildIkukyuRow, buildSankyuRow, leaveReportDeadline, maternityReportedOf, suggestIkukyuKind, suggestSankyuKind,
  type IkukyuInput, type SankyuInput,
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
  kind: "apply", reported: null, workDays: 0, remarks: "", myNumber: true, today: "2022-12-10", ...o,
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
    const papa = { ...masako, id: "2002", name: "年金　正男", furigana: "ネンキン マサオ", gender: "male" };
    const row = buildIkukyuRow(ikukyu({ start: "2022-10-10", end: "2022-10-27" }, { staff: papa, workDays: 2, today: "2022-10-28" }), office);
    expect(row.problems).toEqual([]);
    expect(row.values.slice(20, 27)).toEqual(["9", "041010", "9", "041027", "18", "2", ""]);
    const short = buildIkukyuRow(ikukyu({ start: "2022-10-10", end: "2022-10-20" }, { staff: papa, today: "2022-10-28" }), office);
    expect(short.problems).toEqual(["同じ月のうちに始まって終わる育児休業等が11日で、14日に足りないので、保険料は免除されません（申出書は出せません）"]);
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
    expect(row.reported).toEqual({ kind: "extend", on: "2023-10-01", start: "2022-12-07", end: "2024-04-09" });
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
