/**
 * 労災の書類（業務災害）
 *
 * ・平均賃金算定内訳（様式第8号（別紙1）。休業補償給付支給請求書の初回に添える）：Q の平均賃金の計算（utils/averageWage.ts。労働基準法12条）を、
 *   別紙1の欄（A：月・週その他一定の期間によって支払ったもの／B：日若しくは時間又は出来高払制その他の請負制によって支払ったもの、
 *   総計・平均賃金・最低保障平均賃金の計算方法、裏面③特別給与の額）に当てはめる
 * ・休業補償給付支給請求書（様式第8号）・療養補償給付たる療養の給付請求書（様式第5号）の、事業主が証明する欄に書く内容
 * ・労働者死傷病報告（令和7年1月1日からの様式。休業4日以上・死亡）：電子申請（帳票入力支援サービス）が原則。書く内容を出す
 * 様式は厚生労働省「主要様式ダウンロードコーナー（労災保険給付関係主要様式）」と「労働者死傷病報告の様式」による。
 * 請求書は労働者が出す（事業主は証明する）。死傷病報告は事業者が遅滞なく出す（休業4日未満は四半期ごと）。
 * ・別紙1の裏面②・表面①：賃金計算期間のうち業務外の傷病の療養などで休業した期間があるとき、その日数(チ)と期間中の賃金(リ)を書き、
 *   その期間を除いて計算した平均賃金（（賃金の総額(ホ) − (リ)）÷（総日数(イ) − (チ)））を書く（様式第8号 別紙1）
 * ・別紙2（療養のため労働できなかった期間に、所定労働時間の一部だけ働いた日・賃金が支払われた休暇があるとき）：
 *   ② 賃金を受けなかった日の日数を、③ 全部休業日と部分算定日（一部休業日・賃金が支払われた休暇）に分け、④ 部分算定日の年月日と賃金の額を書く。
 *   月給などで休業日にも払った賃金は、月額 ÷ 30 × 日数（様式第8号 別紙2 の注意）
 */
import dayjs from "dayjs";
import type { AverageWageResult } from "./averageWage";
import { foreignOf } from "./foreignInfo";
import { KOYO_RESIDENCE_STATUSES } from "../constants/koyoTodoke";
import type { PrintForm, PrintItem } from "./printForms";
import { formatWareki } from "./wareki";
import { baseHoursOf, dayScheduledHours, describeWeekdayHours, hasWeekdayHours } from "./scheduledHours";

const w = (d: string | null | undefined) => (d ? formatWareki(d) : "");
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
/** 銭を「6,521円73銭」にする */
export const senText = (sen: number | null): string => {
  if (sen === null) return "";
  const yen = Math.floor(sen / 100);
  return `${yen.toLocaleString()}円${String(sen % 100).padStart(2, "0")}銭`;
};
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// ── 別紙1 平均賃金算定内訳 ─────────────────────────────────────

export interface Besshi1Row {
  /** 賃金計算期間（「8月21日から9月20日まで」） */
  from: string;
  to: string;
  /** 総日数（暦日数から除いた日を引いた日数） */
  days: number;
  /** 労働日数（B だけ） */
  workedDays: number;
  base: number;
  allowance: number;
  total: number;
}

export interface Besshi1 {
  a: Besshi1Row[];
  b: Besshi1Row[];
  /** (イ) 総日数・(ロ) A の計・(ハ) 労働日数・(ニ) B の計・(ホ) 総計 */
  i: number;
  ro: number;
  ha: number;
  ni: number;
  ho: number;
  /** 平均賃金（総計 ÷ 総日数）・最低保障の (ヘ)・(ト)・最低保障平均賃金（銭） */
  principleSen: number | null;
  heSen: number | null;
  toSen: number | null;
  minimumSen: number | null;
  /** 使う平均賃金（手で入れた額があればその額） */
  amountSen: number | null;
  /** B がある（日・時間・出来高で決まる賃金がある） */
  hasB: boolean;
}

/** 別紙1 ②：業務外の傷病の療養などで休業した期間（賃金計算期間ごと）と、表面①の平均賃金 */
export interface Besshi1NonWork {
  rows: { from: string; to: string; days: number; wages: number }[];
  /** (チ) 日数の計・(リ) 賃金の計 */
  chi: number;
  ri: number;
  /** 表面①：（(ホ) − (リ)）÷（(イ) − (チ)）（銭） */
  sen: number | null;
  reason: string;
}

/**
 * 別紙1 ②① を出す
 * @param leaves 業務外の傷病の療養などで休業した期間
 * @param wagesOf 賃金計算期間ごとの、その休業した日の賃金（null は 0：給与を払わない休職）
 */
export const besshi1NonWorkOf = (b: Besshi1, leaves: { start: string; end: string }[], reason: string, wagesOf: (i: number) => number | null = () => null): Besshi1NonWork | null => {
  if (leaves.length === 0) return null;
  const rows = b.a.map((p, i) => {
    let days = 0;
    for (let d = dayjs(p.from); !d.isAfter(dayjs(p.to), "day"); d = d.add(1, "day")) {
      const x = d.format("YYYY-MM-DD");
      if (leaves.some((l) => l.start <= x && (!l.end || x <= l.end))) days++;
    }
    return { from: p.from, to: p.to, days, wages: days > 0 ? wagesOf(i) ?? 0 : 0 };
  });
  const chi = rows.reduce((t, r) => t + r.days, 0);
  if (chi === 0) return null;
  const ri = rows.reduce((t, r) => t + r.wages, 0);
  const restDays = b.i - chi;
  return { rows, chi, ri, sen: restDays > 0 ? Math.floor(((b.ho - ri) * 100) / restDays + 1e-9) : null, reason };
};

/** 別紙2 の1日 */
export interface Besshi2Day {
  date: string;
  /** whole：全部休業日 / partial：部分算定日（一部休業日・賃金が支払われた休暇） / worked：所定労働時間を働いた日（休業していない） */
  kind: "whole" | "partial" | "worked";
  /** 部分算定日の賃金の額（円。初めの値。画面で直せる） */
  amount: number;
  note: string;
}

/**
 * 別紙2：療養のため労働できなかった期間の日を、全部休業日と部分算定日に分ける
 * ・所定労働時間の一部だけ働いた日・有給休暇の日は部分算定日。所定労働時間を働いた日は休業していないので、②③に入れない
 * ・ほかの日（休日を含む）は全部休業日（月給を休業日にも払っているときは、その日も部分算定日にする：monthlyPaid）
 * ・賃金の額の初めの値：時給は 働いた時間 × 時給（有給休暇は所定労働時間分）、日給は日給、月給は 月額 ÷ 30
 */
export const besshi2Of = (
  from: string, to: string, rows: { work_date: string; work_type?: string | null; work_hours?: number | string | null; scheduled_hours?: number | string | null }[],
  staff: any, monthlyPaid = false,
): { days: Besshi2Day[]; whole: number; partial: number; worked: number } => {
  const byDate = new Map(rows.map((r) => [String(r.work_date), r]));
  const wageType = String(staff?.wage_type ?? "");
  const base = Number(staff?.base_wage) || 0;
  const out: Besshi2Day[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { days: out, whole: 0, partial: 0, worked: 0 };
  for (let d = dayjs(from); !d.isAfter(dayjs(to), "day"); d = d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD");
    const r = byDate.get(date);
    const hours = Number(r?.work_hours) || 0;
    // その日の所定労働時間（勤怠で直した時間 → 曜日の時間 → 1日の所定労働時間。入っていなければ8時間。utils/scheduledHours.ts）
    const scheduled = dayScheduledHours(staff, date, r?.scheduled_hours) ?? baseHoursOf(staff) ?? 8;
    const paidLeave = r?.work_type === "paid_full" || r?.work_type === "paid_half";
    const perDay = wageType === "monthly" ? Math.floor(base / 30) : wageType === "daily" ? base : Math.floor(base * scheduled);
    if (hours >= scheduled) {
      out.push({ date, kind: "worked", amount: 0, note: "所定労働時間を働いた日" });
    } else if (hours > 0) {
      out.push({ date, kind: "partial", amount: wageType === "hourly" ? Math.floor(base * hours) : perDay, note: `一部休業日（${hours}時間働いた）` });
    } else if (paidLeave) {
      out.push({ date, kind: "partial", amount: r?.work_type === "paid_half" ? Math.floor(perDay / 2) : perDay, note: "賃金が支払われた休暇（有給休暇）" });
    } else if (monthlyPaid && wageType === "monthly") {
      out.push({ date, kind: "partial", amount: perDay, note: "休業日にも月給を払った（月額 ÷ 30）" });
    } else {
      out.push({ date, kind: "whole", amount: 0, note: "" });
    }
  }
  return {
    days: out, whole: out.filter((x) => x.kind === "whole").length, partial: out.filter((x) => x.kind === "partial").length,
    worked: out.filter((x) => x.kind === "worked").length,
  };
};

export const besshi1Of = (r: AverageWageResult): Besshi1 => {
  const rows = r.periods.filter((p) => p.days > 0);
  const a = rows.map((p): Besshi1Row => ({
    from: p.from, to: p.to, days: p.days - p.excludedDays, workedDays: p.workedDays, base: p.monthBase, allowance: p.monthWages - p.monthBase, total: p.monthWages,
  }));
  const b = rows.map((p): Besshi1Row => ({
    from: p.from, to: p.to, days: p.days - p.excludedDays, workedDays: p.workedDays, base: p.timeBase, allowance: p.timeWages - p.timeBase, total: p.timeWages,
  }));
  const i = r.totalDays;
  const ro = r.monthWages;
  const ha = r.workedDays;
  const ni = r.timeWages;
  const hasB = ni > 0;
  const heSen = i > 0 ? Math.floor((ro * 100) / i + 1e-9) : null;
  const toSen = hasB && ha > 0 ? Math.floor((ni * 60) / ha + 1e-9) : null;
  return {
    a, b, i, ro, ha, ni, ho: ro + ni, principleSen: r.principleSen, heSen: hasB ? heSen : null, toSen, minimumSen: r.minimumSen, amountSen: r.amountSen, hasB,
  };
};

/** 賃金支給方法（別紙1の「月給・週給・日給・時間給・出来高払制・その他請負制」） */
export const payMethodLabel = (wageType: unknown) => (wageType === "monthly" ? "月給" : wageType === "daily" ? "日給" : "時間給");

// ── 様式第8号・第5号の事業主の証明 ─────────────────────────────

export interface AccidentInput {
  staff: any;
  company: { name?: string | null; address?: string | null; phone?: string | null; representative?: string | null; labor_ins_num?: string | null };
  /** 負傷又は発病の年月日と時刻 */
  date: string;
  time: string;
  /** 災害発生の事実を確認した者の職名・氏名 */
  witness: string;
  /** 災害の原因及び発生状況（どのような場所で・どのような作業をしているときに・どのような物又は環境に・どのような不安全な又は有害な状態があって・どのような災害が発生したか） */
  cause: string;
  /** 療養のため労働できなかった期間と、そのうち賃金を受けなかった日の日数（様式第8号） */
  leaveFrom: string;
  leaveTo: string;
  unpaidDays: string;
  /** 死傷病報告を出した日（様式第8号の1回目） */
  reportedOn: string;
  certifiedOn: string;
}

const jobOf = (staff: any) => String(staff?.job_type ?? "");
const prescribedHours = (staff: any) => {
  const h = Number(staff?.scheduled_work_hours) || 0;
  const start = /^(\d{1,2}):(\d{2})/.exec(String(staff?.scheduled_in ?? ""));
  // 曜日で所定労働時間が違う人は、違う曜日の時間も書く（「1日 4時間。水6時間」。utils/scheduledHours.ts）
  const day = `1日 ${h}時間${hasWeekdayHours(staff) ? `。${describeWeekdayHours(staff)}` : ""}`;
  return start ? `${Number(start[1])}時${start[2]}分から（${day}）` : h > 0 ? day : "";
};

export const youshiki8Form = (i: AccidentInput, besshi: Besshi1 | null): PrintForm => {
  const s = i.staff;
  const items: PrintItem[] = [
    { label: "労働保険番号", value: String(i.company.labor_ins_num ?? "") },
    { label: "労働者の氏名（カタカナ・漢字）・生年月日", value: `${toKatakana(String(s?.furigana ?? ""))}　${s?.name ?? ""}　${w(s?.birthday)}` },
    { label: "⑦ 負傷又は発病年月日", value: w(i.date) },
    { label: "⑰ 平均賃金（別紙1のとおり）", value: besshi ? senText(besshi.amountSen) : "" },
    { label: "⑲ 療養のため労働できなかった期間", value: i.leaveFrom ? `${w(i.leaveFrom)}から${w(i.leaveTo)}まで${i.leaveFrom && i.leaveTo ? `（${dayjs(i.leaveTo).diff(dayjs(i.leaveFrom), "day") + 1}日間）` : ""}` : "" },
    { label: "⑳ そのうち賃金を受けなかった日の日数", value: i.unpaidDays ? `${i.unpaidDays}日` : "" },
    { label: "労働者の職種", value: jobOf(s) },
    { label: "負傷又は発病の時刻", value: i.time },
    { label: "災害発生の事実を確認した者の職名・氏名", value: i.witness },
    { label: "所定労働時間", value: prescribedHours(s) },
    { label: "災害の原因及び発生状況", value: i.cause },
    { label: "死傷病報告提出年月日（1回目の請求書）", value: w(i.reportedOn) },
    { label: "事業主の証明（事業の名称・事業場の所在地・事業主の氏名・電話）", value: `${i.company.name ?? ""}　${i.company.address ?? ""}　${i.company.representative ?? ""}　${i.company.phone ?? ""}` },
    { label: "証明日", value: w(i.certifiedOn) },
  ];
  const problems: string[] = [];
  if (!i.date) problems.push("負傷又は発病年月日を入れてください");
  if (!i.cause.trim()) problems.push("災害の原因及び発生状況を入れてください");
  if (besshi && besshi.amountSen === null) problems.push("平均賃金を出せません（平均賃金の画面で確かめてください）");
  const notes = [
    "休業の4日目から、休業補償給付（給付基礎日額の60%）と休業特別支給金（20%）が出ます。最初の3日（待期期間）は、会社が平均賃金の60%以上の休業補償を払います（平均賃金の画面・給与に入れられます）。",
    "1回目の請求書には、平均賃金算定内訳（別紙1）を添えます。所定労働時間の一部だけ休んだ日があれば別紙2も添えます。",
  ];
  return { key: `rousai8:${s?.id}`, title: "休業補償給付支給請求書（様式第8号）の事業主が証明する欄", who: String(s?.name ?? ""), items, problems, notes };
};

export const youshiki5Form = (i: AccidentInput): PrintForm => {
  const s = i.staff;
  const items: PrintItem[] = [
    { label: "労働保険番号", value: String(i.company.labor_ins_num ?? "") },
    { label: "労働者の氏名（カタカナ・漢字）・生年月日・性別", value: `${toKatakana(String(s?.furigana ?? ""))}　${s?.name ?? ""}　${w(s?.birthday)}　${s?.gender === "male" ? "男" : s?.gender === "female" ? "女" : ""}` },
    { label: "⑦ 負傷又は発病年月日・時刻", value: `${w(i.date)}　${i.time}` },
    { label: "労働者の住所", value: `〒${s?.zip_code ?? ""} ${s?.address ?? ""}` },
    { label: "労働者の職種", value: jobOf(s) },
    { label: "災害発生の事実を確認した者の職名・氏名", value: i.witness },
    { label: "災害の原因及び発生状況", value: i.cause },
    { label: "事業主の証明（事業の名称・事業場の所在地・事業主の氏名・電話）", value: `${i.company.name ?? ""}　${i.company.address ?? ""}　${i.company.representative ?? ""}　${i.company.phone ?? ""}` },
    { label: "証明日", value: w(i.certifiedOn) },
  ];
  const problems: string[] = [];
  if (!i.date) problems.push("負傷又は発病年月日を入れてください");
  if (!i.cause.trim()) problems.push("災害の原因及び発生状況を入れてください");
  const notes = ["労災指定の病院などで治療を受けるときに、労働者が病院などを経由して労働基準監督署長に出します（治療費はかかりません）。災害発生の事実を確認した者が多いときは、最初に発見した者を書きます。"];
  return { key: `rousai5:${s?.id}`, title: "療養補償給付たる療養の給付請求書（様式第5号）の事業主が証明する欄", who: String(s?.name ?? ""), items, problems, notes };
};

// ── 労働者死傷病報告 ────────────────────────────────────────

export interface ShishobyoInput extends AccidentInput {
  /** 事業の種類（日本標準産業分類の細分類の4桁と名前） */
  industry: string;
  /** 事業場の労働者数 */
  workers: number;
  /** 休業見込期間（月・週・日）か死亡日時 */
  expected: string;
  /** 職種（日本標準職業分類の小分類の3桁と名前） */
  occupation: string;
  injury: string;
  part: string;
  place: string;
  /** 報告書作成者の職氏名・事業者職氏名 */
  writer: string;
  submittedOn: string;
}

export const shishobyoForm = (i: ShishobyoInput): PrintForm => {
  const s = i.staff;
  const age = s?.birthday && i.date ? dayjs(i.date).diff(dayjs(s.birthday), "year") : null;
  const years = s?.join_date && i.date ? dayjs(i.date).diff(dayjs(s.join_date), "month") : null;
  const f = foreignOf(s);
  const status = f ? KOYO_RESIDENCE_STATUSES.find((x) => x.code === f.status) : null;
  const items: PrintItem[] = [
    { label: "事業の種類（日本標準産業分類の細分類の4桁）", value: i.industry },
    { label: "事業場の名称（カナ・漢字）", value: String(i.company.name ?? "") },
    { label: "労働保険番号", value: String(i.company.labor_ins_num ?? "") },
    { label: "事業場の所在地・電話", value: `${i.company.address ?? ""}　${i.company.phone ?? ""}` },
    { label: "労働者数", value: i.workers > 0 ? `${i.workers}人` : "" },
    { label: "発生日時（24時間表記）", value: `${w(i.date)}　${i.time}` },
    { label: "被災労働者の氏名（カナ・漢字）", value: `${toKatakana(String(s?.furigana ?? ""))}　${s?.name ?? ""}` },
    { label: "生年月日（年齢）・性別", value: `${w(s?.birthday)}${age !== null ? `（${age}歳）` : ""}　${s?.gender === "male" ? "男" : s?.gender === "female" ? "女" : ""}` },
    { label: "休業見込期間又は死亡日時", value: i.expected },
    { label: "職種（日本標準職業分類の小分類の3桁）", value: i.occupation || jobOf(s) },
    { label: "経験期間（その職種の経験。1年以上は年数、1年未満は月数）", value: years === null ? "" : years >= 12 ? `${Math.floor(years / 12)}年（この会社に入ってから。前の経験があれば足す）` : `${years}月（この会社に入ってから）` },
    { label: "傷病名・傷病部位", value: [i.injury, i.part].filter(Boolean).join("・") },
    { label: "被災地の所在地", value: i.place },
    { label: "災害発生状況及び原因（①場所 ②作業 ③物・環境 ④不安全・有害な状態 ⑤災害）", value: i.cause },
  ];
  if (f) {
    items.push({ label: "国籍・地域・在留資格（外国人のとき。外国人雇用状況の届出と同じ）", value: `${f.nationality}・${status?.free ? f.statusText : status?.name ?? ""}` });
  }
  items.push(
    { label: "報告書作成者 職氏名", value: i.writer },
    { label: "事業者職氏名・提出日", value: `${i.company.representative ?? ""}　${w(i.submittedOn)}` },
  );
  const problems: string[] = [];
  if (!i.industry.trim()) problems.push("事業の種類（日本標準産業分類の4桁）を入れてください");
  if (!i.cause.trim()) problems.push("災害発生状況及び原因を入れてください");
  if (!i.expected.trim()) problems.push("休業見込期間（または死亡日時）を入れてください");
  const notes = [
    "令和7年1月1日から、労働者死傷病報告は電子申請（帳票入力支援サービス）で出すのが原則です（前の様式は使えません）。事業の種類・職種・傷病名・部位・国籍・在留資格はコードで入れます。",
    "休業4日以上・死亡は遅滞なく、休業4日未満は四半期ごと（最後の月の翌月末日まで）に、労働基準監督署長に出します。派遣労働者のときは、派遣先と派遣元の両方が出します。",
  ];
  return { key: `shishobyo:${s?.id}`, title: "労働者死傷病報告（休業4日以上・死亡）", who: String(s?.name ?? ""), items, problems, notes };
};

/** 別紙1の期間の書き方 */
export const periodText = (from: string, to: string) => `${md(from)}から${md(to)}まで`;
