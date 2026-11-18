/**
 * 給与・賞与の仕訳データ（会計ソフトに取り込む CSV）
 *
 * 一般的な給与ソフトの「仕訳連携」と同じく、確定した給与（支給した月ごと）・賞与（1回ごと）の内訳（賃金台帳の内訳）から、
 * 支払った日の仕訳を作る。会計ソフトごとの取り込みの形は違うので、Q は、多くの会計ソフトが取り込める一般的な形
 * （日付・伝票番号・借方の勘定科目・補助科目・部門・金額・貸方の勘定科目・補助科目・部門・金額・摘要。1行に借方か貸方の一方を書く複合仕訳）
 * にし、勘定科目・補助科目の名前は会社ごとに変えられる（company.journal_settings）。
 * ・借方：給与手当（役員は役員報酬）・賞与（役員は役員賞与）。通勤手当を別の勘定科目（旅費交通費など）にもできる。
 *   年末調整の還付は、源泉所得税の預り金を減らす（借方）
 * ・貸方：社会保険料・雇用保険料・源泉所得税・住民税の預り金、そのほかの控除（項目の名前を補助科目にする）、差引支給額（普通預金など）。
 *   年末調整の徴収は、源泉所得税の預り金（貸方）
 * ・現物で払った報酬はお金を払っていないので入れない。会社が負担する社会保険料・労働保険料（法定福利費）は、保険料の集計表の画面で、
 *   借方 法定福利費（補助科目に保険の名前）・貸方 未払費用の仕訳にする（buildWelfareJournal。科目の名前は変えられる）
 * ・部門ごとにすると、部門（従業員の画面の「部門」）ごとに分けて、借方・貸方の部門に書く
 * ・CSV の形は、会計ソフトの取り込みの設定に合わせて選べる（列の並びと見出し・見出しの行の有無・日付の書き方・文字コード（UTF-8・シフトJIS））
 */
import type { PayLedger } from "./legalBooks";
import { encodeSjisText } from "./sjisText";

/** CSV の列（見出しの名前の初めの値） */
export const JOURNAL_COLUMNS = {
  date: "日付", voucher: "伝票番号",
  debitAccount: "借方勘定科目", debitSub: "借方補助科目", debitDept: "借方部門", debitAmount: "借方金額",
  creditAccount: "貸方勘定科目", creditSub: "貸方補助科目", creditDept: "貸方部門", creditAmount: "貸方金額",
  memo: "摘要",
} as const;
export type JournalColumn = keyof typeof JOURNAL_COLUMNS;
const ALL_COLUMNS = Object.keys(JOURNAL_COLUMNS) as JournalColumn[];

/** 日付の書き方：slash 2026/11/25・hyphen 2026-11-25・compact 20261125 */
export type JournalDateStyle = "slash" | "hyphen" | "compact";
export const JOURNAL_DATE_STYLES: Record<JournalDateStyle, string> = { slash: "2026/11/25", hyphen: "2026-11-25", compact: "20261125" };
/** 文字コード：utf8bom UTF-8（BOM 付き）・utf8 UTF-8・sjis シフトJIS */
export type JournalEncoding = "utf8bom" | "utf8" | "sjis";
export const JOURNAL_ENCODINGS: Record<JournalEncoding, string> = { utf8bom: "UTF-8（BOM 付き）", utf8: "UTF-8（BOM なし）", sjis: "シフトJIS" };

export interface JournalSettings {
  salary: string;
  executiveSalary: string;
  bonus: string;
  executiveBonus: string;
  /** 通勤手当を分ける勘定科目（空なら給与・賞与の勘定科目に含める） */
  commute: string;
  deposit: string;
  socialInsuranceSub: string;
  employmentInsuranceSub: string;
  incomeTaxSub: string;
  residentTaxSub: string;
  /** 差引支給額を払った勘定科目（振込なら普通預金など） */
  payment: string;
  /** 部門ごとに分ける */
  byDepartment: boolean;
  /** 会社負担の社会保険料・労働保険料の仕訳：借方の科目（法定福利費）・貸方の科目（未払費用） */
  welfare: string;
  accrued: string;
  /** CSV の形：列の並び（入れない列は省く）・見出しの名前・見出しの行を書くか・日付の書き方・文字コード */
  columns: JournalColumn[];
  headers: Partial<Record<JournalColumn, string>>;
  header: boolean;
  dateStyle: JournalDateStyle;
  encoding: JournalEncoding;
}

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = {
  salary: "給与手当", executiveSalary: "役員報酬", bonus: "賞与", executiveBonus: "役員賞与", commute: "",
  deposit: "預り金", socialInsuranceSub: "社会保険料", employmentInsuranceSub: "雇用保険料", incomeTaxSub: "源泉所得税", residentTaxSub: "住民税",
  payment: "普通預金", byDepartment: false, welfare: "法定福利費", accrued: "未払費用",
  columns: [...ALL_COLUMNS], headers: {}, header: true, dateStyle: "slash", encoding: "utf8bom",
};

export const parseJournalSettings = (v: unknown): JournalSettings => {
  if (typeof v !== "string" || !v.trim()) return { ...DEFAULT_JOURNAL_SETTINGS };
  try {
    const x = JSON.parse(v);
    const out = { ...DEFAULT_JOURNAL_SETTINGS };
    for (const k of Object.keys(out) as (keyof JournalSettings)[]) {
      if (k === "byDepartment" || k === "header") (out as any)[k] = k === "header" ? x?.header !== false : !!x?.byDepartment;
      else if (k === "columns") {
        const cols = Array.isArray(x?.columns) ? x.columns.filter((c: unknown) => ALL_COLUMNS.includes(c as JournalColumn)) : [];
        out.columns = cols.length > 0 ? [...new Set(cols as JournalColumn[])] : [...ALL_COLUMNS];
      } else if (k === "headers") {
        out.headers = x?.headers && typeof x.headers === "object"
          ? Object.fromEntries(Object.entries(x.headers).filter(([c, v]) => ALL_COLUMNS.includes(c as JournalColumn) && typeof v === "string" && v.trim())) as JournalSettings["headers"]
          : {};
      } else if (k === "dateStyle") out.dateStyle = x?.dateStyle in JOURNAL_DATE_STYLES ? x.dateStyle : "slash";
      else if (k === "encoding") out.encoding = x?.encoding in JOURNAL_ENCODINGS ? x.encoding : "utf8bom";
      else if (typeof x?.[k] === "string") (out as any)[k] = x[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_JOURNAL_SETTINGS };
  }
};

export interface JournalPerson {
  staffId: string;
  name: string;
  executive: boolean;
  department: string;
  /** 支払った日（YYYY-MM-DD） */
  payDate: string;
  ledger: PayLedger | null;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
}

export interface JournalLine {
  date: string;
  voucher: number;
  side: "debit" | "credit";
  account: string;
  sub: string;
  department: string;
  amount: number;
  memo: string;
}

const SOCIAL = new Set(["健康保険料", "介護保険料", "子ども・子育て支援金", "厚生年金保険料", "国保組合の保険料"]);

/**
 * 仕訳を作る（支払った日・部門ごとに1つの伝票）
 * @param kind 給与か賞与か（借方の勘定科目と摘要）
 * @param label 摘要に書く「2026年11月支給 給与」など
 */
export const buildPayJournal = (kind: "salary" | "bonus", label: string, people: JournalPerson[], st: JournalSettings): { lines: JournalLine[]; notes: string[] } => {
  const notes: string[] = [];
  const groups = new Map<string, JournalPerson[]>();
  for (const p of people) {
    const key = `${p.payDate}\u0000${st.byDepartment ? p.department.trim() : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const lines: JournalLine[] = [];
  let voucher = 0;
  for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
    const [date, department] = key.split("\u0000");
    voucher += 1;
    const sums = new Map<string, { side: "debit" | "credit"; account: string; sub: string; amount: number }>();
    const add = (side: "debit" | "credit", account: string, sub: string, amount: number) => {
      if (!amount) return;
      const k = `${side}\u0000${account}\u0000${sub}`;
      const cur = sums.get(k) ?? { side, account, sub, amount: 0 };
      cur.amount += amount;
      sums.set(k, cur);
    };
    for (const p of list) {
      const earn = kind === "salary" ? (p.executive ? st.executiveSalary : st.salary) : (p.executive ? st.executiveBonus : st.bonus);
      const l = p.ledger;
      if (!l) {
        add("debit", earn, "", p.totalEarnings);
        add("credit", st.deposit, "内訳なし", p.totalDeductions);
        notes.push(`${p.name}さんは内訳を残す前に確定したので、控除をまとめて「${st.deposit}（内訳なし）」にしています。`);
      } else {
        for (const e of l.earnings) add("debit", st.commute && e.name === "通勤手当" ? st.commute : earn, "", e.amount);
        for (const d of l.deductions) {
          const sub = SOCIAL.has(d.name) ? st.socialInsuranceSub : d.name === "雇用保険料" ? st.employmentInsuranceSub
            : d.name === "所得税" ? st.incomeTaxSub : d.name === "住民税" ? st.residentTaxSub : d.name;
          add("credit", st.deposit, sub, d.amount);
        }
        if (l.yearEndSettlement > 0) add("debit", st.deposit, st.incomeTaxSub, l.yearEndSettlement);
        if (l.yearEndSettlement < 0) add("credit", st.deposit, st.incomeTaxSub, -l.yearEndSettlement);
        if ((l.inKind ?? []).length > 0 && !notes.some((n) => n.startsWith("現物"))) notes.push("現物で払った報酬は、お金を払っていないので仕訳に入れていません。");
      }
      add("credit", st.payment, "", l ? l.netPay : p.netPay);
    }
    const memo = `${label}（${list.length}人）`;
    const ordered = [...sums.values()].sort((a, b) => (a.side === b.side ? 0 : a.side === "debit" ? -1 : 1));
    for (const s of ordered) {
      lines.push({ date, voucher, side: s.side, account: s.account, sub: s.sub, department, amount: s.amount, memo });
    }
  }
  return { lines, notes };
};

/** 借方・貸方の合計（合っていなければ仕訳を作れない） */
export const journalTotals = (lines: JournalLine[]) => ({
  debit: lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0),
  credit: lines.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0),
});

const csvEscape = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV（1行に借方か貸方の一方。列の並び・見出し・日付の書き方は設定から。設定がなければ一般的な形） */
export const journalCsv = (lines: JournalLine[], st: Pick<JournalSettings, "columns" | "headers" | "header" | "dateStyle"> = DEFAULT_JOURNAL_SETTINGS): string => {
  const cols = st.columns.length > 0 ? st.columns : ALL_COLUMNS;
  const head = cols.map((c) => st.headers[c] || JOURNAL_COLUMNS[c]);
  const dateOf = (d: string) => (st.dateStyle === "hyphen" ? d : st.dateStyle === "compact" ? d.replace(/-/g, "") : d.replace(/-/g, "/"));
  const rows = lines.map((l) => {
    const debit = l.side === "debit";
    const v: Record<JournalColumn, string> = {
      date: dateOf(l.date), voucher: String(l.voucher),
      debitAccount: debit ? l.account : "", debitSub: debit ? l.sub : "", debitDept: debit ? l.department : "", debitAmount: debit ? String(l.amount) : "",
      creditAccount: debit ? "" : l.account, creditSub: debit ? "" : l.sub, creditDept: debit ? "" : l.department, creditAmount: debit ? "" : String(l.amount),
      memo: l.memo,
    };
    return cols.map((c) => v[c]);
  });
  return [...(st.header ? [head] : []), ...rows].map((c) => c.map(csvEscape).join(",")).join("\r\n") + "\r\n";
};

/** 保存するファイルのバイト（文字コードは設定から）。シフトJIS にない字は「?」にして unknown で知らせる */
export const journalBytes = (lines: JournalLine[], st: JournalSettings): { bytes: Uint8Array; unknown: string[] } => {
  const text = journalCsv(lines, st);
  if (st.encoding === "sjis") return encodeSjisText(text);
  const body = new TextEncoder().encode(text);
  if (st.encoding === "utf8") return { bytes: body, unknown: [] };
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return { bytes: out, unknown: [] };
};

/**
 * 会社負担の社会保険料・労働保険料（法定福利費）の仕訳（保険料の集計表の会社負担の見込みから。1つの伝票）
 * 借方：法定福利費（補助科目に保険の名前）、貸方：未払費用（合計）
 */
export const buildWelfareJournal = (date: string, label: string, items: { sub: string; amount: number }[], st: JournalSettings): JournalLine[] => {
  const list = items.filter((x) => x.amount > 0);
  if (list.length === 0) return [];
  const memo = `${label} 会社負担の社会保険料・労働保険料`;
  return [
    ...list.map((x): JournalLine => ({ date, voucher: 1, side: "debit", account: st.welfare, sub: x.sub, department: "", amount: x.amount, memo })),
    { date, voucher: 1, side: "credit", account: st.accrued, sub: "", department: "", amount: list.reduce((t, x) => t + x.amount, 0), memo },
  ];
};
