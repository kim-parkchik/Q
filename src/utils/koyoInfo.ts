/**
 * 従業員ごとの、雇用保険の届書に書くこと（staff.koyo_info の JSON）
 *
 * ・資格取得届：取得区分（新規・再取得）・被保険者となったことの原因・雇用形態・職種・就職経路・1週間の所定労働時間・賃金月額・
 *   契約期間・資格取得年月日（入社日と違うとき）・備考
 * ・外国人の方（在留資格「外交」「公用」と特別永住者を除く）：ローマ字の氏名・国籍・地域・在留資格・在留期間・資格外活動許可・
 *   在留カード番号・派遣・請負就労区分。資格取得届・資格喪失届に書くと、外国人雇用状況の届出をしたことになる
 *   （雇用保険事務手続きの手引き【第２編】）
 * ・ハローワークに届けている氏名（いまの氏名と違うとき）：資格取得届（再取得）の被保険者証の氏名・資格喪失届と転勤届の氏名変更
 *   （雇用保険被保険者氏名変更届はなく、資格喪失届・転勤届などで新しい氏名を届ける）
 * ・離職（loss）：喪失原因・離職票の交付希望・補充採用予定・被保険者でなくなったことの原因・離職理由（離職証明書の⑦欄）・
 *   具体的事情記載欄・賃金に関する特記事項・離職者の確認（異議の有無・署名）
 * ・転勤（transfers）：雇用保険適用事業所が違う拠点に移った日と、移る前の拠点（転勤届）
 * ・届け出た日（reported）：ファイルを保存した日（次に出す届書を決めるのに使う）
 * コードは src/constants/koyoTodoke.ts（仕様書の項目説明から作ったもの）
 */
import { KOYO_CODES, KOYO_NATIONALITIES, KOYO_REASON_CODES, KOYO_REASON_TITLES, KOYO_RESIDENCE_STATUSES } from "../constants/koyoTodoke";
import { parseWorkDays } from "./annualWorkDays";
import { birthdayAt } from "./calcSalary";

/** 外国人の方の情報（資格取得届・資格喪失届・転勤届に書く） */
export interface KoyoForeign {
  /** 被保険者氏名（ローマ字。在留カードのとおり） */
  romaji: string;
  /** 国籍・地域（参考資料３の名前。在留カードの国籍） */
  nationality: string;
  /** 在留資格のコード（参考資料４） */
  status: string;
  /** 在留資格がコード「30」（不明）のときの在留資格か理由（20字まで） */
  statusText: string;
  /** 在留期間（満了日。YYYY-MM-DD） */
  periodEnd: string;
  /** 資格外活動許可の有無 */
  permission: "" | "有" | "無";
  /** 在留カード番号（英字2・数字8・英字2の12字） */
  card: string;
  /** 派遣・請負就労区分（派遣・請負で、主としてほかの事業所で働く） */
  dispatch: "" | "該当" | "非該当";
}

/** 離職の情報（資格喪失届・離職証明書に書く） */
export interface KoyoLoss {
  /** 喪失原因（1：離職以外の理由 / 2：3以外の離職 / 3：事業主の都合による離職） */
  cause: "" | "1" | "2" | "3";
  /** 離職票の交付を希望する（null は決めていない。59歳以上は希望にかかわらず交付する） */
  certificate: boolean | null;
  /** 補充採用予定の有無 */
  replacement: "" | "有" | "無";
  /** 被保険者でなくなったことの原因（資格喪失届。空なら、従業員の画面の「退職の事由」） */
  causeText: string;
  /**
   * 離職理由（離職証明書の⑦欄）：1(1) 1(2) 2 3(1) 3(2) 3(3) 3(4) 4(1) 4(2) 4(3)① 4(3)② 5(1)①〜⑦ 5(2) 6
   * 4(3)① は人員整理を行うための希望退職の募集・退職勧奨、4(3)② はそのほか
   */
  reason: string;
  /** 離職理由の欄の項目（定年年齢など。仕様書の項目の名前 → 値） */
  details: Record<string, string>;
  /** 具体的事情記載欄（事業主用） */
  circumstances: string;
  /** 賃金に関する特記事項（毎月決まって支払われる賃金以外で、3か月以内の期間ごとに支払われる賃金） */
  wageNote: string;
  /** 離職者の確認：異議の有無（0：有り / 1：無し）と、離職者の氏名（署名） */
  objection: "" | "0" | "1";
  signature: string;
  /** 離職証明書の賃金の欄の、手で直した備考（行の番号 → 字） */
  rowNotes?: Record<string, string>;
}

/** 転勤（雇用保険適用事業所の違う拠点へ） */
export interface KoyoTransfer {
  /** 転勤した日（YYYY-MM-DD） */
  on: string;
  /** 移る前の拠点・移った先の拠点（branches.id） */
  from: number;
  to: number;
  /** 転勤届のファイルを保存した日 */
  reported?: string;
}

export interface KoyoInfo {
  /** 資格取得年月日（入社日と違うとき。週の所定労働時間が20時間以上になった日など） */
  acquiredOn: string;
  /** 取得区分（空なら、雇用保険被保険者番号があれば再取得・なければ新規） */
  acquireKind: "" | "1" | "2";
  /** 被保険者となったことの原因（空なら 2：新規雇用（その他）） */
  cause: string;
  /** 雇用形態（空なら、契約期間・週の所定労働時間から決める） */
  employmentForm: string;
  /** 職種（01〜11） */
  occupation: string;
  /** 就職経路（1〜4） */
  route: string;
  /** 1週間の所定労働時間（分。null なら、勤務の設定（出勤する曜日・所定労働時間）から） */
  weeklyMinutes: number | null;
  /** 賃金月額（円。null なら、給与の設定から） */
  wageMonthly: number | null;
  /** 契約期間の定め（有期契約）と期間・契約更新条項 */
  contract: { has: boolean; start: string; end: string; renewal: "" | "有" | "無" };
  /** 資格取得届の備考（被保険者となったことの原因が「その他」のときは書く） */
  remarks: string;
  foreign: KoyoForeign | null;
  /** ハローワークに届けている氏名・フリガナ（いまの氏名と違うとき）と、氏名を変えた日 */
  registeredName: string;
  registeredKana: string;
  nameChangedOn: string;
  /** 個人番号（マイナンバー）をハローワークに届けている（Q を使う前に届けた・資格取得届に書いた・個人番号登録届を出した） */
  numberReported: boolean;
  loss: KoyoLoss;
  transfers: KoyoTransfer[];
  /** ファイルを保存した日（資格取得届・資格喪失届・個人番号登録届） */
  reported: { shutoku?: string; soshitsu?: string; bango?: string };
}

export const emptyKoyoLoss = (): KoyoLoss => ({
  cause: "", certificate: null, replacement: "", causeText: "", reason: "", details: {}, circumstances: "", wageNote: "",
  objection: "", signature: "",
});

export const emptyKoyoInfo = (): KoyoInfo => ({
  acquiredOn: "", acquireKind: "", cause: "", employmentForm: "", occupation: "", route: "", weeklyMinutes: null, wageMonthly: null,
  contract: { has: false, start: "", end: "", renewal: "" }, remarks: "", foreign: null,
  registeredName: "", registeredKana: "", nameChangedOn: "", numberReported: false,
  loss: emptyKoyoLoss(), transfers: [], reported: {},
});

export const emptyKoyoForeign = (): KoyoForeign => ({
  romaji: "", nationality: "", status: "", statusText: "", periodEnd: "", permission: "", card: "", dispatch: "",
});

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const date = (v: unknown): string => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** staff.koyo_info を読む（壊れていれば空） */
export const parseKoyoInfo = (json: unknown): KoyoInfo => {
  let v: any = null;
  try {
    v = typeof json === "string" && json.trim() ? JSON.parse(json) : json && typeof json === "object" ? json : null;
  } catch {
    v = null;
  }
  const base = emptyKoyoInfo();
  if (!v || typeof v !== "object") return base;
  const c = v.contract ?? {};
  const f = v.foreign;
  const l = v.loss ?? {};
  return {
    acquiredOn: date(v.acquiredOn),
    acquireKind: pick(v.acquireKind, ["", "1", "2"] as const, ""),
    cause: str(v.cause),
    employmentForm: str(v.employmentForm),
    occupation: str(v.occupation),
    route: str(v.route),
    weeklyMinutes: num(v.weeklyMinutes),
    wageMonthly: num(v.wageMonthly),
    contract: { has: !!c.has, start: date(c.start), end: date(c.end), renewal: pick(c.renewal, ["", "有", "無"] as const, "") },
    remarks: str(v.remarks),
    foreign: f && typeof f === "object" ? {
      romaji: str(f.romaji), nationality: str(f.nationality), status: str(f.status), statusText: str(f.statusText),
      periodEnd: date(f.periodEnd), permission: pick(f.permission, ["", "有", "無"] as const, ""), card: str(f.card),
      dispatch: pick(f.dispatch, ["", "該当", "非該当"] as const, ""),
    } : null,
    registeredName: str(v.registeredName),
    registeredKana: str(v.registeredKana),
    nameChangedOn: date(v.nameChangedOn),
    numberReported: !!v.numberReported,
    loss: {
      cause: pick(l.cause, ["", "1", "2", "3"] as const, ""),
      certificate: l.certificate === true ? true : l.certificate === false ? false : null,
      replacement: pick(l.replacement, ["", "有", "無"] as const, ""),
      causeText: str(l.causeText),
      reason: str(l.reason),
      details: l.details && typeof l.details === "object" ? Object.fromEntries(Object.entries(l.details).map(([k, x]) => [k, str(x)])) : {},
      circumstances: str(l.circumstances),
      wageNote: str(l.wageNote),
      objection: pick(l.objection, ["", "0", "1"] as const, ""),
      signature: str(l.signature),
      ...(l.rowNotes && typeof l.rowNotes === "object" ? { rowNotes: Object.fromEntries(Object.entries(l.rowNotes).map(([k, x]) => [k, str(x)])) } : {}),
    },
    transfers: Array.isArray(v.transfers)
      ? v.transfers.filter((t: any) => t && date(t.on)).map((t: any) => ({
        on: date(t.on), from: Number(t.from) || 0, to: Number(t.to) || 0, ...(date(t.reported) ? { reported: date(t.reported) } : {}),
      }))
      : [],
    reported: {
      ...(date(v.reported?.shutoku) ? { shutoku: date(v.reported.shutoku) } : {}),
      ...(date(v.reported?.soshitsu) ? { soshitsu: date(v.reported.soshitsu) } : {}),
      ...(date(v.reported?.bango) ? { bango: date(v.reported.bango) } : {}),
    },
  };
};

/** staff.koyo_info に書く（何も入れていなければ null） */
export const stringifyKoyoInfo = (info: KoyoInfo): string | null =>
  JSON.stringify(info) === JSON.stringify(emptyKoyoInfo()) ? null : JSON.stringify(info);

// ── 選ぶ欄 ────────────────────────────────────────────

/** 区分のコードの選択肢（[コード, 名前]） */
const optionsOf = (name: string): [string, string][] => Object.entries(KOYO_CODES[name] ?? {}).map(([label, code]) => [code, label]);
export const CAUSE_OPTIONS = optionsOf("被保険者となったことの原因");
export const EMPLOYMENT_FORM_OPTIONS = optionsOf("雇用形態");
export const OCCUPATION_OPTIONS = optionsOf("職種");
export const ROUTE_OPTIONS = optionsOf("就職経路");
export const LOSS_CAUSE_OPTIONS = optionsOf("喪失原因");
export const ACQUIRE_KIND_OPTIONS = optionsOf("取得区分");
/** 国籍・地域（参考資料３） */
export const NATIONALITY_OPTIONS = KOYO_NATIONALITIES;
/** 在留資格（参考資料４。廃止済の在留資格は、資格喪失届・転勤届のためだけに残す） */
export const RESIDENCE_STATUS_OPTIONS = KOYO_RESIDENCE_STATUSES;

// ── 初めの値 ───────────────────────────────────────────

/** 雇用保険の資格取得年月日（入れていなければ入社日） */
export const koyoAcquiredOn = (staff: any, info = parseKoyoInfo(staff?.koyo_info)): string => info.acquiredOn || String(staff?.join_date ?? "");

/** 取得区分（入れていなければ、雇用保険被保険者番号があれば再取得「2」・なければ新規「1」） */
export const acquireKindOf = (staff: any, info = parseKoyoInfo(staff?.koyo_info)): "1" | "2" =>
  info.acquireKind || (String(staff?.employment_ins_num ?? "").replace(/\D/g, "").length === 11 ? "2" : "1");

/** 1週間の出勤する日数（カレンダーパターン 0 は出勤する曜日の数、ほかは土日を休みとして 5日） */
export const weeklyWorkDaysOf = (staff: any): number => {
  if (Number(staff?.calendar_pattern_id ?? 1) === 0) return Object.values(parseWorkDays(staff?.work_days)).filter(Boolean).length;
  return 5;
};

/**
 * 1週間の所定労働時間（分）：入れていればその値、なければ出勤する日数 × 1日の所定労働時間
 * （雇用保険事務手続きの手引き：被保険者の種類を問わず書く。資格喪失届は離職したときの時間）
 */
export const weeklyMinutesOf = (staff: any, info = parseKoyoInfo(staff?.koyo_info)): number => {
  if (info.weeklyMinutes !== null && info.weeklyMinutes > 0) return Math.round(info.weeklyMinutes);
  const hours = Number(staff?.scheduled_work_hours) || 0;
  return Math.round(weeklyWorkDaysOf(staff) * hours * 60);
};

/** 支払の態様（1：月給（日給月給を含む） / 3：日給 / 4：時間給） */
export const payStyleOf = (staff: any): string => {
  const type = String(staff?.wage_type ?? "");
  const codes = KOYO_CODES["支払の態様"];
  return type === "monthly" ? codes["月給"] : type === "daily" ? codes["日給"] : codes["時間給"];
};

/**
 * 賃金月額（円）の初めの値：毎月決まって支払われる賃金の月額（臨時の賃金・1か月を超える期間ごとの賃金・超過勤務手当を除く）
 * 月給は基本給、日給は日給 × 1週間の出勤日数 × 52 ÷ 12、時給は時給 × 1週間の所定労働時間 × 52 ÷ 12。
 * 通勤手当（月額。定期券などを現物で渡すものも賃金）と、固定の支給項目（fixedItems）を足す
 * （雇用保険事務手続きの手引き：採用時に定められた賃金のうち、毎月決まって支払われるべき賃金の月額（支払総額））
 */
export const estimatedKoyoWage = (staff: any, fixedItems = 0, info = parseKoyoInfo(staff?.koyo_info)): number => {
  if (info.wageMonthly !== null && info.wageMonthly > 0) return Math.round(info.wageMonthly);
  const base = Number(staff?.base_wage) || 0;
  const type = String(staff?.wage_type ?? "");
  const weeks = 52 / 12;
  const main = type === "monthly" ? base
    : type === "daily" ? base * weeklyWorkDaysOf(staff) * weeks
    : base * (weeklyMinutesOf(staff, info) / 60) * weeks;
  // 通勤手当（月額）。定期券などを現物で渡すものも、雇用保険の賃金に入れる
  const commute = staff?.commute_type === "monthly" ? Number(staff?.commute_amount) || 0 : 0;
  return Math.round(main + commute + fixedItems);
};

/** 賃金月額を千円の単位にする（千円未満四捨五入。1〜9999） */
export const wageThousand = (yen: number): number => Math.min(9999, Math.max(1, Math.floor(yen / 1000 + 0.5)));

/**
 * 雇用形態の初めの値：契約期間の定めがあれば 4（有期契約労働者）、1週間の所定労働時間が30時間未満なら 3（パートタイム）、
 * ほかは 7（その他）（雇用保険事務手続きの手引き：短時間労働者（週の所定労働時間が30時間未満）は「3」、
 * 有期契約労働者（登録型派遣・パートタイムを除く）は「4」）
 */
export const employmentFormOf = (staff: any, info = parseKoyoInfo(staff?.koyo_info)): string => {
  if (info.employmentForm) return info.employmentForm;
  const codes = KOYO_CODES["雇用形態"];
  if (weeklyMinutesOf(staff, info) < 30 * 60) return codes["パートタイム"];
  if (info.contract.has) return codes["有期契約労働者"];
  return codes["その他"];
};

/** 被保険者となったことの原因の初めの値（2：新規雇用（その他）） */
export const causeOf = (info: KoyoInfo): string => info.cause || KOYO_CODES["被保険者となったことの原因"]["新規雇用(その他)"];

/** 国籍・地域のコード（参考資料３。なければ空） */
export const nationalityCodeOf = (name: string): string => KOYO_NATIONALITIES.find(([n]) => n === name)?.[1] ?? "";

/** 在留資格（コード → ファイルに書く値。不明（30）は入れた在留資格か理由） */
export const residenceStatusOf = (foreign: KoyoForeign): { code: string; csv: string; name: string } | null => {
  const s = KOYO_RESIDENCE_STATUSES.find((x) => x.code === foreign.status);
  if (!s) return null;
  return { code: s.code, csv: s.free ? [...foreign.statusText.trim()].slice(0, 20).join("") : s.csv, name: s.free ? foreign.statusText.trim() : s.name };
};

/** 離職票の交付が要るか（離職日に59歳以上なら、希望にかかわらず交付する。雇用保険事務手続きの手引き）。年齢は誕生日の前日に1つ増える */
export const certificateRequired = (staff: any, lossDate: string): boolean => {
  const birthday = String(staff?.birthday ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !/^\d{4}-\d{2}-\d{2}$/.test(lossDate)) return false;
  return lossDate >= birthdayAt(birthday, 59).subtract(1, "day").format("YYYY-MM-DD");
};

/** 離職票を交付する（資格喪失届（離職票交付あり）を出す）か */
export const wantsCertificate = (staff: any, info: KoyoInfo, lossDate: string): boolean =>
  info.loss.certificate === true || certificateRequired(staff, lossDate);

/** 離職理由の区分（画面の選択肢。key は KoyoLoss.reason、flag は離職証明書のファイルで「1」にする項目） */
export interface ReasonOption {
  key: string;
  flag: string;
  /** 区分の名前（手引きの名前。4(3)①②・5(1)⑦ は離職証明書の欄の字） */
  title: string;
  /** 区分のまとまり（1〜6） */
  group: string;
}

const flag = (name: string) => name;
/**
 * 離職理由の区分（離職証明書の⑦欄）。名前は手引き「離職理由欄（⑦欄）の各項目の内容について」の字（KOYO_REASON_TITLES）。
 * 4(3) の①②と 5(1)⑦ は手引きに名前がないので、離職証明書の欄の分け方で書く
 */
export const REASON_OPTIONS: ReasonOption[] = [
  { key: "1(1)", flag: flag("選択１－１"), title: KOYO_REASON_TITLES["1(1)"], group: "1" },
  { key: "1(2)", flag: flag("選択１－２"), title: KOYO_REASON_TITLES["1(2)"], group: "1" },
  { key: "2", flag: flag("選択２"), title: KOYO_REASON_TITLES["2"], group: "2" },
  { key: "3(1)", flag: flag("選択３－１"), title: KOYO_REASON_TITLES["3(1)"], group: "3" },
  { key: "3(2)", flag: flag("選択３－２"), title: KOYO_REASON_TITLES["3(2)"], group: "3" },
  { key: "3(3)", flag: flag("選択３－３"), title: KOYO_REASON_TITLES["3(3)"], group: "3" },
  { key: "3(4)", flag: flag("選択３－４"), title: KOYO_REASON_TITLES["3(4)"], group: "3" },
  { key: "4(1)", flag: flag("選択４－１"), title: KOYO_REASON_TITLES["4(1)"], group: "4" },
  { key: "4(2)", flag: flag("選択４－２"), title: KOYO_REASON_TITLES["4(2)"], group: "4" },
  { key: "4(3)①", flag: flag("選択４－３－１"), title: `${KOYO_REASON_TITLES["4(3)"]}（事業の縮小・一部休廃止に伴う人員整理のためのもの）`, group: "4" },
  { key: "4(3)②", flag: flag("選択４－３－２"), title: `${KOYO_REASON_TITLES["4(3)"]}（そのほか。理由を具体的に）`, group: "4" },
  { key: "5(1)①", flag: flag("選択５－１－１"), title: KOYO_REASON_TITLES["5(1)①"], group: "5" },
  { key: "5(1)②", flag: flag("選択５－１－２"), title: KOYO_REASON_TITLES["5(1)②"], group: "5" },
  { key: "5(1)③", flag: flag("選択５－１－３"), title: KOYO_REASON_TITLES["5(1)③"], group: "5" },
  { key: "5(1)④", flag: flag("選択５－１－４"), title: KOYO_REASON_TITLES["5(1)④"], group: "5" },
  { key: "5(1)⑤", flag: flag("選択５－１－５"), title: KOYO_REASON_TITLES["5(1)⑤"], group: "5" },
  { key: "5(1)⑥", flag: flag("選択５－１－６"), title: KOYO_REASON_TITLES["5(1)⑥"], group: "5" },
  { key: "5(1)⑦", flag: flag("選択５－１－７"), title: "職場における事情による離職（そのほか。理由を具体的に）", group: "5" },
  { key: "5(2)", flag: flag("選択５－２"), title: KOYO_REASON_TITLES["5(2)"], group: "5" },
  { key: "6", flag: flag("選択６"), title: KOYO_REASON_TITLES["6"], group: "6" },
];

/** 離職理由の区分のまとまりの名前（離職証明書の⑦欄の見出し） */
export const REASON_GROUP_TITLES: Record<string, string> = {
  "1": "1 事業所の倒産等によるもの",
  "2": "2 定年によるもの",
  "3": "3 労働契約期間満了等によるもの",
  "4": "4 事業主からの働きかけによるもの",
  "5": "5 労働者の判断によるもの",
  "6": "6 その他",
};

/**
 * 離職理由の欄の項目（区分ごと。name は仕様書の項目の名前。codes がある項目は選ぶ（KOYO_REASON_CODES）、ない項目は数か字を入れる）
 * when：ほかの項目の値で、入れるか決まる項目（[項目の名前, 値]）
 */
export interface ReasonDetail {
  name: string;
  label: string;
  /** 数を入れる項目（定年年齢・契約期間など）は "number"、字は "text"、選ぶ項目は "code" */
  input: "number" | "text" | "code";
  max?: number;
  when?: [string, string];
}

const code = (name: string, label: string, when?: [string, string]): ReasonDetail => ({ name, label, input: "code", ...(when ? { when } : {}) });
const number = (name: string, label: string, when?: [string, string]): ReasonDetail => ({ name, label, input: "number", ...(when ? { when } : {}) });
const text = (name: string, label: string, max: number, when?: [string, string]): ReasonDetail => ({ name, label, input: "text", max, ...(when ? { when } : {}) });

export const REASON_DETAILS: Record<string, ReasonDetail[]> = {
  "2": [
    number("選択２（定年年齢）", "定年の年齢（歳）"),
    code("選択２（定年後の継続雇用）", "定年後の継続雇用を"),
    code("選択２（継続雇用の事由）", "継続雇用を希望していたのに離職した事由", ["選択２（定年後の継続雇用）", "0"]),
    text("選択２（具体的理由）", "具体的な理由（c その他のとき）", 34, ["選択２（継続雇用の事由）", "2"]),
  ],
  "3(1)": [
    number("選択３－１（１回の契約期間）", "1回の契約期間（か月）"),
    number("選択３－１（通算契約期間）", "通算契約期間（か月）"),
    number("選択３－１（契約更新回数）", "契約更新回数（回）"),
    code("選択３－１（上限短縮による離職）", "当初の契約締結後に契約期間や更新回数の上限を短縮し、その上限到来による離職に該当"),
    code("選択３－１（規定上限による離職）", "当初の契約締結後に契約期間や更新回数の上限を設け、その上限到来による離職に該当"),
    code("選択３－１（雇用期限による離職）", "定年後の再雇用時にあらかじめ定められた雇用期限到来による離職で"),
    code("選択３－１（通算契約期間の上限による離職）", "4年6箇月以上5年以下の通算契約期間の上限が定められ、この上限到来による離職で"),
    code("選択３－１（上限の定めの有無）", "その上限が、平成24年8月10日前から定められて", ["選択３－１（通算契約期間の上限による離職）", "0"]),
  ],
  "3(2)": [
    code("選択３－２（労働者種別）", "労働者の種別"),
    number("選択３－２－１（１回の契約期間）", "1回の契約期間（か月）", ["選択３－２（労働者種別）", "0"]),
    number("選択３－２－１（通算契約期間）", "通算契約期間（か月）", ["選択３－２（労働者種別）", "0"]),
    number("選択３－２－１（契約更新回数）", "契約更新回数（回）", ["選択３－２（労働者種別）", "0"]),
    code("選択３－２－１（確約合意の有無）", "契約を更新又は延長することの確約・合意の", ["選択３－２（労働者種別）", "0"]),
    code("選択３－２－１（明示の有無）", "更新又は延長しない旨の明示の", ["選択３－２（労働者種別）", "0"]),
    code("選択３－２－１（雇止め通知の有無）", "直前の契約更新時に雇止め通知の", ["選択３－２（労働者種別）", "0"]),
    code("選択３－２－１（不更新条項の追加の有無）", "当初の契約締結後に不更新条項の追加が", ["選択３－２（労働者種別）", "0"]),
    code("選択３－２－１（労働者からの申出）", "労働者からの契約の更新又は延長", ["選択３－２（労働者種別）", "0"]),
    number("選択３－２－２（１回の契約期間）", "1回の契約期間（か月）", ["選択３－２（労働者種別）", "1"]),
    number("選択３－２－２（通算契約期間）", "通算契約期間（か月）", ["選択３－２（労働者種別）", "1"]),
    number("選択３－２－２（契約更新回数）", "契約更新回数（回）", ["選択３－２（労働者種別）", "1"]),
    code("選択３－２－２（確約合意の有無）", "契約を更新又は延長することの確約・合意の", ["選択３－２（労働者種別）", "1"]),
    code("選択３－２－２（明示の有無）", "更新又は延長しない旨の明示の", ["選択３－２（労働者種別）", "1"]),
    code("選択３－２－２（労働者からの申出）", "労働者からの契約の更新又は延長", ["選択３－２（労働者種別）", "1"]),
    code("選択３－２－２（派遣就業指示の選択）", "派遣就業の指示", ["選択３－２（労働者種別）", "1"]),
  ],
  "4(3)②": [text("選択４－３－２（具体的理由）", "具体的な理由", 33)],
  "5(1)⑤": [code("選択５－１－５（教育訓練の有無）", "教育訓練の")],
  "5(1)⑥": [text("選択５－１－６（所在地）", "事業所の旧（新）所在地", 13)],
  "5(1)⑦": [text("選択５－１－７（具体的理由）", "具体的な理由", 32)],
  "6": [text("選択６（具体的理由）", "具体的な理由", 37)],
};

/** 離職理由の欄の項目の選択肢（[コード, 名前]） */
export const reasonCodeOptions = (name: string): [string, string][] => Object.entries(KOYO_REASON_CODES[name] ?? {}).map(([label, c]) => [c, label]);
