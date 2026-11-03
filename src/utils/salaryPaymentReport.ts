/**
 * 給与支払報告書（個人別明細書）を出す人と、出す先の市区町村をまとめる
 *
 * ■ 出す人と出す先（地方税法317条の6）
 *   ・1月1日に在職している人（第1項）：前年中に給与を支払った人について、1月1日の住所の市区町村に、1月31日までに出す
 *   ・前年中に退職した人（第3項）：退職した日（給与の支払を受けなくなった日）の住所の市区町村に、翌年1月31日までに出す。
 *     その年に支払った給与の総額が30万円以下の人は、出さなくてよい（ただし書。市区町村によっては出すよう求めている）
 *   ・出す先は、従業員の画面で選んだ市区町村（staff.resident_tax_municipality）
 * ■ 普通徴収にする人：個人別明細書の摘要に、市区町村が決めた理由を書く
 *   （eLTAX の CSV は「普通徴収」に1を入れ、摘要に理由を書く。地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）」項番134・86）
 *   理由の符号は、多くの市区町村で共通の「普A」〜「普F」（東京都主税局「普通徴収切替理由書（兼仕切書（紙））」）。基準の細部は市区町村ごとに違う
 * ■ 指定番号：市区町村が特別徴収義務者に付けた番号（特別徴収税額の決定通知書に書いてある）。
 *   新しく出す市区町村で、前年度の指定番号がないときは空でよい（同仕様書 項番140）
 */
import { findLocalGovByAddress, localGovByCode, type LocalGov } from "./localGov";
import { toTaxColumn } from "./incomeTax";

/** 退職した人で、その年の給与の総額がこの額以下なら、出さなくてよい（地方税法317条の6第3項ただし書） */
export const RETIREE_OPTIONAL_LIMIT = 300_000;

/** 普通徴収にする理由の符号（東京都主税局「普通徴収切替理由書（兼仕切書（紙））」の言葉） */
export const ORDINARY_REASONS: { code: string; label: string }[] = [
  { code: "普A", label: "総従業員数が2人以下（普B〜普Fに当たる人を、ほかの市区町村の分も含めて差し引いた人数）" },
  { code: "普B", label: "他の事業所で特別徴収" },
  { code: "普C", label: "給与が少なく税額が引けない（住民税非課税の場合など）" },
  { code: "普D", label: "給与の支払が不定期（給与の支払が毎月でないなど）" },
  { code: "普E", label: "事業専従者（個人事業主のみ対象）" },
  { code: "普F", label: "退職者又は退職予定者（5月末日まで）" },
];

/** 1月1日に在職している人（employed）か、年の途中で退職した人（retired）か */
export type ReportKind = "employed" | "retired";

/** 退職日が翌年1月1日より前なら、年の途中で退職した人（12月31日に退職した人も） */
export const reportKindOf = (retirementDate: string | null | undefined, year: number): ReportKind =>
  retirementDate && retirementDate < `${year + 1}-01-01` ? "retired" : "employed";

/** 従業員ごと・年分ごとの設定（salary_payment_reports の1行） */
export interface ReportSetting {
  /** 普通徴収にする（null は初めの値のまま） */
  ordinary: boolean | null;
  /** 普通徴収にする理由（普A〜普F、またはそのほかの理由） */
  reason: string;
  /** 出さなくてよい退職者も出す */
  submit: boolean;
}

export const parseReportSetting = (row: { ordinary_collection?: unknown; ordinary_reason?: unknown; submit?: unknown } | null | undefined): ReportSetting => ({
  ordinary: row?.ordinary_collection === null || row?.ordinary_collection === undefined ? null : Number(row.ordinary_collection) === 1,
  reason: String(row?.ordinary_reason ?? "").trim(),
  submit: Number(row?.submit) === 1,
});

/** 普通徴収の初めの値：退職した人は普F、乙欄の人（ほかに主たる給与がある人）は普B、ほかは特別徴収 */
export const defaultCollection = (kind: ReportKind, taxColumn: unknown): { ordinary: boolean; reason: string; why: string } =>
  kind === "retired" ? { ordinary: true, reason: "普F", why: "退職した人" }
  : toTaxColumn(taxColumn) === "otsu" ? { ordinary: true, reason: "普B", why: "乙欄の人" }
  : { ordinary: false, reason: "", why: "" };

export interface ReportPerson {
  staffId: string;
  name: string;
  kind: ReportKind;
  retiredOn: string | null;
  /** 従業員の画面で選んだ団体コード（空なら未設定） */
  code: string;
  /** 出す先の市区町村（未設定・一覧にないコードなら null） */
  municipality: LocalGov | null;
  /** 住所から探した市区町村（未設定のときに出す） */
  suggested: LocalGov | null;
  /** 支払金額・源泉徴収税額（源泉徴収票と同じ） */
  payment: number;
  withholdingTax: number;
  /** 出さなければならない（30万円以下の退職者は false） */
  required: boolean;
  /** 出す */
  submit: boolean;
  /** 普通徴収にする・その理由 */
  ordinary: boolean;
  reason: string;
  /** 初めの値のまま（設定していない）なら、その理由（「退職した人」など）。特別徴収の初めの値は空 */
  defaultWhy: string;
  /** 足りない項目（住所・フリガナ・生年月日） */
  missing: string[];
  /** 画面に出す注意 */
  warnings: string[];
}

export interface ReportSource {
  year: number;
  staff: {
    id: string | number; name?: string | null; furigana?: string | null; birthday?: string | null; address?: string | null;
    retirement_date?: string | null; tax_column?: unknown; resident_tax_municipality?: string | null;
  };
  payment: number;
  withholdingTax: number;
  setting: ReportSetting;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 1人分の、出すかどうか・出す先・徴収のしかた */
export const buildReportPerson = ({ year, staff, payment, withholdingTax, setting }: ReportSource): ReportPerson => {
  const kind = reportKindOf(staff.retirement_date, year);
  const code = str(staff.resident_tax_municipality);
  const municipality = localGovByCode(code);
  const required = kind === "employed" || payment > RETIREE_OPTIONAL_LIMIT;
  const submit = required || setting.submit;
  const byDefault = setting.ordinary === null;
  const initial = defaultCollection(kind, staff.tax_column);
  const ordinary = byDefault ? initial.ordinary : !!setting.ordinary;
  const reason = !ordinary ? "" : byDefault ? initial.reason : setting.reason;
  const missing = [
    !str(staff.address) && "住所",
    !str(staff.furigana) && "フリガナ",
    !str(staff.birthday) && "生年月日",
  ].filter((x): x is string => !!x);

  const warnings: string[] = [];
  if (submit) {
    if (!code) warnings.push("市区町村を選んでいません（従業員の画面の「住民税（特別徴収）」で選んでください）");
    else if (!municipality) warnings.push(`団体コード ${code} は一覧にありません（従業員の画面で選び直してください）`);
    if (ordinary && !reason) warnings.push("普通徴収にする理由を入れてください（摘要に書きます）");
    if (missing.length > 0) warnings.push(`${missing.join("・")}が入っていません（従業員の画面で入れてください）`);
    // 5月末日までに退職する人は、普F で普通徴収にできる
    const r = str(staff.retirement_date);
    if (!ordinary && kind === "employed" && r && r <= `${year + 1}-05-31`) {
      warnings.push("5月末日までに退職する人です。普通徴収（普F）にできます");
    }
  }

  return {
    staffId: String(staff.id),
    name: str(staff.name),
    kind,
    retiredOn: kind === "retired" ? str(staff.retirement_date) : null,
    code,
    municipality,
    suggested: municipality ? null : findLocalGovByAddress(staff.address),
    payment,
    withholdingTax,
    required,
    submit,
    ordinary,
    reason,
    defaultWhy: byDefault ? initial.why : "",
    missing,
    warnings,
  };
};

export interface MunicipalityGroup<T extends ReportPerson = ReportPerson> {
  /** 団体コード（市区町村が未設定・一覧にない人は空） */
  code: string;
  municipality: LocalGov | null;
  people: T[];
  /** 出す人のうち、特別徴収・普通徴収の人数 */
  special: number;
  ordinary: number;
  /** 出さない人（30万円以下の退職者）の人数 */
  skipped: number;
}

/** 市区町村ごとにまとめる（市区町村が未設定の人を先に、あとは団体コードの順） */
export const groupByMunicipality = <T extends ReportPerson>(people: T[]): MunicipalityGroup<T>[] => {
  const groups = new Map<string, MunicipalityGroup<T>>();
  for (const p of people) {
    const code = p.municipality ? p.municipality.code : "";
    const g = groups.get(code) ?? { code, municipality: p.municipality, people: [], special: 0, ordinary: 0, skipped: 0 };
    g.people.push(p);
    if (!p.submit) g.skipped++;
    else if (p.ordinary) g.ordinary++;
    else g.special++;
    groups.set(code, g);
  }
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
};

/** 指定番号の書き方をそろえる（全角の英数字・ハイフンを半角に） */
export const normalizeDesignationNumber = (s: string) => s.normalize("NFKC").trim();

/** 指定番号：半角の英数字とハイフンで12文字まで（同仕様書 項番140）。よければ null */
export const designationNumberError = (s: string): string | null => {
  const v = normalizeDesignationNumber(s);
  if (!v) return null;
  if (!/^[0-9A-Za-z-]+$/.test(v)) return "指定番号は、半角の英数字とハイフンで入れてください";
  if (v.length > 12) return "指定番号は12文字までです";
  return null;
};

/**
 * 紙の総括表（地方税法施行規則 第十七号様式）の報告人員（記載要領10〜13）：
 * 提出先に個人別明細書を出す人のうち、特別徴収・普通徴収（退職者）・普通徴収（退職者を除く）の人数と、その合計
 */
export const summaryCounts = (people: Pick<ReportPerson, "submit" | "ordinary" | "kind">[]) => {
  const out = people.filter((p) => p.submit);
  const special = out.filter((p) => !p.ordinary).length;
  const ordinaryRetired = out.filter((p) => p.ordinary && p.kind === "retired").length;
  const ordinaryOther = out.filter((p) => p.ordinary && p.kind !== "retired").length;
  return { special, ordinaryRetired, ordinaryOther, total: special + ordinaryRetired + ordinaryOther };
};

/** 総括表の「給与の支払期間」（記載要領4：報告人員に給与を支払った期間）。給与を払った月の、いちばん早い月と遅い月 */
export const paymentPeriodOf = (monthsList: number[][]): { from: number; to: number } | null => {
  const all = monthsList.flat().filter((m) => m >= 1 && m <= 12);
  return all.length === 0 ? null : { from: Math.min(...all), to: Math.max(...all) };
};

/** 総括表の「受給者総人員」（記載要領9：翌年1月1日に給与の支払を受けている人の総人員。提出先に関わらず会社全体） */
export const staffTotalOnJan1 = (staff: { join_date?: string | null; retirement_date?: string | null }[], year: number): number => {
  const jan1 = `${year + 1}-01-01`;
  return staff.filter((s) => !(s.join_date && s.join_date > jan1) && !(s.retirement_date && s.retirement_date < jan1)).length;
};
