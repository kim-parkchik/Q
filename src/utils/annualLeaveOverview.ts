/**
 * 有給休暇管理の画面に出す、年次有給休暇の付与の知らせ（付与日が来て、まだ登録していない付与）と、年5日の取得（会社全体）を読む
 * 計算は utils/annualLeaveGrant.ts。付与・取った日・前の記録の読み方は、有給休暇管理の画面と同じ（utils/paidLeave.ts）
 */
import dayjs from "dayjs";
import { countPrescribedWorkDays, loadCalendarContext, type CalendarContext } from "./annualWorkDays";
import { parseLeavePeriods } from "./leaveExemption";
import { collectLeaveTaken, loadPaidLeaveData, type LeaveGrantRow, type LeaveTaken } from "./paidLeave";
import {
  afterMonths, attendanceRateFor, dueAnnualGrants, fiveDayStatuses, grantDaysFor, parseAnnualLeaveRule, plannedGrants, workScaleOf,
  type AnnualLeaveRule, type AttendanceForRate, type AttendanceRate, type FiveDayStatus, type PlannedGrant,
} from "./annualLeaveGrant";

interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export interface DueAnnualGrantInfo {
  grant: PlannedGrant;
  days: number;
  proportional: boolean;
  rate: AttendanceRate;
}

export interface StaffAnnualLeave {
  staffId: string;
  name: string;
  /** 付与日が来て、まだ登録していない付与 */
  due: DueAnnualGrantInfo[];
  /** 次の付与（今日より後。入社日が入っていない・退職する人は null） */
  next: { date: string; days: number; proportional: boolean; stage: number; legalDate: string } | null;
  /** 年5日の取得（10日以上の付与ごと。期間が重なるときは、まとめて按分） */
  fiveDays: FiveDayStatus[];
  /** 入社日が入っていないので、付与日を出せない */
  noJoinDate: boolean;
}

/** 会社の、年次有給休暇の付与日の決まりと、半日単位の有給（半休）を使うか（年5日の按分の切り上げに使う） */
export interface AnnualLeaveSettings {
  rule: AnnualLeaveRule;
  halfDayLeave: boolean;
}

/** 会社の行（company）から読む */
export const annualLeaveSettingsOf = (
  company: { annual_leave_rule?: string | null; half_day_leave?: unknown } | null | undefined,
): AnnualLeaveSettings => ({
  rule: parseAnnualLeaveRule(company?.annual_leave_rule),
  halfDayLeave: Number(company?.half_day_leave ?? 1) !== 0,
});

export const loadAnnualLeaveSettings = async (db: SelectDb): Promise<AnnualLeaveSettings> => {
  const rows = await db.select<{ annual_leave_rule?: string | null; half_day_leave?: number | null }[]>(
    "SELECT annual_leave_rule, half_day_leave FROM company WHERE id = 1",
  );
  return annualLeaveSettingsOf(rows?.[0]);
};

/**
 * 1人分の年5日の取得（utils/annualLeaveGrant.ts の fiveDayStatuses）
 * 10日を分けて付与したときに、同じ付与（法定の段）を分けたものかを見分けるため、入社日と会社の付与日の決まりから付与の予定を出して使う
 */
export const fiveDaysOf = (
  staff: { join_date?: string | null; retirement_date?: string | null },
  grants: LeaveGrantRow[],
  taken: LeaveTaken[],
  today: string,
  settings: AnnualLeaveSettings,
): FiveDayStatus[] => {
  const until = grants.reduce((max, g) => (g.grant_date > max ? g.grant_date : max), today);
  const planned = staff.join_date ? plannedGrants(staff.join_date, settings.rule, until, staff.retirement_date || null) : [];
  return fiveDayStatuses(grants, taken, today, { halfDayLeave: settings.halfDayLeave, planned });
};

const dayBefore = (date: string) => dayjs(date).subtract(1, "day").format("YYYY-MM-DD");

/** 付与日から1年の所定労働日数（会社カレンダーで決めている人の比例付与に使う） */
const annualDaysFrom = (ctx: CalendarContext, date: string) => countPrescribedWorkDays(ctx, date, dayBefore(afterMonths(date, 12)));

/** 1人分の、付与の知らせ・次の付与・年5日 */
export const loadStaffAnnualLeave = async (db: SelectDb, staff: any, settings: AnnualLeaveSettings, today: string): Promise<StaffAnnualLeave> => {
  const data = await loadPaidLeaveData(db, staff.id);
  const { taken } = collectLeaveTaken(data.attendance, data.manual);
  const fiveDays = fiveDaysOf(staff, data.grants, taken, today, settings);
  const base = { staffId: String(staff.id), name: String(staff.name ?? ""), fiveDays };
  if (!staff.join_date) return { ...base, due: [], next: null, noJoinDate: true };

  const planned = plannedGrants(staff.join_date, settings.rule, today, staff.retirement_date || null);
  const due = dueAnnualGrants(planned, data.grants, today);
  const nextPlan = planned.find((p) => p.date > today) ?? null;
  const ctx = await loadCalendarContext(db, staff);
  const scaleFor = (date: string) => workScaleOf(staff, Number(staff.calendar_pattern_id ?? 1) === 0 ? null : annualDaysFrom(ctx, date));

  let rows: AttendanceForRate[] = [];
  if (due.length > 0) {
    const from = due.reduce((min, d) => (d.periodFrom < min ? d.periodFrom : min), due[0].periodFrom);
    const to = due.reduce((max, d) => (d.periodTo > max ? d.periodTo : max), due[0].periodTo);
    rows = (await db.select<AttendanceForRate[]>(
      `SELECT work_date, work_type, work_hours, paid_leave_hours, special_leave_hours FROM attendance
       WHERE staff_id = ? AND is_finalized = 1 AND work_date BETWEEN ? AND ?`,
      [staff.id, from, to],
    )) ?? [];
  }
  const leavePeriods = parseLeavePeriods(staff.leave_periods);
  const dueInfo = due.map((grant): DueAnnualGrantInfo => {
    const { days, proportional } = grantDaysFor(grant.stage, scaleFor(grant.date));
    const deemed = grant.deemedFrom && grant.deemedTo ? { from: grant.deemedFrom, to: grant.deemedTo } : null;
    return { grant, days, proportional, rate: attendanceRateFor(grant.periodFrom, grant.periodTo, ctx, rows, leavePeriods, deemed) };
  });
  const next = nextPlan
    ? { date: nextPlan.date, stage: nextPlan.stage, legalDate: nextPlan.legalDate, ...grantDaysFor(nextPlan.stage, scaleFor(nextPlan.date)) }
    : null;
  return { ...base, due: dueInfo, next, noJoinDate: false };
};

/** 在籍している人（退職日が今日より前の人と、退職の状態で退職日がない人を除く） */
export const isActiveStaff = (s: any, today: string): boolean =>
  s.retirement_date ? s.retirement_date >= today : s.status !== "retired";

/** 会社全体の、付与の知らせと年5日 */
export const loadAnnualLeaveOverview = async (db: SelectDb, staffList: any[], today: string) => {
  const settings = await loadAnnualLeaveSettings(db);
  const staff: StaffAnnualLeave[] = [];
  for (const s of staffList.filter((x) => isActiveStaff(x, today))) {
    staff.push(await loadStaffAnnualLeave(db, s, settings, today));
  }
  return { rule: settings.rule, staff };
};

/** 年5日で、いま知らせる期間（期間中で足りない・期間が過ぎて1年以内で足りなかった） */
export const fiveDayAlerts = (statuses: FiveDayStatus[], today: string): FiveDayStatus[] =>
  statuses.filter((s) => s.state === "ongoing" || (s.state === "overdue" && afterMonths(s.to, 12) > today));
