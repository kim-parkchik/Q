import { describe, expect, test } from "bun:test";
import { gaikokujinDueDate, gaikokujinEventsIn, gaikokujinForm } from "./gaikokujinReport";

const foreign = (patch: Record<string, unknown> = {}) => JSON.stringify({
  romaji: "NGUYEN VAN A", nationality: "ベトナム", status: "", statusText: "", periodEnd: "2027-08-31", permission: "有", card: "AB12345678CD", dispatch: "非該当", checkedOn: "2026-10-05", ...patch,
});
const place = { key: "company", name: "サンプル商事株式会社", koyoNumber: "1301-123456-7", helloWork: "飯田橋", prefecture: "東京都", zip: "100-0005", address: "東京都千代田区丸の内1-1-1", phone: "03-0000-0000" };
const company = { name: "サンプル商事株式会社", address: "東京都千代田区丸の内1-1-1", phone: "03-0000-0000", representative: "見本 太郎" };

describe("外国人雇用状況届出書", () => {
  test("雇用保険に入らない外国人の方の、その月の雇入れ・離職だけを出す", () => {
    const s = { id: "7", name: "グエン ヴァン エー", join_date: "2026-10-05", is_employment_ins_eligible: 0, foreign_info: foreign() };
    expect(gaikokujinEventsIn(s, "2026-10")).toEqual([{ kind: "hire", date: "2026-10-05" }]);
    expect(gaikokujinEventsIn(s, "2026-11")).toEqual([]);
    expect(gaikokujinEventsIn({ ...s, is_employment_ins_eligible: 1 }, "2026-10")).toEqual([]);
    expect(gaikokujinEventsIn({ ...s, foreign_info: null }, "2026-10")).toEqual([]);
    expect(gaikokujinEventsIn({ ...s, retirement_date: "2026-10-31" }, "2026-10").map((e) => e.kind)).toEqual(["hire", "leave"]);
  });

  test("様式第3号の欄（雇入れ）と提出期限（翌月の末日）", () => {
    const s = { id: "7", name: "グエン ヴァン エー", furigana: "ぐえん ゔぁん えー", birthday: "2000-02-29", gender: "male", join_date: "2026-10-05", is_employment_ins_eligible: 0, foreign_info: foreign({ status: "01" }) };
    const f = gaikokujinForm({ staff: s, events: [{ kind: "hire", date: "2026-10-05" }], place, company, corporation: true, submittedOn: "2026-11-18" });
    const v = Object.fromEntries(f.items.map((i) => [i.label, i.value]));
    expect(v["①外国人の氏名（ローマ字）"]).toBe("NGUYEN VAN A");
    expect(v["フリガナ（カタカナ）"]).toBe("グエン ヴァン エー");
    expect(v["③在留期間（期限）（西暦）"]).toBe("2027年8月31日まで");
    expect(v["④生年月日（西暦）"]).toBe("2000年2月29日");
    expect(v["⑤性別"]).toBe("1 男");
    expect(v["⑦資格外活動許可の有無"]).toBe("1 有");
    expect(v["⑧在留カードの番号"]).toBe("AB12345678CD");
    expect(v["雇入れ年月日（西暦）"]).toBe("2026年10月5日");
    expect(v["主たる事務所の名称（法人）"]).toBe("サンプル商事株式会社");
    expect(v["あて先"]).toBe("飯田橋公共職業安定所長 殿");
    expect(f.due).toBe("2026-11-30");
    expect(gaikokujinDueDate("2026-01-31")).toBe("2026-02-28");
  });

  test("離職では資格外活動許可を書かない。足りない欄は直すところにする", () => {
    const s = { id: "8", name: "見本", join_date: "2025-04-01", retirement_date: "2026-10-15", is_employment_ins_eligible: 0, foreign_info: foreign({ romaji: "", card: "" }) };
    const f = gaikokujinForm({ staff: s, events: [{ kind: "leave", date: "2026-10-15" }], place, company, corporation: false, submittedOn: "2026-11-18" });
    expect(f.items.some((i) => i.label.startsWith("⑦"))).toBe(false);
    expect(f.items.some((i) => i.label.startsWith("主たる事務所"))).toBe(false);
    expect(f.items[0].value).toBe("離職（「雇入れ」を消す）");
    const p = f.problems.join("\n");
    for (const w of ["ローマ字の氏名", "在留資格", "在留カード番号", "生年月日", "性別"]) expect(p).toContain(w);
  });
});
