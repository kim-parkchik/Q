/**
 * マイナンバーの保存期間（utils/myNumberRetention.ts）
 * 扶養控除等申告書の保存期間：提出期限（その年の最初に給与を払う日の前日）の属する年の翌年1月10日の翌日から7年（所得税法施行規則76条の3）
 */
import { describe, expect, test } from "bun:test";
import { buildMyNumberList, familyKey, SELF_KEY } from "./myNumber";
import { declarationKeepUntil, jaDate, lastDeclarationYearOf, myNumberRetentions, retentionsOfRow, todayYmd } from "./myNumberRetention";
import { parseDeclaration } from "./nenchoDeclaration";

const TODAY = "2026-11-14";
const SPOUSE = { name: "山田 花子", birthday: "1988-05-05" };
const CHILD = { name: "山田 一郎", birthday: "2000-04-01", relation: "子" };
const decl = (staffId: string, year: number, o: { spouse?: boolean; child?: boolean } = {}) => ({
  staffId, year,
  declaration: parseDeclaration(JSON.stringify({ spouse: o.spouse ? SPOUSE : null, dependents: o.child ? [CHILD] : [] })),
});
const reg = (staffId: string, person: string) => ({ staffId, person, name: "", relation: "" });
const spouseKey = familyKey(SPOUSE.name, SPOUSE.birthday);
const childKey = familyKey(CHILD.name, CHILD.birthday);
const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("保存期間の数え方", () => {
  test("その年の申告書は、翌年1月11日から7年（8年後の1月10日まで保管）", () => {
    expect(declarationKeepUntil(2026)).toBe("2034-01-10");
    expect(declarationKeepUntil(2018)).toBe("2026-01-10");
  });
  test("退職した人の最後の申告書の年：退職した年・最後に給与か賞与を払った年・申告書を入れた年のいちばん遅い年", () => {
    expect(lastDeclarationYearOf("2026-03-31", 2026, [2024, 2025, 2026])).toBe(2026);
    // 12月末に退職し、最後の給与を翌年1月に払った（その年の申告書も出している）
    expect(lastDeclarationYearOf("2026-12-31", 2027, [2026])).toBe(2027);
    expect(lastDeclarationYearOf("2026-06-30", null, [])).toBe(2026);
  });
  test("今日の日付（この PC の日付）と、日付の書き方", () => {
    expect(todayYmd(new Date(2026, 10, 4))).toBe("2026-11-04");
    expect(jaDate("2025-01-10")).toBe("2025年1月10日");
    expect(jaDate("")).toBe("");
  });
});

describe("本人", () => {
  const row = (id: string, retirement_date: string | null) =>
    buildMyNumberList([{ id, name: "山田 太郎", retirement_date }], [], [reg(id, SELF_KEY)])[0];
  test("在籍している間（休職中も）は保管する", () => {
    const r = retentionsOfRow(row("1", null), { status: "active" }, 2026, [], TODAY)[SELF_KEY];
    expect(r).toMatchObject({ keepUntil: null, expired: false, unknown: false });
    // 退職日が先（まだ在籍している）
    expect(retentionsOfRow(row("1", "2026-12-31"), { status: "active", retirement_date: "2026-12-31" }, 2026, [], TODAY)[SELF_KEY].keepUntil).toBeNull();
  });
  test("退職した人：最後の申告書の保存期間が過ぎたら消す（2018年に退職 → 2026年1月10日まで保管、11日から消す）", () => {
    const staff = { status: "retired", retirement_date: "2018-03-31" };
    const r = retentionsOfRow(row("1", "2018-03-31"), staff, 2018, [2017, 2018], TODAY)[SELF_KEY];
    expect(r).toMatchObject({ keepUntil: "2026-01-10", expired: true });
    expect(r.basis).toContain("2018年分");
    expect(retentionsOfRow(row("1", "2018-03-31"), staff, 2018, [], "2026-01-10")[SELF_KEY].expired).toBe(false);
    expect(retentionsOfRow(row("1", "2018-03-31"), staff, 2018, [], "2026-01-11")[SELF_KEY].expired).toBe(true);
  });
  test("12月末に退職して翌年1月に最後の給与を払った人は、1年遅く（2019年分の申告書の保存期間）", () => {
    const r = retentionsOfRow(row("1", "2018-12-31"), { status: "retired", retirement_date: "2018-12-31" }, 2019, [], TODAY)[SELF_KEY];
    expect(r).toMatchObject({ keepUntil: "2027-01-10", expired: false });
  });
  test("「退職」なのに退職日が入っていないときは、保存期間がわからない（消す一覧に出さない）", () => {
    const r = retentionsOfRow(row("1", null), { status: "retired" }, 2018, [], TODAY)[SELF_KEY];
    expect(r).toMatchObject({ keepUntil: null, expired: false, unknown: true });
    expect(r.basis).toContain("退職日");
  });
});

describe("家族（配偶者・扶養親族）", () => {
  test("在籍している人の家族：いちばん新しい申告書に載っている間は保管し、扶養から外れて7年が過ぎたら消す", () => {
    // 配偶者は2016〜2026年分の申告書に、子は2016〜2017年分だけに載っている
    const declarations = years(2016, 2026).map((y) => decl("1", y, { spouse: true, child: y <= 2017 }));
    const row = buildMyNumberList([{ id: "1", name: "山田 太郎" }], declarations, [reg("1", SELF_KEY), reg("1", spouseKey), reg("1", childKey)])[0];
    const r = retentionsOfRow(row, { status: "active" }, 2026, years(2016, 2026), TODAY);
    expect(r[spouseKey]).toMatchObject({ keepUntil: null, expired: false });
    expect(r[childKey]).toMatchObject({ keepUntil: "2025-01-10", expired: true });
    expect(r[childKey].basis).toContain("2017年分");
  });
  test("退職した人の家族：その家族が最後に載った申告書の年で数える。申告書に見当たらない番号は、本人と同じ日まで", () => {
    const declarations = [decl("2", 2015, { child: true }), decl("2", 2016, { spouse: true, child: true }), decl("2", 2017, { spouse: true })];
    const orphanKey = familyKey("山田 次郎", "2003-03-03");
    const row = buildMyNumberList([{ id: "2", name: "山田 太郎", retirement_date: "2017-09-30" }], declarations,
      [reg("2", SELF_KEY), reg("2", spouseKey), reg("2", childKey), reg("2", orphanKey)])[0];
    const r = retentionsOfRow(row, { status: "retired", retirement_date: "2017-09-30" }, 2017, [2015, 2016, 2017], TODAY);
    expect(r[SELF_KEY]).toMatchObject({ keepUntil: "2025-01-10", expired: true });
    expect(r[spouseKey]).toMatchObject({ keepUntil: "2025-01-10", expired: true });
    expect(r[childKey]).toMatchObject({ keepUntil: "2024-01-10", expired: true });
    expect(r[orphanKey]).toMatchObject({ keepUntil: "2025-01-10", expired: true });
    expect(r[orphanKey].basis).toContain("本人と同じ日");
  });
  test("在籍している人の、申告書に見当たらない家族の番号は、保存期間がわからない（確かめてもらう）", () => {
    const orphanKey = familyKey("山田 次郎", "2003-03-03");
    const row = buildMyNumberList([{ id: "3", name: "山田 太郎" }], [decl("3", 2026)], [reg("3", orphanKey)])[0];
    expect(retentionsOfRow(row, { status: "active" }, 2026, [2026], TODAY)[orphanKey]).toMatchObject({ keepUntil: null, expired: false, unknown: true });
  });
});

describe("保存期間が過ぎた番号の一覧", () => {
  test("登録してある番号だけを出す（登録していない家族・在籍している人は出さない）", () => {
    const staffList = [
      { id: "1", name: "在籍 太郎", status: "active", retirement_date: null },
      { id: "2", name: "退職 次郎", status: "retired", retirement_date: "2017-09-30" },
      { id: "3", name: "退職 三郎", status: "retired", retirement_date: "2025-03-31" },
    ];
    const declarations = [decl("2", 2017, { spouse: true, child: true })];
    // 退職 次郎さんの子は登録していない
    const rows = buildMyNumberList(staffList, declarations, [reg("1", SELF_KEY), reg("2", SELF_KEY), reg("2", spouseKey), reg("3", SELF_KEY)]);
    const { byStaff, expired } = myNumberRetentions(rows, staffList, { "2": 2017, "3": 2025 }, { "2": [2017] }, TODAY);
    expect(expired.map((x) => `${x.row.staffId}:${x.entry.relation}`)).toEqual(["2:本人", "2:配偶者"]);
    expect(byStaff["3"][SELF_KEY]).toMatchObject({ keepUntil: "2033-01-10", expired: false });
    expect(byStaff["2"][childKey].expired).toBe(true); // 期間は過ぎているが、登録していないので一覧には出ない
  });
});
