/**
 * 健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届（日本年金機構）
 *
 * 決まり（日本年金機構「従業員に賞与を支給したときの手続き」・届書の記入方法・「【ケース5-1、5-2】賞与を支給したとき」）:
 * ・賞与を支払った日から5日以内に、事務センター（年金事務所）に出す。年3回以下の賞与が対象（年4回以上の賞与は標準報酬月額に入れる）
 * ・届けるのは、支払った日に被保険者だった人（資格取得月に、取得した日以後に払った賞与。資格喪失月でも、退職した日（喪失日の前日）
 *   までに払った賞与は届け出る（保険料はかからない））。産前産後休業・育児休業等で保険料が免除される期間に払った賞与も届け出る
 *   （標準賞与額は年度の累計に入る）。賞与を払わなかった人は入れない（電子申請では設定しない）
 * ・賞与支払額は、通貨で払った額と現物で払った額。賞与額（標準賞与額）は、その合計から1,000円未満を切り捨てた額
 *   （健康保険の年度累計573万円・厚生年金の1か月150万円の上限は、年金機構が決める。届書には切り捨てた合計を書く）
 * ・同じ月に2回以上払ったときは、その月に払った額を合わせて届け出る。賞与支払年月日はその月の最後に払った日、備考の
 *   「同一月内の賞与合算」に初めに払った日を書く（すでに届け出た月に追加で払ったときも、合わせて届け出る）
 * ・70歳以上の人（厚生年金の資格を失った「70歳以上被用者」）は、備考の「70歳以上被用者」に印を付け、個人番号か基礎年金番号を書く。
 *   75歳以上の人（健康保険の資格もない）は「70歳以上被用者届のみ提出」にし、被保険者整理番号は書かない
 * ・2つ以上の適用事業所で働いている人は、備考の「二以上勤務」に印を付ける
 * 電子申請用のファイルの項目（表4.9.1-1）：様式コード 2265700・事業所整理記号・被保険者整理番号・氏名（カナ・漢字）・
 *   生年月日（元号のコード＋和暦の年月日）・賞与支払年月日・通貨・現物・合計（1,000円未満切り捨て。1千万円以上は 9999999／9999000）・
 *   個人番号・基礎年金番号（上4けた・下6けた）・備考1〜3・70歳以上被用者届のみ提出
 * 現物で払った賞与は、賞与の支給項目に「現物で渡す」の印を付けた項目の額（確定した賞与の in_kind）。通貨は総支給からそれを除いた額。
 * 70歳以上被用者は基礎年金番号で届ける（個人番号でも届けられるが、まだ使わない）。
 * 出典：日本年金機構 https://www.nenkin.go.jp/shinsei/kounen/tekiyo/shoyo/20140821.html
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html
 *       厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」（src/constants/shahoTodoke.ts）
 */
import dayjs from "dayjs";
import { SHAHO_BONUS_FIELDS, SHAHO_BONUS_FORM_CODE, SHAHO_BONUS_UNION_FIELDS, SHAHO_PAY_ERA_CODES } from "../constants/shahoTodoke";
import { checkInsuredMonth, checkSocialInsEnrolled } from "./calcSalary";
import type { HealthInsurer, InsurerType } from "./healthInsurer";
import { unionRecordOf, type UnionRecord } from "./unionReport";
import { checkLeaveExemptBonus, exemptLeavePeriodsOf } from "./leaveExemption";
import { fieldProblem, shahoDate } from "./shahoCsv";
import { reach70Date, reach75Date, shahoPersonValues, type ShahoPersonPart } from "./shahoPerson";

/** 1回の賞与の、1人に払った額（確定した賞与） */
export interface BonusPayment {
  settingId: number;
  /** 賞与の名前（「冬季賞与」など） */
  name: string;
  /** 支給日（YYYY-MM-DD） */
  paymentDate: string;
  staffId: string;
  /** 総支給額（通貨と現物の合計） */
  totalEarnings: number;
  /** 総支給額のうち、現物で渡した額（現物で渡す支給項目。なければ 0） */
  inKind?: number;
}

/** 届書の1人分 */
export interface BonusReportRow {
  staffId: string;
  name: string;
  /** 被保険者整理番号（70歳以上被用者届のみのときは空） */
  pensionNumber: string;
  /** 被保険者氏名（カナ・漢字。漢字は書けないときは空） */
  kana: string;
  kanji: string;
  birthday: string;
  /** 賞与支払年月日（その月の最後に払った日）と、同じ月に2回以上払ったときの初めの日（「05」。1回なら空） */
  paymentDate: string;
  firstPaymentDay: string;
  /** 合わせた賞与の名前 */
  bonusNames: string[];
  /** 賞与支払額（通貨・現物）と賞与額（合計から1,000円未満を切り捨て） */
  currency: number;
  inKind: number;
  total: number;
  /** 70歳以上被用者・70歳以上被用者届のみ（75歳以上）・二以上勤務 */
  over70: boolean;
  over70Only: boolean;
  multiOffice: boolean;
  /** 電子申請用ファイルの21項目 */
  values: string[];
  /** 健康保険組合に出す行（健康保険組合の75歳未満の人だけ。utils/unionReport.ts） */
  union: UnionRecord | null;
  /** 直すところ（あれば電子申請用ファイルを作らない） */
  problems: string[];
  /** 知らせ（保険料はかからないが届け出る、など） */
  notes: string[];
}

/** 届けない人（賞与を払ったが、被保険者でなかった人など） */
export interface BonusReportSkipped {
  staffId: string;
  name: string;
  reason: string;
}

/** 1千万円以上の額の書き方（表4.9.1-1） */
const AMOUNT_OVER = 9999999;
const TOTAL_OVER_SINGLE = 9999000;
const TEN_MILLION = 10000000;

/** 被保険者の項目（utils/shahoPerson.ts）の、この届書の項目の番号（0から） */
const PERSON_FIELDS: Record<ShahoPersonPart, number[]> = { pensionNumber: [4], kana: [5], birth: [7, 8], basic: [15, 16] };

/** 支払った日に被保険者だったか（入社した日以後、退職した日（資格喪失日の前日）まで） */
const insuredOn = (staff: any, date: string): boolean =>
  (!staff.join_date || date >= staff.join_date) && (!staff.retirement_date || date <= staff.retirement_date);

/**
 * 届書を作る
 * @param staffList 従業員（社会保険の加入・生年月日・整理番号など）
 * @param payments その月（賞与を払った月）に払った、確定した賞与（1人1回ずつ）
 * @param office 事業所情報の12項目（utils/shahoCsv.ts の shahoOfficeValues。頭の3つが都道府県コード・郡市区符号・事業所記号）
 * @param insurerTypeOf 従業員の健康保険の保険者（健康保険組合・国民健康保険組合の70歳以上の人は、70歳以上被用者賞与支払届だけを出す）
 */
export const buildBonusReport = (
  staffList: any[],
  payments: BonusPayment[],
  office: string[],
  insurerTypeOf: (staff: any) => InsurerType = () => "kyokai",
  insurerOf: (staff: any) => HealthInsurer | null = () => null,
): { rows: BonusReportRow[]; skipped: BonusReportSkipped[] } => {
  const rows: BonusReportRow[] = [];
  const skipped: BonusReportSkipped[] = [];
  const byStaff = new Map<string, BonusPayment[]>();
  for (const p of payments) {
    if (!(p.totalEarnings > 0)) continue;
    const list = byStaff.get(p.staffId) ?? [];
    list.push(p);
    byStaff.set(p.staffId, list);
  }
  for (const [staffId, list] of byStaff) {
    const staff = staffList.find((s) => String(s.id) === staffId);
    const name = staff?.name ?? staffId;
    if (!staff) {
      skipped.push({ staffId, name, reason: "従業員が見つかりません" });
      continue;
    }
    const sorted = [...list].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.settingId - b.settingId);
    const last = sorted[sorted.length - 1].paymentDate;
    const [y, m] = last.split("-").map(Number);
    if (!checkSocialInsEnrolled(staff, y, m)) {
      skipped.push({ staffId, name, reason: "社会保険に入っていない（標準報酬月額がない・社保規定が未加入）ので、届け出ません" });
      continue;
    }
    // 被保険者だった日に払った賞与だけを届け出る（入社する前・退職した後に払った賞与は入れない）
    const insured = sorted.filter((p) => insuredOn(staff, p.paymentDate));
    if (insured.length === 0) {
      skipped.push({
        staffId, name,
        reason: staff.join_date && last < staff.join_date
          ? `入社した日（${staff.join_date}）より前に払った賞与なので、届け出ません`
          : `退職した日（${staff.retirement_date}）より後に払った賞与なので、届け出ません（資格を失ったあと）`,
      });
      continue;
    }
    const notes: string[] = [];
    const problems: string[] = [];
    /** すでに直すところを書いた項目（項目の決まりで、同じことを2回知らせない） */
    const reported = new Set<number>();
    const problem = (message: string, ...fields: number[]) => {
      problems.push(message);
      for (const i of fields) reported.add(i);
    };
    const first = insured[0];
    const lastPaid = insured[insured.length - 1];
    if (insured.length < sorted.length) {
      notes.push(`被保険者でなかった日に払った賞与（${sorted.filter((p) => !insured.includes(p)).map((p) => `${p.name} ${p.paymentDate}`).join("・")}）は入れていません`);
    }
    // 賞与支払額：現物で渡した額（現物で渡す支給項目）と、それを除いた通貨の額
    const inKind = insured.reduce((s, p) => s + Math.min(p.totalEarnings, Math.max(0, Number(p.inKind) || 0)), 0);
    const currency = insured.reduce((s, p) => s + p.totalEarnings, 0) - inKind;
    const firstPaymentDay = insured.length >= 2 && first.paymentDate !== lastPaid.paymentDate ? first.paymentDate.slice(8, 10) : "";
    if (insured.length >= 2) {
      notes.push(
        `同じ月に払った賞与（${insured.map((p) => `${p.name} ${Number(p.paymentDate.slice(5, 7))}月${Number(p.paymentDate.slice(8, 10))}日`).join("・")}）を合わせて届け出ます`
        + (firstPaymentDay ? `（備考の「同一月内の賞与合算」に、初めに払った ${Number(firstPaymentDay)}日を書きます）` : ""),
      );
    }
    // 年齢（支払った日で数える）：70歳に達した日から厚生年金の資格がなく（70歳以上被用者）、75歳の誕生日から健康保険の資格もない
    const birthday = String(staff.birthday ?? "");
    const over70 = !!birthday && lastPaid.paymentDate >= reach70Date(birthday);
    const over75 = over70 && lastPaid.paymentDate >= reach75Date(birthday);
    // 75歳以上と、健康保険組合・国民健康保険組合の70歳以上の人は、年金事務所には70歳以上被用者の分だけを出す
    const over70Only = over70 && (over75 || insurerTypeOf(staff) !== "kyokai");
    const multiOffice = Number(staff.multi_office) === 1;
    // 保険料はかからないが届け出る賞与
    if (!checkInsuredMonth(staff.join_date, staff.retirement_date, y, m)) {
      notes.push("資格を失う月（退職した月）に払った賞与なので、保険料はかかりませんが、届け出ます");
    }
    if (checkLeaveExemptBonus(exemptLeavePeriodsOf(staff), lastPaid.paymentDate)) {
      notes.push("産前産後休業・育児休業等で保険料が免除される期間の賞与ですが、届け出ます（標準賞与額は年度の累計に入ります）");
    }
    if (over75) notes.push("75歳以上（健康保険の資格もない）なので、「70歳以上被用者賞与支払届」だけを出します（被保険者整理番号は書きません）");
    else if (over70Only) notes.push("健康保険組合・国民健康保険組合の70歳以上の人なので、年金事務所には「70歳以上被用者賞与支払届」だけを出します（被保険者整理番号は書きません）");
    else if (over70) notes.push("70歳以上被用者なので、備考の「70歳以上被用者」に印を付け、基礎年金番号を書きます");

    const person = shahoPersonValues(staff, { kanjiField: SHAHO_BONUS_FIELDS[6], withoutPensionNumber: over70Only, needBasic: over70 });
    const { pensionNumber, kana, kanji, birth, basic } = person;
    person.problems.forEach((p) => problem(p.message, ...PERSON_FIELDS[p.part]));
    notes.push(...person.notes);
    const pay = shahoDate(lastPaid.paymentDate, SHAHO_PAY_ERA_CODES);
    if (!pay) problem(`支給日（${lastPaid.paymentDate}）を和暦にできません`, 9, 10);
    // 1千万円以上は 9999999（合計は、通貨か現物のどちらかだけなら 9999000、両方で1千万円以上なら 9999999）
    const total = Math.floor((currency + inKind) / 1000) * 1000;
    const currencyText = currency >= TEN_MILLION ? String(AMOUNT_OVER) : String(currency);
    const inKindText = inKind >= TEN_MILLION ? String(AMOUNT_OVER) : String(inKind);
    const totalText = currency + inKind >= TEN_MILLION ? String(currency > 0 && inKind > 0 ? AMOUNT_OVER : TOTAL_OVER_SINGLE) : String(total);
    if (currency + inKind >= TEN_MILLION) notes.push("賞与が1千万円以上なので、仕様書の決まりで、額を 9999999（合計は 9999000）と書きます");

    const values = [
      SHAHO_BONUS_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "",
      pensionNumber, kana, kanji,
      birth?.era ?? "", birth?.ymd ?? "", pay?.era ?? "", pay?.ymd ?? "",
      currencyText, inKindText, totalText,
      "", basic?.[0] ?? "", basic?.[1] ?? "",
      over70 ? "1" : "", multiOffice ? "1" : "", firstPaymentDay, over70Only ? "1" : "",
    ];
    SHAHO_BONUS_FIELDS.forEach((f, i) => {
      if ((i >= 1 && i <= 3) || reported.has(i)) return; // 事業所整理記号は、事業所の情報で確かめる
      const p = fieldProblem(f, values[i]);
      if (p) problems.push(p);
    });
    // 健康保険組合の人（75歳未満）は、組合にも出す（年金事務所に70歳以上被用者届のみを出す人も、組合には健康保険の賞与を届ける）
    const insurer = insurerOf(staff);
    const union = insurer?.type === "union" && !over75
      ? unionRecordOf(insurer, staff, values, SHAHO_BONUS_UNION_FIELDS, { 4: String(staff.pension_num ?? "").normalize("NFKC").trim() }, true)
      : null;
    rows.push({
      staffId, name, pensionNumber, kana, kanji, birthday, paymentDate: lastPaid.paymentDate, firstPaymentDay,
      bonusNames: insured.map((p) => p.name), currency, inKind, total, over70, over70Only, multiOffice,
      values, union, problems: [...new Set(problems)], notes,
    });
  }
  // 届書は被保険者整理番号の順にそろえる（70歳以上被用者届のみの人は後ろ）
  rows.sort((a, b) => (Number(a.pensionNumber) || Infinity) - (Number(b.pensionNumber) || Infinity) || a.staffId.localeCompare(b.staffId));
  return { rows, skipped };
};

/**
 * 選んだ賞与の届書に入れる支払い：その賞与を払った人の、同じ月にその賞与の支給日までに払った賞与（前に払った分と合わせて届け出る）
 * その月にあとで払う賞与は、払ったときにまた届け出る（すでに届け出た月に追加で払ったときは、合わせて届け出る）
 */
export const paymentsForBonus = (payments: BonusPayment[], settingId: number, paymentDate: string): BonusPayment[] => {
  const month = paymentDate.slice(0, 7);
  const upTo = payments.filter((p) => p.paymentDate.slice(0, 7) === month && p.paymentDate <= paymentDate);
  const paid = new Set(upTo.filter((p) => p.settingId === settingId && p.totalEarnings > 0).map((p) => p.staffId));
  return upTo.filter((p) => paid.has(p.staffId));
};

/** 支払日から5日以内の提出期限 */
export const bonusReportDeadline = (lastPaymentDate: string): string => dayjs(lastPaymentDate).add(5, "day").format("YYYY-MM-DD");
