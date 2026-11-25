/**
 * 月々の源泉所得税（税額表の甲欄・乙欄）に使う「扶養親族等の数」を、扶養控除等申告書の内容（年末調整の画面に入れたもの）から数える（見直しの P9）
 *
 * ■ 甲欄（給与所得者の扶養控除等申告書を出した人。所得税法185条1項1号）
 *   ・源泉控除対象配偶者（2条1項33号の4）と源泉控除対象親族（同34号の5。控除対象扶養親族と、所得の見積額が線以下の特定親族）の合計数
 *   ・本人が障害者（特別障害者を含む）・寡婦・ひとり親・勤労学生なら、これらの一に該当するごとに足す（187条）
 *   ・同一生計配偶者・扶養親族（16歳未満の人を含む）のうちに障害者（特別障害者を含む）・同居特別障害者がいれば、これらの一に該当するごとに足す
 *     （187条。同居特別障害者は、障害者と同居特別障害者の両方に当たるので2人。国税庁「源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」の
 *     〔扶養親族等の数の算定方法〕の具体例も同じ。所得の見積額が線を超える配偶者・特定親族が障害者でも、足さない）
 * ■ 乙欄（従たる給与についての扶養控除等申告書。185条1項2号・195条）：源泉控除対象配偶者と源泉控除対象親族の数だけ（187条の足し算はない）
 * ■ 年齢は、その年の12月31日の年齢（utils/nenchoDeclaration.ts の classifyDependentByLimits）。所得は、申告書の所得の見積額
 * ■ 線（給与等の支払を受ける人・源泉控除対象配偶者・同一生計配偶者と扶養親族・源泉控除対象親族になる特定親族の所得の見積額）は、
 *   国税庁の法定調書の手引から作った constants/nencho（gensen20XX.ts の withoutAdjustment。手引がまだない、すぐ次の年分は仮の書き方）。
 *   令和8年分は、11月30日以前に支払う給与は前の線、12月1日以後に支払う給与は新しい線（dependentLineOn）
 * ■ 足す人数と、説明に出す年齢は、国税庁「源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」から作った constants/tax/withholdingDependentRules.ts
 * ■ Q が見分けられないこと（申告書の内容のとおりに数える）：国外居住親族（親族関係書類などを出した人だけを数える）、
 *   ほかの人の申告書で控除を受けている家族（夫婦や親族のお互いで控除は受けられない）
 * 出典：所得税法2条1項・185条・187条（e-Gov 法令API で読んだ）、国税庁「令和8年分・令和9年分 源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」
 *       （tax-tables/source/。入手元は tax-tables/README.md）
 */
import { getProvisionalSlipMaster, getWithholdingSlipMaster, type WithholdingSlipMaster } from "../constants/nencho";
import { WITHHOLDING_DEPENDENT_RULES } from "../constants/tax/withholdingDependentRules";
import type { TaxColumn } from "./incomeTax";
import {
  ageAtYearEnd, classifyDependentByLimits, parseDeclaration, type DeclaredDependent, type DeclaredPerson, type DependentKind, type NenchoDeclaration,
} from "./nenchoDeclaration";

/** その年分の線（国税庁の手引から作ったもの。手引がまだない、すぐ次の年分は仮の書き方。どちらもなければ null） */
export const withholdingLinesOf = (year: number): WithholdingSlipMaster | null =>
  getWithholdingSlipMaster(year) ?? getProvisionalSlipMaster(year);

/** その日（YYYY-MM-DD）に支払う給与で使う、同一生計配偶者・扶養親族の所得の見積額の線 */
export const dependentLineOn = (gm: WithholdingSlipMaster, payDate: string): number => {
  const w = gm.withoutAdjustment;
  return payDate.slice(5, 10) <= w.earlierUntil ? w.earlierIncomeLimit : w.currentIncomeLimit;
};

/**
 * その年の途中で、同一生計配偶者・扶養親族の線が変わる日（この日以後に支払う給与から新しい線。令和8年分は 2026-12-01）。
 * 1年を通して同じ線なら null
 */
export const lineChangeDate = (gm: WithholdingSlipMaster, year: number): string | null => {
  const until = gm.withoutAdjustment.earlierUntil;
  if (until >= "12-31") return null;
  const next = new Date(Date.UTC(year, Number(until.slice(0, 2)) - 1, Number(until.slice(3)) + 1));
  return next.toISOString().slice(0, 10);
};

/** 「2026-12-01」→「12月1日」 */
export const monthDayLabel = (date: string): string => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

/** 金額を「95万円」の形にする（万円で割り切れなければ「1,234円」） */
export const manYen = (n: number): string => (n % 10000 === 0 ? `${(n / 10000).toLocaleString()}万円` : `${n.toLocaleString()}円`);

export interface WithholdingDependentsCount {
  /** 扶養親族等の数 */
  total: number;
  /** 源泉控除対象配偶者（0 か 1） */
  spouse: number;
  /** 源泉控除対象親族 */
  relatives: number;
  /** 本人の障害者・寡婦・ひとり親・勤労学生で足す人数 */
  self: number;
  /** 同一生計配偶者・扶養親族の障害者・同居特別障害者で足す人数 */
  family: number;
  /** 内訳（画面に出す文） */
  details: string[];
  /** 数えなかった人と、確かめてほしいこと */
  notes: string[];
}

const RELATIVE_LABELS: Partial<Record<DependentKind, string>> = {
  general: "控除対象扶養親族",
  specific: "特定扶養親族",
  elderlyTogether: "老人扶養親族",
  elderlyOther: "老人扶養親族",
  specificRelative: "特定親族",
};

const nameOf = (p: { name?: string }) => (p.name ?? "").trim() || "名前なし";
const incomeOf = (p: DeclaredPerson) => Math.max(0, Number(p.totalIncome) || 0);

/**
 * 申告書の内容から、その年に支払う給与の「扶養親族等の数」を数える（数えられない年分・丙欄は null）
 * @param year 年分（年齢は、この年の12月31日で数える。前の年の申告書を渡せば、その年の見込み）
 * @param opts.column 税額表の欄（乙欄は、従たる給与についての扶養控除等申告書として数える）
 * @param opts.payDate 給与を支払う日（YYYY-MM-DD。令和8年分は、11月30日以前か12月1日以後かで扶養親族の線が変わる）
 * @param opts.selfTotalIncome 本人の合計所得金額（年末調整の計算結果など。わからなければ null。900万円の線を超えれば配偶者を数えない）
 */
export const countWithholdingDependents = (
  decl: NenchoDeclaration,
  year: number,
  opts: { column: TaxColumn; payDate: string; selfTotalIncome?: number | null },
): WithholdingDependentsCount | null => {
  const gm = withholdingLinesOf(year);
  const rule = WITHHOLDING_DEPENDENT_RULES[year];
  if (!gm || !rule || opts.column === "hei") return null;
  const w = gm.withoutAdjustment;
  const line = dependentLineOn(gm, opts.payDate);
  const secondary = opts.column === "otsu";
  const details: string[] = [];
  const notes: string[] = [];

  // 源泉控除対象配偶者：本人の所得の見積額が線以下で、配偶者の所得の見積額が線以下
  let spouse = 0;
  const s = decl.spouse;
  const selfIncome = opts.selfTotalIncome ?? null;
  if (s && incomeOf(s) <= w.spouseIncomeLimit) {
    if (selfIncome !== null && selfIncome > w.recipientIncomeLimit) {
      notes.push(`本人の合計所得金額（${selfIncome.toLocaleString()}円）が${manYen(w.recipientIncomeLimit)}を超えるので、配偶者（${nameOf(s)}）は源泉控除対象配偶者になりません。`);
    } else {
      spouse = 1;
      details.push(`源泉控除対象配偶者 1人：${nameOf(s)}`);
      if (selfIncome === null) notes.push(`本人の所得の見積額が${manYen(w.recipientIncomeLimit)}以下として、配偶者を数えています。`);
    }
  } else if (s) {
    notes.push(`配偶者（${nameOf(s)}）は、所得の見積額が${manYen(w.spouseIncomeLimit)}を超えるので数えません。`);
  }

  // 源泉控除対象親族：控除対象扶養親族と、所得の見積額が線以下の特定親族
  const kinds = decl.dependents.map((d) => ({ d, kind: classifyDependentByLimits(d, year, { income: line, specificRelative: w.specificRelativeLimit }) }));
  const relatives = kinds.filter(({ kind }) => RELATIVE_LABELS[kind]);
  if (relatives.length > 0) {
    details.push(`源泉控除対象親族 ${relatives.length}人：${relatives.map(({ d, kind }) => `${nameOf(d)}（${RELATIVE_LABELS[kind]}）`).join("・")}`);
  }
  const young = kinds.filter(({ kind }) => kind === "young");
  const noBirthday = kinds.filter(({ d }) => !/^\d{4}-\d{2}-\d{2}$/.test(d.birthday || ""));
  const over = kinds.filter(({ d, kind }) => kind === "none" && /^\d{4}-\d{2}-\d{2}$/.test(d.birthday || ""));
  if (noBirthday.length > 0) notes.push(`生年月日が入っていない人（${noBirthday.map(({ d }) => nameOf(d)).join("・")}）は、数えていません。`);

  // 足し算（甲欄だけ。187条）
  let self = 0;
  let family = 0;
  if (!secondary) {
    const selfItems = [
      decl.self.disability === "special" ? "特別障害者" : decl.self.disability === "general" ? "障害者" : "",
      decl.self.widow ? "寡婦" : "",
      decl.self.singleParent ? "ひとり親" : "",
      decl.self.workingStudent ? "勤労学生" : "",
    ].filter(Boolean);
    self = selfItems.length * rule.perSelfItem;
    if (self > 0) details.push(`本人 ${self}人：${selfItems.join("・")}`);

    // 同一生計配偶者（所得の見積額が扶養親族と同じ線以下の配偶者）と扶養親族（16歳未満も含む。特定親族は扶養親族ではない）
    const familyItems: string[] = [];
    const addFamily = (p: DeclaredPerson) => {
      if (p.disability === "general") {
        family += rule.perFamilyItem;
        familyItems.push(`${nameOf(p)}（障害者）`);
      } else if (p.disability === "special") {
        const together = !!p.livingTogether;
        family += rule.perFamilyItem * (together ? 2 : 1);
        familyItems.push(together ? `${nameOf(p)}（同居特別障害者。障害者と同居特別障害者で2つ）` : `${nameOf(p)}（特別障害者）`);
      }
    };
    if (s && incomeOf(s) <= line) addFamily(s);
    else if (s && s.disability !== "none") {
      notes.push(`配偶者（${nameOf(s)}）は、所得の見積額が${manYen(line)}を超え、同一生計配偶者ではないので、障害者でも足しません。`);
    }
    for (const { d, kind } of kinds) if (kind !== "none" && kind !== "specificRelative") addFamily(d);
    if (family > 0) details.push(`家族の障害者 ${family}人：${familyItems.join("・")}`);
    const notCounted = kinds.filter(({ d, kind }) => kind === "specificRelative" && d.disability !== "none");
    if (notCounted.length > 0) {
      notes.push(`特定親族（${notCounted.map(({ d }) => nameOf(d)).join("・")}）は扶養親族ではないので、障害者でも足しません。`);
    }
  }

  // 数えない人（申告書に書いた順。16歳未満の人は、障害者で足したときは出さない）。所得が多い人は、超えた線を出す
  // （19歳以上23歳未満は、源泉控除対象親族になる特定親族の線。ほかは扶養親族の線）
  const sr = rule.specificRelative;
  const overLine = (d: DeclaredDependent) => {
    const age = ageAtYearEnd(d.birthday, year);
    return age !== null && age >= sr.ageFrom && age < sr.ageUntil ? w.specificRelativeLimit : line;
  };
  const skipped = kinds.flatMap((k) =>
    young.includes(k) && (secondary || k.d.disability === "none") ? [`${nameOf(k.d)}（${rule.familyIncludesUnder}歳未満）`]
    : over.includes(k) ? [`${nameOf(k.d)}（所得の見積額が${manYen(overLine(k.d))}を超える）`]
    : []);
  if (skipped.length > 0) details.push(`数えない人：${skipped.join("・")}`);

  return { total: spouse + relatives.length + self + family, spouse, relatives: relatives.length, self, family, details, notes };
};

/** 年末調整の画面に保存した、その人の申告書（年分ごと） */
export interface SavedDeclaration {
  year: number;
  declaration: NenchoDeclaration;
  /** 年末調整の計算結果の合計所得金額（計算していなければ null） */
  selfTotalIncome: number | null;
}

/** year_end_adjustments の行（year・declaration・result）を読む。申告書がない行は除く */
export const parseSavedDeclarations = (rows: { year: unknown; declaration: unknown; result?: unknown }[]): SavedDeclaration[] =>
  rows
    .filter((r) => typeof r.declaration === "string" && r.declaration.trim() !== "")
    .map((r) => {
      let total: number | null = null;
      try {
        const v = typeof r.result === "string" && r.result ? JSON.parse(r.result)?.totalIncome : null;
        total = typeof v === "number" && Number.isFinite(v) ? v : null;
      } catch {
        total = null;
      }
      return { year: Number(r.year), declaration: parseDeclaration(r.declaration), selfTotalIncome: total };
    })
    .filter((r) => Number.isInteger(r.year));

/**
 * 従業員の画面で比べる年と、その年に支払う給与の日：きょうか、扶養人数のいちばん新しい行の始まりの月の1日の、遅いほう
 * （いちばん新しい行を、先の月・翌年から入れてあれば、そちらの年で数える）
 */
export const compareTargetOf = (latestFrom: string, today: string): { year: number; payDate: string } => {
  const fromDate = /^\d{4}-\d{2}$/.test(latestFrom) ? `${latestFrom}-01` : "";
  const payDate = fromDate > today ? fromDate : today;
  return { year: Number(payDate.slice(0, 4)), payDate };
};

export interface DependentsSuggestion extends WithholdingDependentsCount {
  /** 数えた年分 */
  year: number;
  /** 使った申告書の年分（その年分がまだなければ前の年分。そのときは見込み） */
  sourceYear: number;
  /** その年の途中で線が変わる前に数えて、変わった後の人数が違うとき：変わる日（その日以後に支払う給与から）と人数 */
  later: { from: string; total: number } | null;
}

/**
 * 従業員の画面に出す、申告書から数えた扶養親族等の数。その年分の申告書がなければ、前の年分の申告書から、年齢をその年で数え直した見込み
 * （所得の見積額と本人の合計所得金額は、前の年のまま）。どちらもなければ null
 */
export const suggestDependents = (saved: SavedDeclaration[], year: number, column: TaxColumn, payDate: string): DependentsSuggestion | null => {
  const use = saved.find((s) => s.year === year) ?? saved.find((s) => s.year === year - 1);
  const gm = withholdingLinesOf(year);
  if (!use || !gm) return null;
  const count = countWithholdingDependents(use.declaration, year, { column, payDate, selfTotalIncome: use.selfTotalIncome });
  if (!count) return null;
  const change = lineChangeDate(gm, year);
  const after = change && payDate < change
    ? countWithholdingDependents(use.declaration, year, { column, payDate: change, selfTotalIncome: use.selfTotalIncome })
    : null;
  return { ...count, year, sourceYear: use.year, later: change && after && after.total !== count.total ? { from: change, total: after.total } : null };
};

/** 確定した給与の月ごとの、支払った日と使った扶養人数 */
export interface UsedDependents {
  month: number;
  payDate: string;
  used: number;
}

export interface YearDependentsCheck {
  /** その年にいちばん遅く支払う給与の線で数えた人数 */
  latest: WithholdingDependentsCount;
  /** 11月30日以前に支払う給与の線で数えると人数が違うとき（令和8年分）、その人数 */
  earlier: WithholdingDependentsCount | null;
  /** 確定した給与で使った人数（月の順） */
  used: UsedDependents[];
  /** 確定した給与で使った人数が、その給与を支払った日の線で数えた人数と違う月 */
  different: (UsedDependents & { counted: number })[];
}

/**
 * 年末調整の画面に出す、申告書から数えた人数と、その年に確定した給与で使った人数の照らし合わせ（数えられなければ null）
 * 申告書は、その年の12月31日の現況なので、年の途中で家族の状況が変わった人は、違う月があってもまちがいではない
 */
export const checkYearDependents = (
  decl: NenchoDeclaration, year: number, column: TaxColumn, used: UsedDependents[], selfTotalIncome: number | null,
): YearDependentsCheck | null => {
  const gm = withholdingLinesOf(year);
  if (!gm) return null;
  const count = (payDate: string) => countWithholdingDependents(decl, year, { column, payDate, selfTotalIncome });
  const latest = count(`${year}-12-31`);
  if (!latest) return null;
  const early = count(`${year}-01-01`);
  const earlier = early && early.total !== latest.total ? early : null;
  const sorted = [...used].sort((a, b) => a.month - b.month);
  const different = sorted
    .map((u) => ({ ...u, counted: count(u.payDate)?.total ?? latest.total }))
    .filter((u) => u.counted !== u.used);
  return { latest, earlier, used: sorted, different };
};

/** 月の並びを「1〜3月・5月」の形にする（続く月をまとめる） */
export const monthRanges = (months: number[]): string => {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}月` : `${sorted[i]}〜${sorted[j]}月`);
    i = j;
  }
  return parts.join("・");
};

/** 確定した給与で使った人数を、人数ごとに「1〜11月 2人・12月 3人」の形にする */
export const usedSummary = (used: UsedDependents[]): string => {
  const byCount = new Map<number, number[]>();
  for (const u of used) byCount.set(u.used, [...(byCount.get(u.used) ?? []), u.month]);
  return [...byCount.entries()]
    .sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))
    .map(([n, months]) => `${monthRanges(months)} ${n}人`)
    .join("・");
};

/** 扶養人数（扶養親族等の数）の数え方の説明（前書き・数える人・終わりの注意） */
export interface DependentsRuleText {
  intro: string;
  items: string[];
  note: string | null;
}

/**
 * 扶養人数（扶養親族等の数）の数え方の説明。線と年齢は、その年分の国税庁の資料から作ったもの（数えられない年分は null）
 * @param payDate 線を決める、給与を支払う日（令和8年分は、11月30日以前なら12月1日からの線も書く）
 */
export const dependentsRuleText = (year: number, column: TaxColumn, payDate: string): DependentsRuleText | null => {
  const gm = withholdingLinesOf(year);
  const rule = WITHHOLDING_DEPENDENT_RULES[year];
  if (!gm || !rule || column === "hei") return null;
  const w = gm.withoutAdjustment;
  const line = dependentLineOn(gm, payDate);
  // 線が変わる前の日に支払う給与なら、変わった後の線も書く（令和8年分は12月1日から）
  const change = lineChangeDate(gm, year);
  const later = change && line !== w.currentIncomeLimit ? `（${monthDayLabel(change)}以後に支払う給与からは${manYen(w.currentIncomeLimit)}）` : "";
  const sr = rule.specificRelative;
  const spouseLine = `源泉控除対象配偶者：本人の所得の見積額が${manYen(w.recipientIncomeLimit)}以下のときの、所得の見積額が${manYen(w.spouseIncomeLimit)}以下の配偶者`;
  const relativeLine = `源泉控除対象親族：${rule.deductibleAgeFrom}歳以上で所得の見積額が${manYen(line)}以下${later}の扶養親族（控除対象扶養親族）と、`
    + `${sr.ageFrom}歳以上${sr.ageUntil}歳未満で所得の見積額がその線を超え${manYen(w.specificRelativeLimit)}以下の親族（特定親族）`;
  if (column === "otsu") {
    return {
      intro: "従たる給与についての扶養控除等申告書に書かれた、次の人の合計です（所得税法185条1項2号。年齢はその年の12月31日の年齢）。障害者などの足し算はしません。",
      items: [spouseLine, relativeLine],
      note: null,
    };
  }
  return {
    intro: "扶養控除等申告書に書かれた、次の人数の合計です（所得税法185条・187条。年齢はその年の12月31日の年齢）。",
    items: [
      spouseLine,
      relativeLine,
      `本人が障害者（特別障害者を含む）・寡婦・ひとり親・勤労学生なら、それぞれ${rule.perSelfItem}人を足す`,
      `所得の見積額が${manYen(line)}以下${later}の配偶者（同一生計配偶者）や扶養親族（${rule.familyIncludesUnder}歳未満も含む）が障害者なら${rule.perFamilyItem}人を足し、`
        + `同居特別障害者なら、もう${rule.perFamilyItem}人を足す`,
    ],
    note: `${rule.familyIncludesUnder}歳未満の子は、障害者でなければ数えません。国外に住む家族は、親族関係書類などを出してもらった人だけを数えます。`,
  };
};
