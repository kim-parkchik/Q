/**
 * 年次有給休暇の付与（付与日・日数・出勤率）と、年5日の取得の確かめ
 *
 * ■ 付与（労働基準法39条1項〜3項。日数の表は src/constants/annualLeave.ts。e-Gov の条文データからスクリプトで作る）
 *   ・雇入れの日から6か月継続勤務し、全労働日の8割以上出勤した人に10日。その後は1年ごとに、8割以上出勤していれば、
 *     継続勤務期間に応じた日数（11・12・14・16・18・20日）。
 *   ・1週間の所定労働時間が30時間未満で、週の所定労働日数が4日以下（週で決めていない人は、1年間の所定労働日数が216日以下）の人は、
 *     比例付与の表の日数。
 *   ・6か月・1年は、雇入れの日・前の付与日から数えて、その月数たった日（応当日。応当日がない月は翌月1日）。
 * ■ 付与日をそろえる（統一基準日。斉一的取扱い。平成6年1月4日 基発1号）：会社が決めた月日に、全員の付与日をそろえる。
 *   法定の基準日（入社6か月後・その後1年ごと）より遅くはできないので、そろえるときは前倒しにする。
 *   ・初回は入社6か月後、2回目からは次の統一日（初めの値。マネーフォワード クラウド勤怠の「月日指定」と同じ形）
 *   ・統一日が入社6か月後より先に来れば、その日に初回（来なければ6か月後）。その後は統一日ごと
 *   前倒しした日の日数は、前倒しした先の段の日数（2回目なら11日）。前倒しで短くなった期間は、8割の出勤率では全部出勤したものとみなす。
 * ■ 出勤率：全労働日（所定労働日）のうち出勤した日。年休・特別休暇の日と、産前産後休業・育児休業の期間（従業員の画面の産休・育休）は
 *   出勤したものとみなす（労働基準法39条10項）。所定労働日でない日の労働は数えない。Q に確定した勤怠がない日があれば、確かめられない。
 * ■ 年5日（労働基準法39条7項）：10日以上付与した人に、付与日（基準日）から1年以内に5日を取らせる（会社の年度・1〜12月ではなく人ごと）。
 *   全休は1日、半休は0.5日で数え、時間単位の年休と特別休暇は数えない（本人が取っても数えない。厚生労働省 スタートアップ労働条件
 *   https://www.startup-roudou.mhlw.go.jp/qa/zigyonushi/hatarakikatakaikaku/q5.html ・ q6.html）。
 *   ・1年の期間が重なるとき（付与日をそろえて、前の付与から1年たたないうちに次の10日以上を付与したとき）は、はじめの基準日から
 *     最後の基準日の1年後までをまとめて、その月数 ÷ 12 × 5 日を取らせる（比例按分。労働基準法施行規則24条の5第2項）。
 *     月数は、まるまるの月数に、余りの日をその次の1か月の日数で割った分を足す。法令に端数の決まりはないので、足りなくならないように、
 *     取れる単位（半休を使う会社は半日、使わない会社は1日）に切り上げる（ジョブカンの「ダブルトラック」と同じ数え方。
 *     マネーフォワード クラウド勤怠も、重なるときはまとめて按分する）。
 *   ・10日を何回かに分けて付与したとき（入社日に5日、6か月後に5日など）は、合わせて10日になった日を基準日にし、はじめに分けて付与した日
 *     から取った日も数える（同4項）。同じ付与（法定の段）を分けたものかは、いちばん近い付与の予定で見分ける
 *     （比例付与の人が、付与日をそろえて半年で次の付与を受けても、別の段の付与なので合わせない）。
 */
import dayjs from "dayjs";
import {
  ATTENDANCE_RATE_REQUIRED, FIRST_GRANT_MONTHS, NORMAL_GRANT_DAYS, OBLIGATION_DAYS, OBLIGATION_MIN_GRANT_DAYS,
  PROPORTIONAL_GRANT_DAYS, PROPORTIONAL_MAX_ANNUAL_DAYS, PROPORTIONAL_MAX_WEEKLY_DAYS, PROPORTIONAL_WEEKLY_HOURS_LIMIT,
} from "../constants/annualLeave";
import { expiryAfterMonths, isAnnualLeaveGrant, type LeaveGrantRow, type LeaveTaken } from "./paidLeave";
import { isPrescribedWorkDay, parseWorkDays, type CalendarContext } from "./annualWorkDays";
import { dateInYear } from "./specialLeave";
import type { LeavePeriod } from "./leaveExemption";
import { DEEMED_PRESENT_LEAVE_TYPES, leaveOn } from "./leaveOfAbsence";

const fmt = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");

// ── 会社の付与のしかた ─────────────────────────────────────

/**
 * 私傷病の休職などの「その他の休職」の日を、出勤率でどう数えるか（法律に決まりがなく、就業規則で決める）
 * exclude：全労働日から除く（初めの値。労働の義務がない日として、分母にも分子にも入れない）／absent：欠勤と同じに数える
 * 産前産後休業・育児休業・介護休業・業務上の負傷や疾病による休業は、法律どおり出勤したものとみなす（労働基準法39条10項）
 */
export type OtherLeaveRateRule = "exclude" | "absent";

export const OTHER_LEAVE_RATE_LABELS: Record<OtherLeaveRateRule, string> = {
  exclude: "全労働日から除く",
  absent: "欠勤と同じに数える",
};

/**
 * hire：入社日ごと（法定どおり）／unified：会社で決めた月日にそろえる（first：初回の付与）
 * otherLeave：その他の休職の日の、出勤率での数え方（省略は全労働日から除く）
 */
export type AnnualLeaveRule = (
  | { mode: "hire" }
  | { mode: "unified"; month: number; day: number; first: "sixMonths" | "unifiedFirst" }
) & { otherLeave?: OtherLeaveRateRule };

export const DEFAULT_ANNUAL_LEAVE_RULE: AnnualLeaveRule = { mode: "hire" };

/** その他の休職の日の、出勤率での数え方（設定がなければ全労働日から除く） */
export const otherLeaveRuleOf = (rule: AnnualLeaveRule): OtherLeaveRateRule => (rule.otherLeave === "absent" ? "absent" : "exclude");

/** company.annual_leave_rule（JSON）を読む。ない・読めないときは入社日ごと */
export const parseAnnualLeaveRule = (value: unknown): AnnualLeaveRule => {
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_ANNUAL_LEAVE_RULE;
  try {
    const v = JSON.parse(value);
    const month = Number(v?.month);
    const day = Number(v?.day);
    const other: { otherLeave?: OtherLeaveRateRule } = v?.otherLeave === "absent" ? { otherLeave: "absent" } : {};
    if (v?.mode === "unified" && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1
      && day <= dayjs(new Date(2024, month - 1, 1)).daysInMonth()) {
      return { mode: "unified", month, day, first: v?.first === "unifiedFirst" ? "unifiedFirst" : "sixMonths", ...other };
    }
    return { mode: "hire", ...other };
  } catch {
    // 読めないときは入社日ごと
  }
  return DEFAULT_ANNUAL_LEAVE_RULE;
};

export const stringifyAnnualLeaveRule = (rule: AnnualLeaveRule): string => JSON.stringify(rule);

export const describeAnnualLeaveRule = (rule: AnnualLeaveRule): string =>
  rule.mode === "hire"
    ? "入社日ごと（入社6か月後、その後1年ごと）"
    : `毎年${rule.month}月${rule.day}日にそろえる（${rule.first === "sixMonths" ? "初回は入社6か月後、2回目から" : "入社6か月後より先に来れば初回から"}）`;

/** その他の休職の日の数え方の説明（出勤率） */
export const describeOtherLeaveRule = (rule: AnnualLeaveRule): string =>
  `私傷病の休職などの「その他の休職」の日は、出勤率で${OTHER_LEAVE_RATE_LABELS[otherLeaveRuleOf(rule)]}`;

// ── 日付 ──────────────────────────────────────────────

/** from から months か月たった日（その前の日までが months か月。応当日がない月は翌月1日。民法143条） */
export const afterMonths = (from: string, months: number): string => {
  const end = expiryAfterMonths(from, months);
  return end ? fmt(dayjs(end).add(1, "day")) : "";
};

const dayBefore = (date: string) => fmt(dayjs(date).subtract(1, "day"));

// ── 付与日数 ─────────────────────────────────────────────

/** 週・1年の所定労働日数と、1週間の所定労働時間（比例付与かを決める） */
export interface WorkScale {
  /** 1週間の所定労働日数（曜日で決めている人。会社カレンダーで決めている人は null） */
  weeklyDays: number | null;
  /** 1週間の所定労働時間（わからなければ null） */
  weeklyHours: number | null;
  /** 1年間の所定労働日数（会社カレンダーで決めている人に使う。わからなければ null） */
  annualDays: number | null;
}

/** 従業員の設定から、週・1年の所定労働日数と1週間の所定労働時間を出す */
export const workScaleOf = (
  staff: { calendar_pattern_id?: unknown; work_days?: string | null; scheduled_work_hours?: unknown },
  annualDays: number | null,
): WorkScale => {
  const hours = Number(staff.scheduled_work_hours) || 0;
  if (Number(staff.calendar_pattern_id ?? 1) === 0) {
    const weeklyDays = Object.values(parseWorkDays(staff.work_days)).filter(Boolean).length;
    return { weeklyDays, weeklyHours: hours > 0 ? weeklyDays * hours : null, annualDays };
  }
  // 会社カレンダーで決めている人：1週間あたりの平均（1年間の所定労働日数 ÷ 52週）
  return { weeklyDays: null, weeklyHours: hours > 0 && annualDays ? (annualDays / 52) * hours : null, annualDays };
};

/** 継続勤務期間の段（0：6か月、1：1年6か月、…、6：6年6か月以上）の付与日数 */
export const grantDaysFor = (stage: number, scale: WorkScale): { days: number; proportional: boolean } => {
  const i = Math.min(Math.max(0, stage), NORMAL_GRANT_DAYS.length - 1);
  const normal = { days: NORMAL_GRANT_DAYS[i], proportional: false };
  if (scale.weeklyHours !== null && scale.weeklyHours >= PROPORTIONAL_WEEKLY_HOURS_LIMIT) return normal;
  if (scale.weeklyDays !== null) {
    if (scale.weeklyDays > PROPORTIONAL_MAX_WEEKLY_DAYS) return normal;
    const row = PROPORTIONAL_GRANT_DAYS.find((r) => r.weeklyDays === scale.weeklyDays);
    return { days: row ? row.days[i] : 0, proportional: true };
  }
  if (scale.annualDays !== null) {
    if (scale.annualDays > PROPORTIONAL_MAX_ANNUAL_DAYS) return normal;
    const row = PROPORTIONAL_GRANT_DAYS.find((r) => scale.annualDays! >= r.annualDaysFrom && scale.annualDays! <= r.annualDaysTo);
    return { days: row ? row.days[i] : 0, proportional: true };
  }
  return normal;
};

/** 「6か月」「1年6か月」…「6年6か月以上」 */
export const stageLabel = (stage: number): string => {
  const i = Math.min(Math.max(0, stage), NORMAL_GRANT_DAYS.length - 1);
  return i === 0 ? "6か月" : `${i}年6か月${i === NORMAL_GRANT_DAYS.length - 1 ? "以上" : ""}`;
};

// ── 付与の予定 ────────────────────────────────────────────

export interface PlannedGrant {
  /** 付与日 */
  date: string;
  /** 継続勤務期間の段（0：6か月、1：1年6か月、…） */
  stage: number;
  /** 法定の基準日（入社6か月後・その後1年ごと） */
  legalDate: string;
  /** 出勤率を見る期間（はじめは雇入れの日から、その後は前の付与日から。付与日の前の日まで） */
  periodFrom: string;
  periodTo: string;
  /** 前倒しで短くなった期間（8割の出勤率では、全部出勤したものとみなす。前倒ししていなければ null） */
  deemedFrom: string | null;
  deemedTo: string | null;
}

/** 統一日（月日）の、date より後で最初の日 */
const nextUnified = (rule: { month: number; day: number }, date: string): string => {
  const y = Number(date.slice(0, 4));
  const same = dateInYear(y, rule.month, rule.day);
  return same > date ? same : dateInYear(y + 1, rule.month, rule.day);
};

/**
 * 付与の予定（until までの付与と、その次の1回）
 * @param joinDate 雇入れの日（入社日）
 * @param retirementDate 退職日（その日より後の付与は出さない）
 */
export const plannedGrants = (joinDate: string, rule: AnnualLeaveRule, until: string, retirementDate?: string | null): PlannedGrant[] => {
  if (!joinDate || !dayjs(joinDate).isValid()) return [];
  const legal0 = afterMonths(joinDate, FIRST_GRANT_MONTHS);
  const legalOf = (stage: number) => (stage === 0 ? legal0 : afterMonths(legal0, 12 * stage));
  const dates: string[] = [];
  if (rule.mode === "hire") {
    for (let k = 0; k < 80; k++) {
      const d = legalOf(k);
      dates.push(d);
      if (d > until) break;
    }
  } else {
    const first = rule.first === "unifiedFirst" ? [nextUnified(rule, joinDate), legal0].sort()[0] : legal0;
    dates.push(first);
    let d = nextUnified(rule, first);
    for (let k = 1; k < 80 && dates[dates.length - 1] <= until; k++) {
      dates.push(d);
      d = dateInYear(Number(d.slice(0, 4)) + 1, rule.month, rule.day);
    }
  }
  const result: PlannedGrant[] = [];
  for (let k = 0; k < dates.length; k++) {
    const date = dates[k];
    if (retirementDate && date > retirementDate) break;
    const legalDate = legalOf(k);
    const advanced = date < legalDate;
    result.push({
      date,
      stage: k,
      legalDate,
      periodFrom: k === 0 ? joinDate : dates[k - 1],
      periodTo: dayBefore(date),
      deemedFrom: advanced ? date : null,
      deemedTo: advanced ? dayBefore(legalDate) : null,
    });
    if (date > until) break;
  }
  return result;
};

// ── 出勤率 ─────────────────────────────────────────────

/** 出勤率を数えるのに使う、確定した勤怠の行 */
export interface AttendanceForRate {
  work_date: string;
  work_type?: string | null;
  work_hours?: number | string | null;
  paid_leave_hours?: number | string | null;
  special_leave_hours?: number | string | null;
}

export interface AttendanceRate {
  /** 全労働日（所定労働日。公休にした日・全労働日から除くその他の休職の日を除き、前倒しで出勤したものとみなす日を含む） */
  allDays: number;
  /** 出勤した日（年休・特別休暇・産休・育休・介護休業・業務上の負傷や疾病による休業・前倒しでみなす日を含む） */
  presentDays: number;
  /** Q に確定した勤怠がない所定労働日 */
  missingDays: number;
  /** 前倒しで出勤したものとみなした日 */
  deemedDays: number;
  /** 休業（産休・育休・介護休業・業務上の負傷や疾病による休業）で、出勤したものとみなした所定労働日 */
  leaveDays: number;
  /** その他の休職の所定労働日（全労働日から除いた日か、欠勤と同じに数えた日） */
  otherLeaveDays: number;
  /** その他の休職の日の数え方（会社の決まり） */
  otherLeaveRule: OtherLeaveRateRule;
  /** 出勤率（全労働日がなければ null） */
  rate: number | null;
  /** 8割以上か（勤怠がない日があれば、確かめられないので null） */
  ok: boolean | null;
}

const PRESENT_TYPES = new Set(["normal", "paid_full", "paid_half", "special", "special_half", "holiday_work", "statutory_holiday"]);

/** 出勤率（全労働日の8割以上か。労働基準法39条1項・10項） */
export const attendanceRateFor = (
  from: string,
  to: string,
  ctx: CalendarContext,
  rows: AttendanceForRate[],
  leavePeriods: LeavePeriod[],
  deemed: { from: string; to: string } | null = null,
  otherLeave: OtherLeaveRateRule = "exclude",
): AttendanceRate => {
  const byDate = new Map(rows.map((r) => [r.work_date, r]));
  let allDays = 0;
  let presentDays = 0;
  let missingDays = 0;
  let deemedDays = 0;
  let leaveDays = 0;
  let otherLeaveDays = 0;
  const each = (a: string, b: string, fn: (date: string) => void) => {
    for (let d = dayjs(a); !d.isAfter(dayjs(b)); d = d.add(1, "day")) fn(fmt(d));
  };
  if (from && to && from <= to) {
    each(from, to, (date) => {
      if (!isPrescribedWorkDay(new Date(`${date}T00:00:00`), ctx)) return; // 所定労働日でない日は数えない
      const row = byDate.get(date);
      const leave = leaveOn(leavePeriods, date);
      if (leave && DEEMED_PRESENT_LEAVE_TYPES.has(leave.type)) {
        // 産前産後休業・育児休業・介護休業・業務上の負傷や疾病による休業は、出勤したものとみなす（労働基準法39条10項）
        allDays++; presentDays++; leaveDays++; return;
      }
      if (leave && !(row && (Number(row.work_hours) || 0) > 0)) {
        // その他の休職（働いた日を除く）：会社の決まりで、全労働日から除くか、欠勤と同じに数える
        otherLeaveDays++;
        if (otherLeave === "absent") allDays++;
        return;
      }
      if (!row) { missingDays++; return; }
      const type = row.work_type || "normal";
      if (type === "holiday") return; // 公休にした日は全労働日に入れない
      allDays++;
      if (type === "absent") return;
      const worked = (Number(row.work_hours) || 0) > 0 || (Number(row.paid_leave_hours) || 0) > 0 || (Number(row.special_leave_hours) || 0) > 0;
      if (type === "normal" ? worked : PRESENT_TYPES.has(type)) presentDays++;
    });
  }
  if (deemed && deemed.from <= deemed.to) {
    each(deemed.from, deemed.to, (date) => {
      if (!isPrescribedWorkDay(new Date(`${date}T00:00:00`), ctx)) return;
      allDays++;
      presentDays++;
      deemedDays++;
    });
  }
  const rate = allDays > 0 ? presentDays / allDays : null;
  return {
    allDays, presentDays, missingDays, deemedDays, leaveDays, otherLeaveDays, otherLeaveRule: otherLeave, rate,
    ok: missingDays > 0 ? null : rate === null ? true : rate >= ATTENDANCE_RATE_REQUIRED - 1e-9,
  };
};

// ── まだ登録していない付与 ─────────────────────────────────────

/** 登録した付与を、予定の付与と結びつけるときの、日のずれの上限（日。少し早く・遅く登録した付与も、同じ付与とみなす） */
const MATCH_DAYS = 183;

/**
 * 付与日が来て、まだ登録していない付与
 * ・登録した年次有給休暇の付与は、いちばん近い予定の付与（前後6か月まで）と結びつけ、その予定は登録ずみとする
 * ・付与が1つもない人は、有効期限（2年）が残っている付与を出す
 * ・付与がある人は、いちばん新しい付与より後の付与だけを出す（前の付与の日が会社の決まりと違っても、知らせが出つづけないように）
 */
export const dueAnnualGrants = (planned: PlannedGrant[], grants: LeaveGrantRow[], today: string): PlannedGrant[] => {
  const annual = grants.filter(isAnnualLeaveGrant).map((g) => g.grant_date).sort();
  const matched = new Set<string>();
  for (const date of annual) {
    let best: PlannedGrant | null = null;
    let bestDiff = Infinity;
    for (const p of planned) {
      if (matched.has(p.date)) continue;
      const diff = Math.abs(dayjs(p.date).diff(dayjs(date), "day"));
      if (diff <= MATCH_DAYS && diff < bestDiff) { best = p; bestDiff = diff; }
    }
    if (best) matched.add(best.date);
  }
  const last = annual.length > 0 ? annual[annual.length - 1] : null;
  return planned.filter((p) =>
    p.date <= today
    && !matched.has(p.date)
    && (last === null ? afterMonths(p.date, 24) > today : p.date > last));
};

// ── 年5日 ───────────────────────────────────────────────

/** 年5日を数える単位（半休を使う会社は0.5日、使わない会社は1日。時間単位の年休は数えない） */
export const obligationUnit = (halfDayLeave: boolean): number => (halfDayLeave ? 0.5 : 1);

/** value を unit の倍数に切り上げる（小数の計算のずれで、ちょうどの値を1つ上に切り上げないように、少し丸めてから） */
const ceilTo = (value: number, unit: number) => Math.ceil(Math.round((value / unit) * 1e6) / 1e6) * unit;

/** 取った日のうち、年5日に数える日数（全休1日・半休0.5日。前の記録の0.3日のような半端は、半日に満たない分を数えない） */
const obligationDaysOf = (t: LeaveTaken) => Math.floor(Math.max(0, Number(t.days) || 0) * 2 + 1e-9) / 2;

/**
 * 期間の月数（ジョブカンの「ダブルトラック」と同じ数え方）
 * from から、まるまる何か月たつか（months）と、余りの日（extraDays）。余りの日は、その次の1か月の日数で割って月にする
 * 例：2025-10-15〜2027-03-31 は 17か月と17日（2027-03-15〜03-31）で、17 + 17 ÷ 31 = 17.55か月
 */
export const periodMonths = (from: string, to: string): { months: number; extraDays: number; total: number } => {
  const end = fmt(dayjs(to).add(1, "day"));
  let months = 0;
  while (months < 1200 && afterMonths(from, months + 1) <= end) months++;
  const start = months === 0 ? from : afterMonths(from, months);
  const extraDays = Math.max(0, dayjs(end).diff(dayjs(start), "day"));
  const monthLength = dayjs(afterMonths(from, months + 1)).diff(dayjs(start), "day");
  return { months, extraDays, total: months + (extraDays > 0 && monthLength > 0 ? extraDays / monthLength : 0) };
};

/** 年5日の期間のもとになった付与 */
export interface FiveDayGrant {
  date: string;
  days: number;
}

export interface FiveDayStatus {
  /** 期間のもとになった付与（期間が重なってまとめたときは2つ以上。10日を分けて付与したときは、分けた付与を全部） */
  grants: FiveDayGrant[];
  /** 期間（はじめの基準日から、最後の基準日の1年後の前の日まで） */
  from: string;
  to: string;
  /** 取った日を数えはじめる日（ふつうは from。10日を分けて付与したときは、はじめに分けて付与した日） */
  countFrom: string;
  /** 1年の期間が重なったので、まとめて比例按分した（労働基準法施行規則24条の5第2項） */
  merged: boolean;
  /** 期間の長さ（まるまるの月数・余りの日・余りも月にした月数） */
  months: number;
  extraDays: number;
  monthsTotal: number;
  /** 按分した日数（切り上げる前。まとめていなければ5） */
  exactDays: number;
  /** 会社が半休を使うか（使わないときは、これから取らせる日数を1日単位にする） */
  halfDayLeave: boolean;
  /**
   * 取らせる日数を出す単位（半休を使う会社は0.5日、使わない会社は1日。
   * 使わない会社でも、期間に前に取った半休があれば0.5日（4.5日取った人に「8日まで、あと3日」と出さないように）
   */
  unit: number;
  /** 取らせる日数（按分した日数を unit の単位に切り上げた日数。まとめていなければ5） */
  requiredDays: number;
  /** 期間に取った年休の日数（全休1日・半休0.5日。時間単位は数えない） */
  takenDays: number;
  /**
   * あと何日取らせるか（按分した日数（切り上げる前）に足りない日数を、unit の単位に切り上げる。取れていれば0）
   * 取れたかは、切り上げる前の日数で見る（半休を使わない会社でも、前に取った半休は0.5日で数えるので、7.5日の按分に 4.5日取った人は、あと3日）
   */
  remainingDays: number;
  /** upcoming：基準日の前／ongoing：期間中で足りない／done：取れた／overdue：期間が過ぎて足りない */
  state: "upcoming" | "ongoing" | "done" | "overdue";
}

export interface FiveDayOptions {
  /** 会社が半日単位の有給（半休）を使うか（使わないときは、按分した日数を1日単位に切り上げる） */
  halfDayLeave: boolean;
  /** 付与の予定（10日を分けて付与したときに、同じ付与（法定の段）を分けたものかを見分けるのに使う。入社日がわからなければ空） */
  planned: PlannedGrant[];
}

/** 付与日にいちばん近い付与の予定の段（1年より離れていれば null。同じだけ離れていれば、後の予定） */
const nearestStage = (planned: PlannedGrant[], date: string): number | null => {
  let best: PlannedGrant | null = null;
  let bestDiff = Infinity;
  for (const p of planned) {
    const diff = Math.abs(dayjs(p.date).diff(dayjs(date), "day"));
    if (diff > 366) continue;
    if (diff < bestDiff || (diff === bestDiff && best !== null && p.date > best.date)) {
      best = p;
      bestDiff = diff;
    }
  }
  return best ? best.stage : null;
};

interface ObligationBase {
  /** 基準日（10日以上を付与した日。分けて付与したときは、合わせて10日になった日） */
  date: string;
  /** 取った日を数えはじめる日 */
  countFrom: string;
  grants: FiveDayGrant[];
}

/** 年5日の基準日（10日以上の付与と、10日を分けて付与して合わせて10日になった日） */
const obligationBases = (grants: LeaveGrantRow[], planned: PlannedGrant[]): ObligationBase[] => {
  const annual = grants
    .filter((g) => isAnnualLeaveGrant(g) && (Number(g.days_granted) || 0) > 0)
    .sort((a, b) => a.grant_date.localeCompare(b.grant_date));
  const bases: ObligationBase[] = [];
  const fullStages = new Set<number>();
  const parts = new Map<number, FiveDayGrant[]>();
  for (const g of annual) {
    const grant = { date: g.grant_date, days: Number(g.days_granted) || 0 };
    const stage = nearestStage(planned, g.grant_date);
    if (grant.days >= OBLIGATION_MIN_GRANT_DAYS) {
      bases.push({ date: grant.date, countFrom: grant.date, grants: [grant] });
      if (stage !== null) fullStages.add(stage);
    } else if (stage !== null) {
      parts.set(stage, [...(parts.get(stage) ?? []), grant]);
    }
  }
  // 10日を分けて付与したとき（労働基準法施行規則24条の5第4項）：同じ段の付与を合わせて10日になった日を基準日にし、
  // はじめに分けて付与した日から取った日も数える（基準日より前に本人が取った日の分は、時季を決めて取らせなくてよい）
  for (const [stage, list] of parts) {
    if (fullStages.has(stage)) continue; // 同じ段に10日以上の付与があれば、そちらで数える
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      sum += list[i].days;
      if (sum >= OBLIGATION_MIN_GRANT_DAYS) {
        bases.push({ date: list[i].date, countFrom: list[0].date, grants: list.slice(0, i + 1) });
        break;
      }
    }
  }
  return bases.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * 年5日の取得の確かめ
 * ・10日以上の付与ごとに、付与日（基準日）から1年に5日
 * ・前の期間の中で、また10日以上を付与したとき（付与日をそろえたときなど）は、はじめの基準日から最後の基準日の1年後までを
 *   まとめて、月数 ÷ 12 × 5 日を、半日（半休を使わない会社は1日）単位に切り上げる（労働基準法施行規則24条の5第2項）
 * ・10日を分けて付与したときは、合わせて10日になった日を基準日にし、はじめに分けて付与した日から取った日も数える（同4項）
 */
export const fiveDayStatuses = (grants: LeaveGrantRow[], taken: LeaveTaken[], today: string, options: FiveDayOptions): FiveDayStatus[] => {
  const takeUnit = obligationUnit(options.halfDayLeave);
  const groups: { bases: ObligationBase[]; to: string }[] = [];
  for (const b of obligationBases(grants, options.planned)) {
    const own = expiryAfterMonths(b.date, 12);
    const last = groups[groups.length - 1];
    if (last && b.date <= last.to) {
      // 前の期間の中で、また10日以上を付与した（期間が重なる）→ まとめる
      last.bases.push(b);
      if (own > last.to) last.to = own;
    } else {
      groups.push({ bases: [b], to: own });
    }
  }
  return groups.map(({ bases, to }): FiveDayStatus => {
    const from = bases[0].date;
    const countFrom = bases.reduce((min, b) => (b.countFrom < min ? b.countFrom : min), from);
    const merged = bases.length > 1;
    const { months, extraDays, total } = periodMonths(from, to);
    const exactDays = merged ? (total / 12) * OBLIGATION_DAYS : OBLIGATION_DAYS;
    const takenDays = taken.filter((t) => t.date >= countFrom && t.date <= to).reduce((sum, t) => sum + obligationDaysOf(t), 0);
    const unit = Math.abs(takenDays - Math.round(takenDays)) > 1e-9 ? 0.5 : takeUnit;
    const requiredDays = merged ? ceilTo(exactDays, unit) : OBLIGATION_DAYS;
    const short = Math.max(0, exactDays - takenDays);
    const done = short <= 1e-9;
    return {
      grants: bases.flatMap((b) => b.grants),
      from, to, countFrom, merged, months, extraDays, monthsTotal: total, exactDays,
      halfDayLeave: options.halfDayLeave, unit, requiredDays, takenDays,
      remainingDays: done ? 0 : ceilTo(short, takeUnit),
      state: today < from ? "upcoming" : done ? "done" : today <= to ? "ongoing" : "overdue",
    };
  });
};

const dayCount = (n: number) => `${Math.round(n * 100) / 100}日`;

/** 年5日の日数・数えはじめの説明（まとめて按分したとき・10日を分けて付与したとき。どちらでもなければ空） */
export const describeFiveDay = (f: FiveDayStatus): string[] => {
  const notes: string[] = [];
  if (f.merged) {
    const length = f.extraDays > 0 ? `${f.months}か月と${f.extraDays}日` : `${f.months}か月`;
    const months = f.extraDays > 0 ? `${Math.round(f.monthsTotal * 100) / 100}か月` : `${f.months}`;
    const unitText = f.unit === 1 ? "1日単位（半休を使わないので）" : f.halfDayLeave ? "半日単位" : "半日単位（前に取った半休があるので）";
    const rounded = Math.abs(f.requiredDays - f.exactDays) > 1e-9 ? `を${unitText}に切り上げて ${dayCount(f.requiredDays)}` : "";
    notes.push(`1年の期間が重なったので、${f.from}〜${f.to}（${length}）をまとめて、${months} ÷ 12 × 5 = ${dayCount(f.exactDays)}${rounded}（比例按分。労働基準法施行規則24条の5第2項）`);
  }
  if (f.countFrom < f.from) {
    notes.push(`10日を分けて付与したので、合わせて10日になった ${f.from} から数え、はじめに付与した ${f.countFrom} からの取得も入れています（労働基準法施行規則24条の5第4項）`);
  }
  return notes;
};
