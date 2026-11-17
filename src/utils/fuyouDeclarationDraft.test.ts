import { describe, expect, test } from "bun:test";
import { buildFuyouDraft } from "./fuyouDeclarationDraft";
import { emptyDeclaration, type DeclaredDependent } from "./nenchoDeclaration";

const dep = (name: string, relation: string, birthday: string, o: Partial<DeclaredDependent> = {}): DeclaredDependent => ({
  name, relation, birthday, totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false, ...o,
});

describe("翌年分の扶養控除等申告書の下書き", () => {
  test("翌年の12月31日の年齢で、16歳未満・一般・特定・老人（同居老親等）に分け、区分が変わる人を知らせる", () => {
    const decl = {
      ...emptyDeclaration(),
      self: { ...emptyDeclaration().self, disability: "general" as const, workingStudent: true },
      spouse: { name: "山田　花子", birthday: "1957-06-01", totalIncome: 500000, disability: "none" as const, livingTogether: true },
      dependents: [
        dep("山田　一郎", "子", "2011-05-01"), dep("山田　次郎", "子", "2015-04-02"), dep("山田　三郎", "子", "2008-03-01", { totalIncome: 300000 }),
        dep("山田　父", "父", "1957-06-01", { linealAscendant: true }), dep("山田　祖母", "祖母", "1940-01-01", { linealAscendant: true, livingTogether: false, disability: "special" }),
      ],
    };
    const d = buildFuyouDraft(decl, 2027);
    expect(d.dependents.map((x) => [x.name, x.age, x.kind])).toEqual([
      ["山田　一郎", 16, "general"], ["山田　三郎", 19, "specific"], ["山田　父", 70, "elderlyTogether"], ["山田　祖母", 88, "elderlyOther"],
    ]);
    expect(d.young.map((x) => [x.name, x.age])).toEqual([["山田　次郎", 12]]);
    expect([d.spouse?.age, d.spouse?.elderly, d.spouse?.incomeThisYear]).toEqual([70, true, 500000]);
    expect(d.self).toEqual(["本人：一般の障害者", "勤労学生"]);
    expect(d.notes).toEqual([
      "山田　一郎さんは、2027年に16歳になるので、控除対象扶養親族の欄に移ります。",
      "山田　三郎さんは、2027年に19歳になるので、特定扶養親族になります。",
      "山田　父さんは、2027年に70歳になるので、老人扶養親族になります。",
      "配偶者は、70歳になるので、老人控除対象配偶者になります。",
    ]);
  });
  test("年末調整の申告書がなければ空の下書き", () => {
    const d = buildFuyouDraft(null, 2027);
    expect([d.spouse, d.dependents.length, d.young.length]).toEqual([null, 0, 0]);
    expect(d.notes[0]).toContain("2026年の年末調整の申告書");
  });
});
