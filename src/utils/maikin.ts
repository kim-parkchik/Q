/**
 * 毎月勤労統計調査（全国調査・地方調査）の調査票（第一種事業所用）に書く数
 *
 * 厚生労働省「毎月勤労統計調査 全国調査及び地方調査 調査票の記入要領」（令和8年7月）による（文字認識で読んで確かめた）。
 * 調査の対象に指定された事業所だけが、調査月の翌月10日までに出す（オンライン回答か郵送）。
 * ・調査期間：給与締切日の翌日から次の給与締切日まで（締切日がなければ1日〜末日）。締切日が15日以降なら締切日のある月、
 *   14日以前なら期間の初めの月が調査月（例：20日締め → 12月21日〜1月20日が1月分、10日締め → 1月11日〜2月10日が1月分）
 * ・常用労働者：期間を定めずに、又は1か月以上の期間を定めて雇われている人（事業主・法人の代表者、無給の家族従業者を除く）。
 *   男・女と、そのうちパートタイム労働者（1日の所定労働時間が一般の労働者より短いか、週の所定労働日数が少ない人）に分ける
 * ・5 常用労働者数：前調査期間の末日・増加（採用など）・減少（退職・解雇・死亡。末日付けを含む）・本調査期間の末日
 * ・6 出勤日数：実際に就業した延べ日数（1時間でも就業すれば1日。丸1日の有給休暇は含めない）
 * ・7 実労働時間数：所定内と所定外（早出・残業・休日出勤。固定残業代の分も含む）。30分以上は切り上げ、30分未満は切り捨て
 * ・8 現金給与額：きまって支給する給与（超過労働給与を含む）と特別に支払われた給与（賞与など）。百円の位で四捨五入して千円単位
 * Q では、調査期間の確定した給与（賃金台帳の内訳）と、調査期間に払った賞与から数える。
 */
import dayjs from "dayjs";
import { parseLedger } from "./legalBooks";
import { weeklyWorkDaysOf } from "./koyoInfo";

/** 調査月の調査期間（closingDay は 1〜28・99：末日） */
export const maikinPeriod = (year: number, month: number, closingDay: number): { from: string; to: string } => {
  if (closingDay === 99) {
    const d = dayjs(new Date(year, month - 1, 1));
    return { from: d.format("YYYY-MM-DD"), to: d.endOf("month").format("YYYY-MM-DD") };
  }
  // 15日以降の締切日：その月の締切日で終わる期間。14日以前：その月の締切日の翌日から次の月の締切日まで
  const to = closingDay >= 15 ? dayjs(new Date(year, month - 1, closingDay)) : dayjs(new Date(year, month, closingDay));
  return { from: to.subtract(1, "month").add(1, "day").format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
};

export interface MaikinCell {
  men: number;
  women: number;
  /** うちパートタイム労働者（男女の合計） */
  part: number;
}
const cell = (): MaikinCell => ({ men: 0, women: 0, part: 0 });
const add = (c: MaikinCell, s: { woman: boolean; part: boolean }, n: number) => {
  if (s.woman) c.women += n;
  else c.men += n;
  if (s.part) c.part += n;
};

export interface MaikinResult {
  from: string;
  to: string;
  start: MaikinCell;
  increase: MaikinCell;
  decrease: MaikinCell;
  end: MaikinCell;
  days: MaikinCell;
  /** 実労働時間数（所定内・所定外。時間。四捨五入した整数） */
  scheduledHours: MaikinCell;
  overtimeHours: MaikinCell;
  /** 現金給与額（千円。百円の位で四捨五入） */
  regularPay: MaikinCell;
  overtimePay: MaikinCell;
  specialPay: MaikinCell;
  /** 特別に支払われた給与の名称と額（円） */
  specialItems: { name: string; amount: number }[];
  /** 確定した給与がなかった人 */
  missing: string[];
  notes: string[];
}

export interface MaikinSalary {
  staffId: string;
  ledger: unknown;
  totalEarnings: number;
}
export interface MaikinBonus {
  staffId: string;
  name: string;
  amount: number;
}

/** 超過労働給与の行（残業・休日出勤・深夜の手当と固定残業代） */
const OVERTIME_LINE = /時間外|休日出勤|深夜|固定残業/;

/** 一般の労働者の1日の所定労働時間（月給の人に多い時間。なければ、いちばん長い時間） */
export const standardDailyHours = (staff: any[]): number => {
  const count = new Map<number, number>();
  for (const s of staff.filter((x) => x.wage_type === "monthly")) {
    const h = Number(s.scheduled_work_hours) || 0;
    if (h > 0) count.set(h, (count.get(h) ?? 0) + 1);
  }
  if (count.size > 0) return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  return Math.max(0, ...staff.map((s) => Number(s.scheduled_work_hours) || 0));
};

export const isPartTime = (s: any, standardHours: number): boolean =>
  (Number(s.scheduled_work_hours) || 0) < standardHours || weeklyWorkDaysOf(s) < 5;

const employedOn = (s: any, date: string) => {
  const join = String(s?.join_date ?? "");
  const leave = String(s?.retirement_date ?? "");
  return (!join || join <= date) && (!leave || leave >= date);
};
const thousand = (yen: number) => Math.floor(yen / 1000 + 0.5);

/**
 * 調査票の数（staff はその事業所の従業員。salaries は調査期間の確定した給与、bonuses は調査期間に払った賞与）
 */
export const maikinResult = (staff: any[], period: { from: string; to: string }, salaries: MaikinSalary[], bonuses: MaikinBonus[]): MaikinResult => {
  const people = staff.filter((s) => Number(s.is_executive) !== 1);
  const standard = standardDailyHours(people);
  const kind = (s: any) => ({ woman: s.gender === "female", part: isPartTime(s, standard) });
  const r: MaikinResult = {
    ...period, start: cell(), increase: cell(), decrease: cell(), end: cell(), days: cell(), scheduledHours: cell(), overtimeHours: cell(),
    regularPay: cell(), overtimePay: cell(), specialPay: cell(), specialItems: [], missing: [], notes: [],
  };
  const dayBefore = dayjs(period.from).subtract(1, "day").format("YYYY-MM-DD");
  const yen = { regular: cell(), overtime: cell(), special: cell() };
  const hours = { scheduled: cell(), overtime: cell() };
  for (const s of people) {
    const k = kind(s);
    const join = String(s.join_date ?? "");
    const leave = String(s.retirement_date ?? "");
    if (employedOn(s, dayBefore)) add(r.start, k, 1);
    if (join >= period.from && join <= period.to) add(r.increase, k, 1);
    if (leave >= period.from && leave <= period.to) add(r.decrease, k, 1);
    const working = (!join || join <= period.to) && (!leave || leave >= period.from);
    if (!working) continue;
    const sal = salaries.find((x) => x.staffId === String(s.id));
    if (!sal) {
      r.missing.push(String(s.name ?? ""));
      continue;
    }
    const l = parseLedger(sal.ledger);
    if (l) {
      add(r.days, k, l.workDays);
      // 所定外労働時間：法定時間外・法定休日と、所定労働時間が8時間より短い人の法定内の残業の時間
      const over = l.overtimeHours + (l.statutoryOvertimeHours ?? 0) + l.holidayHours;
      add(hours.overtime, k, over);
      add(hours.scheduled, k, Math.max(0, l.workHours - over));
      const overtimePay = l.earnings.filter((x) => OVERTIME_LINE.test(x.name)).reduce((sum, x) => sum + Math.max(0, x.amount), 0);
      add(yen.regular, k, l.earnings.reduce((sum, x) => sum + Math.max(0, x.amount), 0));
      add(yen.overtime, k, overtimePay);
    } else {
      add(yen.regular, k, Math.max(0, sal.totalEarnings));
      r.notes.push(`${s.name}：内訳がない給与なので、出勤日数・時間数を数えていません`);
    }
  }
  const items = new Map<string, number>();
  for (const b of bonuses) {
    const s = people.find((x) => String(x.id) === b.staffId);
    if (!s) continue;
    add(yen.special, kind(s), Math.max(0, b.amount));
    items.set(b.name, (items.get(b.name) ?? 0) + Math.max(0, b.amount));
  }
  r.specialItems = [...items.entries()].map(([name, amount]) => ({ name, amount }));
  for (const key of ["men", "women", "part"] as const) {
    r.end[key] = r.start[key] + r.increase[key] - r.decrease[key];
    r.scheduledHours[key] = Math.round(hours.scheduled[key]);
    r.overtimeHours[key] = Math.round(hours.overtime[key]);
    r.regularPay[key] = thousand(yen.regular[key]);
    r.overtimePay[key] = thousand(yen.overtime[key]);
    r.specialPay[key] = thousand(yen.special[key]);
  }
  r.notes.push(`パートタイム労働者は、1日の所定労働時間が ${standard}時間（月給の人に多い時間）より短いか、出勤する曜日が週5日より少ない人として数えました。`);
  r.notes.push("所定外労働時間は、法定時間外・法定休日の時間と、所定労働時間が8時間より短い人の法定内の残業の時間です（法定内の残業の時間は、この機能を入れたあとに確定した給与から数えます）。");
  return r;
};
