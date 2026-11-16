/**
 * 健康保険 被扶養者（異動）届／国民年金第3号被保険者関係届（協会けんぽの被保険者。様式コード 2202700）と、
 * 国民年金第3号被保険者関係届（健康保険組合・国民健康保険組合の被保険者の配偶者。様式コード 4300700）の電子申請用ファイルのデータレコード
 *
 * 決まり（日本年金機構「従業員（健康保険・厚生年金保険の被保険者）が家族を被扶養者にするとき、被扶養者に異動があったときの手続き」・
 * 「2-3」の詳細説明・記入例（該当・非該当・変更）・電子申請（e-Gov）の入力例・電子申請の自動チェック（CSV）csv202・csv3、
 * 厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」の表4.10.1-1・表4.11.1-1）:
 * ・事実発生から5日以内に、被保険者が事業主を経由して出す（被扶養者でなくなったときは、その都度）
 * ・1つのレコードに、異動の別（該当・非該当・変更）が同じ、配偶者である被扶養者と、その他の被扶養者2人までを書く。
 *   配偶者を含むときは「配偶者である被扶養者」に、含まないときは「その他の被扶養者1」から書く（3人目からは、次のレコード）
 * ・協会けんぽの被保険者の配偶者の届けは、国民年金第3号被保険者関係届を兼ねる（届出日を書く）。第3号被保険者にならない配偶者
 *   （60歳以上など）は、備考に「扶養届のみ」と書く。健康保険組合などの被保険者の配偶者は、3号関係届（4300700）だけを年金事務所に出し、
 *   健康保険の被扶養者の届けは組合に出す（このファイルでは作らない）
 * ・該当：被扶養者になった日・理由・職業・年間収入の見込み・同居か別居か・住所、被保険者の年間収入。非該当：でなくなった日
 *   （死亡はその翌日、就職などはその日、後期高齢者医療の被保険者になったときはその日）・理由（死亡は死亡年月日も。75歳到達・
 *   障害認定は住所地の都道府県コード）。変更：備考に変更した項目と変更前の内容
 * ・マイナンバーは、被保険者と被扶養者の両方を書けば、続柄の確認書類を省ける（事業主が続柄を確かめたときは「続柄確認」に印）。
 *   マイナンバーを書かない被保険者は基礎年金番号と住所を書く。被扶養者の住所は、マイナンバーを書いても書く
 * ・1千万円以上の収入は 9999999
 * 項目の並び・種別・文字数・コードは src/constants/shahoTodoke.ts（仕様書の PDF から作ったもの）
 */
import dayjs from "dayjs";
import {
  SHAHO_FUYOU_BIRTH_ERA_CODES, SHAHO_FUYOU_CODES, SHAHO_FUYOU_EVENT_ERA_CODES, SHAHO_FUYOU_FIELDS, SHAHO_FUYOU_FORM_CODE,
  SHAHO_FUYOU_OVERSEAS_ERA_CODES, SHAHO_FUYOU_PREFECTURE_CODES, SHAHO_SANGO_CODES, SHAHO_SANGO_FIELDS, SHAHO_SANGO_FORM_CODE,
  type ShahoField,
} from "../constants/shahoTodoke";
import { PREFECTURE_MASTER } from "../constants/prefectures";
import type { InsurerType } from "./healthInsurer";
import { isSango, suggestFuyouKind, type DependentReported, type FuyouChangeKind, type HealthDependent } from "./healthDependents";
import { familyKey } from "./myNumber";
import { MY_NUMBER_PLACEHOLDER, hasNameSpace, shahoDate, toShahoKana, toShahoKanji, unusableChars, valueProblem } from "./shahoCsv";
import { splitBasicPensionNumber } from "./shahoPerson";

const TEN_MILLION = 10_000_000;
const amountText = (n: number | null): string => (n === null ? "" : n >= TEN_MILLION ? "9999999" : String(Math.max(0, Math.floor(n))));
const eventDate = (date: string) => shahoDate(date, SHAHO_FUYOU_EVENT_ERA_CODES) ?? { era: "", ymd: "" };
const birthDate = (date: string) => shahoDate(date, SHAHO_FUYOU_BIRTH_ERA_CODES) ?? { era: "", ymd: "" };
const sexCode = (gender: string) => (gender === "male" ? "1" : gender === "female" ? "2" : "");
/** 事実発生から5日以内の提出期限 */
export const fuyouDeadline = (date: string): string => (date ? dayjs(date).add(5, "day").format("YYYY-MM-DD") : "");

/** 被扶養者の届けの1件（ファイルの1行） */
export interface FuyouRow {
  /** 画面の行の印 */
  key: string;
  staffId: string;
  name: string;
  /** 被扶養者（異動）届（協会けんぽ）か、国民年金第3号被保険者関係届（健康保険組合などの被保険者の配偶者）か */
  form: "fuyou" | "sango";
  kind: FuyouChangeKind;
  /** この行に書いた被扶養者（配偶者が先） */
  dependents: HealthDependent[];
  /** 提出期限（事実発生（なった日・でなくなった日）から5日以内） */
  deadline: string;
  values: string[];
  /** 個人番号の項目が誰の番号か（項目の番号 → 本人 "self"・家族 familyKey） */
  persons: Record<number, string>;
  /** 家族の名前（マイナンバーを読めなかったときに知らせる） */
  personNames: Record<string, string>;
  problems: string[];
  notes: string[];
  /** ファイルを保存したら、被扶養者ごとに残す届け出た内容（被扶養者の id → 内容） */
  reported: Record<string, DependentReported>;
}

export interface FuyouInput {
  staff: any;
  kind: FuyouChangeKind;
  /** この届けに入れる配偶者（1人まで）と、その他の被扶養者（2人まで） */
  spouse: HealthDependent | null;
  others: HealthDependent[];
  /** 事業主等受付年月日（被保険者から届けを受けた日） */
  receivedOn: string;
  /** 事業主確認（所得税法上の控除対象配偶者・扶養親族であることを確かめた。収入の証明を省ける） */
  employerChecked: boolean;
  /** 被保険者の今後1年間の年間収入の見込み（該当のとき） */
  staffIncome: number | null;
  /** 被扶養者でない配偶者の年間収入（該当で、配偶者を被扶養者にしないとき。夫婦ともに収入があるとき） */
  spouseIncome: number | null;
  /** 被保険者のマイナンバーを書く */
  myNumber: boolean;
  /** 家族のマイナンバーを書く（登録してあって、書くと選んだとき） */
  familyMyNumber: (d: HealthDependent) => boolean;
  today: string;
}

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

const checkFields = (fields: ShahoField[], values: string[], skip: Set<number>): string[] => {
  const problems: string[] = [];
  fields.forEach((f, i) => {
    if ((i >= 1 && i <= 3) || skip.has(i)) return;
    const p = valueProblem(f, values[i] ?? "");
    if (p) problems.push(p);
  });
  if (values.length !== fields.length) problems.push(`届書の項目の数が合いません（${values.length}／${fields.length}）`);
  return problems;
};

/** 氏名（カナ・漢字）。漢字は書けない字がある・12文字を超える・姓と名の間にスペースがないときは書かない（カナで届く） */
const nameValues = (who: string, name: string, kana: string, kanjiMax: number, add: (m: string, ...f: number[]) => void, at: number, notes: string[]) => {
  const k = toShahoKana(kana);
  if (!k) add(`${who}のフリガナを入れてください`, at);
  else if (!hasNameSpace(k, " ")) add(`${who}のフリガナの、姓と名の間にスペースを入れてください`, at);
  let kanji = toShahoKanji(name);
  if (kanji && (unusableChars(kanji).length > 0 || [...kanji].length > kanjiMax || !hasNameSpace(kanji, "　"))) {
    notes.push(unusableChars(kanji).length > 0
      ? `${who}の氏名に届書に書けない字（${unusableChars(kanji).join("")}）があるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : [...kanji].length > kanjiMax ? `${who}の氏名が${kanjiMax}文字を超えるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : `${who}の氏名の姓と名の間にスペースがないので、漢字の氏名は書きません（カナの氏名で届きます）`);
    kanji = "";
  }
  return [k, kanji];
};

/** 郵便番号（親番号・子番号）と住所（漢字）。住所は、書けない字がある・37文字を超えるときは書かない */
const addressValues = (who: string, zip: string, address: string, kanjiField: ShahoField, required: boolean, add: (m: string, ...f: number[]) => void, at: number, notes: string[]) => {
  const z = String(zip ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (required && z.length !== 7) add(`${who}の郵便番号（7けた）を入れてください`, at, at + 1);
  let kanji = toShahoKanji(address);
  if (required && !kanji) add(`${who}の住所を入れてください`, at + 2);
  if (kanji && (unusableChars(kanji).length > 0 || [...kanji].length > kanjiField.max)) {
    notes.push(unusableChars(kanji).length > 0
      ? `${who}の住所に届書に書けない字（${unusableChars(kanji).join("")}）があるので、住所は書きません`
      : `${who}の住所が${kanjiField.max}文字を超えるので、住所は書きません`);
    kanji = "";
  }
  return [z.length === 7 ? z.slice(0, 3) : "", z.length === 7 ? z.slice(3) : "", kanji];
};

/** 電話番号を、局番1・2・3に分ける（「03-1234-5678」のようにハイフンで分けたもの。分けられなければ null） */
export const splitPhone = (phone: string): [string, string, string] | null => {
  const parts = String(phone ?? "").normalize("NFKC").split(/[-ー－()（）\s]+/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return [parts[0], parts[1], parts[2]];
};

/** 住所の都道府県の、被扶養者（異動）届の住所地のコード（表4.10.1-2。わからなければ空） */
const prefectureCodeOf = (address: string): string => {
  const a = String(address ?? "").normalize("NFKC");
  const p = PREFECTURE_MASTER.find((x) => a.startsWith(x.name));
  return p ? SHAHO_FUYOU_PREFECTURE_CODES[p.name] ?? "" : "";
};

/** 被扶養者でなくなった日のもとになる日（死亡はその翌日にでなくなる） */
const untilOf = (d: HealthDependent) => d.until;

/** その人の、この届けのできごとの日（該当はなった日、非該当はでなくなった日、変更は今日） */
const eventOf = (d: HealthDependent, kind: FuyouChangeKind, today: string) => (kind === "該当" ? d.from : kind === "非該当" ? untilOf(d) : today);

/** 変更の届けの備考（変更した項目と、届け出た変更前の内容） */
export const changeRemarks = (d: HealthDependent): string => {
  const r = d.reported;
  if (!r) return "";
  const parts: string[] = [];
  if (r.name !== d.name || r.kana !== d.kana) parts.push(`氏名変更前：${r.name || r.kana}`);
  if (r.birthday !== d.birthday) parts.push(`生年月日訂正前：${r.birthday}`);
  if (r.gender !== d.gender) parts.push(`性別変更前：${r.gender === "male" ? "男" : r.gender === "female" ? "女" : ""}`);
  return parts.join("　");
};

/** 被保険者（従業員）の項目：整理番号・氏名・生年月日・性別・個人番号・基礎年金番号・住所 */
const staffPart = (staff: any, kind: FuyouChangeKind, myNumber: boolean, kanjiField: ShahoField, addressField: ShahoField, add: (m: string, ...f: number[]) => void, notes: string[], at: { pension: number | null; kana: number; birth: number; my: number; basic: number; zip: number }) => {
  const pension = String(staff.pension_num ?? "").normalize("NFKC").trim();
  if (at.pension !== null && kind !== "該当" && !pension) add("被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」。非該当・変更の届けには必ず書きます）", at.pension);
  const [kana, kanji] = nameValues("被保険者", staff.name, staff.furigana, kanjiField.max, add, at.kana, notes);
  const birth = birthDate(String(staff.birthday ?? ""));
  if (!birth.era) add(staff.birthday ? `被保険者の生年月日（${staff.birthday}）を、この届書の元号で書けません` : "被保険者の生年月日を入れてください", at.birth, at.birth + 1);
  const basic = myNumber ? null : splitBasicPensionNumber(staff.basic_pension_number);
  if (!myNumber && !basic) add("マイナンバーを書かない被保険者は、基礎年金番号（10けた）を従業員の画面に入れてください", at.basic, at.basic + 1);
  const address = myNumber ? ["", "", ""] : addressValues("被保険者", staff.zip_code, staff.address, addressField, true, add, at.zip, notes);
  return { pension, kana, kanji, birth, basic, address };
};

/**
 * 協会けんぽの被保険者の、被扶養者（異動）届／国民年金第3号被保険者関係届（表4.10.1-1。139項目）の1行
 * @param office 事業所情報の12項目（頭の3つが都道府県コード・郡市区符号・事業所記号）
 */
export const buildFuyouRow = (input: FuyouInput, office: string[], key = ""): FuyouRow => {
  const { staff, kind, spouse, others } = input;
  const { problems, reported: skip, add } = problemList();
  const notes: string[] = [];
  const F = SHAHO_FUYOU_FIELDS;
  const v: string[] = Array(F.length).fill("");
  const persons: Record<number, string> = {};
  const personNames: Record<string, string> = {};
  v[0] = SHAHO_FUYOU_FORM_CODE;
  v[1] = office[0] ?? ""; v[2] = office[1] ?? ""; v[3] = office[2] ?? "";
  if (!spouse && others.length === 0) add("届ける被扶養者がいません");
  if (others.length > 2) add("1つの届書に書けるその他の被扶養者は2人までです");
  // 事業主確認（収入の証明を省いたとき、所得税法上の控除対象配偶者・扶養親族であることを確かめた）
  v[4] = kind === "該当" ? (input.employerChecked ? "1" : "0") : "";
  const received = eventDate(input.receivedOn);
  if (!received.era) add("事業主等受付年月日（被保険者から届けを受けた日）を入れてください", 5, 6);
  v[5] = received.era; v[6] = received.ymd;

  const s = staffPart(staff, kind, input.myNumber, F[9], F[19], add, notes, { pension: 7, kana: 8, birth: 10, my: 13, basic: 14, zip: 17 });
  v[7] = s.pension; v[8] = s.kana; v[9] = s.kanji; v[10] = s.birth.era; v[11] = s.birth.ymd;
  v[12] = sexCode(String(staff.gender ?? ""));
  if (!v[12]) add("被保険者の性別を従業員の画面に入れてください", 12);
  if (input.myNumber) { v[13] = MY_NUMBER_PLACEHOLDER; persons[13] = "self"; }
  v[14] = s.basic?.[0] ?? ""; v[15] = s.basic?.[1] ?? "";
  if (kind === "該当") {
    if (input.staffIncome === null) add("被保険者の今後1年間の年間収入の見込みを入れてください（該当の届けには必ず書きます）", 16);
    v[16] = amountText(input.staffIncome);
  }
  v[17] = s.address[0]; v[18] = s.address[1]; v[19] = s.address[2];
  v[20] = SHAHO_FUYOU_CODES.change[kind];

  // 配偶者である被扶養者（国民年金第3号被保険者を兼ねる）
  if (spouse) {
    const who = `配偶者（${spouse.name || "氏名なし"}）`;
    const on = eventOf(spouse, kind, input.today);
    const sango = isSango(spouse, kind === "該当" ? spouse.from : spouse.reported?.on || on);
    v[21] = received.era; v[22] = received.ymd; // 届出日（配偶者が被保険者を通じて事業主に出した日）
    const [kana, kanji] = nameValues(who, spouse.name, spouse.kana, F[24].max, add, 23, notes);
    v[23] = kana; v[24] = kanji;
    const b = birthDate(spouse.birthday);
    if (!b.era) add(`${who}の生年月日を入れてください`, 25, 26);
    v[25] = b.era; v[26] = b.ymd;
    v[27] = (SHAHO_FUYOU_CODES.spouseRelation as Record<string, string>)[spouse.relation] ?? "";
    if (!v[27]) add(`${who}の続柄（夫・妻）を選んでください`, 27);
    if (input.familyMyNumber(spouse)) {
      v[28] = MY_NUMBER_PLACEHOLDER;
      const person = familyKey(spouse.name, spouse.birthday);
      persons[28] = person;
      personNames[person] = spouse.name;
    } else {
      const basic = splitBasicPensionNumber(spouse.basicPensionNumber);
      v[29] = basic?.[0] ?? ""; v[30] = basic?.[1] ?? "";
      if (sango && !basic) notes.push(`${who}のマイナンバーも基礎年金番号も書かないので、第3号被保険者の届けに必要なときは、年金事務所から問い合わせがあります（基礎年金番号を入れてください）`);
    }
    if (kind === "該当") v[34] = SHAHO_FUYOU_CODES.living[spouse.together ? "同居" : "別居"];
    if (kind === "非該当" && (spouse.endReason === "75歳到達" || spouse.endReason === "障害認定")) {
      v[35] = prefectureCodeOf(spouse.address);
      if (!v[35]) add(`${who}の住所（都道府県から）を入れてください（後期高齢者医療の住所地の都道府県を書きます）`, 35);
    }
    const addr = addressValues(who, spouse.zip, spouse.address, F[38], true, add, 36, notes);
    v[36] = addr[0]; v[37] = addr[1]; v[38] = addr[2];
    const phone = splitPhone(spouse.phone);
    if (spouse.phone && !phone) notes.push(`${who}の電話番号は「03-1234-5678」のようにハイフンで分けて入れると書きます`);
    if (phone) {
      v[39] = (SHAHO_FUYOU_CODES.phone as Record<string, string>)[spouse.phoneKind] ?? SHAHO_FUYOU_CODES.phone["自宅"];
      [v[40], v[41], v[42]] = phone;
    }
    if (kind === "該当") {
      const from = eventDate(spouse.from);
      if (!from.era) add(`${who}が被扶養者になった日を入れてください`, 43, 44);
      v[43] = from.era; v[44] = from.ymd;
      v[45] = (SHAHO_FUYOU_CODES.spouseReason as Record<string, string>)[spouse.reason] ?? "";
      if (!v[45]) add(`${who}が被扶養者になった理由を選んでください`, 45);
      if (spouse.reason === "その他") {
        v[46] = toShahoKanji(spouse.reasonNote);
        if (!v[46]) add(`${who}が被扶養者になった理由（その他）を入れてください`, 46);
      }
      v[47] = (SHAHO_FUYOU_CODES.spouseJob as Record<string, string>)[spouse.job] ?? "";
      if (!v[47]) add(`${who}の職業を選んでください`, 47);
      if (spouse.income === null) add(`${who}の今後1年間の年間収入の見込みを入れてください`, 48);
      v[48] = amountText(spouse.income);
    }
    if (kind === "非該当") {
      const until = eventDate(spouse.until);
      if (!until.era) add(`${who}が被扶養者でなくなった日を入れてください`, 49, 50);
      v[49] = until.era; v[50] = until.ymd;
      v[51] = (SHAHO_FUYOU_CODES.spouseEndReason as Record<string, string>)[spouse.endReason] ?? "";
      if (!v[51]) add(`${who}が被扶養者でなくなった理由を選んでください`, 51);
      if (spouse.endReason === "その他") {
        v[52] = toShahoKanji(spouse.endReasonNote);
        if (!v[52]) add(`${who}が被扶養者でなくなった理由（その他）を入れてください`, 52);
      }
      if (spouse.endReason === "死亡") {
        const death = eventDate(spouse.deathDate);
        if (!death.era) add(`${who}の死亡した日を入れてください`, 53, 54);
        v[53] = death.era; v[54] = death.ymd;
      }
    }
    const remarks = [kind === "変更" ? changeRemarks(spouse) : "", !sango && kind !== "変更" ? "扶養届のみ" : "", spouse.remarks].filter(Boolean).join("　");
    v[55] = toShahoKanji(remarks);
    if (kind === "変更" && !v[55]) add(`${who}の変更の届けには、備考に変更した項目と変更前の内容を書きます`, 55);
    if (!sango && kind !== "変更") notes.push(`${who}は第3号被保険者にならない（20歳未満・60歳以上など）ので、備考に「扶養届のみ」と書きます`);
    else if (sango) notes.push(`${who}の届けは、国民年金第3号被保険者関係届を兼ねます`);
    v[56] = spouse.relationChecked ? "1" : "";
    if (kind === "該当" && spouse.overseas) {
      v[57] = SHAHO_FUYOU_CODES.overseas["該当"];
      const o = shahoDate(spouse.overseasFrom || spouse.from, SHAHO_FUYOU_OVERSEAS_ERA_CODES) ?? { era: "", ymd: "" };
      if (!o.era) add(`${who}が海外特例要件に該当した日を入れてください`, 58, 59);
      v[58] = o.era; v[59] = o.ymd;
      v[60] = (SHAHO_FUYOU_CODES.overseasReason as Record<string, string>)[spouse.overseasReason] ?? "";
      if (!v[60]) add(`${who}が海外特例要件に該当した理由を選んでください`, 60);
      if (spouse.overseasReason === "その他") v[61] = toShahoKanji(spouse.overseasReasonNote);
    }
  } else if (kind === "該当" && input.spouseIncome !== null) {
    // 被扶養者でない配偶者がいるとき、その年間収入（夫婦ともに収入があるときは、年間収入の多い方の被扶養者にする）
    v[68] = amountText(input.spouseIncome);
  }

  // その他の被扶養者1・2（項番70〜102・103〜135）
  others.slice(0, 2).forEach((d, n) => {
    const base = n === 0 ? 69 : 102;
    const who = `${d.relation}（${d.name || "氏名なし"}）`;
    const [kana, kanji] = nameValues(who, d.name, d.kana, F[base + 2].max, add, base + 1, notes);
    v[base + 1] = kana; v[base + 2] = kanji;
    const b = birthDate(d.birthday);
    if (!b.era) add(`${who}の生年月日を入れてください`, base + 3, base + 4);
    v[base + 3] = b.era; v[base + 4] = b.ymd;
    v[base + 5] = sexCode(d.gender);
    if (!v[base + 5]) add(`${who}の性別を選んでください`, base + 5);
    v[base + 6] = (SHAHO_FUYOU_CODES.otherRelation as Record<string, string>)[d.relation] ?? "";
    if (!v[base + 6]) add(`${who}の続柄を選んでください`, base + 6);
    if (d.relation === "その他" && kind !== "非該当") {
      v[base + 7] = toShahoKanji(d.relationNote);
      if (!v[base + 7]) add(`${who}の続柄（伯父・甥など）を入れてください`, base + 7);
    }
    if (input.familyMyNumber(d)) {
      v[base + 8] = MY_NUMBER_PLACEHOLDER;
      const person = familyKey(d.name, d.birthday);
      persons[base + 8] = person;
      personNames[person] = d.name;
    }
    if (kind === "該当") v[base + 9] = SHAHO_FUYOU_CODES.living[d.together ? "同居" : "別居"];
    const addr = addressValues(who, d.zip, d.address, F[base + 12], kind !== "変更", add, base + 10, notes);
    v[base + 10] = addr[0]; v[base + 11] = addr[1]; v[base + 12] = addr[2];
    if (kind === "該当" && d.overseas) {
      v[base + 13] = SHAHO_FUYOU_CODES.overseas["該当"];
      v[base + 14] = (SHAHO_FUYOU_CODES.overseasReason as Record<string, string>)[d.overseasReason] ?? "";
      if (!v[base + 14]) add(`${who}が海外特例要件に該当した理由を選んでください`, base + 14);
      if (d.overseasReason === "その他") v[base + 15] = toShahoKanji(d.overseasReasonNote);
    }
    if (kind === "該当") {
      const from = eventDate(d.from);
      if (!from.era) add(`${who}が被扶養者になった日を入れてください`, base + 20, base + 21);
      v[base + 20] = from.era; v[base + 21] = from.ymd;
      v[base + 22] = (SHAHO_FUYOU_CODES.otherJob as Record<string, string>)[d.job] ?? "";
      if (!v[base + 22]) add(`${who}の職業を選んでください（子は「小・中学生以下」「高・大学生」など）`, base + 22);
      if (d.income === null) add(`${who}の今後1年間の年間収入の見込みを入れてください（収入がなければ 0）`, base + 24);
      v[base + 24] = amountText(d.income);
      v[base + 25] = (SHAHO_FUYOU_CODES.otherReason as Record<string, string>)[d.reason] ?? "";
      if (!v[base + 25]) add(`${who}が被扶養者になった理由を選んでください`, base + 25);
      if (d.reason === "その他") {
        v[base + 26] = toShahoKanji(d.reasonNote);
        if (!v[base + 26]) add(`${who}が被扶養者になった理由（その他）を入れてください`, base + 26);
      }
    }
    if (kind === "非該当") {
      if (d.endReason === "75歳到達" || d.endReason === "障害認定") {
        v[base + 23] = prefectureCodeOf(d.address);
        if (!v[base + 23]) add(`${who}の住所（都道府県から）を入れてください（後期高齢者医療の住所地の都道府県を書きます）`, base + 23);
      }
      const until = eventDate(d.until);
      if (!until.era) add(`${who}が被扶養者でなくなった日を入れてください`, base + 27, base + 28);
      v[base + 27] = until.era; v[base + 28] = until.ymd;
      v[base + 29] = (SHAHO_FUYOU_CODES.otherEndReason as Record<string, string>)[d.endReason] ?? "";
      if (!v[base + 29]) add(`${who}が被扶養者でなくなった理由を選んでください`, base + 29);
      if (d.endReason === "その他") {
        v[base + 30] = toShahoKanji(d.endReasonNote);
        if (!v[base + 30]) add(`${who}が被扶養者でなくなった理由（その他）を入れてください`, base + 30);
      }
    }
    const remarks = [kind === "変更" ? changeRemarks(d) : "", d.remarks].filter(Boolean).join("　");
    v[base + 31] = toShahoKanji(remarks);
    if (kind === "変更" && !v[base + 31]) add(`${who}の変更の届けには、備考に変更した項目と変更前の内容を書きます`, base + 31);
    v[base + 32] = d.relationChecked ? "1" : "";
    if (kind === "該当" && d.certificate) v[136 + n] = "1";
  });
  if (kind === "該当" && spouse?.certificate) v[136] = "1";

  problems.push(...checkFields(F, v, skip));
  const people = [...(spouse ? [spouse] : []), ...others.slice(0, 2)];
  if (kind === "該当") {
    const late = people.filter((d) => d.from && dayjs(input.receivedOn || input.today).diff(dayjs(d.from), "day") >= 60);
    if (late.length > 0) notes.push(`被扶養者になった日が受付日より60日以上前の人（${late.map((d) => d.name).join("・")}）は、扶養の事実を確かめられる書類を添えます（出生・婚姻などで、マイナンバーを書いたときはいりません）`);
  }
  if (input.myNumber && people.every((d) => input.familyMyNumber(d)) && people.every((d) => d.relationChecked)) {
    notes.push("被保険者と被扶養者のマイナンバーを書き、事業主が続柄を確かめたので、続柄の確認書類（戸籍謄本・住民票）を省けます");
  }
  return rowOf(key, staff, "fuyou", kind, people, v, persons, personNames, problems, notes, input.today);
};

/**
 * 健康保険組合・国民健康保険組合の被保険者の配偶者の、国民年金第3号被保険者関係届（表4.11.1-1。63項目）の1行
 * （配偶者の健康保険の被扶養者の届けは、組合に出す）
 */
export const buildSangoRow = (input: FuyouInput, office: string[], key = ""): FuyouRow => {
  const { staff, kind } = input;
  const spouse = input.spouse!;
  const { problems, reported: skip, add } = problemList();
  const notes: string[] = [];
  const F = SHAHO_SANGO_FIELDS;
  const v: string[] = Array(F.length).fill("");
  const persons: Record<number, string> = {};
  const personNames: Record<string, string> = {};
  v[0] = SHAHO_SANGO_FORM_CODE;
  v[1] = office[0] ?? ""; v[2] = office[1] ?? ""; v[3] = office[2] ?? "";
  const received = eventDate(input.receivedOn);
  if (!received.era) add("事業主等受付年月日（被保険者から届けを受けた日）を入れてください", 4, 5);
  v[4] = received.era; v[5] = received.ymd;
  // 配偶者（第2号被保険者。従業員）
  const s = staffPart(staff, kind, input.myNumber, F[7], F[16], add, notes, { pension: null, kana: 6, birth: 8, my: 11, basic: 12, zip: 14 });
  v[6] = s.kana; v[7] = s.kanji; v[8] = s.birth.era; v[9] = s.birth.ymd;
  v[10] = sexCode(String(staff.gender ?? ""));
  if (!v[10]) add("被保険者の性別を従業員の画面に入れてください", 10);
  if (input.myNumber) { v[11] = MY_NUMBER_PLACEHOLDER; persons[11] = "self"; }
  v[12] = s.basic?.[0] ?? ""; v[13] = s.basic?.[1] ?? "";
  v[14] = s.address[0]; v[15] = s.address[1]; v[16] = s.address[2];
  // 第3号被保険者（配偶者）
  const who = `配偶者（${spouse.name || "氏名なし"}）`;
  v[17] = received.era; v[18] = received.ymd;
  const [kana, kanji] = nameValues(who, spouse.name, spouse.kana, F[20].max, add, 19, notes);
  v[19] = kana; v[20] = kanji;
  const b = birthDate(spouse.birthday);
  if (!b.era) add(`${who}の生年月日を入れてください`, 21, 22);
  v[21] = b.era; v[22] = b.ymd;
  v[23] = (SHAHO_SANGO_CODES.relation as Record<string, string>)[spouse.relation] ?? "";
  if (!v[23]) add(`${who}の続柄（夫・妻）を選んでください`, 23);
  if (input.familyMyNumber(spouse)) {
    v[24] = MY_NUMBER_PLACEHOLDER;
    const person = familyKey(spouse.name, spouse.birthday);
    persons[24] = person;
    personNames[person] = spouse.name;
  } else {
    const basic = splitBasicPensionNumber(spouse.basicPensionNumber);
    if (!basic) add(`${who}のマイナンバーを書かないときは、基礎年金番号（10けた）を入れてください`, 25, 26);
    v[25] = basic?.[0] ?? ""; v[26] = basic?.[1] ?? "";
  }
  if (kind === "該当") v[30] = SHAHO_SANGO_CODES.living[spouse.together ? "同居" : "別居"];
  const addr = addressValues(who, spouse.zip, spouse.address, F[33], true, add, 31, notes);
  v[31] = addr[0]; v[32] = addr[1]; v[33] = addr[2];
  const phone = splitPhone(spouse.phone);
  if (phone) {
    v[34] = (SHAHO_SANGO_CODES.phone as Record<string, string>)[spouse.phoneKind] ?? SHAHO_SANGO_CODES.phone["自宅"];
    [v[35], v[36], v[37]] = phone;
  }
  v[38] = SHAHO_SANGO_CODES.change[kind];
  if (kind === "該当") {
    const from = eventDate(spouse.from);
    if (!from.era) add(`${who}が第3号被保険者になった日（被扶養者になった日）を入れてください`, 39, 40);
    v[39] = from.era; v[40] = from.ymd;
    v[41] = (SHAHO_SANGO_CODES.reason as Record<string, string>)[spouse.reason] ?? "";
    if (!v[41]) add(`${who}が第3号被保険者になった理由を選んでください`, 41);
    if (spouse.reason === "その他") v[42] = toShahoKanji(spouse.reasonNote);
    v[43] = SHAHO_SANGO_CODES.system["厚生年金保険・健康保険"];
  }
  if (kind === "非該当") {
    const until = eventDate(spouse.until);
    if (!until.era) add(`${who}が第3号被保険者でなくなった日を入れてください`, 44, 45);
    v[44] = until.era; v[45] = until.ymd;
    // 健康保険の被扶養者でなくなった理由を、3号関係届の理由（死亡・離婚・収入増加・その他）に読み替える
    const reason = spouse.endReason === "死亡" || spouse.endReason === "離婚" ? spouse.endReason : spouse.endReason === "就職・収入増加" ? "収入増加" : "その他";
    v[46] = (SHAHO_SANGO_CODES.endReason as Record<string, string>)[reason];
    if (reason === "死亡") {
      const death = eventDate(spouse.deathDate);
      if (!death.era) add(`${who}の死亡した日を入れてください`, 47, 48);
      v[47] = death.era; v[48] = death.ymd;
    }
    if (reason === "その他") v[49] = toShahoKanji(spouse.endReason === "その他" ? spouse.endReasonNote : spouse.endReason);
  }
  const remarks = [kind === "変更" ? changeRemarks(spouse) : "", spouse.remarks].filter(Boolean).join("　");
  v[50] = toShahoKanji(remarks);
  if (kind === "変更" && !v[50]) add(`${who}の変更の届けには、備考に変更した項目と変更前の内容を書きます`, 50);
  if (kind === "該当" && spouse.overseas) {
    v[51] = "1";
    const o = shahoDate(spouse.overseasFrom || spouse.from, SHAHO_FUYOU_OVERSEAS_ERA_CODES) ?? { era: "", ymd: "" };
    v[52] = o.era; v[53] = o.ymd;
    v[54] = (SHAHO_FUYOU_CODES.overseasReason as Record<string, string>)[spouse.overseasReason] ?? "";
    if (spouse.overseasReason === "その他") v[55] = toShahoKanji(spouse.overseasReasonNote);
  }
  notes.push("健康保険組合などの被保険者の配偶者なので、年金事務所には国民年金第3号被保険者関係届だけを出します（健康保険の被扶養者の届けは、組合の様式で組合に出します）");
  problems.push(...checkFields(F, v, skip));
  return rowOf(key, staff, "sango", kind, [spouse], v, persons, personNames, problems, notes, input.today);
};

const rowOf = (
  key: string, staff: any, form: "fuyou" | "sango", kind: FuyouChangeKind, people: HealthDependent[], values: string[],
  persons: Record<number, string>, personNames: Record<string, string>, problems: string[], notes: string[], today: string,
): FuyouRow => {
  const event = people.map((d) => eventOf(d, kind, today)).filter(Boolean).sort()[0] ?? "";
  return {
    key: key || `${staff.id}:${form}:${kind}:${people.map((d) => d.id).join(",")}`, staffId: String(staff.id), name: String(staff.name ?? ""),
    form, kind, dependents: people, deadline: kind === "変更" ? "" : fuyouDeadline(event), values, persons, personNames,
    problems: [...new Set(problems)], notes,
    reported: Object.fromEntries(people.map((d) => [d.id, {
      kind, on: today, name: d.name, kana: d.kana, birthday: d.birthday, gender: d.gender, ...(d.spouse ? { sango: form === "sango" || isSango(d, d.from || today) } : {}),
    }])),
  };
};

/**
 * 届け出るものを、届書の行に分ける（協会けんぽの人は、異動の別ごとに、配偶者と、その他の被扶養者2人ずつ。
 * 健康保険組合・国民健康保険組合の人は、第3号被保険者の配偶者だけ3号関係届。そのほかの被扶養者は組合に出す）
 */
export const planFuyouRows = (
  dependents: HealthDependent[], insurerType: InsurerType, today: string,
): { kind: FuyouChangeKind; form: "fuyou" | "sango"; spouse: HealthDependent | null; others: HealthDependent[] }[] => {
  const plans: { kind: FuyouChangeKind; form: "fuyou" | "sango"; spouse: HealthDependent | null; others: HealthDependent[] }[] = [];
  for (const kind of ["該当", "非該当", "変更"] as FuyouChangeKind[]) {
    const list = dependents.filter((d) => suggestFuyouKind(d) === kind);
    if (list.length === 0) continue;
    const spouses = list.filter((d) => d.spouse);
    const others = list.filter((d) => !d.spouse);
    if (insurerType === "kyokai") {
      const first = spouses[0] ?? null;
      const chunks: HealthDependent[][] = [];
      for (let i = 0; i < others.length; i += 2) chunks.push(others.slice(i, i + 2));
      if (first || chunks.length > 0) plans.push({ kind, form: "fuyou", spouse: first, others: chunks[0] ?? [] });
      chunks.slice(1).forEach((c) => plans.push({ kind, form: "fuyou", spouse: null, others: c }));
      spouses.slice(1).forEach((sp) => plans.push({ kind, form: "fuyou", spouse: sp, others: [] }));
    } else {
      for (const sp of spouses) {
        const on = kind === "該当" ? sp.from : sp.reported?.on || today;
        if (sp.reported?.sango === true || isSango(sp, on || today)) plans.push({ kind, form: "sango", spouse: sp, others: [] });
      }
    }
  }
  return plans;
};
