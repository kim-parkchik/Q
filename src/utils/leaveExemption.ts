/**
 * 産前産後休業・育児休業等の期間中の、社会保険料の免除
 *
 * 事業主が年金事務所（健康保険組合）に申出をすると、健康保険（介護保険・子ども・子育て支援金を含む）と
 * 厚生年金の保険料が、本人負担分・会社負担分とも免除される。雇用保険料は免除されない（支払った賃金にかかる）。
 *
 * ■ 産前産後休業（健康保険法159条の3・厚生年金保険法81条の2の2）
 *   開始日がある月の分から、終了日の翌日がある月の前月分まで免除する（その月に支払った賞与も免除）。
 * ■ 育児休業等（産後パパ育休を含む。健康保険法159条・厚生年金保険法81条の2）
 *   ・開始日がある月の分から、終了日の翌日がある月の前月分まで免除する
 *   ・開始日がある月と終了日の翌日がある月が同じでも、その月に14日以上休めば、その月の分は免除する
 *     （令和4年10月1日以後に開始した育児休業等だけ）
 *   ・賞与は、1つ目の決まりで免除になる月に支払ったもので、育児休業等の期間が1か月を超えるときだけ免除する
 *     （令和4年9月30日以前に開始した育児休業等は、1か月以下でも免除）
 *   ・続けて取った2つ以上の育児休業等は、1つの育児休業等とみなす
 *   ・役員（事業主等）は、育児休業等の免除を受けられない（産前産後休業は受けられる）
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/sankyu-menjo/20140509-02.html
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/ikuji-menjo/20140327-05.html
 *       https://www.nenkin.go.jp/oshirase/taisetu/2022/202210/100302.html （令和4年10月の改正）
 *       健康保険法施行規則135条（14日の数え方・続けて取った育児休業等）
 * ※ 産後パパ育休中に働いた日は14日から除くが、Q は働いた日を数えずに計算する。
 * ※ 休日をはさんで続けて休んだ（間に働いた日がない）ときも1つの育児休業等になるので、1つの期間として入力してもらう。
 */
import dayjs, { type Dayjs } from 'dayjs';

/** maternity: 産前産後休業 / childcare: 育児休業等（産後パパ育休を含む） */
export type LeaveType = 'maternity' | 'childcare';

export interface LeavePeriod {
  type: LeaveType;
  /** 開始日（YYYY-MM-DD） */
  start: string;
  /** 終了日（YYYY-MM-DD）。まだ決まっていなければ空 */
  end: string;
}

/** 令和4年10月の改正（14日以上の月・賞与の1か月超）が当てはまる育児休業等の開始日 */
const CHILDCARE_RULE_2022_START = '2022-10-01';

/** 従業員の leave_periods（JSON の文字列）を読む。空・壊れているときは期間なし */
export const parseLeavePeriods = (json: unknown): LeavePeriod[] => {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => (p?.type === 'maternity' || p?.type === 'childcare') && typeof p.start === 'string' && p.start)
      .map((p) => ({ type: p.type, start: p.start, end: typeof p.end === 'string' ? p.end : '' }));
  } catch {
    return [];
  }
};

/** 保存用の JSON。期間がなければ空文字 */
export const stringifyLeavePeriods = (leaves: LeavePeriod[]): string =>
  leaves.length > 0 ? JSON.stringify(leaves.map(({ type, start, end }) => ({ type, start, end }))) : '';

/** 入力の誤り（開始日が空・終了日が開始日より前）。問題なければ null */
export const validateLeavePeriod = (p: LeavePeriod): string | null => {
  if (!p.start) return '開始日を入れてください';
  if (p.end && p.end < p.start) return '終了日が開始日より前です';
  return null;
};

/** 年と月から、月の通し番号を作る（月どうしの前後を比べるため） */
const monthIndex = (d: Dayjs) => d.year() * 12 + d.month();

interface Span {
  start: Dayjs;
  /** 終了日。null は終了日が未定（ずっと続いている） */
  end: Dayjs | null;
}

/** 同じ種類の期間を並べ、続けて取った（重なる・翌日から始まる）期間を1つにまとめる */
const mergeSpans = (leaves: LeavePeriod[], type: LeaveType): Span[] => {
  const spans = leaves
    .filter((p) => p.type === type && !validateLeavePeriod(p))
    .map((p) => ({ start: dayjs(p.start), end: p.end ? dayjs(p.end) : null }))
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && (last.end === null || !s.start.isAfter(last.end.add(1, 'day'), 'day'))) {
      if (last.end !== null) last.end = s.end === null || s.end.isAfter(last.end) ? s.end : last.end;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
};

/** 開始日がある月から、終了日の翌日がある月の前月まで、に入る月か */
const coversMonth = (s: Span, m: number) =>
  monthIndex(s.start) <= m && (s.end === null || m < monthIndex(s.end.add(1, 'day')));

/** 開始日がある月と、終了日の翌日がある月が同じか（月の途中で始まって、同じ月のうちに終わる） */
const isWithinOneMonth = (s: Span) => s.end !== null && monthIndex(s.start) === monthIndex(s.end.add(1, 'day'));

/**
 * 期間が1か月を超えるか（暦で数える。1月15日〜2月14日はちょうど1か月、2月15日まで休めば1か月を超える）
 * 1か月後に同じ日がないとき（1月31日開始など）は、その月の末日（2月28日）でちょうど1か月になる（民法143条）
 */
const isLongerThanOneMonth = (s: Span) => {
  if (s.end === null) return true;
  const next = s.start.add(1, 'month');
  const oneMonthEnd = next.date() === s.start.date() ? next.subtract(1, 'day') : next;
  return s.end.isAfter(oneMonthEnd, 'day');
};

/** その月の分の社会保険料が、産休・育休で免除されるか */
export const checkLeaveExemptMonth = (leaves: LeavePeriod[], year: number, month: number): boolean => {
  const m = year * 12 + (month - 1);
  if (mergeSpans(leaves, 'maternity').some((s) => coversMonth(s, m))) return true;

  const childcare = mergeSpans(leaves, 'childcare');
  if (childcare.some((s) => !isWithinOneMonth(s) && coversMonth(s, m))) return true;
  // 同じ月のうちに始まって終わる育児休業等は、その月に合わせて14日以上なら免除（令和4年10月1日以後に開始したもの）
  const days = childcare
    .filter((s) => isWithinOneMonth(s) && monthIndex(s.start) === m && !s.start.isBefore(CHILDCARE_RULE_2022_START, 'day'))
    .reduce((sum, s) => sum + s.end!.diff(s.start, 'day') + 1, 0);
  return days >= 14;
};

/** その日に支払う賞与の社会保険料が、産休・育休で免除されるか */
export const checkLeaveExemptBonus = (leaves: LeavePeriod[], payDate: string): boolean => {
  const m = monthIndex(dayjs(payDate));
  if (mergeSpans(leaves, 'maternity').some((s) => coversMonth(s, m))) return true;
  return mergeSpans(leaves, 'childcare').some((s) =>
    !isWithinOneMonth(s)
    && coversMonth(s, m)
    && (s.start.isBefore(CHILDCARE_RULE_2022_START, 'day') || isLongerThanOneMonth(s)));
};
