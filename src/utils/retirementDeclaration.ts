/**
 * 「退職所得の受給に関する申告書」（退職所得申告書を兼ねる）の下書き
 *
 * 申告書は、退職手当等を受ける人（居住者）が、支払を受ける時までに支払者に出すもの（所得税法203条）。会社は、Q に入れた内容から下書きを
 * 印刷して本人に渡し、本人が確かめて、生活扶助の有無・個人番号などを書いて出してもらう（出してもらった申告書は会社が保存する。
 * 所得税法施行規則77条6項）。
 * 欄と書き方は、国税庁の様式（令和8年1月1日以後。taishoku-tables/source/shinkokusho-2026.pdf）の裏の「申告書の書き方」と、
 * 所得税法203条1項・所得税法施行規則77条1項の記載事項による。
 * ・A 欄（全員）：① 退職手当等の支払を受けることとなった年月日（役員の退職手当等で株主総会の決議が要るものは、その決議で額が決まった日）、
 *   ② 退職の区分（一般・障害）と生活扶助の有無、③ この支払者から受ける退職手当等の勤続期間と年数（1年未満の端数は切り上げ）と、
 *   そのうちの特定役員等勤続期間（一般勤続期間・短期勤続期間との重複）・短期勤続期間
 * ・B 欄（その年に他の退職手当等を受けた人）：④ 他の退職手当等の勤続期間（うち特定役員等・短期）、⑤ ③と④の通算勤続期間と、その内書き
 *   （特定役員等勤続期間と一般・短期との重複、全重複、短期勤続期間と一般との重複。重複には全重複を含めない）
 * ・C 欄（前年以前4年内（確定拠出年金の一時金は9年内・19年内）に退職手当等を受けた人）：⑥ 前年以前の退職手当等の勤続期間
 *   （収入金額がその退職所得控除額に満たないときは、短くした期間）、⑦ ③又は⑤のうち⑥と重複している期間と、㋑ 特定役員等勤続期間・
 *   ㋺ 短期勤続期間との重複（年数は1年未満の端数を切り捨て）
 * ・D 欄（前の退職手当等の勤続期間を通算した人）：⑧ ③に通算された前の退職手当等の勤続期間（うち特定役員等・短期）、⑩ ③又は⑤のうち
 *   ⑧又は⑨だけからなる部分（㋩ 特定役員等・㋥ 短期）、⑪ ⑦と⑩の通算期間（㋭ ㋑と㋩、㋬ ㋺と㋥）。年数は切り捨て。
 *   ⑨（④に通算された前の退職手当等）は、Q では他の退職手当等との結び付きがわからないので、本人が書く
 * ・E 欄（B・C 欄の退職手当等）：区分、支払を受けることとなった年月日、収入金額、源泉徴収税額、特別徴収税額、支払者の所在地・名称、老齢給付金
 */
import {
  ceilYears, floorYears, intersectRanges, mergeRanges, rangeOf, rangesLabel, RETIREMENT_KIND_LABELS, subtractRanges, type Range,
  type RetirementKind, type RetirementRecord, type RetirementResult,
} from "./retirementIncome";

/** 期間の欄（null は「無」） */
export interface DeclPeriod {
  /** 「令和1年4月1日～令和6年3月31日」（いくつかに分かれていれば「・」でつなぐ） */
  label: string;
  /** 年数（null は書かない） */
  years: number | null;
}

export interface DeclERow {
  /** B：本年中に支払を受けた他の退職手当等、C：前年以前の退職手当等 */
  section: "B" | "C";
  kind: RetirementKind;
  paidOn: string;
  amount: number;
  incomeTax: number | null;
  cityTax: number | null;
  prefTax: number | null;
  payer: string;
  payerAddress: string;
  /** 確定拠出年金の老齢給付金の一時金 */
  dc: boolean;
}

export interface RetirementDeclaration {
  year: number;
  /** ① 退職手当等の支払を受けることとなった年月日 */
  fixedDate: string;
  /** ② 障害者になったことに直接基因して退職した */
  disability: boolean;
  /** ③ 勤続期間と内書き */
  a: { service: DeclPeriod | null; officer: DeclPeriod | null; officerGeneral: DeclPeriod | null; officerShort: DeclPeriod | null; short: DeclPeriod | null };
  /** ④⑤（その年に他の退職手当等がなければ null） */
  b: {
    other: DeclPeriod | null; otherOfficer: DeclPeriod | null; otherShort: DeclPeriod | null;
    total: DeclPeriod | null; officer: DeclPeriod | null; officerGeneral: DeclPeriod | null; officerShort: DeclPeriod | null; full: DeclPeriod | null;
    short: DeclPeriod | null; shortGeneral: DeclPeriod | null;
  } | null;
  /** ⑥⑦（前年以前の退職手当等と重なる分がなければ null） */
  c: { prior: DeclPeriod | null; overlap: DeclPeriod | null; officer: DeclPeriod | null; short: DeclPeriod | null } | null;
  /** ⑧⑩⑪（通算した前の退職手当等がなければ null） */
  d: {
    included: DeclPeriod | null; includedOfficer: DeclPeriod | null; includedShort: DeclPeriod | null;
    only: DeclPeriod | null; onlyOfficer: DeclPeriod | null; onlyShort: DeclPeriod | null;
    total: DeclPeriod | null; totalOfficer: DeclPeriod | null; totalShort: DeclPeriod | null;
  } | null;
  e: DeclERow[];
  notes: string[];
}

/** 期間の欄にする（期間がなければ null。年数は1年未満の端数を切り上げるか切り捨てる） */
const periodOf = (ranges: Range[], round: "ceil" | "floor" | "none"): DeclPeriod | null => {
  const list = mergeRanges(ranges);
  if (!list.length) return null;
  return { label: rangesLabel(list), years: round === "ceil" ? ceilYears(list) : round === "floor" ? floorYears(list) : null };
};

/**
 * 申告書の下書きを作る
 * @param result calcRetirement の結果（前年以前の退職手当等と重なる分・区分ごとの期間を使う）
 */
export const retirementDeclarationOf = (r: RetirementRecord, result: RetirementResult): RetirementDeclaration => {
  const inp = r.input;
  const notes: string[] = [];
  const own = inp.parts.length ? mergeRanges(inp.parts.flatMap((p) => rangeOf(p.from, p.to))) : rangeOf(inp.serviceFrom, inp.serviceTo);
  const ownKind = (k: RetirementKind): Range[] =>
    inp.parts.length ? mergeRanges(inp.parts.filter((p) => p.kind === k && p.amount > 0).flatMap((p) => rangeOf(p.from, p.to)))
    : result.kind === k ? own : [];
  const others = inp.declared ? inp.others : [];
  const otherKind = (k: RetirementKind): Range[] => mergeRanges(others.filter((o) => o.kind === k).flatMap((o) => rangeOf(o.from, o.to)));

  // A 欄
  const aOfficer = ownKind("officer");
  const aShort = ownKind("short");
  const aGeneral = ownKind("general");
  const a = {
    service: own.length ? { label: rangesLabel(own), years: result.period ? result.period.counted : ceilYears(own) } : null,
    officer: periodOf(aOfficer, "ceil"),
    officerGeneral: periodOf(intersectRanges(aOfficer, aGeneral), "ceil"),
    officerShort: periodOf(intersectRanges(aOfficer, aShort), "ceil"),
    short: periodOf(aShort, "ceil"),
  };
  if (inp.yearsOverride !== null) notes.push(`③の年数は、手で決めた勤続年数（${inp.yearsOverride}年）ではなく、期間から数えた年数です。勤続期間を直して書いてください。`);

  // B 欄（重複には全重複を含めない）
  let b: RetirementDeclaration["b"] = null;
  if (others.length) {
    const otherAll = mergeRanges(others.flatMap((o) => rangeOf(o.from, o.to)));
    const tOfficer = mergeRanges([...aOfficer, ...otherKind("officer")]);
    const tShort = mergeRanges([...aShort, ...otherKind("short")]);
    const tGeneral = mergeRanges([...aGeneral, ...otherKind("general")]);
    const full = intersectRanges(intersectRanges(tOfficer, tShort), tGeneral);
    b = {
      other: periodOf(otherAll, "ceil"), otherOfficer: periodOf(otherKind("officer"), "ceil"), otherShort: periodOf(otherKind("short"), "ceil"),
      total: periodOf([...own, ...otherAll], "ceil"),
      officer: periodOf(tOfficer, "ceil"),
      officerGeneral: periodOf(subtractRanges(intersectRanges(tOfficer, tGeneral), full), "ceil"),
      officerShort: periodOf(subtractRanges(intersectRanges(tOfficer, tShort), full), "ceil"),
      full: periodOf(full, "ceil"),
      short: periodOf(tShort, "ceil"),
      shortGeneral: periodOf(subtractRanges(intersectRanges(tShort, tGeneral), full), "ceil"),
    };
    if (others.some((o) => !rangeOf(o.from, o.to).length)) notes.push("勤続期間を入れていない他の退職手当等があるので、④⑤の期間は本人が書いてください。");
  }

  // C 欄・D 欄（Q が計算した重なり。控除額を手で決めたときは書かない）
  const overlapRow = result.overlaps.find((x) => x.type === "overlap");
  const includedRow = result.overlaps.find((x) => x.type === "included");
  const cutOf = (kind: "officer" | "short", type: "included" | "overlap") => result.mixedCuts.find((x) => x.kind === kind && x.type === type) ?? null;
  const cutPeriod = (c: { period: string; years: number } | null): DeclPeriod | null => (c ? { label: c.period, years: c.years } : null);
  // ⑥：重なる期間を数える前年以前の退職手当等の勤続期間（収入金額がその退職所得控除額に満たないときは、短くした期間。裏の書き方6）
  const c: RetirementDeclaration["c"] = result.priorSpan.length
    ? {
      prior: periodOf(result.priorSpan, "none"),
      overlap: overlapRow ? { label: overlapRow.period, years: overlapRow.years } : null,
      officer: cutPeriod(cutOf("officer", "overlap")),
      short: cutPeriod(cutOf("short", "overlap")),
    }
    : null;
  const included = mergeRanges((inp.declared ? inp.priors : []).filter((p) => p.included).flatMap((p) => rangeOf(p.from, p.to)));
  let d: RetirementDeclaration["d"] = null;
  if (included.length) {
    const inOwn = intersectRanges(included, own);
    const only = intersectRanges(included, mergeRanges([...own, ...others.flatMap((o) => rangeOf(o.from, o.to))]));
    const onlyOfficer = cutOf("officer", "included");
    const onlyShort = cutOf("short", "included");
    const totalOf = (x: DeclPeriod | null, y: DeclPeriod | null, ranges: Range[]): DeclPeriod | null => (x || y ? periodOf(ranges, "floor") : null);
    const overlapRanges = result.overlapRanges;
    d = {
      included: periodOf(inOwn, "floor"),
      includedOfficer: periodOf(intersectRanges(inOwn, aOfficer), "floor"),
      includedShort: periodOf(intersectRanges(inOwn, aShort), "floor"),
      only: includedRow ? { label: includedRow.period, years: includedRow.years } : periodOf(only, "floor"),
      onlyOfficer: cutPeriod(onlyOfficer),
      onlyShort: cutPeriod(onlyShort),
      total: periodOf([...overlapRanges, ...only], "floor"),
      totalOfficer: totalOf(cutPeriod(cutOf("officer", "overlap")), cutPeriod(onlyOfficer), intersectRanges(mergeRanges([...overlapRanges, ...only]), aOfficer)),
      totalShort: totalOf(cutPeriod(cutOf("short", "overlap")), cutPeriod(onlyShort), intersectRanges(mergeRanges([...overlapRanges, ...only]), aShort)),
    };
  }

  // E 欄
  const e: DeclERow[] = [
    ...others.map((o) => ({
      section: "B" as const, kind: o.kind, paidOn: o.paidOn, amount: o.amount, incomeTax: o.incomeTax, cityTax: o.cityTax, prefTax: o.prefTax,
      payer: o.payer, payerAddress: o.payerAddress, dc: o.dc,
    })),
    ...(inp.declared ? inp.priors : []).filter((p) => !p.included).map((p) => ({
      section: "C" as const, kind: p.kind, paidOn: p.paidOn, amount: p.amount, incomeTax: p.incomeTax, cityTax: null, prefTax: null,
      payer: p.payer, payerAddress: p.payerAddress, dc: p.dc,
    })),
  ];
  if (e.some((x) => !x.paidOn)) notes.push("E 欄の「退職手当等の支払を受けることとなった年月日」が入っていない退職手当等があります（本人が書きます）。");
  if (others.length) notes.push("B 欄の退職手当等の源泉徴収票（特別徴収票）か、その写しを申告書に付けてもらいます（所得税法203条1項）。");
  if (result.kind !== "general" && !inp.parts.length) {
    notes.push(`この退職手当等は${RETIREMENT_KIND_LABELS[result.kind]}なので、③の内書きにその勤続期間を書いています。`);
  }
  return { year: Number(r.fixedDate.slice(0, 4)), fixedDate: r.fixedDate, disability: inp.disability, a, b, c, d, e, notes };
};
