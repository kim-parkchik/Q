/**
 * 年次有給休暇の残り（付与・取った日・有効期限）
 *
 * 有給を取った日は、勤怠（確定した日）の「全休(有給)」「半休(有給)」「時間有給」から数える。
 * 給与の計算（有給の日を欠勤にしない・時給制の人に有給の賃金を払う）と同じ記録を使い、2か所に入れなくてよいようにする。
 * 前に有給の画面で記録した取得（paid_leave_usage）は、その日に確定した勤怠がないときだけ数える（勤怠がある日は勤怠のほうを使う）。
 *
 * ・付与ごとに有効期限がある。初めの値は付与日から2年（労働基準法115条：賃金以外の請求権は2年で時効）。
 *   期限が過ぎた付与の使い残しは残りに数えず、「期限で消えた」分にする
 * ・取った日に使える付与（付与日 ≦ 取った日 ≦ 有効期限）のうち、期限の早い付与（ふつうは古い付与）から引く
 * ・時間単位の有給は、1日の所定労働時間（1時間に満たない端数は切り上げ）を1日として数える
 *   （労働基準法施行規則24条の4第1号：時間単位で与える有給休暇1日の時間数は、1日の所定労働時間数を下回らない）
 * ・残りが足りない日は、引けた分だけ引き、足りない分を shortageMinutes に入れる
 * ・最初の付与より前の日の有給は、Q で有給を管理する前の分として引かない（beforeFirstGrant）
 * ・夏季休暇など、年次有給休暇ではない付与（名前が「法定有給」でないもの）は数えない。勤怠に区分がないので、残りを数えられない
 *
 * 時間は分（整数）で数える。1日 ＝ 1日の時間数 × 60 分。
 */
import dayjs from "dayjs";

/** 年次有給休暇の付与の名前（paid_leave_grants.name。画面では「年次有給休暇」と出す） */
export const ANNUAL_LEAVE_GRANT_NAME = "法定有給";

export interface LeaveGrantRow {
  id: number;
  name?: string | null;
  grant_date: string;
  expiry_date: string;
  days_granted: number;
}

/** 確定した勤怠の1日（有給を数えるのに使う列だけ） */
export interface AttendanceLeaveRow {
  work_date: string;
  work_type?: string | null;
  paid_leave_hours?: number | null;
}

/** 前に有給の画面で記録した取得（paid_leave_usage） */
export interface ManualLeaveRecord {
  id: number;
  usage_date: string;
  days_used: number;
  description?: string | null;
}

/** 有給を取った日 */
export interface LeaveTaken {
  date: string;
  /** 全休は 1、半休は 0.5（前の記録は、記録した日数） */
  days: number;
  /** 時間単位の有給の時間 */
  hours: number;
  source: "attendance" | "manual";
  /** 前の記録（paid_leave_usage）の id */
  manualId?: number;
}

/** 前の記録を数えたか、数えなかった理由 */
export interface ManualRecordCheck {
  record: ManualLeaveRecord;
  counted: boolean;
  reason: string | null;
}

export interface GrantStatus {
  grant: LeaveGrantRow;
  grantedMinutes: number;
  /** 基準の日までに取った日から引いた分 */
  usedMinutes: number;
  /** 基準の日より後の日（予定）の有給から引く分 */
  laterMinutes: number;
  /** 期限で消えた分（基準の日が有効期限より後のとき） */
  expiredMinutes: number;
  /** 基準の日に使える残り（付与日から有効期限までのとき） */
  remainingMinutes: number;
  /** upcoming：まだ付与日の前／active：使える／expired：期限切れ */
  state: "upcoming" | "active" | "expired";
}

export interface TakenStatus extends LeaveTaken {
  minutes: number;
  /** どの付与から何分引いたか */
  allocations: { grantId: number; minutes: number }[];
  /** 残りが足りなくて引けなかった分 */
  shortageMinutes: number;
  /** 最初の付与より前の日（引いていない） */
  beforeFirstGrant: boolean;
  /** 基準の日より後の日（予定） */
  afterAsOf: boolean;
}

export interface PaidLeaveSummary {
  /** 時間単位の有給の1日の時間数 */
  hoursPerDay: number;
  dayMinutes: number;
  /** 残りを数える基準の日 */
  asOf: string;
  /** 年次有給休暇の付与（渡した順） */
  grants: GrantStatus[];
  /** 有給を取った日（日付の順） */
  taken: TakenStatus[];
  /** 基準の日に使える残りの合計 */
  remainingMinutes: number;
  /** 年次有給休暇の付与が1つでも登録されているか */
  hasGrants: boolean;
  firstGrantDate: string | null;
}

/** 年次有給休暇の付与か（名前が「法定有給」か空。夏季休暇などは違う） */
export const isAnnualLeaveGrant = (grant: { name?: string | null }): boolean => {
  const name = (grant.name ?? "").trim();
  return name === "" || name === ANNUAL_LEAVE_GRANT_NAME;
};

/**
 * 時間単位の有給の1日の時間数
 * 1日の所定労働時間を、1時間に満たない端数を切り上げた時間にする（7時間30分 → 8時間）。
 * 所定労働時間が入っていないときは8時間とし、assumed を立てる
 */
export const leaveHoursPerDay = (scheduledWorkHours: unknown): { hours: number; assumed: boolean } => {
  const h = Number(scheduledWorkHours);
  if (!Number.isFinite(h) || h <= 0) return { hours: 8, assumed: true };
  const minutes = Math.round(h * 60);
  return { hours: Math.min(24, Math.ceil(minutes / 60)), assumed: false };
};

/** 付与日から2年の有効期限（2年後の応当日の前日。応当日がない2月29日の付与は、2年後の2月の末日） */
export const defaultExpiryDate = (grantDate: string): string => {
  const d = dayjs(grantDate);
  if (!d.isValid()) return "";
  const monthStart = dayjs(new Date(d.year() + 2, d.month(), 1));
  if (d.date() > monthStart.daysInMonth()) return monthStart.endOf("month").format("YYYY-MM-DD");
  return monthStart.date(d.date()).subtract(1, "day").format("YYYY-MM-DD");
};

const WORK_TYPE_LABELS: Record<string, string> = {
  normal: "出勤（平日）",
  holiday: "公休",
  holiday_work: "所定休日出勤",
  statutory_holiday: "法定休日出勤",
  paid_full: "全休(有給)",
  paid_half: "半休(有給)",
  absent: "欠勤",
};

/** 勤怠の1日の有給（全休 1日・半休 0.5日、時間有給の時間） */
export const leaveOfAttendance = (row: AttendanceLeaveRow): { days: number; hours: number } => {
  const days = row.work_type === "paid_full" ? 1 : row.work_type === "paid_half" ? 0.5 : 0;
  const hours = Math.max(0, Number(row.paid_leave_hours) || 0);
  return { days, hours };
};

/**
 * 有給を取った日を、勤怠（確定した日）と前の記録から作る
 * @param attendance その人の確定した勤怠（有給の日だけでなく、すべての日。前の記録と同じ日に勤怠があるかを見る）
 * @param manual 前に有給の画面で記録した取得
 */
export const collectLeaveTaken = (
  attendance: AttendanceLeaveRow[],
  manual: ManualLeaveRecord[],
): { taken: LeaveTaken[]; manualChecks: ManualRecordCheck[] } => {
  const byDate = new Map<string, AttendanceLeaveRow>();
  const taken: LeaveTaken[] = [];
  for (const row of attendance) {
    byDate.set(row.work_date, row);
    const { days, hours } = leaveOfAttendance(row);
    if (days > 0 || hours > 0) taken.push({ date: row.work_date, days, hours, source: "attendance" });
  }

  const manualChecks = manual.map((record): ManualRecordCheck => {
    const row = byDate.get(record.usage_date);
    if (row) {
      const { days, hours } = leaveOfAttendance(row);
      if (days > 0 || hours > 0) {
        return { record, counted: false, reason: "勤怠にもこの日の有給が入っているので、勤怠のほうを数えています。" };
      }
      const label = WORK_TYPE_LABELS[row.work_type ?? ""] ?? (row.work_type || "出勤");
      return { record, counted: false, reason: `勤怠ではこの日が「${label}」になっているので、数えていません。` };
    }
    const days = Number(record.days_used) || 0;
    if (days <= 0) return { record, counted: false, reason: "日数が0なので、数えていません。" };
    taken.push({ date: record.usage_date, days, hours: 0, source: "manual", manualId: record.id });
    return { record, counted: true, reason: null };
  });

  taken.sort((a, b) => a.date.localeCompare(b.date) || (a.source === b.source ? 0 : a.source === "attendance" ? -1 : 1));
  return { taken, manualChecks };
};

/**
 * 年次有給休暇の残りを数える
 * @param grants 付与（年次有給休暇ではない付与が混ざっていても、数えない）
 * @param taken 有給を取った日（collectLeaveTaken）
 * @param hoursPerDay 時間単位の有給の1日の時間数（leaveHoursPerDay）
 * @param asOf 残りを数える基準の日（YYYY-MM-DD）
 */
export const summarizePaidLeave = (
  grants: LeaveGrantRow[],
  taken: LeaveTaken[],
  hoursPerDay: number,
  asOf: string,
): PaidLeaveSummary => {
  const dayMinutes = hoursPerDay * 60;
  const annual = grants.filter(isAnnualLeaveGrant);
  const toMinutes = (days: number) => Math.round((Number(days) || 0) * dayMinutes);

  // 期限の早い付与（ふつうは古い付与）から引く
  const order = [...annual].sort((a, b) =>
    a.expiry_date.localeCompare(b.expiry_date) || a.grant_date.localeCompare(b.grant_date) || a.id - b.id);
  const left = new Map(order.map((g) => [g.id, toMinutes(g.days_granted)]));
  const used = new Map<number, number>();
  const later = new Map<number, number>();
  const firstGrantDate = annual.reduce<string | null>(
    (min, g) => (min === null || g.grant_date < min ? g.grant_date : min), null);

  const statuses = [...taken]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.source === b.source ? 0 : a.source === "attendance" ? -1 : 1))
    .map((t): TakenStatus => {
      const minutes = Math.round(t.days * dayMinutes + t.hours * 60);
      const afterAsOf = t.date > asOf;
      const beforeFirstGrant = firstGrantDate === null || t.date < firstGrantDate;
      const allocations: { grantId: number; minutes: number }[] = [];
      let need = beforeFirstGrant ? 0 : minutes;
      for (const g of order) {
        if (need <= 0) break;
        if (g.grant_date > t.date || g.expiry_date < t.date) continue;
        const avail = left.get(g.id) ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(avail, need);
        left.set(g.id, avail - take);
        need -= take;
        allocations.push({ grantId: g.id, minutes: take });
        const book = afterAsOf ? later : used;
        book.set(g.id, (book.get(g.id) ?? 0) + take);
      }
      return { ...t, minutes, allocations, shortageMinutes: need, beforeFirstGrant, afterAsOf };
    });

  const grantStatuses = annual.map((grant): GrantStatus => {
    const grantedMinutes = toMinutes(grant.days_granted);
    const usedMinutes = used.get(grant.id) ?? 0;
    const laterMinutes = later.get(grant.id) ?? 0;
    const state = asOf < grant.grant_date ? "upcoming" : asOf > grant.expiry_date ? "expired" : "active";
    return {
      grant,
      grantedMinutes,
      usedMinutes,
      laterMinutes,
      expiredMinutes: state === "expired" ? Math.max(0, grantedMinutes - usedMinutes - laterMinutes) : 0,
      remainingMinutes: state === "active" ? Math.max(0, grantedMinutes - usedMinutes) : 0,
      state,
    };
  });

  return {
    hoursPerDay,
    dayMinutes,
    asOf,
    grants: grantStatuses,
    taken: statuses,
    remainingMinutes: grantStatuses.reduce((sum, g) => sum + g.remainingMinutes, 0),
    hasGrants: annual.length > 0,
    firstGrantDate,
  };
};

const formatTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}時間`;
  return h === 0 ? `${m}分` : `${h}時間${m}分`;
};

/** 分を「9日と5時間」「9.5日」「0日」のように出す */
export const formatLeaveMinutes = (minutes: number, hoursPerDay: number): string => {
  const dayMinutes = hoursPerDay * 60;
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / dayMinutes);
  const rest = total - days * dayMinutes;
  if (rest === 0) return `${days}日`;
  if (rest * 2 === dayMinutes) return `${days}.5日`;
  return days === 0 ? formatTime(rest) : `${days}日と${formatTime(rest)}`;
};

/** 取った日の日数を「1日」「0.5日」「3時間」「0.5日と2時間」のように出す */
export const formatTakenAmount = (t: { days: number; hours: number }): string => {
  const parts: string[] = [];
  if (t.days > 0) parts.push(`${t.days}日`);
  if (t.hours > 0) parts.push(formatTime(Math.round(t.hours * 60)));
  return parts.join("と") || "0日";
};

interface SelectDb {
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** その人の付与・確定した勤怠・前の記録を読み込む（有給の画面と勤怠の画面で同じ読み方にする） */
export const loadPaidLeaveData = async (db: SelectDb, staffId: string | number) => {
  const grants = (await db.select(
    "SELECT id, name, grant_date, expiry_date, days_granted FROM paid_leave_grants WHERE staff_id = ? ORDER BY grant_date DESC, id DESC",
    [staffId],
  )) as LeaveGrantRow[];
  // 給与と同じく、確定した日の勤怠だけを数える
  const attendance = (await db.select(
    "SELECT work_date, work_type, paid_leave_hours FROM attendance WHERE staff_id = ? AND is_finalized = 1",
    [staffId],
  )) as AttendanceLeaveRow[];
  const manual = (await db.select(
    "SELECT id, usage_date, days_used, description FROM paid_leave_usage WHERE staff_id = ? ORDER BY usage_date DESC, id DESC",
    [staffId],
  )) as ManualLeaveRecord[];
  return { grants: grants ?? [], attendance: attendance ?? [], manual: manual ?? [] };
};
