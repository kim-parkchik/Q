/**
 * 健康保険・厚生年金保険 被保険者資格取得届／厚生年金保険 70歳以上被用者該当届と、
 * 健康保険・厚生年金保険 被保険者資格喪失届／厚生年金保険 70歳以上被用者不該当届
 *
 * ■ 資格取得届（日本年金機構「就職したとき（健康保険・厚生年金保険の資格取得）の手続き」・「2-1：従業員を採用したとき」の
 *   詳細説明（ケース2-1）・記入例・電子申請の自動チェック（CSV）csv200）
 *   ・事実発生（資格取得日）から5日以内に出す。資格取得日が届け出る日より後の届書は、e-Gov で受け付けない
 *   ・個人番号（マイナンバー）か基礎年金番号を必ず書く（どちらもない届書は返される）。個人番号を書いた人は、住所を書かない。
 *     書かない人は、郵便番号と住所（カナは必ず。漢字は書けない字がある・37文字を超えるときは書かない）を書く
 *   ・報酬月額は、資格取得時の決定（就業規則や労働契約の内容で、月給は月の額、時給・日給は同じ仕事の人の報酬などで決める）の額を、
 *     通貨（金銭）と現物で書く。通貨の額は届書の画面で入れてもらい、現物は従業員の画面の「現物で払う報酬」（社宅・食事など）と
 *     定期券などで渡す通勤手当から、資格取得日の1か月分の見込みを初めの値にする（utils/genbutsu.ts。画面で直せる）
 *   ・70歳以上の人は、備考欄項目1（70歳以上被用者該当）に印を付ける。協会けんぽの75歳以上の人と、健康保険組合・国民健康保険組合の
 *     70歳以上の人は「70歳以上被用者届のみ提出」にして、種別・取得区分を書かない（協会けんぽの70〜74歳の人は、健康保険の資格取得と
 *     70歳以上被用者該当を1つの届書で出す）
 *   ・被扶養者の有無は、協会けんぽの人で、健康保険被扶養者（異動）届を出す人だけ「1」
 *   ・国民健康保険組合の人は、取得区分を「健康保険適用除外承認申請書を同時に提出する者」にする（適用除外承認申請書は事実発生から14日以内）
 * ■ 資格喪失届（日本年金機構「従業員が退職・死亡したとき（健康保険・厚生年金保険の資格喪失）の手続き」・「2-2」の詳細説明・記入例・
 *   電子申請の自動チェック csv201）
 *   ・資格喪失日は、退職日・死亡日の翌日。事実発生から5日以内に出す。資格喪失日が届け出る日より後の届書は、e-Gov で受け付けない
 *   ・個人番号か基礎年金番号を必ず書く
 *   ・70歳以上被用者は「70歳不該当」に印を付け、不該当年月日（退職日・死亡日の当日）を書く。75歳以上の人と、健康保険組合・
 *     国民健康保険組合の70歳以上の人は「70歳以上被用者届のみ提出」にして、被保険者整理番号と資格喪失年月日を書かない
 *   ・協会けんぽの人は、資格確認書などを回収して添付し、枚数（添付・返不能）を書く。健康保険組合の人は、組合に出す届書に書く
 *   ・Q で作れる喪失の原因は、退職等（退職日の翌日）と死亡（死亡日の翌日）。75歳到達・障害認定・社会保障協定などは、まだ作れない
 * ■ 健康保険組合の人は、年金事務所（厚生年金）と健康保険組合（健康保険）の両方に出す（utils/unionReport.ts）
 * 項目の並び・種別・文字数・コードは src/constants/shahoTodoke.ts（仕様書の PDF から作ったもの）
 */
import dayjs from "dayjs";
import {
  SHAHO_EVENT_ERA_CODES, SHAHO_LOSS_REASONS, SHAHO_SHUTOKU_CATEGORIES, SHAHO_SHUTOKU_FIELDS, SHAHO_SHUTOKU_FORM_CODE, SHAHO_SHUTOKU_KINDS,
  SHAHO_SHUTOKU_UNION_FIELDS, SHAHO_SOSHITSU_FIELDS, SHAHO_SOSHITSU_FORM_CODE, SHAHO_SOSHITSU_UNION_FIELDS, type ShahoField,
} from "../constants/shahoTodoke";
import { PREFECTURE_MASTER } from "../constants/prefectures";
import { parseCommuteSetting } from "./commuteAllowance";
import { inKindEstimateOf, parseInKind } from "./genbutsu";
import type { HealthInsurer, InsurerType } from "./healthInsurer";
import { MY_NUMBER_PLACEHOLDER, shahoDate, toShahoKana, toShahoKanji, unusableChars, valueProblem } from "./shahoCsv";
import { reach70Date, reach75Date, shahoPersonValues, type ShahoPersonPart } from "./shahoPerson";
import { remunerationHistoryOf } from "./standardRemuneration";
import { unionRecordOf, type UnionRecord } from "./unionReport";

const TEN_MILLION = 10_000_000;
const AMOUNT_OVER = "9999999";
/** 和暦の日付（届書の元号のコード）。書けなければ空 */
const eventDate = (date: string) => shahoDate(date, SHAHO_EVENT_ERA_CODES) ?? { era: "", ymd: "" };
/** 事実発生から5日以内の提出期限 */
export const shikakuDeadline = (date: string): string => dayjs(date).add(5, "day").format("YYYY-MM-DD");
const amountText = (n: number) => (n >= TEN_MILLION ? AMOUNT_OVER : String(n));
const BASIC_REASON = "マイナンバーを書かない人は、基礎年金番号（10けた）を従業員の画面に入れてください（マイナンバーも基礎年金番号もない届書は返されます）";

/** 届書の1人分（年金事務所に出す項目と、健康保険組合の人は組合に出す項目） */
export interface ShikakuRow {
  staffId: string;
  name: string;
  kana: string;
  birthday: string;
  insurerType: InsurerType;
  /** 個人番号（マイナンバー）を書く */
  myNumber: boolean;
  over70: boolean;
  over70Only: boolean;
  /** 提出期限（事実発生から5日以内） */
  deadline: string;
  values: string[];
  /** 健康保険組合に出す行（組合の人だけ） */
  union: UnionRecord | null;
  problems: string[];
  notes: string[];
}

/** 年齢（日付 on の時点。70歳に達した日・75歳の誕生日から） */
const ageOn = (birthday: string, on: string) => ({
  over70: !!birthday && reach70Date(birthday) <= on,
  over75: !!birthday && reach75Date(birthday) <= on,
});

/** 項目の決まりで確かめる（事業所整理記号・事業所番号は事業所の情報で、ほかで知らせた項目は除く） */
const checkFields = (fields: ShahoField[], values: string[], skip: Set<number>, officeFields: number): string[] => {
  const problems: string[] = [];
  fields.forEach((f, i) => {
    if ((i >= 1 && i <= officeFields) || skip.has(i)) return;
    const p = valueProblem(f, values[i] ?? "");
    if (p) problems.push(p);
  });
  if (values.length !== fields.length) problems.push(`届書の項目の数が合いません（${values.length}／${fields.length}）`);
  return problems;
};

/** 問題と、知らせた項目の番号（同じことを2回知らせない） */
const problemList = () => {
  const problems: string[] = [];
  const reported = new Set<number>();
  const add = (message: string, ...fields: number[]) => {
    problems.push(message);
    fields.forEach((i) => reported.add(i));
  };
  return { problems, reported, add };
};

// ── 資格取得届 ─────────────────────────────────────────────

export interface ShutokuInput {
  staff: any;
  /** 資格取得年月日（YYYY-MM-DD） */
  acquiredOn: string;
  /** 報酬月額（通貨。円。入れていなければ null） */
  wage: number | null;
  /** 報酬月額（現物。社宅・食事・定期券など。円。なければ 0） */
  inKind?: number;
  /** 被扶養者がいる（協会けんぽの人で、健康保険被扶養者（異動）届も出す） */
  dependents: boolean;
  /** 資格確認書の発行を希望する */
  certificate: boolean;
  /** 特定適用事業所などの短時間労働者 */
  shortTime: boolean;
  /** 60歳以上の人の、退職後の継続再雇用（同じ日付の資格喪失届も出す） */
  rehired: boolean;
  /** 備考欄（その他） */
  remarks: string;
  insurer: HealthInsurer | null;
  /** 個人番号（マイナンバー）を書く（登録してあって、書くと選んだ人） */
  myNumber: boolean;
  /** 届け出る日（YYYY-MM-DD） */
  today: string;
}

export interface ShutokuRow extends ShikakuRow {
  acquiredOn: string;
  wage: number | null;
}

/** 資格取得届の被保険者の項目の番号 */
const SHUTOKU_PERSON: Record<ShahoPersonPart, number[]> = { pensionNumber: [5], kana: [6], birth: [8, 9], basic: [15, 16] };

/** 住所（郵便番号・カナ・漢字）。漢字は書けない字がある・37文字を超えるときは書かない */
const addressValues = (staff: any, kanjiField: ShahoField, add: (m: string, ...f: number[]) => void, notes: string[]) => {
  const zip = String(staff.zip_code ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (zip.length !== 7) add("郵便番号（7けた）を従業員の画面に入れてください（マイナンバーを書かない人は、住所を書きます）", 29, 30);
  const kana = toShahoKana(staff.address_kana);
  if (!kana) add("住所のフリガナを従業員の画面に入れてください（マイナンバーを書かない人は、住所をカナで書きます）", 31);
  let kanji = toShahoKanji(staff.address);
  if (kanji && (unusableChars(kanji).length > 0 || [...kanji].length > kanjiField.max)) {
    notes.push(unusableChars(kanji).length > 0
      ? `住所に届書に書けない字（${unusableChars(kanji).join("")}）があるので、漢字の住所は書きません（カナの住所で届きます）`
      : `住所が${kanjiField.max}文字を超えるので、漢字の住所は書きません（カナの住所で届きます）`);
    kanji = "";
  }
  const pref = PREFECTURE_MASTER.find((p) => kanji.startsWith(toShahoKanji(p.name)));
  if (kanji && !pref) notes.push("住所は都道府県名から書きます（従業員の画面の住所に、都道府県名を入れてください）");
  return [zip.length === 7 ? zip.slice(0, 3) : "", zip.length === 7 ? zip.slice(3) : "", kana, kanji];
};

export const buildShutokuRow = (input: ShutokuInput, office: string[]): ShutokuRow => {
  const { staff } = input;
  const { problems, reported, add } = problemList();
  const notes: string[] = [];
  const birthday = String(staff.birthday ?? "");
  const type: InsurerType = input.insurer?.type ?? "kyokai";
  const age = ageOn(birthday, input.acquiredOn);
  // 75歳以上と、健康保険組合・国民健康保険組合の70歳以上の人は、年金事務所には70歳以上被用者該当届だけを出す
  const over70Only = age.over70 && (age.over75 || type !== "kyokai");
  if (age.over75) notes.push("75歳以上（健康保険の資格もない）なので、「70歳以上被用者該当届」だけを出します（種別・取得区分は書きません）");
  else if (over70Only) notes.push("健康保険組合・国民健康保険組合の70歳以上の人なので、年金事務所には「70歳以上被用者該当届」だけを出します");
  else if (age.over70) notes.push("70歳以上なので、備考の「70歳以上被用者該当」に印を付けます（健康保険の資格取得と一緒に届けます）");

  const person = shahoPersonValues(staff, { kanjiField: SHAHO_SHUTOKU_FIELDS[7], withoutPensionNumber: true, needBasic: !input.myNumber, basicReason: BASIC_REASON });
  person.problems.forEach((p) => add(p.message, ...SHUTOKU_PERSON[p.part]));
  notes.push(...person.notes);

  // 種別（性別）・取得区分（70歳以上被用者届のみのときは書かない）
  const gender = String(staff.gender ?? "");
  const kind = gender === "male" ? SHAHO_SHUTOKU_KINDS["坑内員以外の男子"] : gender === "female" ? SHAHO_SHUTOKU_KINDS["女子"] : "";
  if (!over70Only && !kind) add("性別を従業員の画面に入れてください（届書の「種別」に書きます）", 10);
  const category = type === "kokuho"
    ? SHAHO_SHUTOKU_CATEGORIES["「健康保険適用除外承認申請書」を同時に提出する者"]
    : SHAHO_SHUTOKU_CATEGORIES["健康保険・厚生年金保険に加入する者"];
  if (type === "kokuho" && !over70Only) {
    notes.push("国民健康保険組合の人なので、「健康保険 被保険者適用除外承認申請書」も一緒に出します（事実発生から14日以内）");
  }

  const acquired = eventDate(input.acquiredOn);
  if (!acquired.era) add(`資格取得日（${input.acquiredOn || "なし"}）を和暦にできません`, 17, 18);
  else if (input.acquiredOn > input.today) {
    add(`資格取得日（${input.acquiredOn}）になってから届け出ます（e-Gov は、資格取得日が届け出る日より後の届書を受け付けません）`, 17, 18);
  }

  // 報酬月額（通貨・現物・合計）
  const wage = input.wage;
  if (wage === null || !(wage > 0)) add("報酬月額を入れてください（資格取得時の決定：月給は月の額、時給・日給は同じ仕事の人の報酬などから。残業代などの見込みも入れます）", 20, 22);
  const inKind = Math.max(0, Math.floor(Number(input.inKind) || 0));
  const total = (wage ?? 0) + inKind;
  if (wage !== null && wage > 0 && total < 1000) add("報酬月額の合計は1,000円以上で書きます", 22);
  if (total >= TEN_MILLION) notes.push("報酬月額が1千万円以上なので、仕様書の決まりで 9999999 と書きます");

  const address = input.myNumber ? ["", "", "", ""] : addressValues(staff, SHAHO_SHUTOKU_FIELDS[32], add, notes);
  const remarks = toShahoKanji(input.remarks);
  const multiOffice = Number(staff.multi_office) === 1;
  if (input.rehired) notes.push("退職後の継続再雇用なので、同じ日付の資格喪失届も出し、就業規則・雇用契約書の写しなどを添付します");

  const values = [
    SHAHO_SHUTOKU_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "", office[3] ?? "",
    "", person.kana, person.kanji, person.birth?.era ?? "", person.birth?.ymd ?? "",
    over70Only ? "" : kind, over70Only ? "" : category,
    input.myNumber ? MY_NUMBER_PLACEHOLDER : "", "", "",
    person.basic?.[0] ?? "", person.basic?.[1] ?? "",
    acquired.era, acquired.ymd,
    type === "kyokai" && !over70Only && input.dependents ? "1" : "0",
    wage === null ? "" : amountText(wage), amountText(inKind), wage === null ? "" : amountText(total),
    age.over70 ? "1" : "", multiOffice ? "1" : "", input.shortTime ? "1" : "", input.rehired ? "1" : "", "",
    remarks, ...address,
    over70Only ? "1" : "", type === "kyokai" && !over70Only && input.certificate ? "1" : "",
  ];
  problems.push(...checkFields(SHAHO_SHUTOKU_FIELDS, values, reported, 4));

  // 健康保険組合の人（75歳未満）は、組合にも出す（健康保険の資格取得。被扶養者・資格確認書は組合に出す届書に書く）
  let union: UnionRecord | null = null;
  if (type === "union" && input.insurer && !age.over75) {
    const set: Record<number, string> = {
      10: kind, 11: SHAHO_SHUTOKU_CATEGORIES["健康保険・厚生年金保険に加入する者"],
      19: input.dependents ? "1" : "0", 34: input.certificate ? "1" : "",
    };
    // 組合に出す届書には、住所をいつも書く（個人番号を書いた人も、わかれば書く）
    if (input.myNumber) {
      const zip = String(staff.zip_code ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
      const kanji = toShahoKanji(staff.address);
      Object.assign(set, {
        29: zip.length === 7 ? zip.slice(0, 3) : "", 30: zip.length === 7 ? zip.slice(3) : "", 31: toShahoKana(staff.address_kana),
        32: kanji && unusableChars(kanji).length === 0 && [...kanji].length <= SHAHO_SHUTOKU_FIELDS[32].max ? kanji : "",
      });
    }
    union = unionRecordOf(input.insurer, staff, values, SHAHO_SHUTOKU_UNION_FIELDS, set, false);
  }

  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), kana: person.kana, birthday, insurerType: type,
    myNumber: input.myNumber, over70: age.over70, over70Only, deadline: input.acquiredOn ? shikakuDeadline(input.acquiredOn) : "",
    acquiredOn: input.acquiredOn, wage, values, union, problems: [...new Set(problems)], notes,
  };
};

// ── 資格喪失届 ─────────────────────────────────────────────

/** Q で作れる喪失の原因（退職等：退職日の翌日に喪失／死亡：死亡日の翌日に喪失） */
export type LossCause = "退職等" | "死亡";

export interface SoshitsuInput {
  staff: any;
  cause: LossCause;
  /** 退職日・死亡日（YYYY-MM-DD） */
  eventDate: string;
  /** 60歳以上の人の、退職後の継続再雇用（同じ日付の資格取得届も出す） */
  rehired: boolean;
  /** 備考欄（その他。転勤・雇用契約の変更・「資格取得届提出中」など） */
  remarks: string;
  /** 回収した資格確認書の枚数（添付）・回収できなかった枚数（返不能）。書かなければ null */
  returned: number | null;
  unreturned: number | null;
  insurer: HealthInsurer | null;
  myNumber: boolean;
  today: string;
}

export interface SoshitsuRow extends ShikakuRow {
  cause: LossCause;
  eventDate: string;
  /** 資格喪失年月日（退職日・死亡日の翌日） */
  lostOn: string;
  pensionNumber: string;
}

const SOSHITSU_PERSON: Record<ShahoPersonPart, number[]> = { pensionNumber: [5], kana: [6], birth: [8, 9], basic: [11, 12] };

/** 喪失の原因の、届書のコード（仕様書の名前で引く） */
export const lossReasonCode = (cause: LossCause): string => SHAHO_LOSS_REASONS[cause];

export const buildSoshitsuRow = (input: SoshitsuInput, office: string[]): SoshitsuRow => {
  const { staff } = input;
  const { problems, reported, add } = problemList();
  const notes: string[] = [];
  const birthday = String(staff.birthday ?? "");
  const type: InsurerType = input.insurer?.type ?? "kyokai";
  const lostOn = input.eventDate ? dayjs(input.eventDate).add(1, "day").format("YYYY-MM-DD") : "";
  // 年齢は退職日・死亡日で数える（70歳以上被用者だった人は「70歳不該当」。75歳の誕生日を過ぎた人は健康保険の資格がない）
  const age = ageOn(birthday, input.eventDate);
  const over70Only = age.over70 && (age.over75 || type !== "kyokai");
  if (age.over75) notes.push("75歳以上（健康保険の資格もない）なので、「70歳以上被用者不該当届」だけを出します（被保険者整理番号・資格喪失年月日は書きません）");
  else if (over70Only) notes.push("健康保険組合・国民健康保険組合の70歳以上の人なので、年金事務所には「70歳以上被用者不該当届」だけを出します");
  else if (age.over70) notes.push("70歳以上被用者なので、「70歳不該当」に印を付け、不該当年月日（退職日・死亡日）を書きます");

  const person = shahoPersonValues(staff, { kanjiField: SHAHO_SOSHITSU_FIELDS[7], withoutPensionNumber: over70Only, needBasic: !input.myNumber, basicReason: BASIC_REASON });
  person.problems.forEach((p) => add(p.message, ...SOSHITSU_PERSON[p.part]));
  notes.push(...person.notes);

  const event = eventDate(input.eventDate);
  const lost = eventDate(lostOn);
  if (!event.era) add(`${input.cause === "死亡" ? "死亡日" : "退職日"}（${input.eventDate || "なし"}）を和暦にできません`, 16, 17, 13, 14, 24, 25);
  else if ((over70Only ? input.eventDate : lostOn) > input.today) {
    add(over70Only
      ? `${input.cause === "死亡" ? "死亡日" : "退職日"}（${input.eventDate}）になってから届け出ます（e-Gov は、不該当年月日が届け出る日より後の届書を受け付けません）`
      : `資格喪失日（${input.cause === "死亡" ? "死亡日" : "退職日"}の翌日 ${lostOn}）になってから届け出ます（e-Gov は、資格喪失日が届け出る日より後の届書を受け付けません）`, 13, 14);
  }
  const count = (n: number | null) => (n === null ? "" : String(Math.max(0, Math.trunc(n))));
  if (type === "kyokai" && !age.over75 && input.returned === null && input.unreturned === null) {
    notes.push("資格確認書などを交付していれば、回収して添付し、枚数を書きます（回収できないときは「健康保険 資格確認書回収不能届」も出します）");
  }
  if (input.rehired) notes.push("退職後の継続再雇用なので、同じ日付の資格取得届も出し、就業規則・雇用契約書の写しなどを添付します");
  const multiOffice = Number(staff.multi_office) === 1;

  const values = [
    SHAHO_SOSHITSU_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "", office[3] ?? "",
    person.pensionNumber, person.kana, person.kanji, person.birth?.era ?? "", person.birth?.ymd ?? "",
    input.myNumber ? MY_NUMBER_PLACEHOLDER : "", person.basic?.[0] ?? "", person.basic?.[1] ?? "",
    over70Only ? "" : lost.era, over70Only ? "" : lost.ymd,
    lossReasonCode(input.cause), event.era, event.ymd,
    multiOffice ? "1" : "", input.rehired ? "1" : "", toShahoKanji(input.remarks),
    type === "kyokai" && !over70Only ? count(input.returned) : "", type === "kyokai" && !over70Only ? count(input.unreturned) : "",
    age.over70 ? "1" : "", age.over70 ? event.era : "", age.over70 ? event.ymd : "",
    over70Only ? "1" : "",
  ];
  problems.push(...checkFields(SHAHO_SOSHITSU_FIELDS, values, reported, 4));

  let union: UnionRecord | null = null;
  if (type === "union" && input.insurer && !age.over75) {
    // 組合に出す届書：健康保険の資格喪失（被保険者整理番号・資格喪失年月日・資格確認書の回収を書く）
    union = unionRecordOf(input.insurer, staff, values, SHAHO_SOSHITSU_UNION_FIELDS, {
      5: String(staff.pension_num ?? "").normalize("NFKC").trim(), 13: lost.era, 14: lost.ymd,
      21: count(input.returned), 22: count(input.unreturned),
    }, true);
  }

  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), kana: person.kana, birthday, insurerType: type,
    myNumber: input.myNumber, over70: age.over70, over70Only, deadline: lostOn ? shikakuDeadline(lostOn) : "",
    cause: input.cause, eventDate: input.eventDate, lostOn, pensionNumber: person.pensionNumber,
    values, union, problems: [...new Set(problems)], notes,
  };
};

// ── 届書の画面の初めの値 ─────────────────────────────────────

/**
 * 資格取得日の初めの値：入社日。標準報酬月額の履歴で、入社した月より後の月から加入した人（パートで加入の決まりに当てはまるように
 * なった人など）は、その月の1日（日は画面で直してもらう）
 */
export const acquiredOnOf = (staff: any): { date: string; fromHistory: boolean } => {
  const join = String(staff?.join_date ?? "");
  const first = remunerationHistoryOf(staff).find((e) => e.amount > 0);
  if (first?.from && join && first.from > join.slice(0, 7)) return { date: `${first.from}-01`, fromHistory: true };
  return { date: join, fromHistory: false };
};

/**
 * 報酬月額の初めの値：月給の人は、基本給＋固定残業代＋通勤手当（月額）。時給・日給の人と、日額の通勤手当は入れてもらう
 * （資格取得時の決定は、月給は月の額、時給・日給は同じ仕事の人の報酬などから決め、残業代などの見込みも入れる）
 */
export const estimatedWageOf = (staff: any): number | null => {
  if (staff?.wage_type !== "monthly") return null;
  // 定期券などを現物で渡す通勤手当は、現物の見込み（estimatedInKindOf）に入れる
  const commute = staff.commute_type === "monthly" && !parseCommuteSetting(staff.commute_setting).inKind ? Number(staff.commute_amount) || 0 : 0;
  return (Number(staff.base_wage) || 0) + (Number(staff.fixed_overtime_allowance) || 0) + commute;
};

/**
 * 報酬月額の「現物」の初めの値：資格取得日にしている「現物で払う報酬」（社宅・食事など）の1か月分の額と、
 * 定期券などを現物で渡す通勤手当（月額）。出勤した日ごとの食事は、資格取得日の月の所定労働日数で数える（utils/genbutsu.ts）
 * @param prefecture 勤務地（拠点）の都道府県
 */
export const estimatedInKindOf = (
  staff: any, acquiredOn: string, prefecture: string | null, workDays: number,
): { amount: number; problems: string[] } => {
  const estimate = inKindEstimateOf(parseInKind(staff?.in_kind), acquiredOn, prefecture, workDays);
  const commute = staff?.commute_type === "monthly" && parseCommuteSetting(staff.commute_setting).inKind ? Number(staff.commute_amount) || 0 : 0;
  return { amount: estimate.amount + commute, problems: estimate.problems };
};

/** 資格喪失の原因と日（死亡日が退職日より前か同じなら死亡、そうでなければ退職等。どちらもなければ null） */
export const lossOf = (staff: any): { cause: LossCause; date: string } | null => {
  const death = String(staff?.death_date ?? "");
  const retire = String(staff?.retirement_date ?? "");
  if (death && (!retire || death <= retire)) return { cause: "死亡", date: death };
  return retire ? { cause: "退職等", date: retire } : null;
};
