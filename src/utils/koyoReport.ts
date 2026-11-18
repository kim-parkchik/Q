/**
 * 雇用保険の届書（ハローワークに出す電子申請用ファイルの1人分の行）
 * ・資格取得届（10101）：雇用した日の属する月の翌月10日まで
 * ・資格喪失届（10191）：被保険者でなくなった日（離職日の翌日）の翌日から起算して10日以内。離職票の交付を希望する人と、
 *   59歳以上の人は、離職証明書の内容を書いた「離職票交付あり」の形（524項目）で出す
 * ・転勤届（10106）：雇用保険適用事業所の違う拠点に移った日の翌日から起算して10日以内（移った先の安定所へ）
 * ・個人番号登録届（10702）：個人番号（マイナンバー）をハローワークに届けていない被保険者
 * 項目の並びと決まりは src/constants/koyoTodoke.ts（仕様書の PDF から作ったもの）、書き方は utils/koyoCsv.ts
 * 出典：厚生労働省「雇用保険事務手続きの手引き【第２編】被保険者資格の取得・喪失編」（令和８年８月版）、
 *       「ＣＳＶ形式届書作成仕様書（電子申請）（雇用保険適用関係届書）」（令和５年１１月（第14.00版））
 */
import dayjs from "dayjs";
import { KOYO_CODES, KOYO_FORM_CODES, KOYO_RISHOKU_FIELDS, KOYO_RISHOKUHYO_WISH, type KoyoForm } from "../constants/koyoTodoke";
import {
  KOYO_FIELDS, koyoDateValues, koyoKana, koyoKanji, koyoNameKanji, koyoNameProblem, koyoRomaji, koyoRowProblems, koyoText,
  splitKoyoNumber, splitPhone3,
} from "./koyoCsv";
import {
  acquireKindOf, causeOf, certificateRequired, employmentFormOf, estimatedKoyoWage, koyoAcquiredOn, parseKoyoInfo,
  payStyleOf, REASON_DETAILS, REASON_OPTIONS, wageThousand, weeklyMinutesOf, type KoyoInfo,
} from "./koyoInfo";
import { foreignOf, nationalityCodeOf, residenceStatusOf, type ForeignInfo } from "./foreignInfo";
import { hasNameSpace, MY_NUMBER_PLACEHOLDER } from "./shahoCsv";
import { md, type WageCertResult } from "./wageCertificate";

/** 雇用保険適用事業所（会社か、番号の違う拠点） */
export interface KoyoPlace {
  /** "company" か "branch:1" */
  key: string;
  /** 届書の事業所名称 */
  name: string;
  /** 雇用保険適用事業所番号（「1301-123456-7」） */
  koyoNumber: string;
  /** 提出先の安定所の名前（「飯田橋」。公共職業安定所・ハローワークの字は書かない） */
  helloWork: string;
  prefecture: string;
  zip: string;
  address: string;
  phone: string;
}

/** 届書の1人分 */
export interface KoyoRow {
  key: string;
  form: KoyoForm;
  staffId: string;
  name: string;
  /** 雇用保険適用事業所（KoyoPlace.key。ファイルは事業所ごとに作る） */
  place: string;
  /** できごとの日（資格取得日・離職日・転勤日） */
  date: string;
  deadline: string;
  /** 個人番号（マイナンバー）を書く */
  myNumber: boolean;
  values: string[];
  problems: string[];
  notes: string[];
  /** 離職証明書の賃金の欄（離職票交付ありのとき） */
  cert?: WageCertResult;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const genderCode = (g: unknown) => (g === "male" ? KOYO_CODES["性別"]["男"] : g === "female" ? KOYO_CODES["性別"]["女"] : "");
const fieldIndex = (form: KoyoForm, name: string): number => {
  const i = KOYO_FIELDS[form].findIndex((f) => f.name === name);
  if (i < 0) throw new Error(`${form} に「${name}」の項目がありません`);
  return i;
};
/** 項目の名前で値を入れる表（並びは仕様書の順） */
const valuesFor = (form: KoyoForm) => {
  const values = KOYO_FIELDS[form].map(() => "");
  const set = (name: string, value: string) => { values[fieldIndex(form, name)] = value; };
  const setDate = (prefix: string, date: string | null | undefined) => {
    const [era, y, m, d] = koyoDateValues(date);
    set(`${prefix}（元号）`, era);
    set(`${prefix}（年）`, y);
    set(`${prefix}（月）`, m);
    set(`${prefix}（日）`, d);
  };
  return { values, set, setDate };
};

/** 資格取得届の提出期限（雇用した日の属する月の翌月10日） */
export const shutokuDeadline = (date: string): string => dayjs(date).add(1, "month").date(10).format("YYYY-MM-DD");
/** 資格喪失届の提出期限（被保険者でなくなった日（離職日の翌日）の翌日から起算して10日以内） */
export const soshitsuDeadline = (lossDate: string): string => dayjs(lossDate).add(11, "day").format("YYYY-MM-DD");
/** 転勤届の提出期限（転勤した日の翌日から起算して10日以内） */
export const tenkinDeadline = (date: string): string => dayjs(date).add(10, "day").format("YYYY-MM-DD");

/** 氏名（漢字・カナ）の項目と、直すところ */
const nameParts = (name: string, kana: string, problems: string[], label = "氏名") => {
  const kanji = koyoKanji(name);
  const k = koyoKana(kana);
  const p = koyoNameProblem(kanji, label);
  if (p) problems.push(`${p}（従業員の画面）`);
  if (!k) problems.push(`${label}のフリガナを従業員の画面に入れてください`);
  else if (!hasNameSpace(k, " ")) problems.push(`${label}のフリガナの、姓と名の間にスペースを入れてください（従業員の画面）`);
  return { kanji: koyoNameKanji(kanji), kana: k };
};

/** 外国人の方の項目（ローマ字の氏名・国籍・在留資格など） */
const foreignParts = (foreign: ForeignInfo | null, problems: string[]) => {
  if (!foreign) return null;
  const status = residenceStatusOf(foreign);
  const code = nationalityCodeOf(foreign.nationality);
  const romaji = koyoRomaji(foreign.romaji);
  if (!romaji) problems.push("外国人の方の、ローマ字の氏名（在留カードのとおり）を入れてください（従業員の画面の在留資格の情報）");
  if (!code) problems.push("外国人の方の、国籍・地域を選んでください（従業員の画面の在留資格の情報）");
  if (!status) problems.push("外国人の方の、在留資格を選んでください（従業員の画面の在留資格の情報）");
  else if (!status.csv) problems.push("在留資格が「不明」のときは、在留資格（または理由）を20字以内で入れてください");
  const period = koyoDateValues(foreign.periodEnd);
  if (!period[0]) problems.push("外国人の方の、在留期間（満了日）を入れてください");
  const card = String(foreign.card ?? "").normalize("NFKC").toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{2}\d{8}[A-Z]{2}$/.test(card)) problems.push("在留カード番号は、英字2字・数字8字・英字2字の12字です");
  const [y, m, d] = (foreign.periodEnd || "").split("-");
  return {
    romaji, nationality: foreign.nationality, code, status: status?.csv ?? "", statusCode: status?.code ?? "",
    period: foreign.periodEnd ? [y, m, d] : ["", "", ""],
    permission: foreign.permission ? KOYO_CODES["資格外活動許可の有無"][foreign.permission] : "",
    card,
    dispatch: foreign.dispatch ? KOYO_CODES["派遣・請負就労区分"][foreign.dispatch] : "",
  };
};

/** 番号（4けた・6けた・1けた）の3つの項目 */
const numberParts = (value: string | null | undefined) => splitKoyoNumber(value) ?? ["", "", ""];

const placeProblems = (place: KoyoPlace, problems: string[]) => {
  if (!splitKoyoNumber(place.koyoNumber)) problems.push(`${place.name}の雇用保険適用事業所番号（11けた）を、会社設定・拠点の設定に入れてください`);
  if (!place.helloWork) problems.push(`${place.name}の届書を出すハローワーク（安定所の名前。「飯田橋」など）を、会社設定・拠点の設定に入れてください`);
};

/** 安定所の名前（「飯田橋公共職業安定所」「ハローワーク飯田橋」は「飯田橋」にする） */
export const helloWorkName = (s: string | null | undefined): string =>
  koyoKanji(String(s ?? "").replace(/公共職業安定所|職業安定所|ハローワーク|安定所/g, "").trim()).replace(/　/g, "");

// ── 資格取得届 ───────────────────────────────────────────

export interface KoyoShutokuInput {
  staff: any;
  place: KoyoPlace;
  /** 個人番号（マイナンバー）を書く */
  myNumber: boolean;
  /** 固定の支給項目の月額（賃金月額の初めの値に足す） */
  fixedItems: number;
  today: string;
}

export const buildKoyoShutoku = (input: KoyoShutokuInput): KoyoRow => {
  const { staff, place } = input;
  const info = parseKoyoInfo(staff.koyo_info);
  const problems: string[] = [];
  const notes: string[] = [];
  const v = valuesFor("shutoku");
  const acquiredOn = koyoAcquiredOn(staff, info);
  const kind = acquireKindOf(staff, info);
  v.set("帳票種別", KOYO_FORM_CODES.shutoku);
  v.set("個人番号", input.myNumber ? MY_NUMBER_PLACEHOLDER : "");
  if (!input.myNumber) notes.push("マイナンバーを書かない届書です（資格取得届は、マイナンバーを書いて出します。マイナンバーを登録して「マイナンバーを書く」にしてください）");
  if (kind === "2") {
    const n = splitKoyoNumber(staff.employment_ins_num);
    if (!n) problems.push("再取得の人は、前の会社の雇用保険被保険者証の被保険者番号（11けた）を、従業員の画面に入れてください");
    else {
      v.set("被保険者番号4桁", n[0]);
      v.set("被保険者番号6桁", n[1]);
      v.set("被保険者番号CD", n[2]);
    }
  }
  v.set("取得区分", kind);
  // 再取得で、被保険者証の氏名がいまの氏名と違うとき：被保険者氏名は被保険者証の氏名、変更後の氏名はいまの氏名
  const changed = kind === "2" && !!info.registeredName.trim();
  const now = nameParts(staff.name, staff.furigana, problems);
  if (changed) {
    const old = nameParts(info.registeredName, info.registeredKana, problems, "被保険者証の氏名");
    v.set("被保険者氏名", old.kanji);
    v.set("被保険者氏名フリガナ（カタカナ）", [...old.kana].slice(0, 20).join(""));
    v.set("変更後の氏名", now.kanji);
    v.set("変更後の氏名フリガナ（カタカナ）", [...now.kana].slice(0, 20).join(""));
  } else {
    v.set("被保険者氏名", now.kanji);
    v.set("被保険者氏名フリガナ（カタカナ）", [...now.kana].slice(0, 20).join(""));
  }
  const kanaRest = [...now.kana].slice(20).join("");
  v.set("性別", genderCode(staff.gender));
  if (!genderCode(staff.gender)) problems.push("性別を従業員の画面に入れてください");
  v.setDate("生年月日", staff.birthday);
  if (!staff.birthday) problems.push("生年月日を従業員の画面に入れてください");
  const office = numberParts(place.koyoNumber);
  v.set("事業所番号（安定所番号）", office[0]);
  v.set("事業所番号（一連番号）", office[1]);
  v.set("事業所番号（CD）", office[2]);
  v.setDate("資格取得年月日", acquiredOn);
  if (!acquiredOn) problems.push("入社日（雇用保険の資格取得日）を従業員の画面に入れてください");
  const cause = causeOf(info);
  v.set("被保険者となったことの原因", cause);
  v.set("賃金（支払の態様）", payStyleOf(staff));
  const wage = estimatedKoyoWage(staff, input.fixedItems, info);
  if (wage <= 0) problems.push("賃金月額がわかりません（従業員の画面の基本給か、雇用保険の「賃金月額」を入れてください）");
  v.set("賃金（賃金月額）", wage > 0 ? String(wageThousand(wage)).padStart(4, "0") : "");
  v.set("雇用形態", employmentFormOf(staff, info));
  v.set("職種", info.occupation);
  if (!info.occupation) problems.push("職種を選んでください（従業員の画面の雇用保険）");
  v.set("就職経路", info.route);
  if (!info.route) problems.push("就職経路を選んでください（従業員の画面の雇用保険）");
  const minutes = weeklyMinutesOf(staff, info);
  if (minutes < 20 * 60) problems.push(`1週間の所定労働時間が${Math.floor(minutes / 60)}時間${minutes % 60}分です（20時間未満の人は雇用保険の被保険者になりません）`);
  v.set("１週間の所定労働時間（時間）", p2(Math.min(99, Math.floor(minutes / 60))));
  v.set("１週間の所定労働時間（分）", p2(minutes % 60));
  v.set("契約期間の定め", info.contract.has ? "有" : "無");
  if (info.contract.has) {
    v.setDate("契約期間開始", info.contract.start);
    v.setDate("契約期間終了", info.contract.end);
    v.set("契約更新条項の有無", info.contract.renewal);
    if (!info.contract.start || !info.contract.end) problems.push("契約期間の初めの日と終わりの日を入れてください（従業員の画面の雇用保険）");
    if (!info.contract.renewal) problems.push("契約更新条項の有無を選んでください（従業員の画面の雇用保険）");
  }
  v.set("事業所名", [...koyoText(place.name)].slice(0, 34).join(""));
  const f = foreignParts(foreignOf(staff), problems);
  if (f) {
    v.set("被保険者氏名（ローマ字）", f.romaji);
    v.set("国籍・地域", f.nationality);
    v.set("国籍地域コード", f.code);
    v.set("在留資格", f.status);
    v.set("在留資格コード", f.statusCode);
    v.set("在留期間（年）", f.period[0]);
    v.set("在留期間（月）", f.period[1]);
    v.set("在留期間（日）", f.period[2]);
    v.set("資格外活動許可の有無", f.permission);
    v.set("在留カード番号", f.card);
    v.set("派遣・請負就労区分", f.dispatch);
    if (!f.permission) problems.push("外国人の方の、資格外活動許可の有無を選んでください");
    if (!f.dispatch) problems.push("外国人の方の、派遣・請負就労区分を選んでください");
  }
  const remarks = [koyoText(info.remarks), kanaRest ? `フリガナの続き ${kanaRest}` : ""].filter(Boolean).join(" ");
  if (cause === KOYO_CODES["被保険者となったことの原因"]["その他"] && !koyoText(info.remarks)) {
    problems.push("被保険者となったことの原因が「その他」のときは、備考に具体的な説明を入れてください");
  }
  v.set("備考", remarks);
  v.set("あて先", helloWorkName(place.helloWork));
  placeProblems(place, problems);
  problems.push(...koyoRowProblems("shutoku", v.values).filter((p) => !problems.some((q) => q.includes(p))));
  return {
    key: `shutoku:${staff.id}`, form: "shutoku", staffId: String(staff.id), name: String(staff.name ?? ""), place: place.key,
    date: acquiredOn, deadline: acquiredOn ? shutokuDeadline(acquiredOn) : "", myNumber: input.myNumber,
    values: v.values, problems: [...new Set(problems)], notes,
  };
};

// ── 資格喪失届（離職票交付なし・あり） ─────────────────────────────────

export interface KoyoSoshitsuInput {
  staff: any;
  place: KoyoPlace;
  /** 離職日（退職日・死亡日など。被保険者でなくなった日の前日） */
  lossDate: string;
  myNumber: boolean;
  /** 離職証明書の賃金の欄（離職票を交付するとき。utils/wageCertificate.ts） */
  cert: WageCertResult | null;
  /** 事業主（離職証明書の事業主の欄。会社の名前・所在地・代表者） */
  employer: { name: string; address: string; owner: string };
  today: string;
}

/** 喪失原因の初めの値：死亡は 1（離職以外の理由）、解雇・退職勧奨などの離職理由なら 3、ほかの退職は 2 */
export const lossCauseOf = (staff: any, info: KoyoInfo): string => {
  if (info.loss.cause) return info.loss.cause;
  if (staff.death_date && (!staff.retirement_date || staff.death_date <= staff.retirement_date)) return KOYO_CODES["喪失原因"]["離職以外の理由"];
  const employerSide = ["1(1)", "1(2)", "4(1)", "4(3)①", "4(3)②"];
  if (employerSide.includes(info.loss.reason)) return KOYO_CODES["喪失原因"]["事業主の都合による離職"];
  return info.loss.reason ? KOYO_CODES["喪失原因"]["3以外の離職"] : "";
};

/** 離職証明書の賃金の欄の、行（01〜25）の項目の名前 */
const rowName = (base: string, i: number) => `${base}${p2(i)}`;

export const buildKoyoSoshitsu = (input: KoyoSoshitsuInput): KoyoRow => {
  const { staff, place, lossDate, cert } = input;
  const info = parseKoyoInfo(staff.koyo_info);
  const form: KoyoForm = cert ? "rishoku" : "soshitsu";
  const problems: string[] = [];
  const notes: string[] = [];
  const v = valuesFor(form);
  v.set("帳票種別", KOYO_FORM_CODES[form]);
  v.set("個人番号", input.myNumber ? MY_NUMBER_PLACEHOLDER : "");
  const n = splitKoyoNumber(staff.employment_ins_num);
  if (!n) problems.push("雇用保険被保険者番号（11けた）を従業員の画面に入れてください");
  v.set("被保険者番号4桁", n?.[0] ?? "");
  v.set("被保険者番号6桁", n?.[1] ?? "");
  v.set("被保険者番号CD", n?.[2] ?? "");
  const office = numberParts(place.koyoNumber);
  v.set("事業所番号（安定所番号）", office[0]);
  v.set("事業所番号（一連番号）", office[1]);
  v.set("事業所番号（CD）", office[2]);
  const acquiredOn = koyoAcquiredOn(staff, info);
  v.setDate("資格取得年月日", acquiredOn);
  v.setDate("離職等年月日", lossDate);
  const cause = lossCauseOf(staff, info);
  if (!cause) problems.push("喪失原因を選んでください（従業員の画面の雇用保険の「離職」）");
  v.set("喪失原因", cause);
  v.set("離職票交付希望", KOYO_RISHOKUHYO_WISH[form === "rishoku" ? "rishoku" : "soshitsu"]);
  // ハローワークに届けている氏名がいまの氏名と違うとき：被保険者氏名は届けている氏名、新氏名はいまの氏名
  const now = nameParts(staff.name, staff.furigana, problems);
  const changed = !!info.registeredName.trim();
  if (changed) {
    const old = nameParts(info.registeredName, info.registeredKana, problems, "届けている氏名");
    v.set("被保険者氏名フリガナ（カタカナ）", [...old.kana].slice(0, 20).join(""));
    v.set("被保険者氏名", old.kanji);
    v.set("新氏名フリガナ（カタカナ）", [...now.kana].slice(0, 20).join(""));
    v.set("新氏名", now.kanji);
    v.setDate("氏名変更年月日", info.nameChangedOn);
    if (!info.nameChangedOn) problems.push("氏名を変えた日を入れてください（従業員の画面の雇用保険）");
  } else {
    v.set("被保険者氏名フリガナ（カタカナ）", [...now.kana].slice(0, 20).join(""));
    v.set("被保険者氏名", now.kanji);
  }
  v.set("補充採用予定の有無", info.loss.replacement || "無");
  v.set("性別", genderCode(staff.gender));
  if (!genderCode(staff.gender)) problems.push("性別を従業員の画面に入れてください");
  v.setDate("生年月日", staff.birthday);
  v.set("被保険者の住所又は居所", [...koyoText(staff.address)].slice(0, 64).join(""));
  v.set("事業所名称", [...koyoText(place.name)].slice(0, 34).join(""));
  const causeText = koyoText(info.loss.causeText || staff.retirement_reason || "");
  v.set("被保険者でなくなったことの原因", [...causeText].slice(0, 78).join(""));
  const minutes = weeklyMinutesOf(staff, info);
  v.set("１週間の所定労働時間（時間）", p2(Math.max(20, Math.min(99, Math.floor(minutes / 60)))));
  v.set("１週間の所定労働時間（分）", p2(minutes % 60));
  if (minutes < 20 * 60) notes.push(`1週間の所定労働時間が20時間未満（${Math.floor(minutes / 60)}時間）なので、届書には20時間と書きます。離職したときの時間を確かめてください`);
  v.set("あて先", helloWorkName(place.helloWork));
  const f = foreignParts(foreignOf(staff), problems);
  if (f) {
    v.set("被保険者氏名（ローマ字）", f.romaji);
    v.set("国籍・地域", f.nationality);
    v.set("国籍地域コード", f.code);
    v.set("在留資格", f.status);
    v.set("在留資格コード", f.statusCode);
    v.set("在留期間（年）", f.period[0]);
    v.set("在留期間（月）", f.period[1]);
    v.set("在留期間（日）", f.period[2]);
    v.set("在留カード番号", f.card);
    v.set("派遣・請負就労区分", f.dispatch);
  }
  if (form === "rishoku" && cert) {
    fillCertificate(v, staff, info, place, input, cert, problems, notes);
  } else if (certificateRequired(staff, lossDate)) {
    problems.push("離職日に59歳以上の人は、本人の希望にかかわらず離職票を交付します（離職証明書を作ります）");
  }
  placeProblems(place, problems);
  for (const p of koyoRowProblems(form, v.values)) if (!problems.includes(p)) problems.push(p);
  return {
    key: `${form}:${staff.id}`, form, staffId: String(staff.id), name: String(staff.name ?? ""), place: place.key, date: lossDate,
    deadline: lossDate ? soshitsuDeadline(lossDate) : "", myNumber: input.myNumber, values: v.values, problems: [...new Set(problems)],
    notes, ...(cert ? { cert } : {}),
  };
};

/** 離職証明書の項目（離職票交付ありの届書の 57 番目から） */
const fillCertificate = (
  v: ReturnType<typeof valuesFor>, staff: any, info: KoyoInfo, place: KoyoPlace, input: KoyoSoshitsuInput, cert: WageCertResult,
  problems: string[], notes: string[],
) => {
  const n = splitKoyoNumber(staff.employment_ins_num) ?? ["", "", ""];
  v.set("被保険者番号4桁（離職証明書）", n[0]);
  v.set("被保険者番号6桁（離職証明書）", n[1]);
  v.set("被保険者番号CD（離職証明書）", n[2]);
  const office = numberParts(place.koyoNumber);
  v.set("事業所番号（安定所番号）（離職証明書）", office[0]);
  v.set("事業所番号（一連番号）（離職証明書）", office[1]);
  v.set("事業所番号（CD）（離職証明書）", office[2]);
  v.set("離職者氏名フリガナ（カタカナ）", [...koyoKana(staff.furigana)].slice(0, 30).join(""));
  v.set("離職者氏名", koyoNameKanji(staff.name, 30));
  v.setDate("離職年月日", input.lossDate);
  v.set("事業所名称（離職証明書）", [...koyoKanji(place.name)].slice(0, 40).join(""));
  v.set("事業所所在地（離職証明書）", [...koyoKanji(place.address)].slice(0, 40).join(""));
  const officePhone = splitPhone3(place.phone);
  if (!officePhone) problems.push("事業所の電話番号は「03-1234-5678」のように、ハイフンで3つに区切って入れてください");
  v.set("事業所電話番号（市外局番）", officePhone?.[0] ?? "");
  v.set("事業所電話番号（市内局番）", officePhone?.[1] ?? "");
  v.set("事業所電話番号（加入者番号）", officePhone?.[2] ?? "");
  const zip = String(staff.zip_code ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (zip.length !== 7) problems.push("離職者の郵便番号（7けた）を従業員の画面に入れてください（離職票を送るのに使います）");
  v.set("離職者郵便番号（配達局番号）", zip.length === 7 ? zip.slice(0, 3) : "");
  v.set("離職者郵便番号（町域番号）", zip.length === 7 ? zip.slice(3) : "");
  const address = koyoText(staff.address);
  if (!address) problems.push("離職者の住所を従業員の画面に入れてください");
  if ([...address].length > 40) problems.push("離職者の住所が40字を超えます（離職証明書には40字まで書けます。従業員の画面で短くしてください）");
  v.set("離職者の住所又は居所", address);
  const tel = splitPhone3(staff.phone) ?? splitPhone3(staff.mobile);
  if (!tel) problems.push("離職者の電話番号を「090-1234-5678」のように、ハイフンで3つに区切って従業員の画面に入れてください");
  v.set("離職者電話番号（市外局番）", tel?.[0] ?? "");
  v.set("離職者電話番号（市内局番）", tel?.[1] ?? "");
  v.set("離職者電話番号（加入者番号）", tel?.[2] ?? "");
  v.set("事業主住所", [...koyoText(input.employer.address)].slice(0, 40).join(""));
  v.set("事業主氏名（上段）", [...koyoText(input.employer.name)].slice(0, 27).join(""));
  v.set("事業主氏名（下段）", [...koyoText(input.employer.owner)].slice(0, 27).join(""));
  if (!input.employer.name && !input.employer.owner) problems.push("事業主の名前（会社名・代表者）を会社設定に入れてください");
  const next = cert.nextDay;
  v.set("離職日の翌日（月）", p2(Number(next.slice(5, 7))));
  v.set("離職日の翌日（日）", p2(Number(next.slice(8, 10))));
  // 賃金の欄（行 01〜25。⑧⑨ と ⑩〜⑬ を、上から同じ行に並べる）
  const rows = Math.max(cert.insured.length, cert.wages.length);
  if (rows > 25) problems.push(`離職証明書の賃金の欄が${rows}行あり、電子申請のファイルに書ける25行を超えます（ハローワークに相談してください）`);
  const rowNotes = info.loss.rowNotes ?? {};
  for (let i = 1; i <= Math.min(25, rows); i++) {
    const ins = cert.insured[i - 1];
    const w = cert.wages[i - 1];
    const set = (base: string, value: string) => v.set(rowName(base, i), value);
    if (ins) {
      set("被保険者期間算定対象期間開始（月）", p2(Number(ins.from.slice(5, 7))));
      set("被保険者期間算定対象期間開始（日）", p2(Number(ins.from.slice(8, 10))));
      if (i > 1) {
        set("被保険者期間算定対象期間終了（月）", p2(Number(ins.to.slice(5, 7))));
        set("被保険者期間算定対象期間終了（日）", p2(Number(ins.to.slice(8, 10))));
      }
      set("賃金支払基礎日数", String(ins.days));
    }
    if (w) {
      set("賃金支払対象期間開始（月）", p2(Number(w.from.slice(5, 7))));
      set("賃金支払対象期間開始（日）", p2(Number(w.from.slice(8, 10))));
      if (i > 1) {
        set("賃金支払対象期間終了（月）", p2(Number(w.to.slice(5, 7))));
        set("賃金支払対象期間終了（日）", p2(Number(w.to.slice(8, 10))));
      }
      set("賃金支払対象期間基礎日数", String(w.days));
      set("賃金額Ａ", w.a > 0 ? String(w.a) : "");
      set("賃金額Ｂ", w.b > 0 ? String(w.b) : "");
      set("賃金額計", w.total > 0 ? String(w.total) : "");
    }
    const auto = [ins?.note ?? "", w?.note ?? ""].filter(Boolean).join(" ");
    const note = rowNotes[String(i)] ?? auto;
    if ([...note].length > 16) problems.push(`離職証明書の賃金の欄の${i}行目の備考「${note}」が16字を超えます（離職証明書の画面で短くしてください）`);
    set("賃金支払備考", note);
  }
  v.set("賃金に関する特記事項", koyoText(info.loss.wageNote));
  v.setDate("作成年月日", input.today);
  // 離職理由（⑦欄）
  const reason = REASON_OPTIONS.find((r) => r.key === info.loss.reason);
  if (!reason) problems.push("離職理由を選んでください（従業員の画面の雇用保険の「離職」）");
  for (const r of REASON_OPTIONS) v.set(r.flag, r.key === info.loss.reason ? "1" : "0");
  const details = REASON_DETAILS[info.loss.reason] ?? [];
  for (const d of details) {
    const active = !d.when || (info.loss.details[d.when[0]] ?? "") === d.when[1];
    const value = active ? koyoText(info.loss.details[d.name] ?? "") : "";
    v.set(d.name, value);
    if (active && !value) problems.push(`離職理由の「${d.label}」を入れてください`);
  }
  const circumstances = koyoText(info.loss.circumstances);
  if (!circumstances) problems.push("具体的事情記載欄（離職に至った原因と経緯）を入れてください（従業員の画面の雇用保険の「離職」）");
  v.set("具体的事情記載欄", circumstances);
  v.set("異議の有無", info.loss.objection);
  v.set("離職者署名", koyoText(info.loss.signature));
  if (!info.loss.objection) notes.push("離職者に離職証明書の内容と離職理由を確かめてもらい、異議の有無と氏名を入れてください（電子申請では、確かめたことを証明する書類（確認書）を添えます）");
  notes.push(...cert.notes);
  problems.push(...cert.problems);
  // 賃金の欄の日付（⑧の初めの行の終わりは離職日）
  if (cert.insured[0] && cert.insured[0].to !== input.lossDate) notes.push(`⑧の初めの行は ${md(cert.insured[0].from)}〜離職日 です`);
  void KOYO_RISHOKU_FIELDS;
};

// ── 転勤届 ───────────────────────────────────────────

export interface KoyoTenkinInput {
  staff: any;
  /** 転勤した日 */
  on: string;
  from: KoyoPlace;
  to: KoyoPlace;
  today: string;
}

export const buildKoyoTenkin = (input: KoyoTenkinInput): KoyoRow => {
  const { staff, from, to } = input;
  const info = parseKoyoInfo(staff.koyo_info);
  const problems: string[] = [];
  const notes: string[] = [];
  const v = valuesFor("tenkin");
  v.set("帳票種別", KOYO_FORM_CODES.tenkin);
  const n = splitKoyoNumber(staff.employment_ins_num);
  if (!n) problems.push("雇用保険被保険者番号（11けた）を従業員の画面に入れてください");
  v.set("被保険者番号4桁", n?.[0] ?? "");
  v.set("被保険者番号6桁", n?.[1] ?? "");
  v.set("被保険者番号CD", n?.[2] ?? "");
  v.setDate("生年月日", staff.birthday);
  const now = nameParts(staff.name, staff.furigana, problems);
  v.set("被保険者氏名", now.kanji);
  v.set("被保険者氏名フリガナ（カタカナ）", [...now.kana].slice(0, 20).join(""));
  { const fr = foreignOf(staff); if (fr) v.set("被保険者氏名（ローマ字）", koyoRomaji(fr.romaji)); }
  v.setDate("資格取得年月日", koyoAcquiredOn(staff, info));
  const t = numberParts(to.koyoNumber);
  v.set("事業所番号（安定所番号）", t[0]);
  v.set("事業所番号（一連番号）", t[1]);
  v.set("事業所番号（CD）", t[2]);
  const f = numberParts(from.koyoNumber);
  v.set("転勤前の事業所番号（安定所番号）", f[0]);
  v.set("転勤前の事業所番号（一連番号）", f[1]);
  v.set("転勤前の事業所番号（CD）", f[2]);
  v.setDate("転勤年月日", input.on);
  v.set("転勤前事業所名称・所在地", [...koyoText(`${from.name} ${from.address}`)].slice(0, 72).join(""));
  if (info.registeredName.trim()) {
    v.set("変更前氏名（フリガナ）", [...koyoKana(info.registeredKana)].slice(0, 20).join(""));
    v.set("変更前氏名", koyoNameKanji(info.registeredName));
    v.setDate("氏名変更年月日", info.nameChangedOn);
  }
  v.set("あて先", helloWorkName(to.helloWork));
  if (from.key === to.key) problems.push("移る前と移った先の雇用保険適用事業所が同じです（転勤届は、適用事業所が変わるときに出します）");
  placeProblems(to, problems);
  if (!splitKoyoNumber(from.koyoNumber)) problems.push(`${from.name}の雇用保険適用事業所番号を、会社設定・拠点の設定に入れてください`);
  for (const p of koyoRowProblems("tenkin", v.values)) if (!problems.includes(p)) problems.push(p);
  return {
    key: `tenkin:${staff.id}:${input.on}`, form: "tenkin", staffId: String(staff.id), name: String(staff.name ?? ""), place: to.key,
    date: input.on, deadline: tenkinDeadline(input.on), myNumber: false, values: v.values, problems: [...new Set(problems)], notes,
  };
};

// ── 個人番号登録届 ───────────────────────────────────────

export const buildKoyoBango = (input: { staff: any; place: KoyoPlace; today: string }): KoyoRow => {
  const { staff, place } = input;
  const info = parseKoyoInfo(staff.koyo_info);
  const problems: string[] = [];
  const v = valuesFor("bango");
  v.set("帳票種別", KOYO_FORM_CODES.bango);
  v.set("個人番号", MY_NUMBER_PLACEHOLDER);
  const n = splitKoyoNumber(staff.employment_ins_num);
  if (!n) problems.push("雇用保険被保険者番号（11けた）を従業員の画面に入れてください");
  v.set("被保険者番号4桁", n?.[0] ?? "");
  v.set("被保険者番号6桁", n?.[1] ?? "");
  v.set("被保険者番号CD", n?.[2] ?? "");
  v.set("氏名（カタカナ）", [...koyoKana(staff.furigana)].slice(0, 30).join(""));
  { const fr = foreignOf(staff); if (fr) v.set("被保険者氏名（ローマ字）", koyoRomaji(fr.romaji)); }
  v.set("性別", genderCode(staff.gender));
  v.setDate("生年月日", staff.birthday);
  if (info.registeredName.trim()) {
    v.set("変更前氏名（フリガナ）", [...koyoKana(info.registeredKana)].slice(0, 20).join(""));
    v.set("変更前氏名", koyoNameKanji(info.registeredName));
    v.setDate("氏名変更年月日", info.nameChangedOn);
  }
  v.set("あて先", helloWorkName(place.helloWork));
  placeProblems(place, problems);
  for (const p of koyoRowProblems("bango", v.values)) if (!problems.includes(p)) problems.push(p);
  return {
    key: `bango:${staff.id}`, form: "bango", staffId: String(staff.id), name: String(staff.name ?? ""), place: place.key,
    date: input.today, deadline: "", myNumber: true, values: v.values, problems: [...new Set(problems)], notes: [],
  };
};
