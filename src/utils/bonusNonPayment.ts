/**
 * 健康保険・厚生年金保険 賞与不支給報告書（日本年金機構）
 *
 * 決まり（日本年金機構「賞与を支給したとき、賞与支払予定月に賞与が不支給のとき」・賞与不支給報告書の様式と記入例・
 * 「令和3年4月からの賞与支払届等に係る総括表の廃止及び賞与不支給報告書の新設について」）:
 * ・日本年金機構に登録している賞与支払予定月に、どの被保険者・70歳以上被用者にも賞与を払わなかったときに出す
 *   （払わなかったときは、賞与支払届は出さない。出さないと、あとで提出を勧めるお知らせが届く）
 * ・書くこと：提出日・事業所整理記号・事業所番号・事業所の所在地・名称・事業主氏名・電話番号・賞与支払予定年月・
 *   ①賞与支払年月（予定していた賞与を払わなかった年月）・②支給の状況（「不支給」と印刷されている）・
 *   ③賞与支払予定月の変更（これからの予定月が登録と違うとき。変更後と変更前の月を書く。予定がなくなったら変更後をすべて「00」）
 * ・電子申請（e-Gov）では、画面で項目を入れて出す届書（電子申請用ファイルを添付する届書ではない）。紙でも出せる
 * ・賞与支払予定月は、新規適用届や事業所関係変更（訂正）届で登録する（登録すると、予定月の前の月に届書の用紙が届く）
 */
import { buildBonusReport, type BonusPayment } from "./bonusReport";

/** 賞与支払予定月の数（賞与不支給報告書の「賞与支払予定月の変更」の欄の数） */
export const BONUS_PLAN_MONTH_LIMIT = 4;

/** 会社の bonus_plan_months（「7,12」）を読む。1〜12月の数字だけ、重ねず、小さい順に、4つまで */
export const parseBonusPlanMonths = (value: unknown): number[] =>
  [...new Set(String(value ?? "").split(/[,、\s]+/).map((s) => Number(s.normalize("NFKC"))).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))]
    .sort((a, b) => a - b)
    .slice(0, BONUS_PLAN_MONTH_LIMIT);

/** 保存する形（「7,12」。なければ空） */
export const stringifyBonusPlanMonths = (months: number[]): string => parseBonusPlanMonths(months.join(",")).join(",");

/** paid：被保険者に賞与を払った（賞与支払届を出す）／unpaid：払っていない（賞与不支給報告書を出す）／upcoming：まだその月になっていない */
export type PlanMonthStatus = "paid" | "unpaid" | "upcoming";

export interface PlanMonth {
  month: number;
  /** YYYY-MM */
  ym: string;
  status: PlanMonthStatus;
  /** その月に被保険者に払った賞与の名前 */
  bonuses: string[];
}

/**
 * その年の賞与支払予定月ごとに、被保険者（70歳以上被用者を含む）に賞与を払ったか
 * （社会保険に入っていない人・資格がない日に払った賞与は、払ったことにしない。utils/bonusReport.ts の決まり。
 *  年4回以上払う賞与で、社会保険の報酬として扱ったものも、賞与ではないので払ったことにしない。utils/shoyoHoushu.ts）
 * @param payments その年に払った、確定した賞与
 * @param today 今日（YYYY-MM-DD。その月より前の予定月は、まだその月になっていない）
 */
export const planMonthStatuses = (
  year: number,
  planMonths: number[],
  staffList: any[],
  payments: BonusPayment[],
  today: string,
): PlanMonth[] =>
  planMonths.map((month) => {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const inMonth = payments.filter((p) => p.paymentDate.slice(0, 7) === ym && p.totalEarnings > 0);
    const { rows } = buildBonusReport(staffList, inMonth, []);
    const reported = new Set(rows.map((r) => r.staffId));
    const bonuses = [...new Set(inMonth.filter((p) => reported.has(p.staffId)).map((p) => p.name))];
    const status: PlanMonthStatus = bonuses.length > 0 ? "paid" : ym > today.slice(0, 7) ? "upcoming" : "unpaid";
    return { month, ym, status, bonuses };
  });

/**
 * 賞与支払予定月の変更（③）に書く月：変更後（予定がなくなったら「00」）と変更前（いまの登録）。変えないときは空
 * @param after 変更後の予定月（空の配列は、予定がなくなった）
 */
export const planChangeMonths = (before: number[], after: number[] | null): { after: string[]; before: string[] } => {
  if (after === null) return { after: [], before: [] };
  const p2 = (n: number) => String(n).padStart(2, "0");
  const next = parseBonusPlanMonths(after.join(","));
  return {
    after: next.length > 0 ? next.map(p2) : Array.from({ length: BONUS_PLAN_MONTH_LIMIT }, () => "00"),
    before: parseBonusPlanMonths(before.join(",")).map(p2),
  };
};
