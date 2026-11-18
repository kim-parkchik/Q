/**
 * 雇用保険の給付の申請に、事業主が書く内容（印刷する。e-Gov の画面で入れるか、紙の申請書に書き写す）
 * ・育児休業給付金（受給資格確認票・支給申請書）：休業開始時賃金月額証明書（育児）と、支給単位期間ごとの就業日数・就業時間・
 *   支払われた賃金額
 * ・出生時育児休業給付金（産後パパ育休）：休業開始時賃金月額証明書と、休業期間の就業日数・就業時間・支払われた賃金額
 * ・介護休業給付金：休業開始時賃金月額証明書（介護）と、支給単位期間ごとの就業日数・支払われた賃金額
 * ・高年齢雇用継続基本給付金：六十歳到達時等賃金証明書と、支給対象月（暦月）ごとに支払われた賃金額
 * ・育児時短就業給付金：育児時短就業開始時賃金証明書と、支給対象月ごとに支払われた賃金額
 * 賃金の証明（⑧〜⑬）は離職証明書と同じ形（utils/wageCertificate.ts）。休業を始めた日（女性が産前産後休業に続けて育児休業を
 * したときは、産前休業を始めた日）の前日を「離職日」とみなして作る。
 * ■ 支給単位期間：休業を始めた日から1か月ごとに区切った期間（応当日がない月は月末を応当日とみなす）。最後は休業を終えた日まで
 * ■ 支払われた賃金額：その期間に支払日のある賃金のうち、休業期間を対象としていることが明確な賃金だけ（休業前の期間を含む給与は
 *   入れない）（手引き：支給単位期間に支給された賃金とは「その期間に支払日のあるもの」）
 * 出典：厚生労働省「雇用保険事務手続きの手引き【第３編】育児休業給付・介護休業給付・高年齢雇用継続給付編」（令和８年８月版）
 */
import dayjs from "dayjs";
import type { PayrollGroupForPeriod } from "./payrollPeriod";
import { getPeriodForPayMonth } from "./payrollPeriod";
import { parseLeavePeriods, type LeavePeriod } from "./leaveExemption";
import { parseLedger } from "./legalBooks";
import { birthdayAt } from "./calcSalary";
import { buildWageCertificate, type WageCertDay, type WageCertResult, type WageCertSalary } from "./wageCertificate";
import { formatWareki } from "./wareki";
import { formatKoyoNumber } from "./koyoCsv";
import { koyoAcquiredOn, parseKoyoInfo } from "./koyoInfo";
import type { PrintItem } from "./printForms";

export type BenefitKind = "childcare" | "papa" | "family_care" | "elderly" | "short_time";

export const BENEFIT_TITLES: Record<BenefitKind, { title: string; cert: string; units: string }> = {
  childcare: { title: "育児休業給付受給資格確認票・育児休業給付金支給申請書", cert: "雇用保険被保険者休業開始時賃金月額証明書（育児）", units: "支給単位期間" },
  papa: { title: "出生時育児休業給付金支給申請書", cert: "雇用保険被保険者休業開始時賃金月額証明書（育児）", units: "出生時育児休業期間" },
  family_care: { title: "介護休業給付金支給申請書", cert: "雇用保険被保険者休業開始時賃金月額証明書（介護）", units: "支給単位期間" },
  elderly: { title: "高年齢雇用継続給付受給資格確認票・（初回）高年齢雇用継続給付支給申請書", cert: "雇用保険被保険者六十歳到達時等賃金証明書", units: "支給対象月" },
  short_time: { title: "育児時短就業給付受給資格確認票・（初回）育児時短就業給付金支給申請書", cert: "雇用保険被保険者育児時短就業開始時賃金証明書", units: "支給対象月" },
};

/** 支給単位期間（または支給対象月）の1行 */
export interface BenefitUnit {
  from: string;
  to: string;
  /** 就業日数・就業時間（休業期間の中で働いた日と時間） */
  workDays: number;
  workHours: number;
  /** 支払われた賃金額（その期間に支払日のある、休業期間の分の賃金） */
  paid: number;
  note: string;
}

export interface BenefitDoc {
  key: string;
  kind: BenefitKind;
  title: string;
  certTitle: string;
  unitTitle: string;
  who: string;
  items: PrintItem[];
  /** 賃金の証明（⑧〜⑬） */
  cert: WageCertResult | null;
  /** 賃金の証明の「離職日」とみなす日（休業を始めた日の前日など） */
  certEnd: string;
  units: BenefitUnit[];
  problems: string[];
  notes: string[];
}

export interface BenefitData {
  staff: any;
  group: PayrollGroupForPeriod & { payment_day?: number | null; absence_deduction_method?: string | null };
  salaries: WageCertSalary[];
  attendance: WageCertDay[];
  isWorkDay?: (date: string) => boolean;
  /** 雇用保険適用事業所番号 */
  koyoNumber: string;
  today: string;
}

const fmt = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
const addDays = (date: string, n: number) => fmt(dayjs(date).add(n, "day"));
const w = (date: string | null | undefined) => (date ? formatWareki(date) : "");

/** 支給単位期間（休業を始めた日から1か月ごと。最後は終わりの日まで） */
export const benefitUnits = (start: string, end: string): { from: string; to: string }[] => {
  const out: { from: string; to: string }[] = [];
  if (!start || !end || end < start) return out;
  for (let k = 0; k < 60; k++) {
    const from = fmt(dayjs(start).add(k, "month"));
    if (from > end) break;
    const next = fmt(dayjs(start).add(k + 1, "month"));
    const to = addDays(next, -1) < end ? addDays(next, -1) : end;
    out.push({ from, to });
  }
  return out;
};

/** 暦月ごとの期間（from の月から to の月まで。高年齢雇用継続給付・育児時短就業給付の支給対象月） */
export const calendarMonths = (from: string, to: string): { from: string; to: string }[] => {
  const out: { from: string; to: string }[] = [];
  for (let d = dayjs(from).startOf("month"); !d.isAfter(dayjs(to), "month"); d = d.add(1, "month")) {
    out.push({ from: fmt(d), to: fmt(d.endOf("month")) });
  }
  return out;
};

/** 給与の支払日（支払った年月の、給与規定グループの支払日。その月にない日は月末） */
export const payDateOf = (group: { payment_day?: number | null }, year: number, month: number): string => {
  const base = dayjs(new Date(year, month - 1, 1));
  const day = Math.min(Number(group.payment_day) || 25, base.daysInMonth());
  return fmt(base.date(day));
};

const periodOf = (s: WageCertSalary, group: PayrollGroupForPeriod) => {
  const l = parseLedger(s.ledger);
  if (l?.periodStart && l.periodEnd) return { start: l.periodStart, end: l.periodEnd };
  const p = getPeriodForPayMonth(group, s.target_year, s.target_month);
  return { start: p.startStr, end: p.endStr };
};

/** 労働保険の賃金（支給合計 − 賃金でない額 ＋ 雇用保険の賃金に入れる現物） */
const wageOf = (s: WageCertSalary) => (Number(s.total_earnings) || 0) - (Number(s.non_remuneration) || 0) + (Number(s.in_kind_emp) || 0);

/**
 * 1つの期間の就業日数・就業時間・支払われた賃金額
 * @param leave 休業期間（その中で働いた日を数え、その期間だけの給与を入れる。null なら期間のすべて（高年齢雇用継続給付など））
 */
export const unitFigures = (
  unit: { from: string; to: string }, data: BenefitData, leave: { start: string; end: string } | null,
): BenefitUnit => {
  const inLeave = (d: string) => !leave || (d >= leave.start && d <= leave.end);
  let workDays = 0;
  let workHours = 0;
  for (const r of data.attendance) {
    if (r.work_date < unit.from || r.work_date > unit.to || !inLeave(r.work_date)) continue;
    const h = Number(r.work_hours) || 0;
    if (h > 0) {
      workDays++;
      workHours += h;
    }
  }
  let paid = 0;
  const skipped: string[] = [];
  for (const s of data.salaries) {
    const payDate = payDateOf(data.group, s.target_year, s.target_month);
    if (payDate < unit.from || payDate > unit.to) continue;
    const p = periodOf(s, data.group);
    if (!leave || (p.start >= leave.start && p.end <= leave.end)) paid += wageOf(s);
    else if (wageOf(s) > 0) skipped.push(`${Number(payDate.slice(5, 7))}月${Number(payDate.slice(8, 10))}日`);
  }
  const note = skipped.length > 0 ? `${skipped.join("・")}に払った給与は休業前の期間の分を含むので入れていません（休業中に働いた分があれば足します）` : "";
  return { ...unit, workDays, workHours: Math.round(workHours * 10) / 10, paid, note };
};

const certFor = (data: BenefitData, end: string, elderly = false): WageCertResult =>
  buildWageCertificate({
    endDate: end, acquiredOn: koyoAcquiredOn(data.staff), elderly, staff: data.staff, group: data.group,
    salaries: data.salaries, attendance: data.attendance, isWorkDay: data.isWorkDay,
    commuteLumps: parseKoyoInfo(data.staff.koyo_info).commuteLumps,
  });

const personItems = (data: BenefitData): PrintItem[] => [
  { label: "被保険者番号", value: formatKoyoNumber(data.staff.employment_ins_num) },
  { label: "事業所番号", value: formatKoyoNumber(data.koyoNumber) },
  { label: "被保険者の氏名（フリガナ）", value: `${data.staff.name ?? ""}（${data.staff.furigana ?? ""}）` },
  { label: "生年月日", value: w(data.staff.birthday) },
];

/** 産前産後休業に続けて育児休業をしたときは、産前休業を始めた日（休業開始時賃金月額の起算点） */
export const childcareCertStart = (leaves: LeavePeriod[], leave: LeavePeriod): { start: string; fromMaternity: boolean } => {
  const maternity = leaves.find((l) => l.type === "maternity" && l.start < leave.start && (!l.end || addDays(l.end, 1) >= leave.start));
  return maternity ? { start: maternity.start, fromMaternity: true } : { start: leave.start, fromMaternity: false };
};

/** 育児休業給付金・出生時育児休業給付金・介護休業給付金 */
export const buildLeaveBenefit = (data: BenefitData, leave: LeavePeriod, kind: "childcare" | "papa" | "family_care"): BenefitDoc => {
  const problems: string[] = [];
  const notes: string[] = [];
  const t = BENEFIT_TITLES[kind];
  const leaves = parseLeavePeriods(data.staff.leave_periods);
  const end = leave.end || data.today;
  if (!leave.end) notes.push("休業の終わりの日が決まっていないので、きょうまでの支給単位期間を出しています");
  const certStart = kind === "childcare" ? childcareCertStart(leaves, leave) : { start: leave.start, fromMaternity: false };
  if (certStart.fromMaternity) notes.push(`産前産後休業に続けて育児休業をしたので、休業開始時賃金月額は産前休業を始めた日（${certStart.start}）の前の賃金で証明します`);
  const certEnd = addDays(certStart.start, -1);
  const cert = certFor(data, certEnd);
  const units = (kind === "papa" ? [{ from: leave.start, to: end }] : benefitUnits(leave.start, end))
    .map((u) => unitFigures(u, data, { start: leave.start, end }));
  if (!String(data.staff.employment_ins_num ?? "").trim()) problems.push("雇用保険被保険者番号を従業員の画面に入れてください");
  const items: PrintItem[] = [...personItems(data)];
  if (kind === "childcare" || kind === "papa") {
    items.push({ label: kind === "papa" ? "出生時育児休業の期間" : "育児休業開始年月日", value: kind === "papa" ? `${w(leave.start)}〜${w(end)}` : w(leave.start) });
    items.push({ label: "子の出生年月日（出産予定日）", value: w(leave.childBirthday) });
    if (!leave.childBirthday) problems.push("子の生年月日を、従業員の画面の休業・休職の欄に入れてください");
    if (kind === "papa") {
      const days = dayjs(end).diff(dayjs(leave.start), "day") + 1;
      if (days > 28) problems.push(`出生時育児休業は28日までです（いまは${days}日）`);
      if (leave.childBirthday && leave.start > fmt(dayjs(leave.childBirthday).add(8, "week").subtract(1, "day"))) {
        problems.push("出生時育児休業は、子の出生の日から8週間のうちに取る休業です");
      }
    }
    if (kind === "childcare" && leave.childBirthday) {
      const reach1 = fmt(birthdayAt(leave.childBirthday, 1).subtract(1, "day"));
      if (end >= reach1) notes.push(`子が1歳に達する日（${reach1}）以後の期間は、延長の理由（保育所に入れないなど）があるときだけ支給されます（パパママ育休プラスは1歳2か月まで）`);
    }
  } else {
    items.push({ label: "介護休業開始年月日", value: w(leave.start) });
    items.push({ label: "介護休業終了年月日", value: w(leave.end) });
    const days = dayjs(end).diff(dayjs(leave.start), "day") + 1;
    if (days > 93) problems.push(`介護休業給付金は、同じ家族について通算93日までです（いまは${days}日）`);
    notes.push("介護の対象となる家族の氏名・続柄・性別・生年月日は、申請書に書きます");
  }
  items.push({ label: "賃金締切日・支払日（備考に書く）", value: `${data.group.closing_day === 99 ? "末日" : `${data.group.closing_day}日`}締め・${Number(data.group.is_next_month) === 1 ? "翌月" : "当月"}${data.group.payment_day ?? ""}日払い` });
  return {
    key: `${kind}:${data.staff.id}:${leave.start}`, kind, title: t.title, certTitle: t.cert, unitTitle: t.units, who: String(data.staff.name ?? ""),
    items, cert, certEnd, units, problems: [...problems, ...cert.problems], notes: [...notes, ...cert.notes],
  };
};

/** 60歳に達した日（60歳の誕生日の前日） */
export const reach60Date = (birthday: string): string => fmt(birthdayAt(birthday, 60).subtract(1, "day"));

/** 高年齢雇用継続基本給付金（六十歳到達時等賃金証明書と、支給対象月ごとに支払われた賃金額） */
export const buildElderlyBenefit = (data: BenefitData, from: string, to: string): BenefitDoc => {
  const problems: string[] = [];
  const notes: string[] = [];
  const t = BENEFIT_TITLES.elderly;
  const birthday = String(data.staff.birthday ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) problems.push("生年月日を従業員の画面に入れてください");
  const reach = birthday ? reach60Date(birthday) : "";
  const cert = reach ? certFor(data, reach) : null;
  const start = from || (reach ? fmt(dayjs(reach).startOf("month")) : data.today);
  const units = calendarMonths(start, to || data.today).map((u) => unitFigures(u, data, null));
  notes.push("支給対象月は、60歳に達した日の属する月から65歳に達する日の属する月までの、初日から末日まで被保険者である月です");
  notes.push("賃金が下がった理由（病気の欠勤・会社都合の休業など）で減った額があれば、申請書に「みなし賃金」として書きます");
  return {
    key: `elderly:${data.staff.id}`, kind: "elderly", title: t.title, certTitle: t.cert, unitTitle: t.units, who: String(data.staff.name ?? ""),
    items: [...personItems(data), { label: "60歳に達した日", value: w(reach) }],
    cert, certEnd: reach, units, problems: [...problems, ...(cert?.problems ?? [])], notes: [...notes, ...(cert?.notes ?? [])],
  };
};

/** 育児時短就業給付金（育児時短就業開始時賃金証明書と、支給対象月ごとに支払われた賃金額） */
export const buildShortTimeBenefit = (data: BenefitData, start: string, end: string, childBirthday: string): BenefitDoc => {
  const problems: string[] = [];
  const t = BENEFIT_TITLES.short_time;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) problems.push("育児時短就業を始めた日を入れてください");
  const cert = start ? certFor(data, addDays(start, -1)) : null;
  const units = start ? calendarMonths(start, end || data.today).map((u) => unitFigures(u, data, null)) : [];
  if (childBirthday && end && end >= fmt(birthdayAt(childBirthday, 2).subtract(1, "day"))) {
    problems.push("育児時短就業給付金は、子が2歳に達する日の前日までです");
  }
  return {
    key: `short_time:${data.staff.id}:${start}`, kind: "short_time", title: t.title, certTitle: t.cert, unitTitle: t.units,
    who: String(data.staff.name ?? ""),
    items: [...personItems(data), { label: "育児時短就業開始年月日", value: w(start) }, { label: "子の生年月日", value: w(childBirthday) }],
    cert, certEnd: start ? addDays(start, -1) : "", units, problems: [...problems, ...(cert?.problems ?? [])],
    notes: ["支給対象月は、育児時短就業を始めた日の属する月から、子が2歳に達する日の前日の属する月まで（初日から末日まで被保険者で、育児時短就業をした月）です", ...(cert?.notes ?? [])],
  };
};
