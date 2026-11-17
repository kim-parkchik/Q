/**
 * 給与所得・退職所得等の所得税徴収高計算書（源泉所得税の納付書）に書く中身
 *
 * 納付書は、税務署や業務センターが交付した所定の用紙を使う（国税庁「所得税徴収高計算書（納付書）の記載のしかた」の留意事項）ので、
 * Q は用紙に書き写す中身を出す（一般的な給与ソフトの「所得税徴収高計算書」「所得税徴収高計算書用資料」と同じ）。
 * 決まりは、国税庁「納付書の記載のしかた（給与所得・退職所得等の所得税徴収高計算書）」（令和８年以降分）による。
 *
 * ■ 納期限：納期の特例の承認を受けていなければ、支払った月の翌月10日。受けていれば、1月〜6月に支払った分は7月10日、
 *   7月〜12月に支払った分は翌年1月20日（土日祝日・12月29日〜1月3日なら、その次の日。国税通則法10条2項）
 * ■ 年度：会計年度（納付する日が令和8年4月1日〜令和9年3月31日なら「508」）。Q は納期限の日で決める
 * ■ 納期等の区分：支払った年月（例「508 09」）。納期の特例は、期間の最初と最後の支払年月（「自 508 07 至 508 12」）
 * ■ 俸給、給料等：通常の給与（賞与・日雇労務者の賃金は、それぞれの欄に書く）。
 *   支払年月日は、その月の最後の支払年月日（納期の特例は、期間内の最初と最後の支払年月日）、人員は実人員（納期の特例は、月ごとの実人員の合計数）、
 *   支給額は総額、税額は源泉徴収した税額の合計。
 *   支給額は、所得税がかかる給与の額（非課税の通勤手当を除く。源泉徴収簿の総支給金額と同じ。utils/withholdingLedger.ts）にする。
 *   記載のしかたは、所得税が課されない給与（所得税法9条1項3号の増加恩給など・7号の在外手当）を「摘要」に別に書くことにしていて、
 *   非課税の通勤手当（同5号）は支給額に入れない
 * ■ 賞与（役員賞与を除く）：法人の役員に払った賞与以外の賞与（俸給、給料等の欄に準じて書く）。
 *   役員（従業員の画面の「役員」）に払った賞与は「役員賞与」の欄（同上の支払確定年月日は、Q ではわからないので手で書く）。
 *   使用人兼務役員の使用人分の賞与は「賞与」の欄に書くが、Q では分けられないので、役員の賞与はすべて役員賞与の欄にして知らせる
 * ■ 日雇労務者の賃金：日額表の丙欄で源泉徴収した賃金（Q の丙欄の人の給与）。人員は延べ人員（働いた日の人数の合計）
 * ■ 退職手当等・税理士等の報酬：Q では計算しないので、画面で入れた額を書く
 * ■ 年末調整による不足税額・超過税額：その月に、年末調整の不足額を徴収した額・超過額を還付した額（Q は12月か翌年1月の給与で精算する）。
 *   超過額（還付）は、その月の税額から差し引いて還付し、引ききれないときは、その後に納付する税額から順に差し引く
 *   （国税庁 タックスアンサー No.2675。2か月を経過しても還付しきれないと見込まれるときは「年末調整過納額還付請求書兼残存過納額明細書」で
 *   税務署から還付を受ける）。Q は、その月（期間）に差し引けた額を超過税額の欄に書き、残りを次の納付に回して知らせる
 * ■ 本税：税額の合計 ＋ 不足税額 − 超過税額。合計額は本税（延滞税・不納付加算税は Q では書かない）。
 *   令和8年12月以前に支払った分は「所得税及び復興特別所得税」、令和9年1月以後は「所得税、復興特別所得税及び防衛特別所得税」の額
 */
import dayjs from "dayjs";
import { toWareki } from "./wareki";

export type NofuMode = "general" | "special";

/** 確定した給与（その月に支給したもの） */
export interface NofuSalaryInput {
  staffId: string;
  /** 法人の役員（役員の給与も「俸給、給料等」に書く。賞与だけ分ける） */
  executive: boolean;
  /** 源泉所得税の欄（kou・otsu・hei。丙欄は日雇労務者の賃金） */
  taxColumn: string;
  /** 支払った日（YYYY-MM-DD） */
  payDate: string;
  /** 所得税がかかる支給額（非課税の通勤手当を除く） */
  taxable: number;
  /** 源泉徴収した税額（年末調整の過不足は含まない） */
  tax: number;
  /** この給与で精算した年末調整の過不足額（＋還付／−徴収） */
  yearEnd: number;
  /** 働いた日数（丙欄の人の延べ人員） */
  workDays: number;
}

/** 確定した賞与 */
export interface NofuBonusInput {
  staffId: string;
  executive: boolean;
  payDate: string;
  amount: number;
  tax: number;
}

/** 手で入れる欄（退職手当等・税理士等の報酬） */
export interface NofuExtra {
  /** 支払年月日（「2026-11-30」など。書かなくてもよい） */
  payDate?: string;
  persons: number;
  amount: number;
  tax: number;
}

export interface NofuExtras {
  retirement?: NofuExtra | null;
  professional?: NofuExtra | null;
}

/** 1つの欄（支払年月日・人員・支給額・税額） */
export interface NofuLine {
  /** 期間内の最初と最後の支払年月日（YYYY-MM-DD。払っていなければ null） */
  first: string | null;
  last: string | null;
  persons: number;
  amount: number;
  tax: number;
}

export interface NofuSlip {
  /** 期間の印（一般は「2026-11」、納期の特例は「2026-1H」「2026-2H」） */
  key: string;
  /** 「2026年11月支払分」「2026年7月〜12月支払分」 */
  label: string;
  mode: NofuMode;
  /** 期間の最初と最後の支払年月（YYYY-MM） */
  fromMonth: string;
  toMonth: string;
  /** 年度（会計年度。「508」） */
  fiscalYearCode: string;
  /** 納期等の区分（元号・年・月の数字。「508 09」） */
  periodCodes: { from: string; to: string };
  dueDate: string;
  salary: NofuLine;
  bonus: NofuLine;
  daily: NofuLine;
  retirement: NofuLine;
  professional: NofuLine;
  officerBonus: NofuLine;
  /** 年末調整による不足税額（徴収した額） */
  shortage: number;
  /** この期間に精算した年末調整の還付額の合計（Q で給与と一緒に払った額） */
  refunded: number;
  /** 前の納付から回ってきた、まだ差し引いていない還付額 */
  carryIn: number;
  /** 年末調整による超過税額（この期間の税額から差し引いた還付額） */
  excess: number;
  /** 次の納付に回す、差し引ききれなかった還付額 */
  carryOut: number;
  /** 本税・合計額 */
  principal: number;
  total: number;
  /** 令和9年1月以後に支払った分（防衛特別所得税を含む） */
  withDefense: boolean;
  /** 支払がない期間（納付書は要らない） */
  empty: boolean;
  notes: string[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const monthOf = (date: string) => date.slice(0, 7);

/** 元号の数字（納付書は令和を「5」で書く。例「508」＝令和8年度）。令和でなければ空 */
const reiwaCode = (date: string): string | null => {
  const w = toWareki(date);
  return w && w.era === "令和" ? `5${pad2(w.year)}` : null;
};

/** 「508 09」（令和8年9月） */
export const monthCode = (ym: string): string => {
  const c = reiwaCode(`${ym}-01`);
  return c ? `${c} ${ym.slice(5, 7)}` : "";
};

/** 会計年度（4月〜翌年3月）の「508」 */
export const fiscalYearCodeOf = (date: string): string => {
  const d = dayjs(date);
  const fy = d.month() + 1 >= 4 ? d.year() : d.year() - 1;
  return reiwaCode(`${fy}-04-01`) ?? "";
};

/** 国税の期限の日（土日・祝日・12月29日〜1月3日なら、その次の日。国税通則法10条2項・同施行令2条2項） */
export const taxDueDate = (date: string, isHoliday: (d: string) => boolean = () => false): string => {
  let x = dayjs(date);
  const closed = (d: dayjs.Dayjs) => {
    const md = d.format("MM-DD");
    return d.day() === 0 || d.day() === 6 || isHoliday(d.format("YYYY-MM-DD")) || md >= "12-29" || md <= "01-03";
  };
  while (closed(x)) x = x.add(1, "day");
  return x.format("YYYY-MM-DD");
};

const emptyLine = (): NofuLine => ({ first: null, last: null, persons: 0, amount: 0, tax: 0 });

const addDate = (line: NofuLine, date: string | undefined | null) => {
  if (!date) return;
  if (!line.first || date < line.first) line.first = date;
  if (!line.last || date > line.last) line.last = date;
};

/** 月ごとの実人員を足す（納期の特例は月ごとの実人員の合計数） */
const realPersons = (items: { staffId: string; payDate: string }[]): number => {
  const byMonth = new Map<string, Set<string>>();
  for (const it of items) {
    const m = monthOf(it.payDate);
    if (!byMonth.has(m)) byMonth.set(m, new Set());
    byMonth.get(m)!.add(it.staffId);
  }
  return [...byMonth.values()].reduce((s, set) => s + set.size, 0);
};

const lineOf = (items: { staffId: string; payDate: string; amount: number; tax: number }[]): NofuLine => {
  const line = emptyLine();
  for (const it of items) {
    addDate(line, it.payDate);
    line.amount += it.amount;
    line.tax += it.tax;
  }
  line.persons = realPersons(items);
  return line;
};

const extraLine = (e: NofuExtra | null | undefined): NofuLine => {
  const line = emptyLine();
  if (!e) return line;
  addDate(line, e.payDate || null);
  line.persons = Math.max(0, Math.floor(Number(e.persons) || 0));
  line.amount = Math.max(0, Math.floor(Number(e.amount) || 0));
  line.tax = Math.max(0, Math.floor(Number(e.tax) || 0));
  return line;
};

/** 納付の期間（一般：月ごと、納期の特例：半年ごと） */
export const nofuPeriods = (year: number, mode: NofuMode): { key: string; label: string; from: string; to: string; due: string }[] =>
  mode === "general"
    ? Array.from({ length: 12 }, (_, i) => {
        const ym = `${year}-${pad2(i + 1)}`;
        const next = dayjs(`${ym}-01`).add(1, "month");
        return { key: ym, label: `${year}年${i + 1}月支払分`, from: ym, to: ym, due: `${next.format("YYYY-MM")}-10` };
      })
    : [
        { key: `${year}-1H`, label: `${year}年1月〜6月支払分`, from: `${year}-01`, to: `${year}-06`, due: `${year}-07-10` },
        { key: `${year}-2H`, label: `${year}年7月〜12月支払分`, from: `${year}-07`, to: `${year}-12`, due: `${year + 1}-01-20` },
      ];

export interface NofuOptions {
  /** 作る年（この年に支払った分。前の年の分も渡すと、年末調整の還付の残りを回せる） */
  year: number;
  mode: NofuMode;
  salaries: NofuSalaryInput[];
  bonuses: NofuBonusInput[];
  /** 期間の印（key）ごとの、手で入れた欄 */
  extras?: Record<string, NofuExtras>;
  isHoliday?: (date: string) => boolean;
}

/**
 * 1年分の納付書の中身（一般は12か月、納期の特例は2つ）
 * 前の年の12月の年末調整で還付しきれなかった額を回すため、前の年の分から順に計算する（前の年の給与も渡す）
 */
export const buildNofuSlips = (opts: NofuOptions): NofuSlip[] => {
  const periods = [...nofuPeriods(opts.year - 1, opts.mode), ...nofuPeriods(opts.year, opts.mode)];
  let carry = 0;
  const out: NofuSlip[] = [];
  for (const p of periods) {
    const inPeriod = (date: string) => monthOf(date) >= p.from && monthOf(date) <= p.to;
    const sals = opts.salaries.filter((s) => inPeriod(s.payDate));
    const bons = opts.bonuses.filter((b) => inPeriod(b.payDate));
    const regular = sals.filter((s) => s.taxColumn !== "hei");
    const daily = sals.filter((s) => s.taxColumn === "hei");
    const extras = opts.extras?.[p.key] ?? {};

    const salary = lineOf(regular.map((s) => ({ staffId: s.staffId, payDate: s.payDate, amount: s.taxable, tax: s.tax })));
    const dailyLine = lineOf(daily.map((s) => ({ staffId: s.staffId, payDate: s.payDate, amount: s.taxable, tax: s.tax })));
    dailyLine.persons = daily.reduce((n, s) => n + Math.max(0, Math.floor(Number(s.workDays) || 0)), 0);
    const bonus = lineOf(bons.filter((b) => !b.executive).map((b) => ({ ...b })));
    const officerBonus = lineOf(bons.filter((b) => b.executive).map((b) => ({ ...b })));
    const retirement = extraLine(extras.retirement);
    const professional = extraLine(extras.professional);

    const shortage = sals.reduce((s, x) => s + Math.max(0, -Math.trunc(Number(x.yearEnd) || 0)), 0);
    const refunded = sals.reduce((s, x) => s + Math.max(0, Math.trunc(Number(x.yearEnd) || 0)), 0);
    const taxTotal = salary.tax + bonus.tax + dailyLine.tax + retirement.tax + professional.tax + officerBonus.tax;
    const carryIn = carry;
    const available = taxTotal + shortage;
    const excess = Math.min(carryIn + refunded, available);
    const carryOut = carryIn + refunded - excess;
    const principal = available - excess;

    const notes: string[] = [];
    if (officerBonus.persons > 0) {
      notes.push("役員賞与の「同上の支払確定年月日」（支払が確定した日。株主総会の決議の日など）は、Q ではわからないので手で書いてください。使用人兼務役員の使用人分の賞与は「賞与」の欄に書きます");
    }
    if (carryIn > 0) notes.push(`前の納付で差し引ききれなかった年末調整の還付 ${carryIn.toLocaleString()}円のうち、差し引ける分をこの納付の「年末調整による超過税額」に入れています。`);
    if (carryOut > 0) {
      notes.push(`年末調整の還付のうち ${carryOut.toLocaleString()}円は、この納付の税額から差し引ききれないので、次の納付の税額から差し引きます（国税庁 タックスアンサー No.2675）。` +
        "還付することになった日の翌月から2か月を経過しても還付しきれないと見込まれるときは、「源泉所得税及び復興特別所得税の年末調整過納額還付請求書兼残存過納額明細書」を税務署に出して、税務署から還付を受けます。");
    }
    carry = carryOut;

    const empty = sals.length === 0 && bons.length === 0 && retirement.persons === 0 && professional.persons === 0 && carryIn === 0;
    if (p.from >= `${opts.year}-01`) {
      const due = taxDueDate(p.due, opts.isHoliday);
      out.push({
        key: p.key, label: p.label, mode: opts.mode, fromMonth: p.from, toMonth: p.to,
        fiscalYearCode: fiscalYearCodeOf(due),
        periodCodes: { from: monthCode(p.from), to: monthCode(p.to) },
        dueDate: due,
        salary, bonus, daily: dailyLine, retirement, professional, officerBonus,
        shortage, refunded, carryIn, excess, carryOut, principal, total: principal,
        withDefense: p.to >= "2027-01",
        empty, notes,
      });
    }
  }
  return out;
};

/** 支払年月日の書き方（一般：最後の支払年月日「508 09 25」、納期の特例：最初と最後「508 07 25 ～ 12 25」） */
export const payDateCode = (line: NofuLine, mode: NofuMode): string => {
  if (!line.last) return "";
  const code = (d: string) => {
    const c = reiwaCode(d);
    return c ? `${c} ${d.slice(5, 7)} ${d.slice(8, 10)}` : d;
  };
  if (mode === "general" || !line.first || line.first === line.last) return code(line.last);
  return `${code(line.first)} ～ ${line.last.slice(5, 7)} ${line.last.slice(8, 10)}`;
};
