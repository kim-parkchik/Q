/**
 * 健康保険の傷病手当金・出産手当金の支給申請書の「事業主記入用」（事業主が証明するところ）に書く内容
 *
 * 決まりは、全国健康保険協会（協会けんぽ）「健康保険 傷病手当金 支給申請書 記入の手引き」（令和8年10月）と
 * 「健康保険 出産手当金 支給申請書 記入の手引き」（令和8年3月）の事業主記入用のページによる。申請書は協会けんぽの様式に書く
 * （健康保険組合の人は、組合の様式。書く内容はほぼ同じ）ので、Q は書き写す内容を出す。
 *
 * ■ 勤務状況：申請期間のうち、出勤した日（所定労働時間の一部だけ働いた日も含む）に〇を付ける。年・月は、出勤の有無に関わらず書く。
 *   早退した日は「早」。有給休暇・公休日は書かない。申請期間が3か月を超えるときは、申請書を分ける（傷病手当金の手引き）。
 *   Q は、勤怠で働いた時間がある日を出勤した日にし、所定労働時間より短い日を「早退なら『早』」の候補として出す（遅刻と見分けられないため）
 * ■ 賃金支給状況：申請期間のうち、出勤していない日（〇の日以外の日）に対して報酬等を支給したときは、支給した日（期間）と金額を書く（10行まで。
 *   書ききれないときは申請書を分ける）。
 *   ・書くもの：有給休暇の賃金、出勤等の有無に関わらず支給している手当（通勤手当・扶養手当・住宅手当等）、食事・住居等の現物
 *   ・書かないもの：残業手当など出勤した日の報酬、見舞金など一時的なもの、社会保険適用促進手当など標準報酬月額に考慮されない報酬、
 *     支給していない報酬（0円の行は書かない）
 *   ・有給休暇は、額が同じで期間が続いていれば、まとめて書く（例：12月29日〜12月30日 16,000円）
 *   ・通勤手当など一定期間分をまとめて払うときは、対象期間と金額を書く（例：11月1日〜11月30日の扶養手当 10,000円）
 * ■ 証明日は、申請期間が過ぎた後の日付
 *
 * Q で出す候補（確定した給与の内訳（賃金台帳の内訳）と勤怠から。画面で選び直し・直せる）：
 *   ・有給休暇（特別休暇の有給を含む）を取って出勤しなかった日：時給制・日給制は、その計算期間の「有給休暇手当」「特別休暇手当」を、
 *     休暇の時間で分けた額。月給制は、基本給 ÷ 月給を払った日数（休業の月の日割りの日数、なければ所定労働日数）を1日分とする
 *   ・月額の通勤手当（日額の通勤手当は出勤した日の分なので入れない）・現物の報酬・休業手当：出勤しなかった日がある計算期間の分を入れる
 *   ・そのほかの月額の手当（扶養手当・住宅手当など・固定残業代）と月給制の基本給：Q の給与では、休業（従業員の画面の休業・休職）の日の分は
 *     日割りして払わないので、休業の月の日割りを「しない」にしているときだけ入れる。休業でない欠勤の日には、手当は引かない
 *     （基本給は欠勤控除をしない完全月給制のときだけ）ので、欠勤の日がある計算期間の手当は入れる
 */
import dayjs from "dayjs";
import type { PayLedger } from "./legalBooks";
import type { LeavePeriod } from "./leaveExemption";

export type CertKind = "shoubyou" | "shussan";

export const CERT_KIND_LABELS: Record<CertKind, string> = {
  shoubyou: "傷病手当金",
  shussan: "出産手当金",
};

export interface CertAttendance {
  date: string;
  workType: string;
  workHours: number;
  paidLeaveHours: number;
  specialLeaveHours: number;
  /** 特別休暇が有給か */
  leavePaid: boolean;
}

export interface CertSalary {
  periodStart: string;
  periodEnd: string;
  ledger: PayLedger;
  /** 計算期間の所定労働日数 */
  prescribedDays: number | null;
  /** 休業の日がある月に月給を払った日数 */
  leavePaidDays: number | null;
}

export interface CertInput {
  from: string;
  to: string;
  wageType: string;
  /** 1日の所定労働時間 */
  scheduledHours: number;
  /** 申請期間にかかる計算期間の勤怠（申請期間の外の日も入れる。有給の時間で分けるため） */
  attendance: CertAttendance[];
  /** 申請期間にかかる、確定した給与 */
  salaries: CertSalary[];
  leavePeriods: LeavePeriod[];
  /** 給与規定グループの「休業の月の日割り」と「欠勤控除」 */
  leaveProration: string;
  absenceDeduction: string;
}

export interface CertMonth {
  year: number;
  month: number;
  /** 出勤した日（〇） */
  worked: number[];
  /** 所定労働時間より短い日（早退なら「早」） */
  short: number[];
}

export interface CertPayRow {
  key: string;
  from: string;
  to: string;
  amount: number | null;
  /** 何の報酬か（画面に出す。申請書には書かない） */
  label: string;
  /** 初めに書くか */
  checked: boolean;
  /** 初めは書かない理由・確かめること */
  hint?: string;
}

export interface CertResult {
  months: CertMonth[];
  rows: CertPayRow[];
  notes: string[];
}

const fmt = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
const eachDay = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) out.push(fmt(d));
  return out;
};
const inLeave = (date: string, periods: LeavePeriod[]) => periods.some((p) => date >= p.start && (!p.end || date <= p.end));
const worked = (a: CertAttendance | undefined) => !!a && a.workHours > 0;

/** 有給休暇（特別休暇の有給を含む）の時間（1日の所定労働時間で数える。働いた日は0） */
const paidHoursOf = (a: CertAttendance | undefined, scheduled: number): { paid: number; special: number } => {
  if (!a || worked(a)) return { paid: 0, special: 0 };
  const paid = a.workType === "paid_full" ? scheduled : a.workType === "paid_half" ? scheduled / 2 : a.paidLeaveHours;
  const special = !a.leavePaid ? 0 : a.workType === "special" ? scheduled : a.workType === "special_half" ? scheduled / 2 : a.specialLeaveHours;
  return { paid: Math.max(0, paid || 0), special: Math.max(0, special || 0) };
};

/** 申請期間の勤務状況（月ごと） */
export const certMonths = (input: Pick<CertInput, "from" | "to" | "attendance" | "scheduledHours">): CertMonth[] => {
  const byDate = new Map(input.attendance.map((a) => [a.date, a]));
  const months: CertMonth[] = [];
  for (const date of eachDay(input.from, input.to)) {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    let cur = months[months.length - 1];
    if (!cur || cur.year !== y || cur.month !== m) {
      cur = { year: y, month: m, worked: [], short: [] };
      months.push(cur);
    }
    const a = byDate.get(date);
    if (!worked(a)) continue;
    const day = Number(date.slice(8, 10));
    cur.worked.push(day);
    const covered = a!.workHours + (a!.paidLeaveHours || 0) + (a!.leavePaid ? a!.specialLeaveHours || 0 : 0);
    if (a!.workType !== "holiday" && input.scheduledHours > 0 && covered < input.scheduledHours - 1e-9) cur.short.push(day);
  }
  return months;
};

const lineAmount = (ledger: PayLedger, name: string) => ledger.earnings.filter((l) => l.name === name).reduce((s, l) => s + l.amount, 0);

/** 支給していて、出勤した日の分ではない月額の行か（基本給・時給・残業代・有給・休業・控除の行を除く） */
const WORK_LINES = new Set(["基本給", "日給", "時給分", "有給休暇手当", "特別休暇手当", "休業手当", "休業補償(労災の待期)"]);
const isWorkLine = (name: string) => WORK_LINES.has(name) || /^時間外手当|^休日出勤手当|^深夜手当|控除$/.test(name);

/** 書く内容を作る */
export const buildBenefitCert = (input: CertInput): CertResult => {
  const notes: string[] = [];
  const byDate = new Map(input.attendance.map((a) => [a.date, a]));
  const months = certMonths(input);
  const monthly = input.wageType !== "hourly" && input.wageType !== "daily";
  const rows: CertPayRow[] = [];

  // 申請期間にかかるのに、確定していない給与がないか（計算期間でわかる分だけ）
  const covered = (d: string) => input.salaries.some((s) => d >= s.periodStart && d <= s.periodEnd);
  const uncovered = eachDay(input.from, input.to).filter((d) => !covered(d));
  if (uncovered.length > 0) notes.push(`申請期間のうち ${uncovered[0]}〜${uncovered[uncovered.length - 1]} の給与が確定していないので、その期間の賃金の支給は入れていません。`);

  for (const s of [...input.salaries].sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const overlap = eachDay(s.periodStart > input.from ? s.periodStart : input.from, s.periodEnd < input.to ? s.periodEnd : input.to);
    if (overlap.length === 0 || overlap[0] > overlap[overlap.length - 1]) continue;
    const absentDays = overlap.filter((d) => !worked(byDate.get(d)));
    if (absentDays.length === 0) continue;
    const leaveDays = absentDays.filter((d) => inLeave(d, input.leavePeriods));
    const otherAbsent = absentDays.filter((d) => !inLeave(d, input.leavePeriods) && byDate.get(d)?.workType === "absent");

    // 有給休暇の日：1日分の額で、続いている日をまとめる
    const all = eachDay(s.periodStart, s.periodEnd);
    const hoursAll = all.reduce((t, d) => { const h = paidHoursOf(byDate.get(d), input.scheduledHours); return { paid: t.paid + h.paid, special: t.special + h.special }; }, { paid: 0, special: 0 });
    const paidPay = lineAmount(s.ledger, "有給休暇手当");
    const specialPay = lineAmount(s.ledger, "特別休暇手当");
    const basePay = lineAmount(s.ledger, "基本給");
    const perDayMonthly = monthly ? (() => {
      const days = s.leavePaidDays ?? s.prescribedDays;
      return days && days > 0 ? Math.floor(basePay / days) : null;
    })() : null;
    const dayAmount = (d: string): number | null => {
      const h = paidHoursOf(byDate.get(d), input.scheduledHours);
      if (h.paid + h.special <= 0) return 0;
      if (monthly) {
        if (perDayMonthly === null || input.scheduledHours <= 0) return null;
        return Math.floor((perDayMonthly * (h.paid + h.special)) / input.scheduledHours);
      }
      const p = hoursAll.paid > 0 ? Math.round((paidPay * h.paid) / hoursAll.paid) : 0;
      const q = hoursAll.special > 0 ? Math.round((specialPay * h.special) / hoursAll.special) : 0;
      return p + q;
    };
    const runs: { from: string; to: string; per: number | null; total: number | null }[] = [];
    for (const d of overlap) {
      const v = dayAmount(d);
      if (v !== null && v <= 0) continue;
      const last = runs[runs.length - 1];
      if (last && last.per === v && fmt(dayjs(last.to).add(1, "day")) === d) {
        last.to = d;
        last.total = last.total === null || v === null ? null : last.total + v;
      } else {
        runs.push({ from: d, to: d, per: v, total: v });
      }
    }
    for (const r of runs) {
      rows.push({
        key: `paid:${r.from}`, from: r.from, to: r.to, amount: r.total, label: "有給休暇", checked: true,
        ...(r.total === null ? { hint: "1日分の額がわからないので、有給の日に払った賃金を入れてください" } : {}),
      });
    }

    // 出勤の有無に関わらず支給している手当・現物・休業手当
    const commute = s.ledger.earnings.filter((l) => l.name === "通勤手当" && l.avg === "month").reduce((t, l) => t + l.amount, 0);
    if (commute > 0) rows.push({ key: `commute:${s.periodStart}`, from: s.periodStart, to: s.periodEnd, amount: commute, label: "通勤手当（月額）", checked: true });
    const shutdown = lineAmount(s.ledger, "休業手当");
    if (shutdown > 0) rows.push({ key: `shutdown:${s.periodStart}`, from: s.periodStart, to: s.periodEnd, amount: shutdown, label: "休業手当（会社都合で休ませた日）", checked: true });
    for (const l of s.ledger.inKind ?? []) {
      if (l.amount > 0) rows.push({ key: `inkind:${s.periodStart}:${l.name}`, from: s.periodStart, to: s.periodEnd, amount: l.amount, label: `現物（${l.name}）`, checked: true });
    }
    const paidForLeave = leaveDays.length > 0 && input.leaveProration === "none";
    const allowanceForAbsence = otherAbsent.length > 0;
    for (const l of s.ledger.earnings) {
      if (l.amount <= 0 || isWorkLine(l.name) || l.name === "通勤手当" || l.avg !== "month") continue;
      rows.push({
        key: `allowance:${s.periodStart}:${l.name}`, from: s.periodStart, to: s.periodEnd, amount: l.amount, label: l.name,
        checked: paidForLeave || allowanceForAbsence,
        ...(paidForLeave || allowanceForAbsence ? {} : { hint: "休業の日の分は日割りして払っていないので、初めは書きません（出勤の有無に関わらず払っているなら印を付けます）" }),
      });
    }
    if (monthly && basePay > 0 && (paidForLeave || (otherAbsent.length > 0 && input.absenceDeduction === "none"))) {
      rows.push({
        key: `base:${s.periodStart}`, from: s.periodStart, to: s.periodEnd, amount: basePay + lineAmount(s.ledger, "欠勤控除"),
        label: paidForLeave ? "基本給（休業の日も日割りせずに払った）" : "基本給（欠勤控除をしない完全月給）", checked: true,
      });
    }
  }
  // 支給した日（期間）の順。同じ期間なら、基本給・手当・通勤手当・休業手当・現物・有給休暇の順
  const rank = (k: string) => ["base", "allowance", "commute", "shutdown", "inkind", "paid"].indexOf(k.split(":")[0]);
  rows.sort((a, b) => a.from.localeCompare(b.from) || rank(a.key) - rank(b.key));
  if (months.length > 3) notes.push("申請期間が3か月を超えています。申請書を分けてください（勤務状況の欄は3か月分です）。");
  if (rows.filter((r) => r.checked).length > 10) notes.push("賃金支給状況が10行を超えています。1枚に書ききれないときは、申請書を分けます。");
  return { months, rows, notes };
};

/** 申請期間の初めの値：出産手当金は産前産後休業、傷病手当金はその他の休職（いちばん新しいもの） */
export const defaultCertPeriod = (kind: CertKind, periods: LeavePeriod[]): { from: string; to: string } | null => {
  const list = periods.filter((p) => (kind === "shussan" ? p.type === "maternity" : p.type === "other")).sort((a, b) => b.start.localeCompare(a.start));
  const p = list[0];
  return p ? { from: p.start, to: p.end || p.start } : null;
};
