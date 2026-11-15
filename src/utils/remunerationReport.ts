/**
 * 算定基礎届・月額変更届の電子申請用ファイル（SHFD0006.CSV）のデータレコードと、画面・印刷に出す内容
 * ・算定基礎届：健康保険・厚生年金保険 被保険者報酬月額算定基礎届／厚生年金保険 70歳以上被用者算定基礎届（様式コード・項目は表4.7.1-1）
 * ・月額変更届：健康保険・厚生年金保険 被保険者報酬月額変更届／厚生年金保険 70歳以上被用者月額変更届（表4.8.1-1）
 * 標準報酬月額の決め方は utils/santei.ts・utils/zuiji.ts（画面の結果からこの届書を作る）
 *
 * 決まり（厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」の項目説明、日本年金機構「算定基礎届の記入・提出ガイドブック
 * （令和8年度）」・算定基礎届と月額変更届の記入例・「年間報酬の平均で算定するとき」の詳細説明）:
 * ・総計：算定基礎届は、支払基礎日数が17日以上の月（パートで17日以上の月がなければ15日以上の月、短時間労働者は11日以上の月）の
 *   合計（通貨＋現物）の合計。平均額はその月数で割った額（1円未満切り捨て。使える月がなければ 0）。
 *   月額変更届は、3か月の合計の合計と、その3分の1（1円未満切り捨て）
 * ・修正平均額：途中入社で1か月分の給与が支払われていない月を除いた平均（ガイドブックのケース⑤。その月も、日数が足りれば総計には入れる）、
 *   遡って支払った昇給の差額（遡及支払額）を除いた平均（ケース⑩・月額変更届の記入例）、年間報酬の平均で申し立てるときは年間平均額
 *   （算定基礎届は備考の「年間平均」、月額変更届は備考欄に「年間平均」）。平均額と同じなら書かない
 * ・額は1千万円以上なら 9999999。報酬の月額の「現物によるもの」には、確定した給与の現物で払った報酬（食事・住宅・定期券など。
 *   utils/genbutsu.ts）を書き、「通貨によるもの」はそれを除いた額（画面で報酬を直したときも、現物の額は確定した給与のまま）
 * ・従前の標準報酬月額は千円で4文字（健保・厚年）。厚年は厚生年金の等級表の上限・下限の中にした額。
 *   健康保険組合・国民健康保険組合の人は健保を書かない（年金事務所の届書は厚生年金の分。健康保険組合には組合の形で別に届け出る）。
 *   70歳以上被用者（厚生年金の資格がない）は厚年を、75歳以上（健康保険の資格もない）は健保も書かない
 * ・70歳以上被用者：備考欄項目1に「1」を付け、基礎年金番号を書く（個人番号でもよいが、Q ではまだ使わない）。
 *   算定基礎届は、70歳到達年の6月に70歳以上被用者になった人には付けない。算定の期間の途中で70歳になった人は、70歳に達した日以後の
 *   期間の1か月分の給与を払った月を「70歳算定基礎月」に書き、備考欄に給与の締め日と支払日を書く（ガイドブックのケース⑥）。
 *   月額変更届は、改定年月の前3か月の間に70歳以上被用者になった人には付けない
 * ・70歳以上被用者届のみ提出：75歳以上の人と、健康保険組合・国民健康保険組合の70歳以上の人（年金事務所に出すのは70歳以上被用者の分だけ）。
 *   被保険者整理番号は書かない
 * ・8月・9月に月変の予定がある人と7月改定の月変の人は、電子申請では算定基礎届に入れない（画面の対象外・チェックを外した人）ので、
 *   算定基礎届の備考の「月額変更予定」は使わない
 */
import {
  SHAHO_GEPPEN_FIELDS, SHAHO_GEPPEN_FORM_CODE, SHAHO_GEPPEN_UNION_FIELDS, SHAHO_MONTH_ERA_CODES, SHAHO_SANTEI_APPLY_MONTH, SHAHO_SANTEI_FIELDS,
  SHAHO_SANTEI_FORM_CODE, SHAHO_SANTEI_PAY_MONTHS, SHAHO_SANTEI_UNION_FIELDS, type ShahoField,
} from "../constants/shahoTodoke";
import type { HealthInsurer, InsurerType } from "./healthInsurer";
import { unionRecordOf, type UnionRecord } from "./unionReport";
import { parseLeavePeriods, type LeaveType } from "./leaveExemption";
import type { SanteiMonth, SanteiWorkerKind } from "./santei";
import { fieldProblem, shahoDate, toShahoKanji } from "./shahoCsv";
import { reach70Date, reach75Date, shahoPersonValues, type ShahoPersonPart } from "./shahoPerson";
import { formatWareki, toWareki } from "./wareki";
import { addMonths, type ZuijiDirection } from "./zuiji";

const TEN_MILLION = 10000000;
const OVER = "9999999";

/** 額（1千万円以上は 9999999） */
const amountText = (n: number): string => (n >= TEN_MILLION ? OVER : String(Math.max(0, Math.floor(n))));
/** 月を2文字（4 → 04） */
const mm = (month: number): string => String(month).padStart(2, "0");
const ymOf = (year: number, month: number): string => `${year}-${mm(month)}`;

/** 標準報酬月額を千円で4文字にする（300,000円 → 0300） */
export const thousandsText = (amount: number): string => String(Math.round(amount / 1000)).padStart(4, "0");

/** 年月（YYYY-MM）を、元号のコード・年・月（2文字ずつ）にする。元号のコードがなければ null */
export const shahoMonth = (ym: string | null | undefined): { era: string; year: string; month: string } | null => {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const d = shahoDate(`${ym}-01`, SHAHO_MONTH_ERA_CODES);
  return d ? { era: d.era, year: d.ymd.slice(0, 2), month: d.ymd.slice(2, 4) } : null;
};

/** 「令和8年9月」のような年月（届書の画面・印刷に出す） */
export const warekiMonth = (ym: string | null | undefined): string => {
  const w = ym ? toWareki(`${ym}-01`) : null;
  return w ? `${w.era}${w.year === 1 ? "元" : w.year}年${w.month}月` : "";
};

/** 厚生年金の標準報酬月額（厚生年金の等級表の上限・下限の中にした額） */
export const pensionStandardOf = (standard: number, range: { min: number; max: number }): number =>
  Math.max(range.min, Math.min(standard, range.max));

/** 給与規定グループの締日・支払日を、届書の備考に書く文にする（「末日締め翌月25日払い」） */
export const payRuleText = (group: { closing_day?: unknown; is_next_month?: unknown; payment_day?: unknown } | null | undefined): string => {
  if (!group) return "";
  const closing = Number(group.closing_day);
  const pay = Number(group.payment_day);
  const close = closing === 99 || closing === 0 ? "末日" : `${closing}日`;
  const payDay = pay >= 31 ? "末日" : `${pay}日`;
  return `${close}締め${Number(group.is_next_month) === 1 ? "翌月" : "当月"}${payDay}払い`;
};

/** 届書の備考欄に書く休業・休職の名前 */
const LEAVE_REMARK_NAMES: Record<LeaveType, string> = {
  maternity: "産前産後休業",
  childcare: "育児休業",
  family_care: "介護休業",
  injury: "労災の休業",
  other: "休職",
};

/** 「8年4月」（備考欄に書く短い年月。仕様書の例「29年4月~育児休業」と同じ形） */
const shortMonth = (date: string): string => {
  const w = toWareki(date);
  return w ? `${w.year}年${w.month}月` : date;
};

/** 期間（from〜to）に重なる休業・休職を、備考欄に書く文にする（なければ空） */
export const leaveRemark = (staff: any, from: string, to: string): string =>
  parseLeavePeriods(staff?.leave_periods)
    .filter((l) => l.start <= to && (!l.end || l.end >= from))
    .map((l) => `${shortMonth(l.start)}〜${l.end && l.end <= to ? shortMonth(l.end) : ""}${LEAVE_REMARK_NAMES[l.type]}`)
    .join("　");

/** 1か月分の報酬（届書の1行） */
export interface ReportMonth {
  year: number;
  month: number;
  /** 支払基礎日数（給与を払っていない月は 0） */
  days: number;
  /** 通貨・現物・合計 */
  currency: number;
  inKind: number;
  total: number;
  /** 総計・平均額に入れる月 */
  counted: boolean;
}

/** 届書の1人分（画面・印刷に出す内容と、電子申請用ファイルの項目） */
interface ReportRowBase {
  staffId: string;
  name: string;
  pensionNumber: string;
  kana: string;
  kanji: string;
  birthday: string;
  /** 従前の標準報酬月額（健保・厚年。書かないときは null）と、その額を使いはじめた年月（YYYY-MM） */
  previousHealth: number | null;
  previousPension: number | null;
  previousFrom: string | null;
  /** 昇(降)給（その月に払った給与で固定的賃金が変わった） */
  wageChange: { month: number; direction: ZuijiDirection } | null;
  /** 遡って支払った差額（遡及支払額） */
  retro: { month: number; amount: number } | null;
  months: ReportMonth[];
  sum: number;
  average: number;
  modifiedAverage: number | null;
  /** 70歳以上被用者（備考欄項目1）・70歳以上被用者届のみ・二以上勤務 */
  over70: boolean;
  over70Only: boolean;
  multiOffice: boolean;
  /** 基礎年金番号（課所符号-一連番号。書かないときは空） */
  basicPensionNumber: string;
  /** 備考欄（自動で作った文と、届書に書く文） */
  autoRemarks: string;
  remarks: string;
  /** 電子申請用ファイルの項目 */
  values: string[];
  /** 健康保険組合に出す行（健康保険組合の75歳未満の人だけ。utils/unionReport.ts） */
  union: UnionRecord | null;
  /** 直すところ（あれば電子申請用ファイルを作らない） */
  problems: string[];
  /** 知らせ */
  notes: string[];
}

/** 項目の決まりで確かめる（事業所整理記号は事業所の情報で、ほかで知らせた項目は除く） */
const checkFields = (fields: ShahoField[], values: string[], skip: Set<number>): string[] => {
  const problems: string[] = [];
  fields.forEach((f, i) => {
    if ((i >= 1 && i <= 3) || skip.has(i)) return;
    const p = fieldProblem(f, values[i] ?? "");
    if (p) problems.push(p);
  });
  if (values.length !== fields.length) problems.push(`届書の項目の数が合いません（${values.length}／${fields.length}）`);
  return problems;
};

/** 年齢による届け方（日付 on の時点。70歳以上被用者・75歳以上・70歳に達した日） */
const ageOn = (birthday: string, on: string) => {
  const reach70 = birthday ? reach70Date(birthday) : null;
  const reach75 = birthday ? reach75Date(birthday) : null;
  return { reach70, over70: !!reach70 && reach70 <= on, over75: !!reach75 && reach75 <= on };
};

/** 従前の標準報酬月額の健保・厚年 */
const previousStandards = (
  previous: number, insurerType: InsurerType, over70: boolean, over75: boolean, pensionRange: { min: number; max: number },
) => ({
  health: insurerType === "kyokai" && !over75 && previous > 0 ? previous : null,
  pension: !over70 && previous > 0 ? pensionStandardOf(previous, pensionRange) : null,
});

/** 報酬（現物を含む）を、通貨によるもの・現物によるもの・合計に分ける（現物は報酬を超えない） */
const splitAmount = (amount: number | null, inKindAmount: number | undefined) => {
  const total = Math.max(0, Math.floor(amount ?? 0));
  const inKind = Math.min(total, Math.max(0, Math.floor(inKindAmount ?? 0)));
  return { currency: total - inKind, inKind, total };
};

/** 被保険者の項目の、届書の項目の番号（算定基礎届と月額変更届で同じ） */
const PERSON_FIELDS: Record<ShahoPersonPart, number[]> = { pensionNumber: [4], kana: [5], birth: [7, 8], basic: [40, 41] };

// ── 算定基礎届 ─────────────────────────────────────────────

export interface SanteiReportInput {
  staff: any;
  /** 定時決定の年（その年の9月分から） */
  year: number;
  /** 従前の標準報酬月額（8月分）と、その額を使いはじめた年月（YYYY-MM。わからなければ null） */
  previous: number;
  previousFrom: string | null;
  /** 4・5・6月に支払った給与（画面の値。報酬は遡及支払額を含む支払った額） */
  months: SanteiMonth[];
  kind: SanteiWorkerKind;
  /** 画面で決めた平均（途中入社の月・遡及支払額を除いた平均。使える月がなければ null） */
  ordinaryAverage: number | null;
  /** 年間報酬の平均で申し立てるときの年間平均（申し立てないときは null） */
  annualAverage: number | null;
  /** 給与を確定していない月 */
  unfinalizedMonths: number[];
  wageChange: { month: number; direction: ZuijiDirection } | null;
  retro: { month: number; amount: number } | null;
  /** 4・5・6月に支払った給与の計算期間（70歳算定基礎月に使う） */
  periods: Record<number, { startStr: string; endStr: string }>;
  /** 給与の締め日・支払日（payRuleText） */
  payRule: string;
  insurerType: InsurerType;
  /** 健康保険の保険者（健康保険組合の人は、組合に出す行も作る） */
  insurer?: HealthInsurer | null;
  /** 厚生年金の標準報酬月額の下限・上限（従前の8月分） */
  pensionRange: { min: number; max: number };
  /** 備考欄（画面で直した文。直していなければ null） */
  remarks: string | null;
}

export interface SanteiReportRow extends ReportRowBase {
  /** 適用年月（その年の9月。YYYY-MM） */
  applyFrom: string;
  kind: SanteiWorkerKind;
  /** 70歳算定基礎月（書かないときは空） */
  over70Months: number[];
  partialJoin: boolean;
  leave: boolean;
  annual: boolean;
}

/** 総計・平均額に入れる月（17日以上。パートで17日以上の月がなければ15日以上。短時間労働者は11日以上） */
export const countedMonths = (days: number[], kind: SanteiWorkerKind): boolean[] => {
  const counted = days.map((d) => d >= (kind === "short" ? 11 : 17));
  if (kind === "part" && !counted.some(Boolean)) return days.map((d) => d >= 15);
  return counted;
};

/** 算定基礎届の1人分を作る */
export const buildSanteiReportRow = (input: SanteiReportInput, office: string[]): SanteiReportRow => {
  const { staff, year } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const reported = new Set<number>();
  const problem = (message: string, ...fields: number[]) => {
    problems.push(message);
    for (const i of fields) reported.add(i);
  };
  const birthday = String(staff.birthday ?? "");
  // 年齢は、算定基礎届を出す7月1日で見る
  const julyFirst = `${year}-07-01`;
  const age = ageOn(birthday, julyFirst);
  // 70歳到達年の6月（または7月1日）に70歳以上被用者になった人は、備考欄項目1を付けない
  const reachedInJune = age.over70 && age.reach70! >= `${year}-06-01`;
  const flag70 = age.over70 && !reachedInJune;
  const over70Only = age.over70 && (age.over75 || input.insurerType !== "kyokai");
  if (over70Only && !flag70) {
    problem("6月か7月1日に70歳になった人なので、70歳以上被用者算定基礎届は出せません（年金事務所に確かめてください）", 42, 52);
  }
  const person = shahoPersonValues(staff, { kanjiField: SHAHO_SANTEI_FIELDS[6], withoutPensionNumber: over70Only, needBasic: flag70 || over70Only });
  person.problems.forEach((p) => problem(p.message, ...PERSON_FIELDS[p.part]));
  notes.push(...person.notes);

  if (age.over75) notes.push("75歳以上（健康保険の資格もない）なので、「70歳以上被用者算定基礎届」だけを出します（被保険者整理番号と、健保の従前の標準報酬月額は書きません）");
  else if (over70Only) notes.push("健康保険組合・国民健康保険組合の70歳以上の人なので、年金事務所には「70歳以上被用者算定基礎届」だけを出します（被保険者整理番号は書きません）");
  else if (flag70) notes.push("70歳以上被用者なので、備考の「70歳以上被用者算定」に印を付け、基礎年金番号を書きます（厚年の従前の標準報酬月額は書きません）");
  if (reachedInJune && !over70Only) notes.push("6月に70歳以上被用者になった人なので、備考の「70歳以上被用者算定」には印を付けません（仕様書の決まり）");
  if (!over70Only && input.insurerType !== "kyokai") {
    notes.push("健康保険組合・国民健康保険組合の人なので、健保の従前の標準報酬月額は書きません（健康保険組合には、組合の決まった形で別に届け出ます）");
  }

  const prev = previousStandards(input.previous, input.insurerType, age.over70, age.over75, input.pensionRange);
  if (input.previous <= 0) problem("従前の標準報酬月額（8月分）がありません（従業員の画面の標準報酬月額）", 12, 13);
  const previousMonth = shahoMonth(input.previousFrom);
  if (!previousMonth) problem("従前の改定月（いまの標準報酬月額をいつから使っているか）がわかりません（従業員の画面の入社日・標準報酬月額の履歴）", 14, 15, 16);
  const apply = shahoMonth(`${year}-09`);
  if (!apply) problem(`${year}年9月を和暦にできません`, 9, 10);
  if (input.unfinalizedMonths.length > 0) problems.push(`${input.unfinalizedMonths.join("・")}月の給与が確定していません（確定してから作ります）`);

  // 4・5・6月の報酬（遡及支払額は、支払った月の通貨に含める。画面の報酬は支払った額）
  const days = input.months.map((m) => Math.max(0, Math.floor(m.days ?? 0)));
  const counted = countedMonths(days, input.kind);
  const months: ReportMonth[] = input.months.map((m, i) => {
    const { currency, inKind, total } = splitAmount(m.amount, m.inKind);
    return { year, month: m.month, days: days[i], currency, inKind, total, counted: counted[i] };
  });
  months.forEach((m) => { if (m.days > 31) problem(`${m.month}月の支払基礎日数が31日を超えています`); });
  const used = months.filter((m) => m.counted);
  const sum = used.reduce((s, m) => s + m.total, 0);
  const average = used.length > 0 ? Math.floor(sum / used.length) : 0;
  if (used.length === 0) notes.push("支払基礎日数が足りる月がないので、平均額は 0 と書きます（標準報酬月額は、年金事務所が決めます）");
  const annual = input.annualAverage !== null;
  const modifiedAverage = annual
    ? input.annualAverage
    : input.ordinaryAverage !== null && input.ordinaryAverage !== average && input.ordinaryAverage >= 1000 ? input.ordinaryAverage : null;
  const partialJoin = input.months.some((m) => m.partialJoin);
  if (partialJoin && modifiedAverage !== null && !annual) notes.push("途中入社で1か月分の給与を払っていない月を除いた平均を、修正平均額に書きます");
  if (input.retro && !annual) notes.push(`${input.retro.month}月に遡って支払った差額（${input.retro.amount.toLocaleString()}円）を、遡及支払額に書きます（修正平均額は、差額を除いた平均）`);
  if (annual) notes.push("年間報酬の平均で申し立てるので、年間平均額を修正平均額に書き、備考の「年間平均」に印を付けます（申立書と同意書を添えます）");

  // 70歳算定基礎月：算定の期間の途中で70歳になった人は、70歳に達した日以後の期間の1か月分の給与を払った月
  let over70Months: number[] = [];
  const startsBefore70 = flag70 && input.months.some((m) => (input.periods[m.month]?.startStr ?? "") < age.reach70!);
  if (startsBefore70) {
    over70Months = months.filter((m) => m.counted && (input.periods[m.month]?.startStr ?? "") >= age.reach70!).map((m) => m.month);
    if (over70Months.length === 0) {
      notes.push("70歳に達した日のあとの期間の1か月分の給与を払った月がないので、70歳算定基礎月は書きません（年金事務所に確かめてください）");
    } else {
      notes.push(`算定の期間の途中で70歳になったので、70歳以上被用者の算定基礎月（${over70Months.join("・")}月）と、給与の締め日・支払日を書きます`);
    }
  }
  const leave = (() => {
    const first = input.periods[input.months[0]?.month]?.startStr;
    const last = input.periods[input.months[input.months.length - 1]?.month]?.endStr;
    return first && last ? leaveRemark(staff, first, last) : "";
  })();

  // 備考欄：途中入社（資格取得日と締め日・支払日）、70歳（締め日・支払日）、休業・休職
  const autoRemarks = toShahoKanji([
    partialJoin && staff.join_date ? `${formatWareki(staff.join_date)}取得` : "",
    (partialJoin || over70Months.length > 0) && input.payRule ? input.payRule : "",
    leave,
  ].filter(Boolean).join("　"));
  const remarks = input.remarks === null ? autoRemarks : toShahoKanji(input.remarks);

  const wage = input.wageChange && input.wageChange.month >= 4 && input.wageChange.month <= 6 ? input.wageChange : null;
  const retro = input.retro && input.retro.amount > 0 ? input.retro : null;
  const p = person;
  const values = [
    SHAHO_SANTEI_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "",
    p.pensionNumber, p.kana, p.kanji,
    p.birth?.era ?? "", p.birth?.ymd ?? "",
    apply?.era ?? "", apply?.year ?? "", SHAHO_SANTEI_APPLY_MONTH,
    prev.health !== null ? thousandsText(prev.health) : "", prev.pension !== null ? thousandsText(prev.pension) : "",
    previousMonth?.era ?? "", previousMonth?.year ?? "", previousMonth?.month ?? "",
    wage ? mm(wage.month) : "", wage ? (wage.direction === "up" ? "1" : "2") : "",
    retro ? mm(retro.month) : "", retro ? amountText(retro.amount) : "",
    ...SHAHO_SANTEI_PAY_MONTHS,
    ...months.map((m) => mm(m.days)),
    ...months.map((m) => amountText(m.currency)),
    ...months.map((m) => amountText(m.inKind)),
    ...months.map((m) => amountText(m.total)),
    amountText(sum), amountText(average), modifiedAverage !== null ? amountText(modifiedAverage) : "",
    "", p.basic?.[0] ?? "", p.basic?.[1] ?? "",
    flag70 || over70Only ? "1" : "", over70Months.map(mm).join(""),
    Number(staff.multi_office) === 1 ? "1" : "", "", partialJoin ? "1" : "", leave ? "1" : "",
    input.kind === "short" ? "1" : "", input.kind === "part" ? "1" : "", annual ? "1" : "",
    remarks,
    over70Only ? "1" : "",
  ];
  problems.push(...checkFields(SHAHO_SANTEI_FIELDS, values, reported));
  // 健康保険組合の人（75歳未満）は、組合にも出す（年金事務所には書かない健康保険の従前の標準報酬月額と被保険者整理番号を書く）
  const union = input.insurer?.type === "union" && !age.over75
    ? unionRecordOf(input.insurer, staff, values, SHAHO_SANTEI_UNION_FIELDS, {
      4: String(staff.pension_num ?? "").normalize("NFKC").trim(), 12: input.previous > 0 ? thousandsText(input.previous) : "",
    }, true)
    : null;
  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), pensionNumber: p.pensionNumber, kana: p.kana, kanji: p.kanji, birthday,
    previousHealth: prev.health, previousPension: prev.pension, previousFrom: input.previousFrom,
    wageChange: wage, retro, months, sum, average, modifiedAverage,
    over70: flag70 || over70Only, over70Only, multiOffice: Number(staff.multi_office) === 1,
    basicPensionNumber: p.basic ? `${p.basic[0]}-${p.basic[1]}` : "",
    autoRemarks, remarks, values, union, problems: [...new Set(problems)], notes,
    applyFrom: `${year}-09`, kind: input.kind, over70Months, partialJoin, leave: !!leave, annual,
  };
};

/** 算定基礎届（届書は被保険者整理番号の順。70歳以上被用者届のみの人は後ろ） */
export const buildSanteiReport = (inputs: SanteiReportInput[], office: string[]): SanteiReportRow[] =>
  sortRows(inputs.map((input) => buildSanteiReportRow(input, office)));

const sortRows = <T extends ReportRowBase>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (Number(a.pensionNumber) || Infinity) - (Number(b.pensionNumber) || Infinity) || a.staffId.localeCompare(b.staffId));

/** 算定基礎届の提出期間（毎年7月1日から7月10日まで） */
export const santeiReportPeriod = (year: number): { from: string; to: string } => ({ from: `${year}-07-01`, to: `${year}-07-10` });

// ── 月額変更届 ─────────────────────────────────────────────

export interface GeppenReportInput {
  /** 画面の行の目印（届書の行で、画面の行を探すのに使う） */
  key?: string;
  staff: any;
  /** 変動月（変わった固定的賃金を初めて支払った月）と、上がったか下がったか */
  changeYear: number;
  changeMonth: number;
  direction: ZuijiDirection;
  /** 改定年月（変動月から4か月目。YYYY-MM） */
  revisionFrom: string;
  /** 従前の標準報酬月額（変動月から3か月目の分）と、その額を使いはじめた年月 */
  previous: number;
  previousFrom: string | null;
  /** 変動月から3か月に支払った給与（画面の値。報酬は遡及支払額と現物を含む支払った額。inKind はそのうち現物で払った額） */
  months: { year: number; month: number; days: number | null; amount: number | null; inKind?: number }[];
  /** 特定適用事業所の短時間労働者 */
  short: boolean;
  /** 画面で決めた平均（遡及支払額を除いた平均） */
  ordinaryAverage: number | null;
  /** 年間平均で申し立てるときの年間平均額（申し立てないときは null） */
  annualAverage: number | null;
  /** 遡って支払った差額（3か月のうち、何か月目（0から）に払ったか） */
  retro: { index: number; amount: number } | null;
  /** 昇給・降給の理由（備考欄項目4。画面で直した文。直していなければ null）と、自動で作った文 */
  reason: string | null;
  autoReason: string;
  /** 備考欄（画面で直した文。直していなければ null） */
  remarks: string | null;
  insurerType: InsurerType;
  /** 健康保険の保険者（健康保険組合の人は、組合に出す行も作る） */
  insurer?: HealthInsurer | null;
  /** 厚生年金の標準報酬月額の下限・上限（従前の月の分） */
  pensionRange: { min: number; max: number };
}

export interface GeppenReportRow extends ReportRowBase {
  /** 画面の行の目印（GeppenReportInput の key。なければ従業員の番号） */
  key: string;
  revisionFrom: string;
  short: boolean;
  reason: string;
  autoReason: string;
  annual: boolean;
}

/**
 * 昇給・降給の理由（備考欄項目4）の初めの文：確定した給与で変わった固定的賃金から作る
 * （変動月を画面で指定したときは「固定的賃金の変更」。そのほかの手当の変更などは、画面で直してもらう）
 */
export const autoChangeReason = (
  wageType: string | null | undefined,
  base: { before: number | null; after: number | null },
  fixedOvertime: { before: number | null; after: number | null },
  inKind: { before: { monthly: number; daily: number } | null; after: { monthly: number; daily: number } | null } = { before: null, after: null },
): string => {
  const parts: string[] = [];
  if (base.before !== null && base.after !== null) parts.push(wageType === "hourly" ? "時給" : wageType === "daily" ? "日給" : "基本給");
  // 現物で払う報酬（社宅に入った・出た・価額の告示の改正など）：なかった → 支給、なくなった → 廃止、ほかは価額の変更
  const none = (v: { monthly: number; daily: number }) => v.monthly === 0 && v.daily === 0;
  const inKindText = inKind.before && inKind.after
    ? none(inKind.before) ? "現物給与の支給" : none(inKind.after) ? "現物給与の廃止" : "現物給与の価額の変更"
    : null;
  const withInKind = (text: string) => (inKindText ? `${text}・${inKindText}` : text);
  if (fixedOvertime.before !== null && fixedOvertime.after !== null) {
    if (fixedOvertime.before === 0) return withInKind(parts.length > 0 ? `${parts[0]}の変更・固定残業代の支給` : "固定残業代の支給");
    if (fixedOvertime.after === 0) return withInKind(parts.length > 0 ? `${parts[0]}の変更・固定残業代の廃止` : "固定残業代の廃止");
    parts.push("固定残業代");
  }
  if (parts.length === 0) return inKindText ?? "固定的賃金の変更";
  return withInKind(`${parts.join("・")}の変更`);
};

/** 月額変更届の1人分を作る */
export const buildGeppenReportRow = (input: GeppenReportInput, office: string[]): GeppenReportRow => {
  const { staff } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const reported = new Set<number>();
  const problem = (message: string, ...fields: number[]) => {
    problems.push(message);
    for (const i of fields) reported.add(i);
  };
  const birthday = String(staff.birthday ?? "");
  // 年齢は、改定年月の初めの日で見る。改定年月の前3か月（変動月から）の間に70歳以上被用者になった人は、備考欄項目1を付けない
  const age = ageOn(birthday, `${input.revisionFrom}-01`);
  const changeFirst = `${ymOf(input.changeYear, input.changeMonth)}-01`;
  const flag70 = age.over70 && age.reach70! < changeFirst;
  const over70Only = age.over70 && (age.over75 || input.insurerType !== "kyokai");
  if (over70Only && !flag70) {
    problem("改定年月の前3か月の間に70歳になった人なので、70歳以上被用者月額変更届は出せません（年金事務所に確かめてください）", 42, 48);
  }
  const person = shahoPersonValues(staff, { kanjiField: SHAHO_GEPPEN_FIELDS[6], withoutPensionNumber: over70Only, needBasic: flag70 || over70Only });
  person.problems.forEach((p) => problem(p.message, ...PERSON_FIELDS[p.part]));
  notes.push(...person.notes);
  if (age.over75) notes.push("75歳以上（健康保険の資格もない）なので、「70歳以上被用者月額変更届」だけを出します（被保険者整理番号と、健保の従前の標準報酬月額は書きません）");
  else if (over70Only) notes.push("健康保険組合・国民健康保険組合の70歳以上の人なので、年金事務所には「70歳以上被用者月額変更届」だけを出します（被保険者整理番号は書きません）");
  else if (flag70) notes.push("70歳以上被用者なので、備考の「70歳以上被用者月額変更」に印を付け、基礎年金番号を書きます（厚年の従前の標準報酬月額は書きません）");
  else if (age.over70) notes.push("改定年月の前3か月の間に70歳以上被用者になった人なので、備考の「70歳以上被用者月額変更」には印を付けません（仕様書の決まり）");
  if (!over70Only && input.insurerType !== "kyokai") {
    notes.push("健康保険組合・国民健康保険組合の人なので、健保の従前の標準報酬月額は書きません（健康保険組合には、組合の決まった形で別に届け出ます）");
  }

  const prev = previousStandards(input.previous, input.insurerType, age.over70, age.over75, input.pensionRange);
  if (input.previous <= 0) problem("従前の標準報酬月額がありません（従業員の画面の標準報酬月額）", 12, 13);
  const previousMonth = shahoMonth(input.previousFrom);
  if (!previousMonth) problem("従前の改定月（いまの標準報酬月額をいつから使っているか）がわかりません（従業員の画面の入社日・標準報酬月額の履歴）", 14, 15, 16);
  const revision = shahoMonth(input.revisionFrom);
  if (!revision) problem(`改定年月（${input.revisionFrom}）を和暦にできません`, 9, 10, 11);

  const minDays = input.short ? 11 : 17;
  const months: ReportMonth[] = input.months.map((m) => {
    const { currency, inKind, total } = splitAmount(m.amount, m.inKind);
    const days = Math.max(0, Math.floor(m.days ?? 0));
    return { year: m.year, month: m.month, days, currency, inKind, total, counted: true };
  });
  if (input.months.some((m) => m.amount === null || m.days === null)) problems.push("3か月の給与のうち、確定していない月があります（確定してから作ります）");
  if (months.some((m) => m.days < minDays || m.days > 31)) {
    problem(`支払基礎日数は、3か月とも${minDays}日から31日です（${minDays}日に足りない月があると、随時改定の対象になりません）`, 24, 25, 26);
  }
  const sum = months.reduce((s, m) => s + m.total, 0);
  const average = Math.floor(sum / 3);
  const annual = input.annualAverage !== null;
  const modifiedAverage = annual
    ? input.annualAverage
    : input.ordinaryAverage !== null && input.ordinaryAverage !== average && input.ordinaryAverage >= 1000 ? input.ordinaryAverage : null;
  const retro = input.retro && input.retro.amount > 0 && months[input.retro.index] ? input.retro : null;
  if (retro && !annual) notes.push(`${months[retro.index].month}月に遡って支払った差額（${retro.amount.toLocaleString()}円）を、遡及支払額に書きます（修正平均額は、差額を除いた平均）`);
  if (annual) notes.push("年間報酬の平均で申し立てるので、年間平均額を修正平均額に、備考欄に「年間平均」と書きます（申立書と同意書を添えます）");

  // 届書に書く文は全角にする（画面で直していないときは、自動で作った文。比べるので、自動の文も全角にしておく）
  const autoReason = toShahoKanji(input.autoReason);
  const reason = input.reason === null ? autoReason : toShahoKanji(input.reason);
  const autoRemarks = annual ? "年間平均" : "";
  const remarks = input.remarks === null ? autoRemarks : toShahoKanji(input.remarks);
  const p = person;
  const values = [
    SHAHO_GEPPEN_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "",
    p.pensionNumber, p.kana, p.kanji,
    p.birth?.era ?? "", p.birth?.ymd ?? "",
    revision?.era ?? "", revision?.year ?? "", revision?.month ?? "",
    prev.health !== null ? thousandsText(prev.health) : "", prev.pension !== null ? thousandsText(prev.pension) : "",
    previousMonth?.era ?? "", previousMonth?.year ?? "", previousMonth?.month ?? "",
    mm(input.changeMonth), input.direction === "up" ? "1" : "2",
    retro ? mm(months[retro.index].month) : "", retro ? amountText(retro.amount) : "",
    ...months.map((m) => mm(m.month)),
    ...months.map((m) => mm(m.days)),
    ...months.map((m) => amountText(m.currency)),
    ...months.map((m) => amountText(m.inKind)),
    ...months.map((m) => amountText(m.total)),
    amountText(sum), amountText(average), modifiedAverage !== null ? amountText(modifiedAverage) : "",
    "", p.basic?.[0] ?? "", p.basic?.[1] ?? "",
    flag70 || over70Only ? "1" : "", Number(staff.multi_office) === 1 ? "1" : "", input.short ? "1" : "",
    reason,
    "",
    remarks,
    over70Only ? "1" : "",
  ];
  // 給与支給月は改定年月の前3か月（前一ヶ月の次の月が改定年月）
  const next = months.length === 3 ? addMonths(months[2].year, months[2].month, 1) : null;
  if (!next || ymOf(next.year, next.month) !== input.revisionFrom) problems.push("給与支給月が、改定年月の前の3か月になっていません");
  problems.push(...checkFields(SHAHO_GEPPEN_FIELDS, values, reported));
  const union = input.insurer?.type === "union" && !age.over75
    ? unionRecordOf(input.insurer, staff, values, SHAHO_GEPPEN_UNION_FIELDS, {
      4: String(staff.pension_num ?? "").normalize("NFKC").trim(), 12: input.previous > 0 ? thousandsText(input.previous) : "",
    }, true)
    : null;
  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), pensionNumber: p.pensionNumber, kana: p.kana, kanji: p.kanji, birthday,
    previousHealth: prev.health, previousPension: prev.pension, previousFrom: input.previousFrom,
    wageChange: { month: input.changeMonth, direction: input.direction },
    retro: retro ? { month: months[retro.index].month, amount: retro.amount } : null,
    months, sum, average, modifiedAverage,
    over70: flag70 || over70Only, over70Only, multiOffice: Number(staff.multi_office) === 1,
    basicPensionNumber: p.basic ? `${p.basic[0]}-${p.basic[1]}` : "",
    autoRemarks, remarks, values, union, problems: [...new Set(problems)], notes,
    key: input.key ?? String(staff.id), revisionFrom: input.revisionFrom, short: input.short, reason, autoReason, annual,
  };
};

/** 月額変更届（届書は被保険者整理番号の順。70歳以上被用者届のみの人は後ろ） */
export const buildGeppenReport = (inputs: GeppenReportInput[], office: string[]): GeppenReportRow[] =>
  sortRows(inputs.map((input) => buildGeppenReportRow(input, office)));
