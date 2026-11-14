/**
 * 平均賃金を、会社ファイルの確定した給与・勤怠から読んで計算する（計算の決まりは utils/averageWage.ts）
 * ・loadAverageWage：1人の、ある日のできごとの平均賃金（手で入れた額があれば、その額）
 * ・loadAverageWagePay：給与明細に入れる、会社都合で休ませた日の休業手当・労災の待期の休業補償の材料
 * ・手で入れた平均賃金（average_wage_overrides）：Q で計算できないとき（入社して間もない・3か月がすべて休業など）や、
 *   都道府県労働局長・労働基準監督署が決めた額を使うとき
 */
import dayjs from 'dayjs';
import { isPrescribedWorkDay, loadCalendarContext, type CalendarContext } from './annualWorkDays';
import {
  averageWagePeriods, calcAverageWage, shutdownDatesOf, shutdownEventDates, SHUTDOWN_WORK_TYPE, toShutdownRate, waitingDatesIn,
  type AverageWageAttendance, type AverageWagePay, type AverageWageResult,
} from './averageWage';

interface Db {
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
  execute?: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** 平均賃金に使う従業員の項目 */
export interface AverageWageStaff {
  id: string | number;
  payroll_group_id?: unknown;
  join_date?: string | null;
  probation_end?: string | null;
  wage_type?: string | null;
  leave_periods?: unknown;
  calendar_pattern_id?: unknown;
  work_days?: string | null;
}

const ymIndex = (year: number, month: number) => year * 12 + month;

/** 給与規定グループの締日・翌月払いか・休業手当の率 */
const loadGroup = async (db: Db, staff: AverageWageStaff) => {
  const rows = (await db.select(
    'SELECT closing_day, is_next_month, shutdown_allowance_rate FROM payroll_groups WHERE id = ?',
    [Number(staff.payroll_group_id) || 1],
  )) as { closing_day?: number; is_next_month?: number; shutdown_allowance_rate?: number | null }[];
  const g = rows?.[0];
  return {
    closingDay: Number(g?.closing_day) || 99,
    isNextMonth: Number(g?.is_next_month) === 1,
    shutdownRate: toShutdownRate(g?.shutdown_allowance_rate),
  };
};

/** 手で入れた平均賃金（なければ null） */
export const loadAverageWageOverride = async (db: Db, staffId: string | number, eventDate: string) => {
  const rows = (await db.select(
    'SELECT amount_sen, note, created_at FROM average_wage_overrides WHERE staff_id = ? AND event_date = ?',
    [String(staffId), eventDate],
  )) as { amount_sen: number; note: string | null; created_at: string | null }[];
  const r = rows?.[0];
  return r ? { amountSen: Number(r.amount_sen) || 0, note: String(r.note ?? ''), createdAt: String(r.created_at ?? '') } : null;
};

/** 平均賃金を手で入れる（同じ従業員・できごとの日なら入れ替える） */
export const saveAverageWageOverride = async (db: Db, staffId: string | number, eventDate: string, amountSen: number, note: string) => {
  if (!db.execute) throw new Error('保存できません');
  await db.execute(
    `INSERT INTO average_wage_overrides (staff_id, event_date, amount_sen, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(staff_id, event_date) DO UPDATE SET amount_sen = excluded.amount_sen, note = excluded.note, created_at = DATETIME('now', 'localtime')`,
    [String(staffId), eventDate, Math.max(0, Math.round(amountSen)), note],
  );
};

/** 手で入れた平均賃金を消す（Q の計算に戻す） */
export const deleteAverageWageOverride = async (db: Db, staffId: string | number, eventDate: string) => {
  if (!db.execute) throw new Error('消せません');
  await db.execute('DELETE FROM average_wage_overrides WHERE staff_id = ? AND event_date = ?', [String(staffId), eventDate]);
};

/**
 * 1人の、ある日のできごとの平均賃金（確定した給与・勤怠から計算する。手で入れた額があれば、その額にする）
 * @param eventDate できごとの日（休業の初めの日・事故の日・解雇を伝えた日など）
 */
export const loadAverageWage = async (db: Db, staff: AverageWageStaff, eventDate: string): Promise<AverageWageResult> => {
  const group = await loadGroup(db, staff);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && dayjs(eventDate).isValid() && dayjs(eventDate).format('YYYY-MM-DD') === eventDate;
  let salaries: { target_year: number; target_month: number; ledger: string | null; total_earnings: number; leave_paid_days: number | null }[] = [];
  let attendance: AverageWageAttendance[] = [];
  if (valid) {
    const periods = averageWagePeriods(eventDate, group.closingDay, group.isNextMonth);
    salaries = ((await db.select(
      `SELECT target_year, target_month, ledger, total_earnings, leave_paid_days FROM salary_results
       WHERE staff_id = ? AND (target_year * 12 + target_month) BETWEEN ? AND ?`,
      [String(staff.id), ymIndex(periods[0].payYear, periods[0].payMonth), ymIndex(periods[2].payYear, periods[2].payMonth)],
    )) as typeof salaries) ?? [];
    attendance = ((await db.select(
      'SELECT work_date, work_type, work_hours FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ? AND is_finalized = 1',
      [String(staff.id), periods[0].start, periods[2].end],
    )) as AverageWageAttendance[]) ?? [];
  }
  const result = calcAverageWage({
    eventDate,
    staff,
    closingDay: group.closingDay,
    isNextMonth: group.isNextMonth,
    salaries: salaries.map((s) => ({
      payYear: Number(s.target_year), payMonth: Number(s.target_month), ledger: s.ledger ?? null,
      totalEarnings: Number(s.total_earnings) || 0, leavePaidDays: s.leave_paid_days === null || s.leave_paid_days === undefined ? null : Number(s.leave_paid_days),
    })),
    attendance,
  });
  const manual = valid ? await loadAverageWageOverride(db, staff.id, eventDate) : null;
  return manual ? { ...result, amountSen: manual.amountSen, error: null, manual: { amountSen: manual.amountSen, note: manual.note } } : result;
};

/**
 * 給与明細に入れる、平均賃金を使う支給の材料（会社都合で休ませた日の休業手当・労災の待期の休業補償）。どちらの日もなければ null
 * @param rows 計算期間の勤怠（給与の計算に使うもの）
 * @param ctx  会社カレンダー（休業が続いているかを決める。なければ読む）
 */
export const loadAverageWagePay = async (
  db: Db,
  staff: AverageWageStaff,
  period: { start: string; end: string },
  rows: AverageWageAttendance[],
  ctx: CalendarContext | null = null,
): Promise<AverageWagePay | null> => {
  const shutdownDates = shutdownDatesOf(rows, period);
  const waiting = waitingDatesIn(staff, period);
  if (shutdownDates.length === 0 && waiting.length === 0) return null;
  const group = await loadGroup(db, staff);

  // 会社都合の休業：前の計算期間から続いている休業の初めの日を知るため、1年前からの休業の日も読む
  let shutdownEvents: Record<string, string> = {};
  if (shutdownDates.length > 0) {
    const before = ((await db.select(
      'SELECT work_date FROM attendance WHERE staff_id = ? AND work_type = ? AND work_date >= ? AND work_date < ?',
      [String(staff.id), SHUTDOWN_WORK_TYPE, dayjs(period.start).subtract(1, 'year').format('YYYY-MM-DD'), period.start],
    )) as { work_date: string }[]) ?? [];
    const calendar = ctx ?? await loadCalendarContext(db as Parameters<typeof loadCalendarContext>[0], staff);
    const isWorkDay = (date: string) => isPrescribedWorkDay(new Date(`${date}T00:00:00`), calendar);
    const events = shutdownEventDates([...before.map((r) => String(r.work_date)), ...shutdownDates], isWorkDay);
    shutdownEvents = Object.fromEntries(shutdownDates.map((d) => [d, events[d] ?? d]));
  }
  const waitingEvents = Object.fromEntries(waiting.map((w) => [w.date, w.eventDate]));

  const wages: AverageWagePay['wages'] = {};
  for (const ev of [...new Set([...Object.values(shutdownEvents), ...Object.values(waitingEvents)])].sort()) {
    const r = await loadAverageWage(db, staff, ev);
    wages[ev] = { amountSen: r.amountSen, error: r.error, manual: !!r.manual };
  }
  return { shutdownRate: group.shutdownRate, shutdownEvents, waitingEvents, wages };
};
