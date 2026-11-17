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
 * ・現物で払った報酬はお金を払っていないので入れない。会社が負担する社会保険料・労働保険料（法定福利費）は、保険料の集計表で出す
 * ・部門ごとにすると、部門（従業員の画面の「部門」）ごとに分けて、借方・貸方の部門に書く
 */
import type { PayLedger } from "./legalBooks";

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
}

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = {
  salary: "給与手当", executiveSalary: "役員報酬", bonus: "賞与", executiveBonus: "役員賞与", commute: "",
  deposit: "預り金", socialInsuranceSub: "社会保険料", employmentInsuranceSub: "雇用保険料", incomeTaxSub: "源泉所得税", residentTaxSub: "住民税",
  payment: "普通預金", byDepartment: false,
};

export const parseJournalSettings = (v: unknown): JournalSettings => {
  if (typeof v !== "string" || !v.trim()) return { ...DEFAULT_JOURNAL_SETTINGS };
  try {
    const x = JSON.parse(v);
    const out = { ...DEFAULT_JOURNAL_SETTINGS };
    for (const k of Object.keys(out) as (keyof JournalSettings)[]) {
      if (k === "byDepartment") out.byDepartment = !!x?.byDepartment;
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

/** CSV（1行目は見出し。1行に借方か貸方の一方） */
export const journalCsv = (lines: JournalLine[]): string => {
  const head = ["日付", "伝票番号", "借方勘定科目", "借方補助科目", "借方部門", "借方金額", "貸方勘定科目", "貸方補助科目", "貸方部門", "貸方金額", "摘要"];
  const rows = lines.map((l) => {
    const d = l.date.replace(/-/g, "/");
    const side = [l.account, l.sub, l.department, String(l.amount)];
    const blank = ["", "", "", ""];
    return [d, String(l.voucher), ...(l.side === "debit" ? side : blank), ...(l.side === "credit" ? side : blank), l.memo];
  });
  return [head, ...rows].map((c) => c.map(csvEscape).join(",")).join("\r\n") + "\r\n";
};
