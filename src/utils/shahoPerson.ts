/**
 * 社会保険の届書（賞与支払届・算定基礎届・月額変更届）に書く、被保険者の項目（届書で同じ書き方のもの）
 * ・被保険者整理番号（70歳以上被用者届のみのときは書かない）
 * ・被保険者氏名（カナは半角カナで姓と名の間に半角スペース。漢字は書けない字がある・12文字を超える・姓と名の間に
 *   スペースがないときは書かない（カナの氏名で届く））
 * ・生年月日（元号のコードと、年・月・日を2文字ずつ）
 * ・基礎年金番号（70歳以上被用者のとき。上4けたの課所符号と下6けたの一連番号。個人番号でも届けられるが、Q ではまだ使わない）
 * 年齢：70歳に達した日（誕生日の前日）から厚生年金の資格がなく（70歳以上被用者）、75歳の誕生日から健康保険の資格もない
 * 出典：厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」（src/constants/shahoTodoke.ts の各データレコードの項目説明）
 */
import { SHAHO_BIRTH_ERA_CODES, type ShahoField } from "../constants/shahoTodoke";
import { birthdayAt } from "./calcSalary";
import { hasNameSpace, shahoDate, toShahoKana, toShahoKanji, unusableChars } from "./shahoCsv";

/** 70歳に達する日（誕生日の前日。年齢計算ニ関スル法律）。この日から厚生年金の資格がない（70歳以上被用者） */
export const reach70Date = (birthday: string): string => birthdayAt(birthday, 70).subtract(1, "day").format("YYYY-MM-DD");
/** 75歳の誕生日。この日から健康保険の資格がない（後期高齢者医療） */
export const reach75Date = (birthday: string): string => birthdayAt(birthday, 75).format("YYYY-MM-DD");

/** 基礎年金番号（10けた）を、上4けた（課所符号）と下6けた（一連番号）に分ける。10けたでなければ null */
export const splitBasicPensionNumber = (value: string | null | undefined): [string, string] | null => {
  const digits = String(value ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
  return digits.length === 10 ? [digits.slice(0, 4), digits.slice(4)] : null;
};

/** 直すところが、どの項目のことか（届書ごとの項目の番号に読み替えて、項目の決まりで同じことを2回知らせないようにする） */
export type ShahoPersonPart = "pensionNumber" | "kana" | "birth" | "basic";

export interface ShahoPersonValues {
  /** 被保険者整理番号（書かないときは空） */
  pensionNumber: string;
  /** 被保険者氏名（カナ・漢字。漢字は書かないときは空） */
  kana: string;
  kanji: string;
  /** 生年月日（元号のコードと YYMMDD）。わからなければ null */
  birth: { era: string; ymd: string } | null;
  /** 基礎年金番号（課所符号・一連番号）。書かないとき・わからないときは null */
  basic: [string, string] | null;
  problems: { message: string; part: ShahoPersonPart }[];
  notes: string[];
}

/**
 * 被保険者の項目を作る
 * @param staff 従業員（pension_num・furigana・name・birthday・basic_pension_number）
 * @param options.kanjiField 届書の「被保険者氏名(漢字)」の項目の決まり（文字数の上限に使う）
 * @param options.withoutPensionNumber 被保険者整理番号を書かない（70歳以上被用者届のみ）
 * @param options.needBasic 基礎年金番号を書く（70歳以上被用者）
 */
export const shahoPersonValues = (
  staff: any,
  options: { kanjiField: ShahoField; withoutPensionNumber: boolean; needBasic: boolean },
): ShahoPersonValues => {
  const problems: ShahoPersonValues["problems"] = [];
  const notes: string[] = [];
  const pensionNumber = options.withoutPensionNumber ? "" : String(staff.pension_num ?? "").normalize("NFKC").trim();
  if (!options.withoutPensionNumber && !pensionNumber) {
    problems.push({ message: "被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」に、資格取得のときに知らされた番号を入れてください）", part: "pensionNumber" });
  }
  const kana = toShahoKana(staff.furigana);
  if (!kana) problems.push({ message: "フリガナがありません（従業員の画面）", part: "kana" });
  else if (!hasNameSpace(kana, " ")) problems.push({ message: "フリガナの姓と名の間に、スペースを入れてください（従業員の画面）", part: "kana" });
  // 漢字の氏名は省略できる。書けない字がある・12文字を超える・姓と名の間にスペースがないときは書かない（カナの氏名で届く）
  let kanji = toShahoKanji(staff.name);
  const max = options.kanjiField.max;
  if (kanji && (unusableChars(kanji).length > 0 || [...kanji].length > max || !hasNameSpace(kanji, "　"))) {
    notes.push(
      unusableChars(kanji).length > 0 ? `漢字の氏名に届書に書けない字（${unusableChars(kanji).join("")}）があるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : [...kanji].length > max ? `漢字の氏名が${max}文字を超えるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : "漢字の氏名の姓と名の間にスペースがないので、漢字の氏名は書きません（カナの氏名で届きます。従業員の画面でスペースを入れると書きます）",
    );
    kanji = "";
  }
  const birth = shahoDate(String(staff.birthday ?? ""), SHAHO_BIRTH_ERA_CODES);
  if (!birth) problems.push({ message: "生年月日がありません（従業員の画面）", part: "birth" });
  const basic = options.needBasic ? splitBasicPensionNumber(staff.basic_pension_number) : null;
  if (options.needBasic && !basic) {
    problems.push({ message: "70歳以上被用者なので、基礎年金番号（10けた）を従業員の画面に入れてください", part: "basic" });
  }
  return { pensionNumber, kana, kanji, birth, basic, problems, notes };
};
