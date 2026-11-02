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
): number => {
  let count = 0;
  const date = new Date(year, 0, 1);
  while (date.getFullYear() === year) {
    const key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (patternId === 0) {
      if (workDays[DAY_KEYS[date.getDay()]]) count++;
    } else {
      const isDefaultHoliday = date.getDay() === 0 || date.getDay() === 6 || holidays.has(key);
      const setting = companyCalendar[key];
      const isHoliday = (isDefaultHoliday && setting !== 0) || setting === 1;
      if (!isHoliday) count++;
    }
    date.setDate(date.getDate() + 1);
  }
  return count;
};

/** loadAnnualWorkDays に要るDB操作（tauri-plugin-sql の Database と互換） */
interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/**
 * 従業員の1年間の所定労働日数を、祝日と会社カレンダーをDBから読んで数える
 * （給与明細の残業代の時給・最低賃金のチェックと、勤怠画面の概算で同じ数え方にする）
 */
export const loadAnnualWorkDays = async (
  db: SelectDb,
  staff: { calendar_pattern_id?: unknown; work_days?: string | null },
  year: number,
): Promise<number> => {
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
  return countAnnualWorkDays(year, patternId, parseWorkDays(staff.work_days), holidays, companyCalendar);
};
