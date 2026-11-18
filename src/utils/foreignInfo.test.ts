import { describe, expect, test } from "bun:test";
import { foreignOf, nationalityCodeOf, parseForeignInfo, residencePeriodAlert, residenceStatusOf, stringifyForeignInfo } from "./foreignInfo";

describe("在留資格の情報（外国人の方）", () => {
  test("読む・書く（外国人の方でなければ null。壊れていても null）", () => {
    const f = parseForeignInfo(JSON.stringify({ romaji: "NGUYEN VAN AN", nationality: "ベトナム", status: "35", periodEnd: "2029-03-31", permission: "無", card: "AB12345678CD", dispatch: "非該当", checkedOn: "2026-11-10" }));
    expect(f).toEqual({ romaji: "NGUYEN VAN AN", nationality: "ベトナム", status: "35", statusText: "", periodEnd: "2029-03-31", permission: "無", card: "AB12345678CD", dispatch: "非該当", checkedOn: "2026-11-10" });
    expect(parseForeignInfo(stringifyForeignInfo(f))).toEqual(f);
    expect(parseForeignInfo(null)).toBeNull();
    expect(parseForeignInfo("{こわれた")).toBeNull();
    expect(stringifyForeignInfo(null)).toBeNull();
    expect(foreignOf({ foreign_info: JSON.stringify({ romaji: "A", permission: "たぶん", periodEnd: "2029/03/31" }) })).toMatchObject({ romaji: "A", permission: "", periodEnd: "" });
  });

  test("国籍・地域と在留資格のコード（雇用保険の届書の仕様書の表から）", () => {
    expect(nationalityCodeOf("ベトナム")).toBe("704");
    expect(residenceStatusOf({ ...parseForeignInfo("{}")!, status: "35" })?.name).toBe("技術・人文知識・国際業務");
    expect(residenceStatusOf({ ...parseForeignInfo("{}")!, status: "" })).toBeNull();
  });

  test("在留期間の満了日の知らせ（3か月を切った・過ぎた）", () => {
    const f = (periodEnd: string) => ({ ...parseForeignInfo("{}")!, periodEnd });
    expect(residencePeriodAlert(f("2027-03-01"), "2026-11-18")).toBeNull();
    expect(residencePeriodAlert(f("2027-02-18"), "2026-11-18")).toEqual({ state: "soon", periodEnd: "2027-02-18", days: 92 });
    expect(residencePeriodAlert(f("2026-11-17"), "2026-11-18")).toEqual({ state: "expired", periodEnd: "2026-11-17", days: -1 });
    expect(residencePeriodAlert(f(""), "2026-11-18")).toBeNull();
    expect(residencePeriodAlert(null, "2026-11-18")).toBeNull();
  });
});
