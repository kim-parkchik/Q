/**
 * 死亡退職で払う退職手当等の「退職手当金等受給者別支払調書」と「同合計表」（相続税法の法定調書）
 *
 * 欄は、国税庁の様式（退職手当金等受給者別支払調書：様式ID NTAOHSZ421010040、合計表）と、それぞれの記載要領による
 * （taishoku-tables/source/chousho46.pdf・kisai_chousho46.pdf・goukei40.pdf・kisai_goukei40.pdf。入手元は taishoku-tables/README.md）。
 * ・受給者（相続人など）ごとに1枚。退職手当金等の種類は、退職金・功労金・確定給付企業年金規約などに基づく一時金などの名称（備考二）、
 *   退職者の死亡年月日を書く（備考四）
 * ・合計表は支払った月ごと（「年月分」）。「支払総額（支払調書提出省略分を含む。）」には提出を省略するものも含めたすべてを、
 *   「左のうち、支払調書を提出するものの合計」には、合計表とともに支払調書を出すものだけを書く（合計表の記載要領 1・2）
 * ・提出期限は、支給した月の翌月15日（相続税法59条1項。土日・祝日・12月29日〜1月3日なら、その次の日。国税通則法10条2項）。
 *   受給者ごとの退職手当金等の金額が100万円以下なら、支払調書を出さなくてよい（同ただし書・相続税法施行規則30条3項）。
 *   数は constants/taishoku.ts（scripts/import_taishoku_tables.py で条文から読んだもの）
 */
import dayjs from "dayjs";
import { TAISHOKU_BENEFIT_REPORT } from "../constants/taishoku";
import { emptyRetirementHeir, type RetirementHeir, type RetirementRecord } from "./retirementIncome";
import { taxDueDate } from "./withholdingPayment";

/** 受給者（入れていなければ、支払金額の全部を受ける1人） */
export const heirsOf = (r: RetirementRecord): RetirementHeir[] =>
  r.input.heirs.length ? r.input.heirs : [{ ...emptyRetirementHeir(), amount: r.amount }];

/** 支払調書を出さないか（手で決めていなければ、受給者の額が100万円以下なら出さない。同じ月に同じ人に2回以上払ったときは submittedHeirs） */
export const heirOmitted = (h: RetirementHeir): boolean => h.omit ?? h.amount <= TAISHOKU_BENEFIT_REPORT.omitUpTo;

/** 受給者を見分ける（氏名と住所。氏名がなければ記録ごと） */
export const heirKeyOf = (r: RetirementRecord, h: RetirementHeir, i: number): string =>
  h.name.trim() ? `${h.name.trim()}|${h.address.trim()}` : `${r.id}|${i}`;

/**
 * その月に支払調書を出す受給者（相続税法59条1項：その月中に支給した退職手当金等について、受給者別に作る。ただし書の額は受給者ごとの金額で見る）
 * 手で「出す」「出さない」を決めた受給者はそのとおり、決めていなければ、その月にその人に支給した額の合計が100万円を超えれば出す
 */
export const submittedHeirs = (records: RetirementRecord[], month: string): Set<string> => {
  const map = new Map<string, { amount: number; flags: (boolean | null)[] }>();
  for (const r of records.filter((x) => x.input.death && x.payDate.startsWith(month))) {
    heirsOf(r).forEach((h, i) => {
      const key = heirKeyOf(r, h, i);
      const g = map.get(key) ?? { amount: 0, flags: [] };
      g.amount += h.amount;
      g.flags.push(h.omit);
      map.set(key, g);
    });
  }
  return new Set([...map].filter(([, g]) => g.flags.includes(false) || (!g.flags.includes(true) && g.amount > TAISHOKU_BENEFIT_REPORT.omitUpTo)).map(([k]) => k));
};

/** 支払調書（と合計表）の提出期限：支給した月の翌月15日（休日なら次の日） */
export const benefitReportDueDate = (payDate: string, isHoliday?: (d: string) => boolean): string =>
  taxDueDate(dayjs(payDate).startOf("month").add(1, "month").date(TAISHOKU_BENEFIT_REPORT.dueDay).format("YYYY-MM-DD"), isHoliday);

/** 支払調書を作る前に直すところ */
export const benefitReportProblems = (r: RetirementRecord): string[] => {
  const out: string[] = [];
  const heirs = heirsOf(r);
  const sum = heirs.reduce((s, h) => s + h.amount, 0);
  if (sum !== r.amount) out.push(`受給者ごとの額の合計（${sum.toLocaleString()}円）が、支払金額（${r.amount.toLocaleString()}円）と合いません。`);
  heirs.forEach((h, i) => {
    if (!h.name.trim()) out.push(`${i + 1}人目の受給者の氏名を入れてください。`);
    if (!h.address.trim()) out.push(`${h.name.trim() || `${i + 1}人目の受給者`}の住所を入れてください。`);
    if (!h.relation.trim()) out.push(`${h.name.trim() || `${i + 1}人目の受給者`}の、退職者との続柄を入れてください。`);
  });
  if (!r.input.benefitKind.trim()) out.push("退職手当金等の種類（退職金・功労金など）を入れてください。");
  return out;
};

export interface BenefitSummary {
  /** 支払った月（YYYY-MM。合計表の「年月分」） */
  month: string;
  /** 支払総額（支払調書提出省略分を含む。） */
  total: { persons: number; amount: number };
  /** 左のうち、支払調書を提出するものの合計 */
  submit: { persons: number; amount: number };
}

/** 合計表に書く額（その年に支払った死亡退職の退職手当等を、支払った月ごとに） */
export const benefitSummaryOf = (records: RetirementRecord[], year: number): BenefitSummary[] => {
  const map = new Map<string, { month: string; all: Map<string, number>; sub: Map<string, number> }>();
  for (const r of records.filter((x) => x.input.death && x.payDate.startsWith(`${year}-`))) {
    const month = r.payDate.slice(0, 7);
    const g = map.get(month) ?? { month, all: new Map(), sub: new Map() };
    const submitted = submittedHeirs(records, month);
    heirsOf(r).forEach((h, i) => {
      // 受給者数は人で数える（同じ月に2つの退職手当等を受けた人は1人）
      const key = heirKeyOf(r, h, i);
      g.all.set(key, (g.all.get(key) ?? 0) + h.amount);
      if (submitted.has(key)) g.sub.set(key, (g.sub.get(key) ?? 0) + h.amount);
    });
    map.set(month, g);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).map((g) => ({
    month: g.month, total: { persons: g.all.size, amount: sum(g.all) }, submit: { persons: g.sub.size, amount: sum(g.sub) },
  }));
};
