/**
 * 労働条件通知書（雇入れのときに渡す書面。労働基準法15条・労働基準法施行規則5条、パートタイム・有期雇用労働法6条）
 *
 * 項目と並びは、厚生労働省「主要様式ダウンロードコーナー（労働基準法等関係主要様式）」のモデル労働条件通知書
 * （令和8年10月1日以降に使う様式。【一般労働者用】常用、有期雇用型 と【短時間労働者用】常用、有期雇用型）による。
 * 短時間労働者用は、所定時間外労働の時間（1週・1か月・1年）・休日労働・勤務日・具体的に適用される就業規則名が増える。
 *
 * 値は「従業員ごとに入れた値 → 会社の初めの値 → Q の設定から作る値」の順に使う。
 * ・会社の初めの値（company.labor_conditions）：更新の判断の基準・定年・退職の手続・相談窓口など、会社で同じもの
 * ・従業員ごとの値（staff.labor_conditions）：様式（一般・短時間）・交付日と、その人だけ違うもの
 * ・Q の設定から作る値：契約期間（雇用保険の「契約期間の定め」）・就業の場所（拠点）・業務（従事する業務の種類）・始業終業の時刻・
 *   休憩・休日・年次有給休暇の日数・賃金（基本給・手当・割増率・締め日・支払日・支払方法）・社会保険と雇用保険
 * 書面で明示しなければならない事項（記載要領3）が空なら「直すところ」にする。
 */
import dayjs from "dayjs";
import { parsePremiumRates } from "./premiumRates";
import { grantDaysFor, workScaleOf } from "./annualLeaveGrant";
import { parseWorkDays } from "./annualWorkDays";
import { parseFixedBreak } from "./fixedBreak";
import { parseKoyoInfo, weeklyMinutesOf } from "./koyoInfo";
import { formatWareki } from "./wareki";

export type LaborFormType = "general" | "parttime";
export const LABOR_FORM_LABELS: Record<LaborFormType, string> = {
  general: "一般労働者用（常用、有期雇用型）",
  parttime: "短時間労働者用（常用、有期雇用型）",
};

/** 1つの欄 */
export interface LaborField {
  key: string;
  label: string;
  /** 何行も書く欄 */
  multiline?: boolean;
  /** 会社の初めの値を入れる欄（会社で同じことが多いもの） */
  company?: boolean;
  /** 短時間労働者用だけの欄 */
  parttimeOnly?: boolean;
  /** 書面で明示しなければならない（all：だれにでも / fixedTerm：期間の定めがある人 / parttime：短時間・有期の人） */
  required?: "all" | "fixedTerm" | "parttime";
  /** 入れるときの例 */
  hint?: string;
}

export interface LaborSection {
  title: string;
  fields: LaborField[];
}

/** モデル様式の欄（上から順に） */
export const LABOR_SECTIONS: LaborSection[] = [
  {
    title: "通知書",
    fields: [
      { key: "issueDate", label: "交付する日", required: "all" },
      { key: "workplace", label: "事業場名称・所在地", required: "all" },
      { key: "employer", label: "使用者職氏名", required: "all" },
    ],
  },
  {
    title: "契約期間",
    fields: [
      { key: "contractPeriod", label: "契約期間", required: "all", hint: "期間の定めなし／期間の定めあり（令和8年4月1日～令和9年3月31日）" },
      { key: "renewal", label: "１ 契約の更新の有無", company: true, required: "fixedTerm", hint: "自動的に更新する・更新する場合があり得る・契約の更新はしない・その他" },
      { key: "renewalCriteria", label: "２ 契約の更新は次により判断する", company: true, multiline: true, required: "fixedTerm", hint: "契約期間満了時の業務量・勤務成績、態度・能力・会社の経営状況・従事している業務の進捗状況" },
      { key: "renewalLimit", label: "３ 更新上限の有無", company: true, required: "fixedTerm", hint: "無／有（更新 3回まで／通算契約期間 5年まで）" },
      { key: "conversion", label: "無期転換（通算契約期間が5年を超える有期労働契約のとき）", multiline: true, hint: "本契約期間の末日の翌日（令和9年4月1日）から無期労働契約に転換できる。労働条件の変更（無）" },
      { key: "specialMeasure", label: "有期雇用特別措置法による特例の対象者の場合", multiline: true },
    ],
  },
  {
    title: "就業の場所",
    fields: [
      { key: "placeNow", label: "（雇入れ直後）", required: "all" },
      { key: "placeRange", label: "（変更の範囲）", company: true, required: "all", hint: "会社の定める営業所／変更なし など" },
    ],
  },
  {
    title: "従事すべき業務の内容",
    fields: [
      { key: "jobNow", label: "（雇入れ直後）", required: "all" },
      { key: "jobRange", label: "（変更の範囲）", company: true, required: "all", hint: "会社の定める業務／変更なし など" },
    ],
  },
  {
    title: "始業、終業の時刻、休憩時間、就業時転換、所定時間外労働の有無に関する事項",
    fields: [
      { key: "workHours", label: "１ 始業・終業の時刻等", multiline: true, required: "all" },
      { key: "breakTime", label: "２ 休憩時間", required: "all" },
      { key: "overtime", label: "３ 所定時間外労働の有無", required: "all", hint: "有／無（短時間労働者用は「有（１週 2時間、１か月 8時間、１年 96時間）」）" },
      { key: "holidayWork", label: "４ 休日労働", parttimeOnly: true, hint: "有（１か月 1日、１年 12日）／無" },
      { key: "workRules", label: "詳細は、就業規則", company: true, hint: "第15条～第20条" },
    ],
  },
  {
    title: "休日",
    fields: [
      { key: "holidays", label: "休日", multiline: true, required: "all" },
      { key: "workDays", label: "勤務日", parttimeOnly: true },
      { key: "holidayRules", label: "詳細は、就業規則", company: true },
    ],
  },
  {
    title: "休暇",
    fields: [
      { key: "annualLeave", label: "１ 年次有給休暇", multiline: true, required: "all" },
      { key: "substituteLeave", label: "２ 代替休暇", company: true, hint: "有／無" },
      { key: "otherLeave", label: "３ その他の休暇", multiline: true, company: true },
      { key: "leaveRules", label: "詳細は、就業規則", company: true },
    ],
  },
  {
    title: "賃金",
    fields: [
      { key: "basePay", label: "１ 基本賃金", required: "all" },
      { key: "allowances", label: "２ 諸手当の額又は計算方法", multiline: true },
      { key: "premiumRates", label: "３ 所定時間外、休日又は深夜労働に対して支払われる割増賃金率", multiline: true, required: "all" },
      { key: "closingDay", label: "４ 賃金締切日", required: "all" },
      { key: "payDay", label: "５ 賃金支払日", required: "all" },
      { key: "payMethod", label: "６ 賃金の支払方法", required: "all" },
      { key: "deductions", label: "７ 労使協定に基づく賃金支払時の控除", company: true, hint: "無／有（社宅費・親睦会費）" },
      { key: "raise", label: "８ 昇給", company: true, required: "parttime", hint: "有（毎年4月。業績・勤務成績による）／無" },
      { key: "bonus", label: "９ 賞与", company: true, required: "parttime", hint: "有（7月・12月。業績・勤務成績による）／無" },
      { key: "retirementPay", label: "10 退職金", company: true, required: "parttime", hint: "有（勤続3年以上。退職金規程による）／無" },
    ],
  },
  {
    title: "退職に関する事項",
    fields: [
      { key: "retirementAge", label: "１ 定年制", company: true, required: "all", hint: "有（60歳）／無" },
      { key: "continuedEmployment", label: "２ 継続雇用制度", company: true, required: "all", hint: "有（65歳まで）／無" },
      { key: "businessSupport", label: "３ 創業支援等措置", company: true, hint: "有（70歳まで業務委託・社会貢献事業）／無" },
      { key: "resignNotice", label: "４ 自己都合退職の手続", company: true, required: "all", hint: "退職する30日以上前に届け出ること" },
      { key: "dismissal", label: "５ 解雇の事由及び手続", company: true, multiline: true, required: "all", hint: "就業規則第50条～第52条による" },
    ],
  },
  {
    title: "その他",
    fields: [
      { key: "socialInsurance", label: "社会保険の加入状況" },
      { key: "employmentInsurance", label: "雇用保険の適用" },
      { key: "chutaikyo", label: "中小企業退職金共済制度", company: true, hint: "加入している／加入していない（中小企業の場合）" },
      { key: "corporatePension", label: "企業年金制度", company: true, hint: "有（制度名 ○○）／無" },
      { key: "explanationDesk", label: "通常の労働者との待遇の相違（内容・理由）等の説明を求める窓口", company: true, required: "parttime", hint: "部署名 総務部　担当者職氏名 課長 ○○（連絡先 03-0000-0000）" },
      { key: "consultationDesk", label: "雇用管理の改善等に関する事項に係る相談窓口", company: true, required: "parttime", hint: "同上" },
      { key: "others", label: "その他", company: true, multiline: true },
      { key: "rulesPlace", label: "就業規則を確認できる場所や方法", company: true, hint: "休憩室に備え付け・社内のファイル共有" },
      { key: "rulesName", label: "具体的に適用される就業規則名", company: true, parttimeOnly: true, hint: "パートタイマー就業規則" },
    ],
  },
];

export const LABOR_FIELDS: LaborField[] = LABOR_SECTIONS.flatMap((s) => s.fields);

/** 会社の初めの値（company.labor_conditions の JSON） */
export type CompanyLaborConditions = Record<string, string>;

/** 従業員ごとに入れた値（staff.labor_conditions の JSON） */
export interface StaffLaborConditions {
  /** 様式（空なら、週の所定労働時間で決める） */
  formType: "" | LaborFormType;
  fields: Record<string, string>;
}

const asRecord = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
  return out;
};
const parseJson = (json: unknown): unknown => {
  if (typeof json !== "string" || !json.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export const parseCompanyLaborConditions = (json: unknown): CompanyLaborConditions => asRecord(parseJson(json));
export const parseStaffLaborConditions = (json: unknown): StaffLaborConditions => {
  const o = parseJson(json) as any;
  return { formType: o?.formType === "general" || o?.formType === "parttime" ? o.formType : "", fields: asRecord(o?.fields) };
};
export const stringifyCompanyLaborConditions = (c: CompanyLaborConditions): string | null => {
  const kept = Object.fromEntries(Object.entries(c).filter(([, v]) => v.trim() !== ""));
  return Object.keys(kept).length > 0 ? JSON.stringify(kept) : null;
};
export const stringifyStaffLaborConditions = (s: StaffLaborConditions): string | null => {
  const fields = Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v !== ""));
  return s.formType || Object.keys(fields).length > 0 ? JSON.stringify({ formType: s.formType, fields }) : null;
};

/** 短時間労働者用にする目安（1週間の所定労働時間が30時間未満。雇用保険の「パートタイム」と同じ） */
export const PARTTIME_WEEKLY_MINUTES = 30 * 60;

/** Q の設定から作るのに使うもの */
export interface LaborContext {
  staff: any;
  company: { name?: string; address?: string; representative?: string; annual_holidays?: number | null; hourly_leave?: number | null };
  /** 就業の場所（拠点。なければ会社） */
  branch: { name?: string; address?: string } | null;
  /** 給与規定グループ（締め日・支払日・決まった休憩） */
  group: { closing_day?: number; is_next_month?: number; payment_day?: number; fixed_break?: string | null; premium_rates?: string | null } | null;
  /** 支給の固定の項目（従業員ごとの額が 0 でないもの） */
  allowances: { name: string; amount: number }[];
  /** 特別休暇の種類（使うもの） */
  leaveTypes: { name: string; isPaid: boolean }[];
  /** 振込先の口座がある */
  hasBankAccount: boolean;
  /** 1年間の所定労働日数（会社カレンダーで決める人の年次有給休暇の日数に使う） */
  annualDays: number | null;
  /** 健康保険・厚生年金に加入している（標準報酬月額があり、社保規定が未加入でない） */
  socialInsured: boolean;
  /** 交付する日の初めの値（YYYY-MM-DD） */
  today: string;
}

const DAY_NAMES: Record<string, string> = { sun: "日", mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const hm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}時${String(m % 60).padStart(2, "0")}分`;
};
const toMinutes = (t: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === "string" ? t.trim() : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dayLabel = (d: number | undefined) => (Number(d) === 99 ? "末日" : `${Number(d)}日`);

/** 決まった休憩の分（1日の所定労働時間の人に使うもの。わからなければ null） */
export const breakMinutesFor = (fixedBreak: unknown, workMinutes: number): number | null => {
  const rule = parseFixedBreak(fixedBreak);
  if (!rule) return null;
  if (rule.mode === "time") {
    const s = toMinutes(rule.start)!;
    const e = toMinutes(rule.end)!;
    return e < s ? e + 1440 - s : e - s;
  }
  // 長さで決める：働く時間が「○時間を超えたら」の、いちばん長いものを使う
  let minutes = 0;
  for (const r of rule.rules) if (workMinutes > r.overMinutes) minutes = Math.max(minutes, r.breakMinutes);
  return minutes;
};

/** 様式（一般・短時間）の初めの値 */
export const defaultFormType = (staff: any): LaborFormType =>
  weeklyMinutesOf(staff) > 0 && weeklyMinutesOf(staff) < PARTTIME_WEEKLY_MINUTES ? "parttime" : "general";

/** Q の設定から作る値 */
export const laborDefaults = (ctx: LaborContext): Record<string, string> => {
  const s = ctx.staff ?? {};
  const info = parseKoyoInfo(s.koyo_info);
  const out: Record<string, string> = {};
  out.issueDate = ctx.today;
  out.workplace = [ctx.company.name, ctx.company.address].filter(Boolean).join("　");
  out.employer = String(ctx.company.representative ?? "");

  // 契約期間（雇用保険の届書に書く「契約期間の定め」から）
  const c = info.contract;
  if (c.has) {
    const from = c.start || String(s.join_date ?? "");
    out.contractPeriod = `期間の定めあり（${from ? formatWareki(from) : "　年　月　日"}～${c.end ? formatWareki(c.end) : "　年　月　日"}）`;
    if (c.renewal === "有") out.renewal = "更新する場合があり得る";
    if (c.renewal === "無") out.renewal = "契約の更新はしない";
  } else {
    out.contractPeriod = "期間の定めなし";
  }

  // 就業の場所・業務
  const place = ctx.branch ?? { name: ctx.company.name, address: ctx.company.address };
  out.placeNow = [place.name, place.address].filter(Boolean).join("　");
  out.jobNow = String(s.job_type ?? "");

  // 始業・終業の時刻・休憩
  const workMinutes = Math.round((Number(s.scheduled_work_hours) || 0) * 60);
  const breakMinutes = breakMinutesFor(ctx.group?.fixed_break, workMinutes);
  const start = toMinutes(s.scheduled_in);
  if (Number(s.is_flex) === 1) {
    const cs = toMinutes(s.core_start);
    const ce = toMinutes(s.core_end);
    out.workHours = "フレックスタイム制；始業及び終業の時刻は労働者の決定に委ねる。"
      + (cs !== null && ce !== null ? `（コアタイム ${hm(cs)}から${hm(ce)}）` : "");
  } else if (start !== null && workMinutes > 0) {
    out.workHours = `始業（${hm(start)}） 終業（${hm(start + workMinutes + (breakMinutes ?? 0))}）`;
  }
  if (breakMinutes !== null && breakMinutes > 0) out.breakTime = `${breakMinutes}分`;
  out.overtime = Number(s.is_overtime_eligible ?? 1) === 0 ? "無" : "有";

  // 休日・勤務日
  if (Number(s.calendar_pattern_id ?? 1) === 0) {
    const days = parseWorkDays(s.work_days);
    const off = DAY_ORDER.filter((d) => !days[d]).map((d) => DAY_NAMES[d]);
    const on = DAY_ORDER.filter((d) => days[d]).map((d) => DAY_NAMES[d]);
    if (off.length > 0) out.holidays = `定例日；毎週 ${off.join("・")}曜日`;
    if (on.length > 0) out.workDays = `毎週（${on.join("・")}）`;
  } else {
    const annual = Number(ctx.company.annual_holidays);
    out.holidays = `会社カレンダーによる${annual > 0 ? `（年間 ${annual}日）` : ""}`;
  }

  // 年次有給休暇（6か月継続勤務したときの日数。週の所定労働日数・時間で比例付与）
  const scale = workScaleOf(s, ctx.annualDays);
  const first = grantDaysFor(0, scale);
  out.annualLeave = `６か月継続勤務した場合→ ${first.days}日${first.proportional ? "（比例付与）" : ""}`
    + `　時間単位年休（${Number(ctx.company.hourly_leave ?? 0) === 1 ? "有" : "無"}）`;
  const paid = ctx.leaveTypes.filter((t) => t.isPaid).map((t) => t.name);
  const unpaid = ctx.leaveTypes.filter((t) => !t.isPaid).map((t) => t.name);
  if (paid.length + unpaid.length > 0) out.otherLeave = [paid.length ? `有給（${paid.join("・")}）` : "", unpaid.length ? `無給（${unpaid.join("・")}）` : ""].filter(Boolean).join("　");

  // 賃金
  const wage = Number(s.base_wage) || 0;
  const type = String(s.wage_type ?? "hourly");
  out.basePay = type === "monthly" ? `月給（${wage.toLocaleString()}円）` : type === "daily" ? `日給（${wage.toLocaleString()}円）` : `時間給（${wage.toLocaleString()}円）`;
  const lines = ctx.allowances.filter((a) => a.amount !== 0).map((a) => `${a.name} ${a.amount.toLocaleString()}円`);
  const commute = String(s.commute_type ?? "none");
  if (commute !== "none" && Number(s.commute_amount) > 0) {
    lines.push(`通勤手当 ${Number(s.commute_amount).toLocaleString()}円${commute === "daily" ? "（1日あたり）" : ""}`);
  }
  if (Number(s.fixed_overtime_allowance) > 0) {
    lines.push(`固定残業代 ${Number(s.fixed_overtime_allowance).toLocaleString()}円（時間外労働 ${Number(s.fixed_overtime_hours) || 0}時間分。超えた分は別に支払う）`);
  }
  if (lines.length > 0) out.allowances = lines.join("\n");
  // 割増賃金率は、その人の給与規定グループの率（就業規則・36協定で決めた率。入れていなければ法律の率。utils/premiumRates.ts）
  const rates = parsePremiumRates(ctx.group?.premium_rates);
  const overLimitMonth = Math.max(rates.overtime, rates.overLimitMonth);
  const overLimitYear = Math.max(rates.overtime, rates.overLimitYear);
  out.premiumRates = [
    `所定時間外、法定超 月６０時間以内（${rates.overtime}）％　月６０時間超（${Math.max(rates.over60, overLimitMonth)}）％　所定超（${rates.statutory}）％`,
    ...(overLimitMonth > rates.overtime || overLimitYear > rates.overtime
      ? [`限度時間を超えた時間外労働 月４５時間超（${overLimitMonth}）％　年３６０時間超（${overLimitYear}）％`] : []),
    `休日 法定休日（${rates.holiday}）％、法定外休日（${rates.overtime}）％`,
    `深夜（${rates.night}）％`,
  ].join("\n");
  if (ctx.group) {
    out.closingDay = `毎月 ${dayLabel(ctx.group.closing_day)}`;
    out.payDay = `${Number(ctx.group.is_next_month) === 1 ? "翌月" : "当月"} ${dayLabel(ctx.group.payment_day)}`;
  }
  out.payMethod = ctx.hasBankAccount ? "本人が指定する金融機関の口座への振込" : "通貨で直接支払う";

  // その他
  out.socialInsurance = ctx.socialInsured ? "厚生年金・健康保険" : "加入しない";
  out.employmentInsurance = Number(s.is_employment_ins_eligible ?? 1) === 1 ? "有" : "無";
  return out;
};

export interface ResolvedLabor {
  formType: LaborFormType;
  fixedTerm: boolean;
  values: Record<string, string>;
  /** 書面で明示しなければならないのに空の欄 */
  problems: string[];
}

/** 使う値を決める（従業員 → 会社 → Q の設定） */
export const resolveLaborConditions = (
  staffValues: StaffLaborConditions,
  companyValues: CompanyLaborConditions,
  defaults: Record<string, string>,
  staff: any,
): ResolvedLabor => {
  const formType = staffValues.formType || defaultFormType(staff);
  const values: Record<string, string> = {};
  for (const f of LABOR_FIELDS) {
    if (f.parttimeOnly && formType !== "parttime") continue;
    values[f.key] = staffValues.fields[f.key] ?? (f.company ? companyValues[f.key] : undefined) ?? defaults[f.key] ?? "";
  }
  const fixedTerm = /期間の定めあり/.test(values.contractPeriod ?? "");
  const problems: string[] = [];
  for (const sec of LABOR_SECTIONS) {
    for (const f of sec.fields) {
      if (!(f.key in values) || values[f.key].trim()) continue;
      const need = f.required === "all" || (f.required === "fixedTerm" && fixedTerm) || (f.required === "parttime" && (fixedTerm || formType === "parttime"));
      if (need) problems.push(`${sec.title}：${f.label.replace(/^[０-９\d]+\s/, "")} を書いてください（書面で明示しなければならない事項です）`);
    }
  }
  if (fixedTerm) {
    const m = /～(.+?)）/.exec(values.contractPeriod);
    const join = String(staff?.join_date ?? "");
    const endDate = parseWarekiEnd(m?.[1] ?? "");
    if (join && endDate && dayjs(endDate).diff(dayjs(join), "year", true) > 5 && !values.conversion?.trim()) {
      problems.push("通算契約期間が5年を超える有期労働契約です。無期転換申込機会と無期転換後の労働条件を書いてください（労働基準法施行規則5条5項）");
    }
  }
  return { formType, fixedTerm, values, problems };
};

/** 「令和9年3月31日」を YYYY-MM-DD にする（読めなければ null） */
const parseWarekiEnd = (text: string): string | null => {
  const m = /(令和|平成)(元|\d+)年(\d+)月(\d+)日/.exec(text);
  if (!m) return null;
  const y = (m[2] === "元" ? 1 : Number(m[2])) + (m[1] === "令和" ? 2018 : 1988);
  return `${y}-${String(m[3]).padStart(2, "0")}-${String(m[4]).padStart(2, "0")}`;
};
