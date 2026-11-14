/**
 * 平均賃金（労働基準法12条）と、それを使う額（休業手当・休業補償・解雇予告手当）
 *
 * ■ 平均賃金：できごとの日（算定事由の発生した日）の前の3か月に払った賃金の総額 ÷ その3か月の暦日数（1銭未満切り捨て）
 *   ・3か月は、直前の賃金締切日から数える（12条2項）。できごとの日は入れず、できごとの日が締日なら、その前の締日から
 *   ・入社して3か月たたない人は、入社した日から数える（12条6項）。直前の締日までが、ひとつの賃金計算期間に満たないときは、
 *     できごとの日の前日まで（まだ確定していない給与を使うので、Q では計算せず、手で入れてもらう）
 *   ・最低保障（12条1項ただし書）：日・時間・出来高で決まる賃金は「その総額 ÷ 働いた日数 × 60%」、月・週など一定の期間で
 *     決まる賃金は「その総額 ÷ 暦日数」とし、足した額が上の額より高ければ、それを平均賃金にする
 *   ・除く期間（12条3項）：業務上の負傷・疾病の療養のための休業・産前産後休業・会社の都合（使用者の責めに帰すべき事由）による
 *     休業・育児休業・介護休業・試用期間は、その日数と、その期間の賃金を除く。私傷病の休職などの「その他の休職」は除かない
 *     （3か月がすべて除く期間なら、都道府県労働局長が決める（労働基準法施行規則4条）ので、手で入れてもらう）
 *   ・入れない賃金（12条4項）：臨時に払った賃金（結婚手当・私傷病手当・見舞金・退職金など）と、3か月を超える期間ごとに払う
 *     賃金（賞与など）。Q は賞与を入れない。給与項目は、給与項目設定の「平均賃金での扱い」で決める
 *   ・まだ払っていなくても、その期間の分の賃金は入れる（Q は、その期間の確定した給与を使う）。通勤手当・残業代・年休の賃金も入れる
 *   ・試用期間の中にできごとがあったときは、試用期間を除かない（労働基準法施行規則3条）
 *   出典：神奈川労働局「平均賃金について」https://jsite.mhlw.go.jp/kanagawa-roudoukyoku/hourei_seido_tetsuzuki/saiteichingin_chinginseido/heikinchi.html
 *         愛知労働局「平均賃金」https://aichi-elcc.mhlw.go.jp/?p=4540 （どちらも 2026-11-14 に確認）
 * ■ 平均賃金を使う額（1円未満は四捨五入。神奈川労働局の計算例と同じ）
 *   ・休業手当（26条）：会社の都合で休ませた日に、平均賃金の60%以上（給与規定グループで率を決める）。できごとの日は休業の日
 *     （続けて休ませたときは、その初めの日）。その日に少し働いたときは、働いた分の賃金との差額を払う
 *   ・休業補償（76条）：業務上の負傷・疾病で休業した最初の3日（労災保険の休業補償給付が出ない待期期間。休日も数える）に、
 *     会社が平均賃金の60%を払う。できごとの日は事故の日（病気は診断で決まった日。労働基準法施行規則48条）。
 *     賃金ではないので、所得税・社会保険料・雇用保険料はかからない
 *   ・解雇予告手当（20条）：30日前に予告しないで解雇するときに、足りない日数分の平均賃金。できごとの日は解雇を伝えた日。
 *     予告の日数は、伝えた日の翌日から解雇の日まで（例：8月31日に解雇するなら、8月1日までに伝える）
 */
import dayjs from 'dayjs';
import { getPayrollPeriod } from './payrollPeriod';
import { parseLeavePeriods, type LeavePeriod, type LeaveType } from './leaveExemption';
import { leaveOn, LEAVE_TYPE_NAMES } from './leaveOfAbsence';
import { parseLedger, type LedgerLine, type PayLedger } from './legalBooks';

/**
 * 平均賃金での賃金の分け方（労働基準法12条1項）
 * month：月・週など一定の期間で決まる賃金（月給・月額の手当・固定残業代・月額の通勤手当）
 * time：日・時間・出来高で決まる賃金（日給・時給・残業代・深夜手当・年休の賃金・歩合）
 * none：入れない（臨時の賃金・3か月を超える期間ごとの賃金・賃金でないもの・除く期間の賃金（休業手当））
 */
export type AverageWageKind = 'month' | 'time' | 'none';

export const AVERAGE_WAGE_KIND_LABELS: Record<AverageWageKind, string> = {
  month: '月で決まる賃金（月給・月額の手当など）',
  time: '日・時間・出来高で決まる賃金（歩合・その月の実績で決まる手当など）',
  none: '入れない（臨時の賃金・3か月を超える期間ごとの賃金・賃金でないもの）',
};

/** 給与項目の「平均賃金での扱い」（設定がなければ、固定の項目は月で決まる賃金、変動の項目は日・時間・出来高で決まる賃金） */
export const toAverageWageKind = (value: unknown, category?: string | null): AverageWageKind =>
  value === 'month' || value === 'time' || value === 'none' ? value : category === 'fixed' ? 'month' : 'time';

/** 休業手当の率の初めの値と最低（平均賃金の100分の60以上。労働基準法26条） */
export const SHUTDOWN_ALLOWANCE_MIN_RATE = 60;
/** 休業補償の率（平均賃金の100分の60。労働基準法76条） */
export const INJURY_COMPENSATION_RATE = 60;
/** 労災保険の休業補償給付が出ない待期期間（休業の最初の3日。労働者災害補償保険法14条） */
export const INJURY_WAITING_DAYS = 3;
/** 解雇の予告の日数（30日前。労働基準法20条） */
export const DISMISSAL_NOTICE_DAYS = 30;

/** 休業手当の率（%）。60未満・入っていないときは60 */
export const toShutdownRate = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= SHUTDOWN_ALLOWANCE_MIN_RATE ? Math.min(100, n) : SHUTDOWN_ALLOWANCE_MIN_RATE;
};

/** 平均賃金の日数・賃金から除く休業（労働基準法12条3項1号・2号・4号）。その他の休職は除かない */
export const EXCLUDED_LEAVE_TYPES: ReadonlySet<LeaveType> = new Set<LeaveType>(['injury', 'maternity', 'childcare', 'family_care']);

/** 勤怠の区分「休業（会社都合）」（会社の都合で休ませた日。休業手当を払う。労働基準法26条） */
export const SHUTDOWN_WORK_TYPE = 'company_leave';

const fmt = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');
/** 期間の暦日数（両端を含む） */
const daysOf = (from: string, to: string) => dayjs(to).diff(dayjs(from), 'day') + 1;
const eachDate = (from: string, to: string, fn: (date: string) => void) => {
  for (let d = dayjs(from); !d.isAfter(dayjs(to), 'day'); d = d.add(1, 'day')) fn(fmt(d));
};
/** 「11月10日」 */
export const mdJa = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
/** 「2026年11月10日」 */
export const ymdJa = (ymd: string) => `${Number(ymd.slice(0, 4))}年${mdJa(ymd)}`;

/** 銭の単位の額を「9,173円80銭」と書く */
export const formatSen = (sen: number): string => {
  const yen = Math.floor(sen / 100);
  return `${yen.toLocaleString()}円${String(sen % 100).padStart(2, '0')}銭`;
};

/** 1円未満を四捨五入する（計算の途中の誤差で 0.5 がわずかに足りなくならないように） */
export const roundYen = (yen: number): number => Math.floor(yen + 0.5 + 1e-7);

// ── 3か月（算定期間） ─────────────────────────────────────

/** 締日（1〜28・99：末日）が、その年月の何日か */
const closingOf = (year: number, month0: number, closingDay: number): dayjs.Dayjs => {
  const base = dayjs(new Date(year, month0, 1));
  return closingDay === 99 || closingDay <= 0 ? base.endOf('month').startOf('day') : base.date(Math.min(closingDay, base.daysInMonth()));
};

/** できごとの日の直前の締日（できごとの日が締日なら、その前の締日。労働基準法12条2項） */
export const closingDateBefore = (eventDate: string, closingDay: number): string => {
  const e = dayjs(eventDate);
  let c = closingOf(e.year(), e.month(), closingDay);
  if (!c.isBefore(e, 'day')) {
    const prev = e.subtract(1, 'month');
    c = closingOf(prev.year(), prev.month(), closingDay);
  }
  return fmt(c);
};

/** 平均賃金の3か月の、1つの賃金計算期間（支給年月はその期間の給与を払う月） */
export interface AverageWagePeriod {
  start: string;
  end: string;
  payYear: number;
  payMonth: number;
}

/** 直前の締日から3か月の賃金計算期間（古い順） */
export const averageWagePeriods = (eventDate: string, closingDay: number, isNextMonth: boolean): AverageWagePeriod[] => {
  const closing = dayjs(closingDateBefore(eventDate, closingDay));
  return [2, 1, 0].map((k) => {
    const c = closing.subtract(k, 'month');
    const p = getPayrollPeriod(c.year(), c.month() + 1, closingDay);
    const pay = dayjs(new Date(c.year(), c.month(), 1)).add(isNextMonth ? 1 : 0, 'month');
    return { start: p.startStr, end: p.endStr, payYear: pay.year(), payMonth: pay.month() + 1 };
  });
};

// ── 確定した給与の内訳の分け方 ─────────────────────────────

/**
 * 内訳の行の分け方（確定したときに残した avg。残していない行は、行の名前で決める）
 * @param wageType その給与の給与形態（基本給の行の名前から決める）
 */
export const averageWageKindOfLine = (line: LedgerLine, wageType: string): AverageWageKind => {
  if (line.avg === 'month' || line.avg === 'time' || line.avg === 'none') return line.avg;
  const name = line.name;
  if (name === '基本給' || name === '固定残業代' || name === '通勤手当') return 'month';
  if (name === '日給' || name === '時給分' || name.startsWith('時間外手当') || name.startsWith('休日出勤手当')
    || name === '深夜手当' || name === '有給休暇手当' || name === '特別休暇手当') return 'time';
  if (name === '休業手当' || name.startsWith('休業補償')) return 'none';
  if (['欠勤控除', '無給休暇控除', 'フレックス不足時間控除', '遅刻早退控除', '休業の日の控除'].includes(name)) {
    return wageType === 'monthly' ? 'month' : 'time';
  }
  return 'month';
};

/** 内訳の基本給の行の名前から、その給与の給与形態を決める */
const wageTypeOfLedger = (ledger: PayLedger, fallback: string): string => {
  const first = ledger.earnings[0]?.name;
  return first === '基本給' ? 'monthly' : first === '日給' ? 'daily' : first === '時給分' ? 'hourly' : fallback;
};

// ── 平均賃金 ─────────────────────────────────────────────

/** 平均賃金の計算に使う、確定した給与 */
export interface AverageWageSalary {
  payYear: number;
  payMonth: number;
  /** 賃金台帳の内訳（salary_results.ledger の JSON） */
  ledger: string | null;
  totalEarnings: number;
  /** 休業の日がある月に、月給を払った日数（salary_results.leave_paid_days。日割りしていなければ null） */
  leavePaidDays: number | null;
}

/** 平均賃金の計算に使う勤怠（確定したもの） */
export interface AverageWageAttendance {
  work_date: string;
  work_type?: string | null;
  work_hours?: unknown;
}

export interface AverageWageInput {
  /** できごとの日（算定事由の発生した日） */
  eventDate: string;
  staff: { join_date?: string | null; probation_end?: string | null; wage_type?: string | null; leave_periods?: unknown };
  /** 給与規定グループの締日（1〜28・99：末日）と、翌月払いか */
  closingDay: number;
  isNextMonth: boolean;
  salaries: AverageWageSalary[];
  attendance: AverageWageAttendance[];
}

/** 3か月のうち、1つの賃金計算期間の分 */
export interface AverageWagePeriodRow extends AverageWagePeriod {
  /** 算定期間に入る日（入社した日から、など） */
  from: string;
  to: string;
  /** 暦日数（from〜to） */
  days: number;
  /** 除いた日数と、その理由（「育児休業 10日」など） */
  excludedDays: number;
  excludedReasons: string[];
  /** 月で決まる賃金・日や時間で決まる賃金（除いた分を引いた後） */
  monthWages: number;
  timeWages: number;
  /** 入れなかった賃金（休業手当・休業補償・臨時の賃金など）と、除いた期間の分として引いた賃金 */
  notIncluded: number;
  /** 働いた日数（働いた時間がある日。除いた日を除く。最低保障に使う） */
  workedDays: number;
  /** 給与を確定しているか（まるごと除く期間なら、確定していなくてよい） */
  confirmed: boolean;
  notes: string[];
}

export interface AverageWageResult {
  eventDate: string;
  /** 直前の締日 */
  closingDate: string;
  /** 算定期間（入社した日から、など。出せないときは null） */
  from: string | null;
  to: string | null;
  periods: AverageWagePeriodRow[];
  /** 暦日数（除いた日を引いた後）・賃金の総額・働いた日数 */
  totalDays: number;
  monthWages: number;
  timeWages: number;
  workedDays: number;
  /** 原則（賃金の総額 ÷ 暦日数。銭） */
  principleSen: number | null;
  /** 最低保障（日・時間・出来高で決まる賃金がないときは null。銭） */
  minimumSen: number | null;
  /** 平均賃金（銭）。出せないときは null */
  amountSen: number | null;
  /** 出せない理由 */
  error: string | null;
  notes: string[];
  /** 手で入れた平均賃金（あれば、amountSen はこの額） */
  manual: { amountSen: number; note: string } | null;
}

/** 除く日の理由（同じ日に2つ当たれば、休業 → 会社都合の休業 → 試用期間の順） */
type ExcludeReason = LeaveType | 'shutdown' | 'probation';

const EXCLUDE_REASON_LABELS: Record<ExcludeReason, string> = {
  ...LEAVE_TYPE_NAMES,
  shutdown: '会社都合の休業',
  probation: '試用期間',
};

/** その日が、会社都合の休業として除く日か（月給制の人が働いた日は、月給を払っているので除かない） */
export const isShutdownDay = (row: AverageWageAttendance | undefined, wageType: string | null | undefined): boolean =>
  !!row && row.work_type === SHUTDOWN_WORK_TYPE && !(wageType === 'monthly' && (Number(row.work_hours) || 0) > 0);

/**
 * 平均賃金を計算する（確定した給与・勤怠から。出せないときは amountSen が null で、error に理由）
 */
export const calcAverageWage = (input: AverageWageInput): AverageWageResult => {
  const { eventDate, staff } = input;
  const closingDate = closingDateBefore(eventDate, input.closingDay);
  const base: AverageWageResult = {
    eventDate, closingDate, from: null, to: null, periods: [], totalDays: 0, monthWages: 0, timeWages: 0, workedDays: 0,
    principleSen: null, minimumSen: null, amountSen: null, error: null, notes: [], manual: null,
  };
  const fail = (error: string, extra: Partial<AverageWageResult> = {}): AverageWageResult => ({ ...base, ...extra, error });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return fail('できごとの日を入れてください');

  const periods = averageWagePeriods(eventDate, input.closingDay, input.isNextMonth);
  let from = periods[0].start;
  const to = closingDate;
  const join = staff.join_date || '';
  if (join && join >= eventDate) return fail('入社した日より前（入社した日を含む）のできごとなので、平均賃金を計算できません（入社した日のできごとは、都道府県労働局長が決めます。労働基準法施行規則4条）');
  if (join && join > from) {
    // 入社して3か月たたない人（労働基準法12条6項）。直前の締日までが、ひとつの賃金計算期間に満たないときは、できごとの日の前日まで数える
    if (join > periods[2].start) {
      return fail('入社してから直前の締日までが、ひとつの賃金計算期間に満たないので、できごとの日の前日までの賃金で数えます。まだ確定していない給与を使うので、Q では計算できません（手で入れてください）');
    }
    from = join;
  }

  const wageType = staff.wage_type || 'monthly';
  const leaves: LeavePeriod[] = parseLeavePeriods(staff.leave_periods);
  const attendanceByDate = new Map(input.attendance.map((r) => [String(r.work_date), r]));
  const probationEnd = staff.probation_end || '';
  // 試用期間の中のできごとなら、試用期間を除かない（労働基準法施行規則3条）
  const excludeProbation = !!probationEnd && eventDate > probationEnd;
  const reasonOf = (date: string): ExcludeReason | null => {
    const leave = leaveOn(leaves, date);
    if (leave && EXCLUDED_LEAVE_TYPES.has(leave.type)) return leave.type;
    if (isShutdownDay(attendanceByDate.get(date), wageType)) return 'shutdown';
    if (excludeProbation && date <= probationEnd) return 'probation';
    return null;
  };

  const notes: string[] = [];
  const rows: AverageWagePeriodRow[] = [];
  const unconfirmed: string[] = [];
  for (const p of periods) {
    const pFrom = p.start > from ? p.start : from;
    const pTo = p.end < to ? p.end : to;
    if (pFrom > pTo) continue;
    const days = daysOf(pFrom, pTo);
    const count: Partial<Record<ExcludeReason, number>> = {};
    let excludedDays = 0;
    let workedDays = 0;
    eachDate(pFrom, pTo, (date) => {
      const reason = reasonOf(date);
      if (reason) {
        count[reason] = (count[reason] ?? 0) + 1;
        excludedDays++;
        return;
      }
      if ((Number(attendanceByDate.get(date)?.work_hours) || 0) > 0) workedDays++;
    });
    const excludedReasons = (Object.keys(count) as ExcludeReason[]).map((r) => `${EXCLUDE_REASON_LABELS[r]} ${count[r]}日`);
    const salary = input.salaries.find((s) => s.payYear === p.payYear && s.payMonth === p.payMonth);
    const row: AverageWagePeriodRow = {
      ...p, from: pFrom, to: pTo, days, excludedDays, excludedReasons,
      monthWages: 0, timeWages: 0, notIncluded: 0, workedDays, confirmed: !!salary, notes: [],
    };
    if (!salary) {
      if (excludedDays < days) unconfirmed.push(`${p.payYear}年${p.payMonth}月支給の給与（${mdJa(p.start)}〜${mdJa(p.end)}の分）`);
      rows.push(row);
      continue;
    }
    const ledger = parseLedger(salary.ledger);
    let month = 0;
    let time = 0;
    let none = 0;
    if (ledger) {
      const wt = wageTypeOfLedger(ledger, wageType);
      for (const line of ledger.earnings) {
        const kind = averageWageKindOfLine(line, wt);
        if (kind === 'month') month += line.amount;
        else if (kind === 'time') time += line.amount;
        else none += line.amount;
      }
      // 会社都合の休業の日に少し働いた分の賃金（その日は除くので、その日の賃金も除く）
      const shutdownWorkedPay = Math.max(0, Number(ledger.shutdownWorkedPay) || 0);
      if (shutdownWorkedPay > 0) {
        time -= shutdownWorkedPay;
        none += shutdownWorkedPay;
      }
    } else {
      month = Number(salary.totalEarnings) || 0;
      row.notes.push('内訳を残す前に確定した給与なので、総支給額をすべて「月で決まる賃金」にしました（臨時の手当などがあれば、確定し直すか、手で入れてください）');
    }
    // 月給を日割りしていない月の休業の日（給与規定グループの「休業の月の日割り」が「日割りしない」）：その日の分の月給を暦日数で除く
    const leaveDays = (count.maternity ?? 0) + (count.childcare ?? 0) + (count.family_care ?? 0) + (count.injury ?? 0);
    if (wageType === 'monthly' && leaveDays > 0 && leaveDays < days && (salary.leavePaidDays === null || salary.leavePaidDays === undefined)) {
      const cut = Math.floor((month * leaveDays) / days);
      month -= cut;
      none += cut;
      row.notes.push(`月給を日割りしていない月なので、休業の${leaveDays}日の分（月で決まる賃金 × ${leaveDays}日 ÷ ${days}日 ＝ ${cut.toLocaleString()}円）を除きました`);
    }
    // 試用期間をまたぐ期間：試用期間の日の分の賃金を、暦日数で分けて除く
    const probationDays = count.probation ?? 0;
    if (probationDays > 0) {
      const rest = days - (excludedDays - probationDays);
      if (probationDays >= rest) {
        none += month + time;
        month = 0;
        time = 0;
      } else {
        const cutMonth = Math.floor((month * probationDays) / rest);
        const cutTime = Math.floor((time * probationDays) / rest);
        month -= cutMonth;
        time -= cutTime;
        none += cutMonth + cutTime;
        row.notes.push(`試用期間をまたぐ期間なので、試用期間の${probationDays}日の分の賃金（${(cutMonth + cutTime).toLocaleString()}円）を暦日数で分けて除きました（手で直せます）`);
      }
    }
    // 全部を除く日なら、その期間の賃金も入れない
    if (excludedDays >= days) {
      none += month + time;
      month = 0;
      time = 0;
    }
    row.monthWages = month;
    row.timeWages = time;
    row.notIncluded = none;
    rows.push(row);
  }

  const totalDays = rows.reduce((s, r) => s + r.days - r.excludedDays, 0);
  const monthWages = rows.reduce((s, r) => s + r.monthWages, 0);
  const timeWages = rows.reduce((s, r) => s + r.timeWages, 0);
  const workedDays = rows.reduce((s, r) => s + r.workedDays, 0);
  const summary = { from, to, periods: rows, totalDays, monthWages, timeWages, workedDays };
  if (unconfirmed.length > 0) {
    return fail(`${unconfirmed.join('・')}を確定してください（平均賃金は、確定した給与で計算します）`, summary);
  }
  if (totalDays <= 0) {
    return fail('3か月がすべて除く期間（休業・試用期間）なので、平均賃金は都道府県労働局長が決めます（労働基準法施行規則4条）。労働基準監督署に確かめて、手で入れてください', summary);
  }
  const total = monthWages + timeWages;
  // 原則：賃金の総額 ÷ 暦日数（1銭未満切り捨て）
  const principleSen = Math.max(0, Math.floor((total * 100) / totalDays + 1e-9));
  // 最低保障：月で決まる賃金 ÷ 暦日数 ＋ 日・時間で決まる賃金 ÷ 働いた日数 × 60%（それぞれ1銭未満切り捨て）
  let minimumSen: number | null = null;
  if (timeWages > 0) {
    if (workedDays > 0) {
      minimumSen = Math.max(0, Math.floor((monthWages * 100) / totalDays + 1e-9)) + Math.floor((timeWages * 60) / workedDays + 1e-9);
    } else {
      notes.push('働いた日がないので、最低保障（働いた日数で割って60%）は計算していません');
    }
  }
  const amountSen = minimumSen !== null && minimumSen > principleSen ? minimumSen : principleSen;
  return { ...base, ...summary, principleSen, minimumSen, amountSen, notes };
};

// ── 平均賃金を使う額 ─────────────────────────────────────

/**
 * 平均賃金 × 率 × 日数（少し働いた日は、その日の賃金との差額。マイナスにはしない）。1円未満は四捨五入
 * @param partialPays 少し働いた日の、その日に払った賃金（円）
 */
export const averageWageAmount = (amountSen: number, ratePct: number, fullDays: number, partialPays: number[] = []): number => {
  const perDay = (amountSen * ratePct) / 10000;
  const total = perDay * fullDays + partialPays.reduce((s, pay) => s + Math.max(0, perDay - pay), 0);
  return roundYen(total);
};

/** 平均賃金 × 率 の1日分（円。端数はそのまま。画面の計算式に出す） */
export const perDayOf = (amountSen: number, ratePct: number): number => (amountSen * ratePct) / 10000;

/** 円の額を、小数があれば小数2けたまで書く（「5,504.28円」） */
export const yenText = (yen: number): string =>
  Number.isInteger(Math.round(yen * 100) / 100)
    ? `${Math.round(yen).toLocaleString()}円`
    : `${(Math.round(yen * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}円`;

/**
 * 会社都合で休ませた日を、続いている休業ごとにまとめ、それぞれの日に「平均賃金を数える日」（その休業の初めの日）を付ける
 * 休業の日のあいだに所定労働日がなければ（休日だけをはさんでいれば）、続いているとみなす
 * @param dates     休業の日（前の計算期間の日も入れると、前から続いている休業の初めの日がわかる）
 * @param isWorkDay その日が所定労働日か（会社カレンダー）
 */
export const shutdownEventDates = (dates: string[], isWorkDay: (date: string) => boolean): Record<string, string> => {
  const sorted = [...new Set(dates)].sort();
  const out: Record<string, string> = {};
  let start = '';
  let prev = '';
  for (const date of sorted) {
    let continued = !!prev;
    if (prev) {
      for (let d = dayjs(prev).add(1, 'day'); d.isBefore(dayjs(date), 'day'); d = d.add(1, 'day')) {
        if (isWorkDay(fmt(d))) { continued = false; break; }
      }
    }
    if (!continued) start = date;
    out[date] = start;
    prev = date;
  }
  return out;
};

/**
 * 業務上の負傷・疾病による休業の、最初の3日（待期期間。休日も数える。会社が休業補償を払う日）と、平均賃金を数える日（事故の日）
 * 同じ事故（事故の日が同じ）の休業は、期間を分けて入れても通算して3日
 */
export const injuryWaitingDays = (leaves: LeavePeriod[]): { date: string; eventDate: string }[] => {
  const groups = new Map<string, LeavePeriod[]>();
  for (const p of leaves) {
    if (p.type !== 'injury' || !p.start || (p.end && p.end < p.start)) continue;
    const key = p.accident || p.start;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: { date: string; eventDate: string }[] = [];
  for (const [eventDate, list] of groups) {
    const dates: string[] = [];
    for (const p of [...list].sort((a, b) => a.start.localeCompare(b.start))) {
      for (let d = dayjs(p.start); dates.length < INJURY_WAITING_DAYS && (!p.end || !d.isAfter(dayjs(p.end), 'day')); d = d.add(1, 'day')) {
        const date = fmt(d);
        if (!dates.includes(date)) dates.push(date);
      }
      if (dates.length >= INJURY_WAITING_DAYS) break;
    }
    for (const date of dates) out.push({ date, eventDate });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
};

/** 解雇の予告の日数（伝えた日の翌日から解雇の日まで）。解雇の日が伝えた日より前なら null */
export const dismissalNoticeDays = (noticeDate: string, dismissalDate: string): number | null => {
  if (!noticeDate || !dismissalDate || dismissalDate < noticeDate) return null;
  return dayjs(dismissalDate).diff(dayjs(noticeDate), 'day');
};

/** 解雇予告手当の日数（30日 − 予告の日数。0日より少なくしない） */
export const dismissalAllowanceDays = (noticeDays: number): number => Math.max(0, DISMISSAL_NOTICE_DAYS - noticeDays);

// ── 給与に入れる（休業手当・休業補償） ──────────────────────────

/**
 * 給与に入れる、平均賃金を使う支給の材料（呼び出し側が確定した給与から平均賃金を出す。utils/averageWageStore.ts の loadAverageWagePay）
 */
export interface AverageWagePay {
  /** 休業手当の率（%。給与規定グループの設定。60以上） */
  shutdownRate: number;
  /** 会社都合で休ませた日 → 平均賃金を数える日（続いている休業の初めの日） */
  shutdownEvents: Record<string, string>;
  /** 労災の待期の日（計算期間の中の日）→ 平均賃金を数える日（事故の日） */
  waitingEvents: Record<string, string>;
  /** 平均賃金を数える日ごとの、平均賃金（銭。出せなければ null）・出せない理由・手で入れたか */
  wages: Record<string, { amountSen: number | null; error: string | null; manual: boolean }>;
}

/** 計算期間の中の、会社都合で休ませた日（勤怠の「休業（会社都合）」の日） */
export const shutdownDatesOf = (rows: AverageWageAttendance[], period: { start: string; end: string } | null | undefined): string[] =>
  rows
    .filter((r) => r.work_type === SHUTDOWN_WORK_TYPE && (!period || (r.work_date >= period.start && r.work_date <= period.end)))
    .map((r) => String(r.work_date))
    .sort();

/** 計算期間の中の、労災の待期の日 */
export const waitingDatesIn = (staff: { leave_periods?: unknown }, period: { start: string; end: string }) =>
  injuryWaitingDays(parseLeavePeriods(staff.leave_periods)).filter((d) => d.date >= period.start && d.date <= period.end);
