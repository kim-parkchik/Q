/**
 * マイナンバーの保存期間（いつまで保管し、いつから消すか）と、保存期間が過ぎた番号の一覧
 *
 * ■ 決まり：個人番号は、個人番号関係事務を処理する必要がなくなり、所管法令で決まった保存期間を過ぎたら、できるだけ速やかに
 *   廃棄・削除する（個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」第4-3-(3)B）。
 *   消したら、消した記録を残す（記録に番号は書かない。同（別添1）安全管理措置）
 *   https://www.ppc.go.jp/legal/policy/my_number_guideline_jigyosha/
 * ■ 保存期間：いちばん長いのは、給与所得者の扶養控除等申告書の7年（提出期限（その年の最初に給与を払う日の前日）の属する年の
 *   翌年1月10日の翌日から7年。所得税法施行規則76条の3）。本人と家族の番号を書いて出すので、この申告書の保存期間が過ぎるまでは消さない。
 *   国税庁「源泉所得税関係に関するFAQ」：退職した人などは、最後に出した申告書の保存期間が過ぎたら、できるだけ速やかに消す
 *   （保存期間の7年の間は消せない）。https://www.nta.go.jp/taxes/tetsuzuki/mynumberinfo/FAQ/gensen_qa.htm
 *   雇用保険の書類（退職から4年）・健康保険と厚生年金の書類（退職から2年）より長く、退職所得の受給に関する申告書（7年）と同じなので、
 *   この7年で数える（クラウド型の給与ソフトの会社の解説と同じく、いちばん長い期間に合わせる。年末調整をしない乙欄の人も同じ）
 * ■ 本人：在籍している間（休職中を含む）は消さない（雇用が続いているので、続けて保管できる。同ガイドライン）。
 *   退職した人は、最後に出した扶養控除等申告書の年（退職した年・最後に給与か賞与を払った年・年末調整の申告書の年のうち、いちばん遅い年）
 *   の翌年1月11日から7年が過ぎたら消す。例：2026年に退職し、最後の給与も2026年に払った → 2034年1月10日まで保管し、11日から消す
 *   （12月末に退職して翌年1月に最後の給与を払ったときは、その年の申告書も出しているので1年遅くなる）
 * ■ 家族（配偶者・扶養親族）：その家族が最後に載った申告書（年末調整の画面の、その年の申告書）の年で数える。いちばん新しい申告書に
 *   載っている間は消さない（在籍している人の家族でも、扶養から外れてから7年が過ぎたら消す）。申告書に見当たらない番号は、
 *   退職した人なら本人と同じ日まで保管し、在籍している人なら保存期間がわからないので、確かめてもらう
 * 一般的な給与ソフトと同じく、保存期間が過ぎた番号を知らせ、確かめてから消す（よく使われている給与ソフトでは、退職者の番号を「要削除」と出し、
 * 1人ずつ・まとめて消せる。そのソフトは「退職日から7年」で知らせるが、Q は申告書の保存期間の終わりで知らせる）
 */
import { SELF_KEY, type MyNumberEntry, type MyNumberStaffRow } from "./myNumber";

export interface MyNumberRetention {
  /** この日まで保管する（YYYY-MM-DD。在籍している・いちばん新しい申告書に載っている・わからないときは null） */
  keepUntil: string | null;
  /** 保存期間が過ぎたか（今日が keepUntil より後） */
  expired: boolean;
  /** なぜ保管するか・どの書類の保存期間か */
  basis: string;
  /** 保存期間がわからない（退職日が入っていない・申告書に見当たらない） */
  unknown: boolean;
}

/** 今日（YYYY-MM-DD。この PC の日付） */
export const todayYmd = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** 日付の書き方（2025-01-10 → 2025年1月10日。記録・確かめの窓に使う） */
export const jaDate = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? `${y}年${m}月${d}日` : ymd;
};

/** その年の扶養控除等申告書の保存期間の終わり（翌年1月11日から7年 → 8年後の1月10日） */
export const declarationKeepUntil = (year: number): string => `${year + 8}-01-10`;

/** 申告書の保存期間の書き方（例：「2026年分の扶養控除等申告書の保存期間（2027年1月11日から7年）」） */
const declarationBasis = (year: number, what: string) => `${what}（${year}年分）の保存期間（${year + 1}年1月11日から7年）`;

/** 退職した人の、最後に出した扶養控除等申告書の年（退職した年・最後に給与か賞与を払った年・年末調整の申告書の年のうち、いちばん遅い年） */
export const lastDeclarationYearOf = (retirementDate: string, lastPayYear: number | null | undefined, declarationYears: number[]): number =>
  Math.max(Number(retirementDate.slice(0, 4)) || 0, Number(lastPayYear) || 0, ...declarationYears);

/** 退職しているか（退職日が今日より前。退職日がなくても「退職」の人は退職とみなす） */
const isRetired = (staff: { status?: string | null; retirement_date?: string | null }, today: string) =>
  (!!staff.retirement_date && staff.retirement_date < today) || staff.status === "retired";

/**
 * 1人分（本人と家族）の保存期間（登録していない人も出す。画面は登録した番号だけに使う）
 * @param lastPayYear     最後に給与か賞与を払った年（払っていなければ null）
 * @param declarationYears 年末調整の申告書を入れた年
 */
export const retentionsOfRow = (
  row: MyNumberStaffRow,
  staff: { status?: string | null; retirement_date?: string | null },
  lastPayYear: number | null | undefined,
  declarationYears: number[],
  today: string,
): Record<string, MyNumberRetention> => {
  const result: Record<string, MyNumberRetention> = {};
  const retired = isRetired(staff, today);
  const keep = (basis: string): MyNumberRetention => ({ keepUntil: null, expired: false, basis, unknown: false });
  const until = (keepUntil: string, basis: string): MyNumberRetention => ({ keepUntil, expired: today > keepUntil, basis, unknown: false });
  const unknown = (basis: string): MyNumberRetention => ({ keepUntil: null, expired: false, basis, unknown: true });

  // 本人
  let selfRetention: MyNumberRetention;
  if (!retired) {
    selfRetention = keep("在籍しているので保管します（休職中も同じ）");
  } else if (!staff.retirement_date) {
    selfRetention = unknown("退職日が入っていないので、保存期間がわかりません（従業員の画面で退職日を入れてください）");
  } else {
    const last = lastDeclarationYearOf(staff.retirement_date, lastPayYear, declarationYears);
    selfRetention = until(declarationKeepUntil(last), declarationBasis(last, "最後の扶養控除等申告書"));
  }
  result[SELF_KEY] = selfRetention;

  // 家族
  const latest = declarationYears.length > 0 ? Math.max(...declarationYears) : null;
  for (const e of row.entries) {
    if (e.key === SELF_KEY) continue;
    if (e.years.length > 0) {
      const last = Math.max(...e.years);
      result[e.key] = !retired && latest !== null && last >= latest
        ? keep(`いちばん新しい申告書（${latest}年分）に載っているので保管します`)
        : until(declarationKeepUntil(last), declarationBasis(last, "この家族が最後に載った扶養控除等申告書"));
    } else if (retired && selfRetention.keepUntil) {
      result[e.key] = until(selfRetention.keepUntil, "年末調整の申告書に見当たらないので、本人と同じ日まで保管します");
    } else {
      result[e.key] = unknown("年末調整の申告書に見当たりません（扶養から外れたなら、最後に載った申告書の年の翌年1月11日から7年が過ぎたら消します）");
    }
  }
  return result;
};

/** 保存期間が過ぎた番号（登録してある番号だけ） */
export interface ExpiredMyNumber {
  row: MyNumberStaffRow;
  entry: MyNumberEntry;
  retention: MyNumberRetention;
}

/**
 * 全員の保存期間と、保存期間が過ぎた番号の一覧
 * @param lastPayYears     従業員IDごとの、最後に給与か賞与を払った年
 * @param declarationYears 従業員IDごとの、年末調整の申告書を入れた年
 */
export const myNumberRetentions = (
  rows: MyNumberStaffRow[],
  staffList: { id: string | number; status?: string | null; retirement_date?: string | null }[],
  lastPayYears: Record<string, number>,
  declarationYears: Record<string, number[]>,
  today: string,
): { byStaff: Record<string, Record<string, MyNumberRetention>>; expired: ExpiredMyNumber[] } => {
  const staffById = new Map(staffList.map((s) => [String(s.id), s]));
  const byStaff: Record<string, Record<string, MyNumberRetention>> = {};
  const expired: ExpiredMyNumber[] = [];
  for (const row of rows) {
    const staff = staffById.get(row.staffId) ?? { retirement_date: row.retiredOn };
    const r = retentionsOfRow(row, staff, lastPayYears[row.staffId] ?? null, declarationYears[row.staffId] ?? [], today);
    byStaff[row.staffId] = r;
    for (const entry of row.entries) {
      if (entry.registered && r[entry.key]?.expired) expired.push({ row, entry, retention: r[entry.key] });
    }
  }
  return { byStaff, expired };
};
