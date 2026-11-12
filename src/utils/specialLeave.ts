/**
 * 会社独自の休暇（特別休暇。夏季休暇・慶弔休暇・リフレッシュ休暇など）
 *
 * 年次有給休暇（労働基準法39条）とは別に、会社が就業規則で決める休暇。有給か無給か・日数・取れる期間は会社が決める
 * （休暇は就業規則に必ず書くことの1つ。労働基準法89条1号）。
 * ・会社の設定（休暇の種類。leave_types）で、種類ごとに 名前・有給か無給か・残りを数えるか・半日でも取れるか・時間単位でも取れるか・
 *   発生（毎年◯月◯日に◯日）・消滅（付与日から◯か月か、◯月◯日まで）を決める。
 * ・時間単位（子の看護等休暇・介護休暇は、1時間単位でも取れるようにしなければならない）：勤怠の「時間休」に、休暇の種類と時間を入れる
 *   （attendance.special_leave_hours。中抜けは、休憩の一覧で休暇の種類の印を付ける。utils/breaks.ts）。
 *   1日分は、1日の所定労働時間（1時間に満たない端数は1時間に切り上げ。年次有給休暇の時間単位と同じ leaveHoursPerDay）として数え、
 *   時間単位で取れるのは、1日の所定労働時間に満たない時間（育児・介護休業法施行規則34条1項・2項（子の看護等休暇）、40条1項・2項（介護休暇）。
 *   法律が求める時間単位は、始業の時刻から続けて、または終業の時刻まで続けて取るもの。中抜けを認めるかは会社が決める）。
 * ・付与は人ごとに残す（special_leave_grants）。発生の日が来たら、有給休暇管理の画面で知らせ、ボタンで在籍している人に付与する
 *   （dueGrants）。0日の付与は「この回は付与しない」の印（知らせを出さないため）。決まりのない付与は、人ごとに手で足す。
 * ・取った日は、勤怠の区分（special：1日、special_half：半日）と休暇の種類（attendance.leave_type_id）で入れる。
 *   確定したときに、有給か無給かを勤怠に残す（attendance.leave_paid。あとで設定を変えても、確定した日は変わらない。
 *   確定し直すと新しい設定で計算する）。
 * ・残りは、年次有給休暇と同じく、期限の早い付与から引く（utils/paidLeave.ts の allocateLeave）。付与より前に取った日・
 *   残りより多く取った日は「残りが足りない」にする。残りを数えない種類（慶弔休暇など、そのつど取る休暇）は、取った日だけを出す。
 * ・給与（utils/calcSalary.ts）：有給の休暇は、月給の人は引かず、日給・時給の人には所定労働時間の分を払う（年次有給休暇と同じく、
 *   所定労働時間を働いた場合の通常の賃金）。無給の休暇は、月給の人は欠勤控除と同じ計算で引き（明細では欠勤とは分けて出す）、
 *   日給・時給の人には払わない。
 * ・年次有給休暇の年5日の取得義務（労働基準法39条7項）には数えない（厚生労働省：特別休暇は、使用者による時季指定の対象にならない
 *   https://www.startup-roudou.mhlw.go.jp/qa/zigyonushi/hatarakikatakaikaku/q6.html ）。
 * ・会社が一斉に休む日（夏季休業など）を就業規則で「休日」にしているときは、休暇ではなく会社カレンダーで休日にする（所定労働日数が減る）。
 * ・一般的な勤怠ソフトと同じ形（マネーフォワード クラウド勤怠の「その他休日/休暇」：休暇を作り、従業員ごとに日数と失効日を付けて付与し、
 *   残りを数える https://biz.moneyforward.com/support/attendance/faq/paid_leave_rules/special_leave_patterns.html ）。
 */
import dayjs from "dayjs";
import { allocateLeave, expiryAfterMonths, type GrantStatus, type LeaveGrantRow, type TakenStatus } from "./paidLeave";

/** 勤怠の区分：特別休暇（1日） */
export const SPECIAL_LEAVE_FULL = "special";
/** 勤怠の区分：特別休暇（半日。残りの半日は働く） */
export const SPECIAL_LEAVE_HALF = "special_half";

/** 発生：毎年 month月day日 に days日 */
export interface GrantRule {
  month: number;
  day: number;
  days: number;
}

/** 消滅：付与日から months か月（応当日の前日まで）か、付与日以後で最初の month月day日 まで */
export type ExpiryRule = { mode: "months"; months: number } | { mode: "date"; month: number; day: number };

export interface LeaveType {
  id: number;
  name: string;
  /** 有給（休んでも給与を引かない・払う）。false は無給 */
  paid: boolean;
  /** 残りを数える（付与から引く）。false は数えない（慶弔休暇など、そのつど取る休暇） */
  trackBalance: boolean;
  /** 半日でも取れる */
  allowHalf: boolean;
  /** 時間単位でも取れる（1時間単位） */
  allowHourly: boolean;
  /** 発生の決まり（null は決まりなし。人ごとに手で付与する） */
  grantRule: GrantRule | null;
  /** 消滅の決まり（手で付与するときの有効期限の初めの値にも使う） */
  expiryRule: ExpiryRule;
  /** 使う（使わない種類は、勤怠で選べない。前の記録はそのまま） */
  active: boolean;
  sortOrder: number;
}

/** 消滅の決まりの初めの値（付与日から1年） */
export const DEFAULT_EXPIRY_RULE: ExpiryRule = { mode: "months", months: 12 };

const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** その月にある日か（2月29日は、うるう年にあるので認める） */
const validMonthDay = (month: number | null, day: number | null): boolean =>
  month !== null && day !== null && day <= dayjs(new Date(2024, month - 1, 1)).daysInMonth();

/** 0.5日きざみの、0より大きい日数か */
export const isValidLeaveDays = (days: unknown): boolean => {
  const n = Number(days);
  return Number.isFinite(n) && n > 0 && n <= 366 && Math.round(n * 2) === n * 2;
};

const parseJson = (value: unknown): any => {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** 発生の決まり（leave_types.grant_rule の JSON）を読む。ない・読めないときは null */
export const parseGrantRule = (value: unknown): GrantRule | null => {
  const v = parseJson(value);
  if (!v || typeof v !== "object") return null;
  const month = intIn(v.month, 1, 12);
  const day = intIn(v.day, 1, 31);
  if (!validMonthDay(month, day) || !isValidLeaveDays(v.days)) return null;
  return { month: month!, day: day!, days: Number(v.days) };
};

/** 消滅の決まり（leave_types.expiry_rule の JSON）を読む。ない・読めないときは付与日から1年 */
export const parseExpiryRule = (value: unknown): ExpiryRule => {
  const v = parseJson(value);
  if (v?.mode === "months") {
    const months = intIn(v.months, 1, 120);
    if (months !== null) return { mode: "months", months };
  }
  if (v?.mode === "date") {
    const month = intIn(v.month, 1, 12);
    const day = intIn(v.day, 1, 31);
    if (validMonthDay(month, day)) return { mode: "date", month: month!, day: day! };
  }
  return DEFAULT_EXPIRY_RULE;
};

/** leave_types の行から読む */
export const leaveTypeFromRow = (row: any): LeaveType => ({
  id: Number(row.id),
  name: String(row.name ?? "").trim() || "特別休暇",
  paid: Number(row.is_paid ?? 1) !== 0,
  trackBalance: Number(row.track_balance ?? 1) !== 0,
  allowHalf: Number(row.allow_half ?? 0) === 1,
  allowHourly: Number(row.allow_hourly ?? 0) === 1,
  grantRule: parseGrantRule(row.grant_rule),
  expiryRule: parseExpiryRule(row.expiry_rule),
  active: Number(row.is_active ?? 1) !== 0,
  sortOrder: Number(row.sort_order) || 0,
});

/** leave_types に保存する値 */
export const leaveTypeToRow = (t: Omit<LeaveType, "id">) => ({
  name: t.name.trim(),
  is_paid: t.paid ? 1 : 0,
  track_balance: t.trackBalance ? 1 : 0,
  allow_half: t.allowHalf ? 1 : 0,
  allow_hourly: t.allowHourly ? 1 : 0,
  grant_rule: t.grantRule ? JSON.stringify(t.grantRule) : null,
  expiry_rule: JSON.stringify(t.expiryRule),
  is_active: t.active ? 1 : 0,
  sort_order: t.sortOrder,
});

/** その年の month月day日（2月29日は、うるう年でない年は2月28日） */
export const dateInYear = (year: number, month: number, day: number): string => {
  const last = dayjs(new Date(year, month - 1, 1)).daysInMonth();
  return dayjs(new Date(year, month - 1, Math.min(day, last))).format("YYYY-MM-DD");
};

/** 付与日から、消滅の決まりで有効期限（この日まで使える）を出す */
export const expiryDateOf = (rule: ExpiryRule, grantDate: string): string => {
  const g = dayjs(grantDate);
  if (!g.isValid()) return "";
  if (rule.mode === "months") return expiryAfterMonths(grantDate, rule.months);
  // ◯月◯日まで：付与日以後で最初の◯月◯日（7月1日の付与で9月30日まで → その年の9月30日。10月1日の付与で3月31日まで → 次の年）
  const sameYear = dateInYear(g.year(), rule.month, rule.day);
  return sameYear >= grantDate ? sameYear : dateInYear(g.year() + 1, rule.month, rule.day);
};

/** 発生の決まりで、asOf 以前で最も新しい付与日（今年の付与日がまだなら、去年の付与日） */
export const latestGrantDate = (rule: GrantRule, asOf: string): string => {
  const year = Number(asOf.slice(0, 4));
  const thisYear = dateInYear(year, rule.month, rule.day);
  return thisYear <= asOf ? thisYear : dateInYear(year - 1, rule.month, rule.day);
};

/** 「毎年7月1日に3日」 */
export const describeGrantRule = (rule: GrantRule | null): string =>
  rule ? `毎年${rule.month}月${rule.day}日に${rule.days}日` : "決まりなし（人ごとに付与する）";

/** 「付与日から3か月」「付与日から1年」「9月30日まで」 */
export const describeExpiryRule = (rule: ExpiryRule): string =>
  rule.mode === "date"
    ? `${rule.month}月${rule.day}日まで`
    : rule.months % 12 === 0 ? `付与日から${rule.months / 12}年` : `付与日から${rule.months}か月`;

/** 「夏季休暇（有給）」 */
export const leaveTypeLabel = (t: Pick<LeaveType, "name" | "paid">): string => `${t.name}（${t.paid ? "有給" : "無給"}）`;

/** 勤怠の区分が特別休暇か */
export const isSpecialLeaveWorkType = (workType: unknown): boolean =>
  workType === SPECIAL_LEAVE_FULL || workType === SPECIAL_LEAVE_HALF;

/** その日の特別休暇の日数（1日・半日。特別休暇でなければ 0） */
export const specialLeaveDaysOf = (workType: unknown): number =>
  workType === SPECIAL_LEAVE_FULL ? 1 : workType === SPECIAL_LEAVE_HALF ? 0.5 : 0;

/** その日の時間単位の特別休暇の時間（区分が特別休暇（1日・半日）の日は 0） */
export const specialLeaveHoursOf = (row: { work_type?: unknown; special_leave_hours?: unknown }): number => {
  if (isSpecialLeaveWorkType(row.work_type)) return 0;
  const h = Number(row.special_leave_hours);
  return Number.isFinite(h) && h > 0 ? h : 0;
};

/**
 * 給与の計算で使う、その日の特別休暇（日数・時間と、有給か）
 * 有給かは、確定したときに残した値（attendance.leave_paid）。値がない日は、払う額が少なくならないように有給として扱う
 */
export const specialLeaveOfRow = (
  row: { work_type?: string | null; special_leave_hours?: unknown; leave_paid?: unknown },
): { days: number; hours: number; paid: boolean } => {
  const days = specialLeaveDaysOf(row.work_type);
  const hours = specialLeaveHoursOf(row);
  const flag = row.leave_paid;
  const paid = flag === null || flag === undefined || flag === "" ? true : Number(flag) !== 0;
  return { days, hours, paid };
};

/**
 * 時間単位で取れる時間の上限（1日の所定労働時間に満たない時間。7時間30分なら7時間、8時間なら7時間）
 * 育児・介護休業法施行規則34条1項・40条1項：時間数は、1日の所定労働時間数に満たないもの
 */
export const maxHourlyLeave = (scheduledWorkHours: unknown): number => {
  const h = Number(scheduledWorkHours);
  if (!Number.isFinite(h) || h <= 0) return 7;
  return Math.max(0, Math.ceil(Math.round(h * 60) / 60) - 1);
};

/** 見本の休暇の種類（育児・介護休業法の休暇。無給・毎年4月1日に5日・3月31日まで・時間単位でも取れる） */
export const LEAVE_TYPE_TEMPLATES: Omit<LeaveType, "id" | "active" | "sortOrder">[] = [
  {
    name: "子の看護等休暇", paid: false, trackBalance: true, allowHalf: false, allowHourly: true,
    grantRule: { month: 4, day: 1, days: 5 }, expiryRule: { mode: "date", month: 3, day: 31 },
  },
  {
    name: "介護休暇", paid: false, trackBalance: true, allowHalf: false, allowHourly: true,
    grantRule: { month: 4, day: 1, days: 5 }, expiryRule: { mode: "date", month: 3, day: 31 },
  },
];

/** 勤怠の区分のプルダウンの値（「special:3」「special_half:3」） */
export const leaveOptionValue = (workType: string, leaveTypeId: number): string => `${workType}:${leaveTypeId}`;

/** プルダウンの値を、勤怠の区分と休暇の種類に分ける（特別休暇でなければ leaveTypeId は null） */
export const parseLeaveOption = (value: string): { workType: string; leaveTypeId: number | null } => {
  const m = /^(special|special_half):(\d+)$/.exec(value);
  return m ? { workType: m[1], leaveTypeId: Number(m[2]) } : { workType: value, leaveTypeId: null };
};

/** 勤怠に出す名前（「夏季休暇」「夏季休暇（半日）」。種類がわからないときは「特別休暇」） */
export const specialLeaveLabel = (type: Pick<LeaveType, "name"> | undefined, workType: unknown): string =>
  `${type?.name ?? "特別休暇"}${workType === SPECIAL_LEAVE_HALF ? "（半日）" : ""}`;

/** 「2日」「2.5日」 */
export const formatLeaveDays = (days: number): string => `${Math.round(days * 2) / 2}日`;

// ── 発生（付与の知らせ） ───────────────────────────────────

export interface StaffForGrant {
  id: string | number;
  name: string;
  status?: string | null;
  join_date?: string | null;
  retirement_date?: string | null;
}

/** 付与の記録（知らせを出すかを見るのに使う列だけ） */
export interface GrantRecord {
  staff_id: string | number;
  leave_type_id: number;
  grant_date: string;
}

export interface DueGrant {
  type: LeaveType;
  grantDate: string;
  expiryDate: string;
  days: number;
  /** 付与日に在籍していて、まだ付与していない人 */
  staff: StaffForGrant[];
}

/** 付与日に在籍しているか（入社日が入っていない人は在籍として扱う。退職の状態で退職日がない人は除く） */
export const employedOn = (s: StaffForGrant, date: string): boolean => {
  if (s.join_date && s.join_date > date) return false;
  if (s.retirement_date) return s.retirement_date >= date;
  return s.status !== "retired";
};

/**
 * 発生の日が来て、まだ付与していない休暇（有給休暇管理の画面で知らせる）
 * ・使う種類で、残りを数え、発生の決まりがあるものだけ。付与日は、今日以前で最も新しい◯月◯日
 * ・有効期限が過ぎたものは出さない
 * ・付与日に在籍している人のうち、同じ種類・同じ付与日の付与がない人（0日の「付与しない」の印がある人も除く）
 */
export const dueGrants = (
  types: LeaveType[],
  staffList: StaffForGrant[],
  grants: GrantRecord[],
  today: string,
): DueGrant[] => {
  const result: DueGrant[] = [];
  for (const type of types) {
    if (!type.active || !type.trackBalance || !type.grantRule) continue;
    const grantDate = latestGrantDate(type.grantRule, today);
    const expiryDate = expiryDateOf(type.expiryRule, grantDate);
    if (!expiryDate || expiryDate < today) continue;
    const done = new Set(grants
      .filter((g) => Number(g.leave_type_id) === type.id && g.grant_date === grantDate)
      .map((g) => String(g.staff_id)));
    const staff = staffList.filter((s) => employedOn(s, grantDate) && !done.has(String(s.id)));
    if (staff.length > 0) result.push({ type, grantDate, expiryDate, days: type.grantRule.days, staff });
  }
  return result;
};

// ── 残り ────────────────────────────────────────────────

/** special_leave_grants の行（数えるのに使う列） */
export interface SpecialLeaveGrantRow {
  id: number;
  leave_type_id: number;
  grant_date: string;
  expiry_date: string;
  days_granted: number;
}

/** 特別休暇を取った日（勤怠の行。区分が特別休暇の日と、時間単位の特別休暇を入れた日） */
export interface SpecialLeaveDay {
  work_date: string;
  work_type?: string | null;
  leave_type_id?: number | string | null;
  special_leave_hours?: number | string | null;
}

export interface SpecialLeaveSummary {
  type: LeaveType;
  /** 1日の時間数（時間単位で取った時間を、日に直すのに使う） */
  hoursPerDay: number;
  /** 付与ごとの状態（分。1日 ＝ hoursPerDay × 60 分。残りを数えない種類は空） */
  grants: GrantStatus[];
  /** 取った日（日付の順） */
  taken: TakenStatus[];
  /** asOf に使える残り（分） */
  remainingMinutes: number;
  /** 残りが足りない日（付与の前に取った日・残りより多く取った日） */
  shortages: TakenStatus[];
  /** 付与が1つでもあるか */
  hasGrants: boolean;
}

/**
 * 休暇の種類ごとの残り（年次有給休暇と同じく、期限の早い付与から引く）
 * @param grants その人の特別休暇の付与（ほかの種類が混ざっていてもよい）
 * @param days その人の勤怠（特別休暇の日・時間。ほかの種類・ほかの区分が混ざっていてもよい）
 * @param asOf 残りを数える基準の日
 * @param hoursPerDay 1日の時間数（1日の所定労働時間を、1時間に満たない端数を切り上げた時間。paidLeave.ts の leaveHoursPerDay）
 */
export const summarizeSpecialLeave = (
  type: LeaveType,
  grants: SpecialLeaveGrantRow[],
  days: SpecialLeaveDay[],
  asOf: string,
  hoursPerDay = 8,
): SpecialLeaveSummary => {
  const dayMinutes = hoursPerDay * 60;
  const taken = days
    .filter((d) => Number(d.leave_type_id) === type.id)
    .map((d) => ({ date: d.work_date, days: specialLeaveDaysOf(d.work_type), hours: specialLeaveHoursOf(d), source: "attendance" as const }))
    .filter((t) => t.days > 0 || t.hours > 0);
  if (!type.trackBalance) {
    const list: TakenStatus[] = [...taken].sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({
      ...t, minutes: Math.round(t.days * dayMinutes + t.hours * 60), allocations: [], shortageMinutes: 0, beforeFirstGrant: false, afterAsOf: t.date > asOf,
    }));
    return { type, hoursPerDay, grants: [], taken: list, remainingMinutes: 0, shortages: [], hasGrants: false };
  }
  const own: LeaveGrantRow[] = grants
    .filter((g) => Number(g.leave_type_id) === type.id)
    .map((g) => ({ id: g.id, name: type.name, grant_date: g.grant_date, expiry_date: g.expiry_date, days_granted: Number(g.days_granted) || 0 }));
  const r = allocateLeave(own, taken, dayMinutes, asOf, false);
  return {
    type,
    hoursPerDay,
    grants: r.grants,
    taken: r.taken,
    remainingMinutes: r.remainingMinutes,
    shortages: r.taken.filter((t) => t.shortageMinutes > 0),
    hasGrants: own.length > 0,
  };
};

// ── 読み込み ──────────────────────────────────────────────

interface SelectDb {
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** 休暇の種類（並べる順） */
export const loadLeaveTypes = async (db: SelectDb): Promise<LeaveType[]> => {
  const rows = (await db.select("SELECT * FROM leave_types ORDER BY sort_order, id")) as any[];
  return (rows ?? []).map(leaveTypeFromRow);
};

/** その人の特別休暇の付与と、確定した勤怠の特別休暇の日 */
export const loadSpecialLeaveData = async (db: SelectDb, staffId: string | number) => {
  const grants = (await db.select(
    "SELECT id, leave_type_id, grant_date, expiry_date, days_granted FROM special_leave_grants WHERE staff_id = ? ORDER BY grant_date DESC, id DESC",
    [staffId],
  )) as SpecialLeaveGrantRow[];
  // 給与と同じく、確定した日の勤怠だけを数える（区分が特別休暇の日と、時間単位の特別休暇を入れた日）
  const days = (await db.select(
    `SELECT work_date, work_type, leave_type_id, special_leave_hours FROM attendance
     WHERE staff_id = ? AND is_finalized = 1 AND (work_type IN (?, ?) OR special_leave_hours > 0)`,
    [staffId, SPECIAL_LEAVE_FULL, SPECIAL_LEAVE_HALF],
  )) as SpecialLeaveDay[];
  return { grants: grants ?? [], days: days ?? [] };
};
