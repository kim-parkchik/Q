/**
 * 1年間の所定労働日数（月給を時間あたりにするときの「1年間における1月平均所定労働時間」の元になる）
 * ・カレンダーパターン 0（曜日で決める）：出勤する曜日の日数
 * ・それ以外：土日と祝日を休みとし、会社カレンダーで休み（1）・出勤（0）に変えた日を反映する
 */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** 従業員の work_days（"mon,tue,..."）を曜日ごとの出勤するかにする */
export const parseWorkDays = (workDays: string | null | undefined): Record<string, boolean> => {
  const days = new Set((workDays || "").split(",").filter(Boolean));
  return Object.fromEntries(DAY_KEYS.map((k) => [k, days.has(k)]));
};

/** 所定労働日を決めるのに使う、従業員のカレンダー（パターン・出勤する曜日・祝日・会社カレンダー） */
export interface CalendarContext {
  patternId: number;
  workDays: Record<string, boolean>;
  /** 祝日（YYYY-MM-DD） */
  holidays: Set<string>;
  /** 会社カレンダーの日ごとの設定（1: 休み / 0: 出勤） */
  companyCalendar: Record<string, number>;
}

const keyOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** その日が所定労働日か */
export const isPrescribedWorkDay = (date: Date, ctx: CalendarContext): boolean => {
  if (ctx.patternId === 0) return !!ctx.workDays[DAY_KEYS[date.getDay()]];
  const key = keyOf(date);
  const isDefaultHoliday = date.getDay() === 0 || date.getDay() === 6 || ctx.holidays.has(key);
  const setting = ctx.companyCalendar[key];
  return !((isDefaultHoliday && setting !== 0) || setting === 1);
};

/** from から to まで（両端を含む。YYYY-MM-DD）の所定労働日数 */
export const countPrescribedWorkDays = (ctx: CalendarContext, from: string, to: string): number => {
  if (!from || !to || from > to) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const date = new Date(fy, fm - 1, fd);
  let count = 0;
  while (keyOf(date) <= to) {
    if (isPrescribedWorkDay(date, ctx)) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
};

/**
 * @param holidays        祝日（YYYY-MM-DD）
 * @param companyCalendar 会社カレンダーの日ごとの設定（1: 休み / 0: 出勤）
 */
export const countAnnualWorkDays = (
  year: number,
  patternId: number,
  workDays: Record<string, boolean>,
  holidays: Set<string>,
  companyCalendar: Record<string, number>,
): number => countPrescribedWorkDays({ patternId, workDays, holidays, companyCalendar }, `${year}-01-01`, `${year}-12-31`);

/** loadAnnualWorkDays に要るDB操作（tauri-plugin-sql の Database と互換） */
interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/** 従業員のカレンダー（祝日と会社カレンダー）をDBから読む */
export const loadCalendarContext = async (
  db: SelectDb,
  staff: { calendar_pattern_id?: unknown; work_days?: string | null },
): Promise<CalendarContext> => {
  const patternId = Number(staff.calendar_pattern_id ?? 1);
  let holidays = new Set<string>();
  const companyCalendar: Record<string, number> = {};
  if (patternId !== 0) {
    const resHolidays = await db.select<{ holiday_date: string }[]>("SELECT holiday_date FROM holiday_master");
    holidays = new Set(resHolidays.map((h) => h.holiday_date.replace(/\//g, "-")));
    const resCompany = await db.select<{ work_date: string; is_holiday: number }[]>(
      "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
      [patternId],
    );
    resCompany.forEach((c) => { companyCalendar[c.work_date] = Number(c.is_holiday); });
  }
  return { patternId, workDays: parseWorkDays(staff.work_days), holidays, companyCalendar };
};

/**
 * 従業員の1年間の所定労働日数を、祝日と会社カレンダーをDBから読んで数える
 * （給与明細の残業代の時給・最低賃金のチェックと、勤怠画面の概算で同じ数え方にする）
 */
export const loadAnnualWorkDays = async (
  db: SelectDb,
  staff: { calendar_pattern_id?: unknown; work_days?: string | null },
  year: number,
): Promise<number> => countPrescribedWorkDays(await loadCalendarContext(db, staff), `${year}-01-01`, `${year}-12-31`);
