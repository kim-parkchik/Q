/**
 * 翌年分の「給与所得者の扶養控除等（異動）申告書」の下書き（従業員に配って、確かめて直してもらうもの）
 *
 * 一般的な給与ソフトと同じく、その年の年末調整で出してもらった申告書の内容（配偶者・扶養親族・障害者など）と従業員の情報から、
 * 翌年分の申告書に書く内容の下書きを作る。申告書は、その年最初に給与の支払を受ける日の前日までに、給与の支払者に出す（所得税法194条1項）。
 * ・年齢と区分は、翌年の12月31日の現況（年齢は、誕生日の前日に1つ上がる。utils/nenchoDeclaration.ts の ageAtYearEnd）で、
 *   16歳未満（年少扶養親族。申告書の「住民税に関する事項」に書く）・19歳以上23歳未満（特定扶養親族）・70歳以上（老人扶養親族。
 *   本人か配偶者の直系尊属で同居なら同居老親等）・それ以外の16歳以上に分ける
 * ・所得の見積額は翌年の分を本人が書く（下書きには、その年の見積額を参考に出す）。所得の要件で控除の対象になるかは、
 *   翌年分の申告書の書き方で本人が確かめる（Q は、翌年分の所得の要件を決めない）
 * ・マイナンバー（個人番号）は、下書きには出さない
 */
import { ageAtYearEnd, type DeclaredDependent, type DeclaredPerson, type DisabilityKind, type NenchoDeclaration } from "./nenchoDeclaration";

export type DraftAgeKind = "young" | "general" | "specific" | "elderlyTogether" | "elderlyOther";

export const DRAFT_AGE_KIND_LABELS: Record<DraftAgeKind, string> = {
  young: "16歳未満（住民税に関する事項に書く）",
  general: "控除対象扶養親族（一般）",
  specific: "特定扶養親族（19歳以上23歳未満）",
  elderlyTogether: "老人扶養親族（同居老親等）",
  elderlyOther: "老人扶養親族（同居老親等以外）",
};

export const DISABILITY_LABELS: Record<DisabilityKind, string> = { none: "", general: "一般の障害者", special: "特別障害者" };

export interface DraftPerson {
  name: string;
  furigana: string;
  relation: string;
  birthday: string;
  /** 翌年の12月31日の年齢 */
  age: number | null;
  kind: DraftAgeKind | null;
  disability: DisabilityKind;
  livingTogether: boolean;
  /** その年の所得の見積額（参考） */
  incomeThisYear: number;
}

export interface FuyouDraft {
  year: number;
  spouse: (DraftPerson & { elderly: boolean }) | null;
  /** 16歳以上の扶養親族 */
  dependents: DraftPerson[];
  /** 16歳未満の扶養親族 */
  young: DraftPerson[];
  /** 本人の障害者・寡婦・ひとり親・勤労学生 */
  self: string[];
  notes: string[];
}

const kindOf = (d: DeclaredDependent, year: number): DraftAgeKind | null => {
  const age = ageAtYearEnd(d.birthday, year);
  if (age === null) return null;
  if (age < 16) return "young";
  if (age >= 19 && age < 23) return "specific";
  if (age >= 70) return d.linealAscendant && d.livingTogether ? "elderlyTogether" : "elderlyOther";
  return "general";
};

const person = (p: DeclaredPerson, relation: string, year: number, kind: DraftAgeKind | null): DraftPerson => ({
  name: p.name, furigana: p.furigana ?? "", relation, birthday: p.birthday, age: ageAtYearEnd(p.birthday, year), kind,
  disability: p.disability, livingTogether: !!p.livingTogether, incomeThisYear: Math.max(0, Number(p.totalIncome) || 0),
});

/**
 * 翌年分の下書きを作る
 * @param declaration その年の年末調整の申告書の内容（なければ null。空の下書きにする）
 * @param year 翌年（下書きの年分）
 */
export const buildFuyouDraft = (declaration: NenchoDeclaration | null, year: number): FuyouDraft => {
  const notes: string[] = [];
  if (!declaration) {
    notes.push(`${year - 1}年の年末調整の申告書が Q に入っていないので、配偶者・扶養親族は空です。`);
    return { year, spouse: null, dependents: [], young: [], self: [], notes };
  }
  const d = declaration;
  const spouse = d.spouse ? { ...person(d.spouse, "配偶者", year, null), elderly: (ageAtYearEnd(d.spouse.birthday, year) ?? 0) >= 70 } : null;
  const all = d.dependents.map((x) => person(x, x.relation, year, kindOf(x, year)));
  for (const x of all) if (x.age === null) notes.push(`${x.name || "（名前なし）"}さんの生年月日が入っていないので、区分を決められません。`);
  const turning16 = all.filter((x) => x.age === 16);
  if (turning16.length > 0) notes.push(`${turning16.map((x) => x.name).join("・")}さんは、${year}年に16歳になるので、控除対象扶養親族の欄に移ります。`);
  const turning19 = all.filter((x) => x.age === 19);
  if (turning19.length > 0) notes.push(`${turning19.map((x) => x.name).join("・")}さんは、${year}年に19歳になるので、特定扶養親族になります。`);
  const turning70 = all.filter((x) => x.age === 70);
  if (turning70.length > 0) notes.push(`${turning70.map((x) => x.name).join("・")}さんは、${year}年に70歳になるので、老人扶養親族になります。`);
  if (spouse && (ageAtYearEnd(d.spouse!.birthday, year) ?? 0) === 70) notes.push("配偶者は、70歳になるので、老人控除対象配偶者になります。");
  const self: string[] = [];
  if (d.self.disability !== "none") self.push(`本人：${DISABILITY_LABELS[d.self.disability]}`);
  if (d.self.widow) self.push("寡婦");
  if (d.self.singleParent) self.push("ひとり親");
  if (d.self.workingStudent) self.push("勤労学生");
  return {
    year, spouse,
    dependents: all.filter((x) => x.kind !== "young"),
    young: all.filter((x) => x.kind === "young"),
    self, notes,
  };
};
