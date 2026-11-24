/**
 * 年次有給休暇管理簿
 *
 * 年次有給休暇を与えたときは、時季・日数・基準日（第一基準日・第二基準日を含む）を労働者ごとに明らかにした書類（年次有給休暇管理簿）を作り、
 * 有給休暇を与えた期間中と、その期間の満了後5年間保存する（労働基準法施行規則24条の7。当分の間は3年間：同附則71条）。
 * 労働者名簿・賃金台帳とあわせて作ってもよい（同55条の2）。
 *
 * Q は、有給休暇管理の画面と同じ数え方（utils/paidLeave.ts：確定した勤怠の「全休(有給)」「半休(有給)」「時間有給」と前の記録を、
 * 期限の早い付与から引く）で、付与（基準日）ごとに、取った日（時季）とその日数・時間、取った合計、期限で消えた分、残りを出す。
 * 年5日の取得（労働基準法39条7項）の期間と取った日数も、その付与の行に付ける（utils/annualLeaveGrant.ts の fiveDayStatuses）。
 */
import { isAnnualLeaveGrant, type PaidLeaveSummary } from "./paidLeave";
import type { FiveDayStatus } from "./annualLeaveGrant";
import { csvField } from "./csvText";

export interface LeaveLedgerTaken {
  date: string;
  /** この付与から引いた分（分） */
  minutes: number;
  /** 取った日の全体（全休 1・半休 0.5、時間有給の時間） */
  days: number;
  hours: number;
  /** 2つの付与から分けて引いた日（残りの分は、ほかの付与の行にある） */
  split: boolean;
}

export interface LeaveLedgerGrant {
  /** 基準日（付与日） */
  grantDate: string;
  expiryDate: string;
  grantedDays: number;
  /** 取った日（時季）。日付の順 */
  taken: LeaveLedgerTaken[];
  /** 取った合計・期限で消えた分・残り（分。残りは基準の日のもの） */
  takenMinutes: number;
  expiredMinutes: number;
  remainingMinutes: number;
  state: "upcoming" | "active" | "expired";
  /** この付与が基準日になった年5日の取得（10日以上の付与だけ） */
  fiveDays: FiveDayStatus | null;
}

export interface LeaveLedger {
  /** 時間単位の有給の1日の時間数 */
  hoursPerDay: number;
  dayMinutes: number;
  asOf: string;
  /** 付与ごと（基準日の新しい順） */
  grants: LeaveLedgerGrant[];
  /** 最初の付与より前に取った日（Q で有給を管理する前の分。どの付与からも引いていない） */
  beforeFirstGrant: { date: string; days: number; hours: number }[];
  /** 残りが足りなくて引けなかった日 */
  shortage: { date: string; minutes: number }[];
}

/** 有給の残りの数え方（summarizePaidLeave）と年5日（fiveDaysOf）から、管理簿を作る */
export const buildLeaveLedger = (summary: PaidLeaveSummary, fiveDays: FiveDayStatus[]): LeaveLedger => {
  const grants = summary.grants
    .filter((g) => isAnnualLeaveGrant(g.grant))
    .map((g): LeaveLedgerGrant => {
      const taken = summary.taken
        .flatMap((t) => t.allocations
          .filter((a) => a.grantId === g.grant.id)
          .map((a) => ({ date: t.date, minutes: a.minutes, days: t.days, hours: t.hours, split: t.allocations.length > 1 || t.shortageMinutes > 0 })))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        grantDate: g.grant.grant_date,
        expiryDate: g.grant.expiry_date,
        grantedDays: Number(g.grant.days_granted) || 0,
        taken,
        takenMinutes: g.usedMinutes + g.laterMinutes,
        expiredMinutes: g.expiredMinutes,
        remainingMinutes: g.remainingMinutes,
        state: g.state,
        fiveDays: fiveDays.find((f) => f.grants.some((x) => x.date === g.grant.grant_date) && f.from === g.grant.grant_date)
          ?? fiveDays.find((f) => f.grants.some((x) => x.date === g.grant.grant_date))
          ?? null,
      };
    })
    .sort((a, b) => b.grantDate.localeCompare(a.grantDate));
  return {
    hoursPerDay: summary.hoursPerDay,
    dayMinutes: summary.dayMinutes,
    asOf: summary.asOf,
    grants,
    beforeFirstGrant: summary.taken.filter((t) => t.beforeFirstGrant).map((t) => ({ date: t.date, days: t.days, hours: t.hours })),
    shortage: summary.taken.filter((t) => t.shortageMinutes > 0 && !t.beforeFirstGrant).map((t) => ({ date: t.date, minutes: t.shortageMinutes })),
  };
};

/**
 * 年次有給休暇の付与通知書（1人1枚。従業員に渡す）に書くこと
 * 法律で決まった書類ではないが、一般的な給与ソフトにあるもの。いちばん新しい付与（期限が切れていないもの）について、
 * 付与日・付与日数・有効期限（付与日から2年。労働基準法115条）と、いま使える残り（前の付与から繰り越した分を含む）、
 * 年5日の取得の期間（労働基準法39条7項）と取った日数、時間単位で取れる上限（1年に5日分。同39条4項）を出す。
 */
export interface GrantNotice {
  grant: LeaveLedgerGrant;
  /** ほかの付与（前の年の分）の、いま使える残り（分） */
  carriedMinutes: number;
  /** いま使える残りの合計（分。付与日の前なら、この付与の日数を足した数） */
  totalMinutes: number;
  /** 時間単位で取れるのは1年に何時間まで（5日分。時間単位の有給を使わない会社は null） */
  hourlyLimitHours: number | null;
}

/** 時間単位の有給は、1年に5日分まで（労働基準法39条4項2号） */
export const HOURLY_LEAVE_DAYS_LIMIT = 5;

export const buildGrantNotice = (ledger: LeaveLedger, hourlyLeave: boolean): GrantNotice | null => {
  const grant = ledger.grants.find((g) => g.state !== "expired");
  if (!grant) return null;
  const others = ledger.grants.filter((g) => g !== grant && g.state === "active");
  const carriedMinutes = others.reduce((sum, g) => sum + g.remainingMinutes, 0);
  const own = grant.state === "active" ? grant.remainingMinutes : grant.grantedDays * ledger.dayMinutes;
  return {
    grant,
    carriedMinutes,
    totalMinutes: carriedMinutes + own,
    hourlyLimitHours: hourlyLeave ? HOURLY_LEAVE_DAYS_LIMIT * ledger.hoursPerDay : null,
  };
};

/** 分を「3日」「2日と4時間」「4時間」にする */
export const leaveAmountLabel = (minutes: number, dayMinutes: number): string => {
  if (minutes <= 0) return "0日";
  const days = Math.floor(minutes / dayMinutes);
  const rest = minutes - days * dayMinutes;
  // 半日（1日の半分）は「0.5日」にする
  if (rest > 0 && rest * 2 === dayMinutes) return `${days + 0.5}日`;
  const hours = Math.round((rest / 60) * 100) / 100;
  if (days > 0 && rest > 0) return `${days}日と${hours}時間`;
  if (days > 0) return `${days}日`;
  return `${hours}時間`;
};

/** 取った日の種類（全休・半休・時間有給） */
export const takenKindLabel = (t: { days: number; hours: number }): string => {
  const parts: string[] = [];
  if (t.days >= 1) parts.push("全休");
  else if (t.days > 0) parts.push("半休");
  if (t.hours > 0) parts.push(`時間有給 ${t.hours}時間`);
  return parts.join("・") || "—";
};

/** 管理簿の CSV（1行に1つの取った日。取った日がない付与も1行出す） */
export const leaveLedgerCsv = (people: { staffId: string; name: string; ledger: LeaveLedger }[]): string => {
  const head = ["社員番号", "氏名", "基準日（付与日）", "有効期限", "付与日数", "取得日（時季）", "取得の種類", "この付与から引いた日数", "取得日数の合計", "期限で消えた日数", "残日数", "年5日の期間", "年5日の取得日数", "年5日の状況"];
  const lines: string[][] = [head];
  const fiveState = (f: FiveDayStatus | null) => !f ? "" : f.state === "done" ? "取れた" : f.state === "overdue" ? "期間が過ぎて足りない" : f.state === "upcoming" ? "基準日の前" : `あと${f.remainingDays}日`;
  for (const p of people) {
    const l = p.ledger;
    for (const g of l.grants) {
      const common = [
        p.staffId, p.name, g.grantDate, g.expiryDate, String(g.grantedDays),
      ];
      const tail = [
        leaveAmountLabel(g.takenMinutes, l.dayMinutes), leaveAmountLabel(g.expiredMinutes, l.dayMinutes), leaveAmountLabel(g.remainingMinutes, l.dayMinutes),
        g.fiveDays ? `${g.fiveDays.from}〜${g.fiveDays.to}` : "", g.fiveDays ? String(g.fiveDays.takenDays) : "", fiveState(g.fiveDays),
      ];
      if (g.taken.length === 0) lines.push([...common, "", "", "", ...tail]);
      for (const t of g.taken) {
        lines.push([...common, t.date, takenKindLabel(t), leaveAmountLabel(t.minutes, l.dayMinutes), ...tail]);
      }
    }
  }
  return lines.map((cells) => cells.map(csvField).join(",")).join("\r\n") + "\r\n";
};
