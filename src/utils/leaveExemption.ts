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
 *   ・役員（事業主等）は、育児休業等の免除を受けられない（産前産後休業は受けられる）。免除を受けられるのは
 *     育児・介護休業法に基づく育児休業等の期間に限り、役員はふつう労働者に当たらず、その育児休業等を取れないため
 *     （日本年金機構「従業員（健康保険・厚生年金保険の被保険者）が育児休業等を取得・延長したときの手続き」4．留意事項（1））。
 *     給与・賞与・養育特例・育児休業等終了時改定は、どれも exemptLeavePeriodsOf で読んだ期間を使う
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/sankyu-menjo/20140509-02.html
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/ikuji-menjo/20140327-05.html
 *       https://www.nenkin.go.jp/oshirase/taisetu/2022/202210/100302.html （令和4年10月の改正）
 *       健康保険法施行規則135条（14日の数え方・続けて取った育児休業等）
 * ※ 産後パパ育休中に働いた日は14日から除くが、Q は働いた日を数えずに計算する。
 * ※ 休日をはさんで続けて休んだ（間に働いた日がない）ときも1つの育児休業等になるので、1つの期間として入力してもらう。
 * ※ 従業員の画面では、介護休業・業務上の負傷や疾病による休業・その他の休職も入れられる（休業の日の給与・勤怠・年休の出勤率は
 *   utils/leaveOfAbsence.ts）。この3つには保険料の免除がないので、免除の計算には使わない（exemptLeavePeriodsOf で除く）。
 */
import dayjs, { type Dayjs } from 'dayjs';

/** 社会保険料の免除がある休業（maternity: 産前産後休業 / childcare: 育児休業等（産後パパ育休を含む）） */
export type ExemptLeaveType = 'maternity' | 'childcare';

/**
 * 休業・休職の種類（従業員の画面で入れる。staff.leave_periods）
 * 免除がある2つに加えて、family_care: 介護休業 / injury: 業務上の負傷・疾病による休業 / other: その他の休職・休業（私傷病の休職など）
 */
export type LeaveType = ExemptLeaveType | 'family_care' | 'injury' | 'other';

export const LEAVE_TYPES: LeaveType[] = ['maternity', 'childcare', 'family_care', 'injury', 'other'];

export interface LeavePeriod {
  type: LeaveType;
  /** 開始日（YYYY-MM-DD） */
  start: string;
  /** 終了日（YYYY-MM-DD）。まだ決まっていなければ空 */
  end: string;
  /**
   * 業務上の負傷・疾病による休業の、事故の日（病気は診断で決まった日。YYYY-MM-DD。空なら開始日）。
   * 最初の3日の休業補償の平均賃金を数える日（労働基準法施行規則48条）。同じ事故の休業は、待期の3日を通算する（utils/averageWage.ts）
   */
  accident?: string;
}

/** 社会保険料の免除に使う休業（産前産後休業・育児休業等） */
export interface ExemptLeavePeriod extends LeavePeriod {
  type: ExemptLeaveType;
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
      .filter((p) => LEAVE_TYPES.includes(p?.type) && typeof p.start === 'string' && p.start)
      .map((p) => ({
        type: p.type, start: p.start, end: typeof p.end === 'string' ? p.end : '',
        ...(p.type === 'injury' && typeof p.accident === 'string' && p.accident ? { accident: p.accident } : {}),
      }));
  } catch {
    return [];
  }
};

/**
 * その人がその休業で、保険料の免除を受けられるか（産前産後休業と、役員でない人の育児休業等だけ。
 * 役員の育児休業等と、介護休業・業務上の負傷や疾病による休業・その他の休職は受けられない）
 */
export const canExemptLeave = (staff: { is_executive?: unknown } | null | undefined, leave: Pick<LeavePeriod, 'type'>): boolean =>
  leave.type === 'maternity' || (leave.type === 'childcare' && Number(staff?.is_executive) !== 1);

/**
 * 保険料の免除に使う期間：従業員の leave_periods のうち、その人が免除を受けられる休業だけ
 * （役員は育児休業等を除く。介護休業などは入れない。従業員の画面には、入れた期間をそのまま出す）
 */
export const exemptLeavePeriodsOf = (staff: { leave_periods?: unknown; is_executive?: unknown } | null | undefined): ExemptLeavePeriod[] =>
  parseLeavePeriods(staff?.leave_periods).filter((p): p is ExemptLeavePeriod => canExemptLeave(staff, p));

/** 保存用の JSON。期間がなければ空文字 */
export const stringifyLeavePeriods = (leaves: LeavePeriod[]): string =>
  leaves.length > 0
    ? JSON.stringify(leaves.map(({ type, start, end, accident }) => ({ type, start, end, ...(type === 'injury' && accident ? { accident } : {}) })))
    : '';

/** 入力の誤り（開始日が空・終了日が開始日より前）。問題なければ null */
export const validateLeavePeriod = (p: LeavePeriod): string | null => {
  if (!p.start) return '開始日を入れてください';
  if (p.end && p.end < p.start) return '終了日が開始日より前です';
  if (p.type === 'injury' && p.accident && p.accident > p.start) return '事故の日が開始日より後です';
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
const mergeSpans = (leaves: LeavePeriod[], type: ExemptLeaveType): Span[] => {
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
