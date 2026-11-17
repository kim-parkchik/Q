/**
 * 給与明細書・賞与明細書（全員分をまとめて）と、支給控除一覧表
 *
 * ■ 明細書：給与等の支払明細書（所得税法231条：給与等を支払う者は、支払を受ける者に支払明細書を交付する）。
 *   確定したときに残した内訳（賃金台帳の内訳。utils/legalBooks.ts の PayLedger）から作るので、給与明細の画面で1人ずつ
 *   計算し直さなくても、その月に支給した給与（その賞与）の全員分をまとめて印刷できる（一般的な給与ソフトと同じ）。
 *   内訳を残す前に確定したもの（内訳がない）は、支給合計・控除合計・差引支給額だけを出す。
 * ■ 支給控除一覧表：その月に支給した給与（または1回の賞与）の全員分を、行に人・列に項目で並べ、拠点ごとの小計と合計を付ける。
 *   列は、勤怠（給与だけ：出勤日数・労働時間・時間外・休日・深夜）、支給の行、支給合計、現物の行、控除の行、控除合計、
 *   年末調整の過不足額、差引支給額。支給・控除の行の名前は人によって違う（月給の人は「基本給」、時給の人は「時給分」など）ので、
 *   全員の行の名前を出てきた順に並べる（同じ人に同じ名前の行が2つあれば足す）。小計は、拠点ごと・部門ごと（従業員の画面の「部門」）を選べる。
 * ■ 月ごとの推移表：1年分の給与（支給した月ごと）の項目の合計を、行に項目・列に月で並べる（一般的な給与ソフトの「月次推移表」）。
 * ■ 前の月と変わった人（変動確認表）：その月と前の月の給与で、支給・控除の項目の額が変わった人と項目を出す
 *   （一般的な給与ソフトの「変動項目確認表」。確定する前の見直しや、手入力の間違いを見つけるのに使う）。
 */
import type { LedgerLine, PayLedger } from "./legalBooks";

/** 明細書・一覧表の1人分（確定した給与・賞与） */
export interface PayDocPerson {
  staffId: string;
  name: string;
  branchName: string;
  /** 部門（従業員の画面の「部門」。なくてもよい） */
  department?: string;
  /** 確定したときに残した内訳（内訳を残す前に確定したものは null） */
  ledger: PayLedger | null;
  /** 確定した結果の支給合計（現物を除く）・控除合計・差引支給額（内訳がないときに使う） */
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
}

export type PayListGroup = "work" | "earning" | "inKind" | "deduction" | "summary";

export interface PayListColumn {
  key: string;
  label: string;
  group: PayListGroup;
  /** 時間の列（小数で出す） */
  hours?: boolean;
}

export interface PayListRow {
  kind: "person" | "subtotal" | "total";
  /** 人は氏名、小計は「拠点 小計」、合計は「合計」 */
  label: string;
  staffId: string;
  branchName: string;
  /** 小計・合計の人数（人の行は 1） */
  count: number;
  values: Record<string, number>;
  /** 内訳がない（支給合計・控除合計・差引支給額だけ） */
  noLedger: boolean;
}

/** 勤怠の列（給与だけ） */
export const WORK_COLUMNS: PayListColumn[] = [
  { key: "w:days", label: "出勤日数", group: "work" },
  { key: "w:hours", label: "労働時間", group: "work", hours: true },
  { key: "w:overtime", label: "時間外", group: "work", hours: true },
  { key: "w:holiday", label: "休日労働", group: "work", hours: true },
  { key: "w:night", label: "深夜", group: "work", hours: true },
];

const add = (values: Record<string, number>, key: string, amount: number) => {
  values[key] = (values[key] ?? 0) + amount;
};

/** 行の名前を、出てきた順に（重ならないように）集める */
const namesOf = (people: PayDocPerson[], pick: (l: PayLedger) => LedgerLine[] | undefined): string[] => {
  const seen: string[] = [];
  for (const p of people) {
    for (const line of (p.ledger ? pick(p.ledger) : undefined) ?? []) {
      if (!seen.includes(line.name)) seen.push(line.name);
    }
  }
  return seen;
};

/**
 * 一覧表の列
 * @param withWork 勤怠の列を出す（給与。賞与は出さない）
 */
export const payListColumns = (people: PayDocPerson[], withWork: boolean): PayListColumn[] => {
  const inKind = namesOf(people, (l) => l.inKind);
  const yearEnd = people.some((p) => (p.ledger?.yearEndSettlement ?? 0) !== 0);
  return [
    ...(withWork ? WORK_COLUMNS : []),
    ...namesOf(people, (l) => l.earnings).map((name): PayListColumn => ({ key: `e:${name}`, label: name, group: "earning" })),
    { key: "s:earnings", label: "支給合計", group: "summary" },
    ...inKind.map((name): PayListColumn => ({ key: `k:${name}`, label: `${name}（現物）`, group: "inKind" })),
    ...namesOf(people, (l) => l.deductions).map((name): PayListColumn => ({ key: `d:${name}`, label: name, group: "deduction" })),
    { key: "s:deductions", label: "控除合計", group: "summary" },
    ...(yearEnd ? [{ key: "s:yearEnd", label: "年末調整（＋還付／−徴収）", group: "summary" } as PayListColumn] : []),
    { key: "s:net", label: "差引支給額", group: "summary" },
  ];
};

/** 1人分の値（列のキーごと） */
export const payListValues = (p: PayDocPerson): Record<string, number> => {
  const values: Record<string, number> = {};
  const l = p.ledger;
  if (!l) {
    values["s:earnings"] = p.totalEarnings;
    values["s:deductions"] = p.totalDeductions;
    values["s:net"] = p.netPay;
    return values;
  }
  values["w:days"] = l.workDays;
  values["w:hours"] = l.workHours;
  values["w:overtime"] = l.overtimeHours;
  values["w:holiday"] = l.holidayHours;
  values["w:night"] = l.nightHours;
  for (const line of l.earnings) add(values, `e:${line.name}`, line.amount);
  for (const line of l.inKind ?? []) add(values, `k:${line.name}`, line.amount);
  for (const line of l.deductions) add(values, `d:${line.name}`, line.amount);
  values["s:earnings"] = l.totalEarnings;
  values["s:deductions"] = l.totalDeductions;
  values["s:yearEnd"] = l.yearEndSettlement;
  values["s:net"] = l.netPay;
  return values;
};

const sumValues = (rows: PayListRow[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.values)) add(out, k, v);
  // 時間は小数の足し算の誤差を丸める
  for (const k of Object.keys(out)) if (k.startsWith("w:")) out[k] = Math.round(out[k] * 100) / 100;
  return out;
};

export type PayListGroupBy = "branch" | "department" | "none";

/**
 * 一覧表の行（人の行・拠点ごと（部門ごと）の小計・合計）
 * 人は渡した順（拠点の順・社員番号の順に並べて渡す）。部門ごとは、部門の名前の順に並べ直す。小計は、まとまりが2つ以上あるときだけ付ける
 */
export const payListRows = (people: PayDocPerson[], groupBy: PayListGroupBy = "branch"): PayListRow[] => {
  const groupOf = (p: PayDocPerson) => (groupBy === "department" ? (p.department ?? "").trim() : groupBy === "branch" ? p.branchName : "");
  const ordered = groupBy === "department"
    ? [...people].sort((a, b) => (groupOf(a) === "" ? 1 : 0) - (groupOf(b) === "" ? 1 : 0) || groupOf(a).localeCompare(groupOf(b), "ja"))
    : people;
  const personRows = ordered.map((p): PayListRow => ({
    kind: "person", label: p.name, staffId: p.staffId, branchName: groupOf(p), count: 1, values: payListValues(p), noLedger: !p.ledger,
  }));
  const groups: string[] = [];
  for (const r of personRows) if (!groups.includes(r.branchName)) groups.push(r.branchName);
  const out: PayListRow[] = [];
  if (groupBy !== "none" && groups.length > 1) {
    const none = groupBy === "department" ? "部門なし" : "拠点なし";
    for (const b of groups) {
      const rows = personRows.filter((r) => r.branchName === b);
      out.push(...rows, { kind: "subtotal", label: `${b || none} 小計`, staffId: "", branchName: b, count: rows.length, values: sumValues(rows), noLedger: false });
    }
  } else {
    out.push(...personRows);
  }
  out.push({ kind: "total", label: "合計", staffId: "", branchName: "", count: personRows.length, values: sumValues(personRows), noLedger: false });
  return out;
};

/** 一覧表の値を、画面・印刷・CSV に出す文字にする（時間は小数2けたまで、0 は空） */
export const payListCell = (col: PayListColumn, row: PayListRow): string => {
  const v = row.values[col.key];
  if (v === undefined || v === 0) return "";
  if (col.hours) return String(Math.round(v * 100) / 100);
  return v.toLocaleString();
};

const csvEscape = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 一覧表の CSV（1行目に表題、2行目に見出し。金額はカンマなしの数字） */
export const payListCsv = (title: string, columns: PayListColumn[], rows: PayListRow[]): string => {
  const head = ["区分", "社員番号", "氏名", "拠点", "人数", ...columns.map((c) => c.label)];
  const lines = [
    [title],
    head,
    ...rows.map((r) => [
      r.kind === "person" ? (r.noLedger ? "人（内訳なし）" : "人") : r.kind === "subtotal" ? "小計" : "合計",
      r.staffId,
      r.kind === "person" ? r.label : r.label,
      r.branchName,
      String(r.count),
      ...columns.map((c) => {
        const v = r.values[c.key];
        if (v === undefined) return "";
        return c.hours ? String(Math.round(v * 100) / 100) : String(v);
      }),
    ]),
  ];
  return lines.map((cells) => cells.map(csvEscape).join(",")).join("\r\n") + "\r\n";
};

/** 時間を「8:30」の形にする（明細書の勤怠の欄） */
export const hoursLabel = (h: number): string => {
  const minutes = Math.round((Number(h) || 0) * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

// ── 月ごとの推移表 ─────────────────────────────────────

export interface PayTrendRow {
  column: PayListColumn;
  /** 1月〜12月（支給した月）の合計 */
  months: number[];
  total: number;
}

/** 1年分の給与の、項目ごと・支給した月ごとの合計（行は一覧表と同じ列。勤怠は合計の時間） */
export const payTrendRows = (byMonth: { month: number; people: PayDocPerson[] }[]): { rows: PayTrendRow[]; persons: number[] } => {
  const all = byMonth.flatMap((m) => m.people);
  const columns = payListColumns(all, true);
  const persons = Array.from({ length: 12 }, (_, i) => byMonth.find((m) => m.month === i + 1)?.people.length ?? 0);
  const sums = Array.from({ length: 12 }, (_, i) => sumValues((byMonth.find((m) => m.month === i + 1)?.people ?? [])
    .map((p) => ({ kind: "person", label: "", staffId: p.staffId, branchName: "", count: 1, values: payListValues(p), noLedger: !p.ledger }))));
  const rows = columns.map((column) => {
    const months = sums.map((v) => v[column.key] ?? 0);
    const total = months.reduce((t, v) => t + v, 0);
    return { column, months, total: column.hours ? Math.round(total * 100) / 100 : total };
  });
  return { rows, persons };
};

// ── 前の月と変わった人（変動確認表） ───────────────────────────

export interface PayChange {
  staffId: string;
  name: string;
  /** 項目の名前（支給・控除・現物・合計） */
  label: string;
  group: PayListGroup;
  before: number | null;
  after: number | null;
  /** after − before（どちらかの月にない人は、ある月の額） */
  diff: number;
}

/**
 * その月（after）と前の月（before）の給与で、額が変わった項目（勤怠の時間は入れない）
 * どちらかの月にしかいない人（入社・退職など）は、その人の差引支給額だけを出す
 */
export const payChanges = (before: PayDocPerson[], after: PayDocPerson[]): PayChange[] => {
  const columns = payListColumns([...before, ...after], false).filter((c) => c.group !== "work");
  const prev = new Map(before.map((p) => [p.staffId, p]));
  const next = new Map(after.map((p) => [p.staffId, p]));
  const ids = [...new Set([...after.map((p) => p.staffId), ...before.map((p) => p.staffId)])];
  const out: PayChange[] = [];
  for (const id of ids) {
    const a = prev.get(id) ?? null;
    const b = next.get(id) ?? null;
    const name = (b ?? a)!.name;
    if (!a || !b) {
      const v = payListValues((b ?? a)!)["s:net"] ?? 0;
      out.push({ staffId: id, name, label: b ? "差引支給額（前の月はなし）" : "差引支給額（この月はなし）", group: "summary", before: a ? v : null, after: b ? v : null, diff: b ? v : -v });
      continue;
    }
    const va = payListValues(a);
    const vb = payListValues(b);
    for (const c of columns) {
      const x = va[c.key] ?? 0;
      const y = vb[c.key] ?? 0;
      if (x !== y) out.push({ staffId: id, name, label: c.label, group: c.group, before: x, after: y, diff: y - x });
    }
  }
  return out;
};
