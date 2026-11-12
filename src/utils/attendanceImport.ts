/**
 * 勤怠の CSV 取り込み（打刻の列に入れる）の確かめと、書き込む文
 * くわしくは timeqard/DESIGN.md の 5.5
 *
 * 取り込む前に、まとめを出して確かめてから入れる。
 * ・TimeQard の CSV（「会社の印」「形式」の列がある）は、会社の印がこの会社ファイルのものかを確かめ、違えば取り込まない。
 *   形式が Q の知らない新しいものなら取り込まない。印のない CSV（手で作ったもの・ほかのタイムカードのもの）は、いままでどおり取り込める。
 * ・Q の従業員にない ID の行は入れず、その ID を一覧で出す（Excel で先頭の 0 が消えた ID は、ほかに同じ数の ID がなければ直す）。
 * ・日付・時刻の形を確かめる（「2026/11/7」「8:58」などは直して入れ、直せないものは、その行を入れずに知らせる）。
 * ・確定した日は上書きしない（いままでと同じ）。
 * ・休憩は一覧で読む（「休憩」の列。「12:00-13:00 15:00-15:10」。shared/timeqard/spans.ts）。TimeQard でない CSV は、
 *   「休憩始」「休憩終」の列と、「外出」「戻り」の列（私用の外出・中抜けは休憩として入れる）も読む。
 * ・カードなしで押した打刻・注意・申し出を一覧で出す。申し出は、選んだものだけを修正の欄（手入力の欄）に入れ、備考に書き足す。
 *   休憩の申し出は、その日の休憩の一覧に足す（同じ時刻の休憩・重なる休憩は、申し出たものに置き換える）。
 *   「休憩を取れなかった」の申し出（「申出_休憩なし」の列）は、選ぶと、その日の「休憩なし」（決まった休憩を引かない。utils/fixedBreak.ts）にする。
 * ・書き込みは、1つのトランザクションでまとめてする（途中で止まって半分だけ入ることがないように）。
 */
import {
  companyMarkLabel,
  CSV_HEADERS,
  isCompanyMark,
  NO_BREAK_LABEL,
  NO_BREAK_SHORT,
  normalizeDate,
  normalizeTime,
  parseCardlessKinds,
  parseCsvRecords,
  parseFormatVersion,
  parseNoBreakRequest,
  parseNotes,
  parseSpanList,
  formatSpanList,
  PUNCH_LABELS,
  requestHeader,
  requestKindLabel,
  TIME_REQUEST_KINDS,
  TIMEQARD_CSV_FORMAT_VERSION,
  timeLabel,
  toHalfWidth,
  type PunchKind,
  type RequestKind,
  type TimeRequestKind,
  type TimeSpan,
} from "../../shared/timeqard";
import type { SqlStatement } from "./dbBatch";
import { applyBreakRequests, sameSpan, stringifyBreaks, type BreakSpan } from "./breaks";

/** Q の勤怠の、出勤・退勤の打刻の列（csv_…）と、修正の列（手入力）。休憩は一覧（csv_breaks・breaks。utils/breaks.ts） */
export const ATTENDANCE_COLUMNS: Record<TimeRequestKind, { csv: string; manual: string }> = {
  entry: { csv: "csv_entry_time", manual: "entry_time" },
  exit: { csv: "csv_exit_time", manual: "exit_time" },
};

export interface ImportStaff {
  id: string | number;
  name: string;
}

/** CSV の1行（取り込める形に直したもの） */
export interface ImportRow {
  rowNumber: number;
  staffId: string;
  name: string;
  date: string;
  /** 出勤・退勤（なければ ""） */
  times: Record<TimeRequestKind, string>;
  /** 休憩の一覧（始めか終わりの一方しかない休憩も入れる） */
  breaks: TimeSpan[];
  /** 申し出た出勤・退勤の時刻 */
  requests: Partial<Record<TimeRequestKind, string>>;
  /** 申し出た休憩 */
  requestBreaks: TimeSpan[];
  /** 「休憩を取れなかった」の申し出がある */
  noBreakRequest: boolean;
  requestReason: string;
  /** ID で押した（カードなしの）打刻の種類 */
  cardless: PunchKind[];
  /** ブラウザで押した打刻の種類（各自のパソコンで、スタッフID とパスワードでログインして押した） */
  web: PunchKind[];
  notes: string[];
}

export interface ReadImportResult {
  /** 取り込めないわけ（あれば、何も取り込まない） */
  error: string | null;
  /** TimeQard の CSV か */
  fromTimeQard: boolean;
  companyMark: string | null;
  /** CSV の行の数（見出しを除く） */
  totalRows: number;
  rows: ImportRow[];
  period: { from: string; to: string } | null;
  unknownIds: { id: string; rows: number }[];
  invalid: { rowNumber: number; reason: string }[];
  /** 同じ人・同じ日の行が2つ以上（後の行を使う） */
  duplicates: { staffId: string; date: string; rowNumbers: number[] }[];
  /** Excel で先頭の 0 が消えた ID などを、Q の ID に直したもの */
  fixedIds: { csvId: string; staffId: string }[];
  /** 形を直した日付・時刻の数（「8:58」→「08:58」など） */
  fixedValues: number;
}

const emptyTimes = (): Record<TimeRequestKind, string> => ({ entry: "", exit: "" });

/** TimeQard でない CSV の、休憩の組の列（「休憩始」「休憩終」と、私用の外出・中抜けの「外出」「戻り」） */
const PAIR_COLUMNS: [string, string][] = [
  ["休憩始", "休憩終"],
  ["外出", "戻り"],
];

/** CSV の ID を、Q の従業員の ID にする（同じ ID → 全角・空白を直して同じ → 数として同じ（ほかに同じ数の ID がないとき）） */
const makeIdResolver = (staff: ImportStaff[]) => {
  const ids = staff.map((s) => String(s.id));
  const exact = new Set(ids);
  const byClean = new Map<string, string[]>();
  const byNumber = new Map<string, string[]>();
  for (const id of ids) {
    const clean = toHalfWidth(id).trim();
    byClean.set(clean, [...(byClean.get(clean) ?? []), id]);
    if (/^\d+$/.test(clean)) {
      const n = String(BigInt(clean));
      byNumber.set(n, [...(byNumber.get(n) ?? []), id]);
    }
  }
  return (csvId: string): string | null => {
    if (exact.has(csvId)) return csvId;
    const clean = toHalfWidth(csvId).trim();
    const sameClean = byClean.get(clean);
    if (sameClean?.length === 1) return sameClean[0];
    if (/^\d+$/.test(clean)) {
      const sameNumber = byNumber.get(String(BigInt(clean)));
      if (sameNumber?.length === 1) return sameNumber[0];
    }
    return null;
  };
};

/**
 * CSV を読んで、取り込める行と、取り込めない行・わけに分ける（会社ファイルの勤怠はまだ見ない）。
 * @param companyMark この会社ファイルの会社の印（まだ作っていなければ null）
 */
export const readAttendanceImport = (text: string, args: { staff: ImportStaff[]; companyMark: string | null }): ReadImportResult => {
  const result: ReadImportResult = {
    error: null,
    fromTimeQard: false,
    companyMark: null,
    totalRows: 0,
    rows: [],
    period: null,
    unknownIds: [],
    invalid: [],
    duplicates: [],
    fixedIds: [],
    fixedValues: 0,
  };
  const { headers, records } = parseCsvRecords(text);
  result.totalRows = records.length;
  if (!headers.includes(CSV_HEADERS.staffId) || !headers.includes(CSV_HEADERS.date)) {
    result.error =
      "見出しの行に「スタッフID」と「日付」がありません。\n1行目が「スタッフID,日付,出勤,退勤,休憩」（休憩は「12:00-13:00 15:00-15:10」のように書く）や「スタッフID,日付,出勤,退勤,休憩始,休憩終」のような見出しの CSV を選んでください。";
    return result;
  }
  if (records.length === 0) {
    result.error = "取り込める行がありませんでした（見出しの行だけです）。";
    return result;
  }

  // --- TimeQard の CSV なら、形式と会社の印を確かめる ---
  result.fromTimeQard = headers.includes(CSV_HEADERS.format) && headers.includes(CSV_HEADERS.companyMark);
  const markRows = new Map<string, number>();
  const badMarkRows = new Set<number>();
  if (result.fromTimeQard) {
    let newest = 0;
    for (const r of records) {
      const version = parseFormatVersion(r.values[CSV_HEADERS.format]);
      if (version !== null) newest = Math.max(newest, version);
      const mark = (r.values[CSV_HEADERS.companyMark] ?? "").normalize("NFKC").trim().toUpperCase();
      if (isCompanyMark(mark)) markRows.set(mark, (markRows.get(mark) ?? 0) + 1);
      else badMarkRows.add(r.rowNumber);
    }
    if (newest > TIMEQARD_CSV_FORMAT_VERSION) {
      result.error = `新しい TimeQard で書き出した CSV です（形式 ${newest}）。Q を新しくしてから取り込んでください。`;
      return result;
    }
    // 休憩を1組しか書けなかった前の形（「休憩始」「外出」の列がある）は、休憩を落とさないように取り込まない
    if (!headers.includes(CSV_HEADERS.breaks) && (headers.includes("休憩始") || headers.includes("外出"))) {
      result.error = "前の形の TimeQard の CSV です（休憩が1組だけの形）。TimeQard を新しくして、CSV を書き出し直してください。";
      return result;
    }
    const marks = [...markRows.keys()];
    if (marks.length > 1) {
      result.error = `1つの CSV に、いくつかの会社の印があります（${marks.map(companyMarkLabel).join("・")}）。\nTimeQard で書き出し直してください。`;
      return result;
    }
    const mark = marks[0] ?? null;
    result.companyMark = mark;
    if (mark && args.companyMark === null) {
      result.error =
        `この会社ファイルからは、まだ TimeQard の従業員ファイルを書き出していません。\n` +
        `この CSV（会社の印 ${companyMarkLabel(mark)}）は、ほかの会社ファイルの打刻なので、取り込みませんでした。`;
      return result;
    }
    if (mark && mark !== args.companyMark) {
      result.error =
        `この CSV は、ほかの会社の打刻です（CSV の会社の印 ${companyMarkLabel(mark)}・この会社ファイルの印 ${companyMarkLabel(args.companyMark ?? "")}）。\n` +
        `取り込みませんでした。TimeQard で読み込んでいる従業員ファイルが、この会社ファイルのものか確かめてください。`;
      return result;
    }
  }

  // --- 1行ずつ確かめる ---
  const resolveId = makeIdResolver(args.staff);
  const names = new Map(args.staff.map((s) => [String(s.id), s.name]));
  const unknown = new Map<string, number>();
  const fixedIds = new Map<string, string>();
  const byDay = new Map<string, ImportRow[]>();
  for (const r of records) {
    const v = r.values;
    const csvId = (v[CSV_HEADERS.staffId] ?? "").trim();
    const rawDate = v[CSV_HEADERS.date] ?? "";
    if (csvId === "" || rawDate.trim() === "") {
      result.invalid.push({ rowNumber: r.rowNumber, reason: "スタッフID か日付が空です" });
      continue;
    }
    if (badMarkRows.has(r.rowNumber)) {
      result.invalid.push({ rowNumber: r.rowNumber, reason: "会社の印がありません" });
      continue;
    }
    const staffId = resolveId(csvId);
    if (staffId === null) {
      unknown.set(csvId, (unknown.get(csvId) ?? 0) + 1);
      continue;
    }
    if (staffId !== csvId) fixedIds.set(csvId, staffId);
    const date = normalizeDate(rawDate);
    if (date === null) {
      result.invalid.push({ rowNumber: r.rowNumber, reason: `日付が読めません（「${rawDate}」）` });
      continue;
    }
    let fixed = date !== rawDate.trim() ? 1 : 0;
    const times = emptyTimes();
    const requests: Partial<Record<TimeRequestKind, string>> = {};
    let badReason: string | null = null;
    for (const k of TIME_REQUEST_KINDS) {
      const raw = v[PUNCH_LABELS[k]] ?? "";
      const time = normalizeTime(raw);
      if (time === null) {
        badReason = `${PUNCH_LABELS[k]}の時刻が読めません（「${raw}」）`;
        break;
      }
      if (time !== "" && time !== raw.trim()) fixed++;
      times[k] = time;
      if (result.fromTimeQard) {
        const rawRequest = v[requestHeader(k)] ?? "";
        const requested = normalizeTime(rawRequest);
        if (requested === null) {
          badReason = `${requestHeader(k)}の時刻が読めません（「${rawRequest}」）`;
          break;
        }
        if (requested !== "") requests[k] = requested;
      }
    }
    // 休憩：「休憩」の列（一覧）。なければ「休憩始」「休憩終」・「外出」「戻り」の組
    let breaks: TimeSpan[] = [];
    let requestBreaks: TimeSpan[] = [];
    if (!badReason && headers.includes(CSV_HEADERS.breaks)) {
      const raw = v[CSV_HEADERS.breaks] ?? "";
      const read = parseSpanList(raw);
      if (read.bad.length > 0) badReason = `休憩の時刻が読めません（「${read.bad.join(" ")}」）`;
      breaks = read.spans;
      if (raw.trim() !== "" && formatSpanList(breaks) !== raw.trim()) fixed++;
    } else if (!badReason) {
      for (const [startCol, endCol] of PAIR_COLUMNS) {
        const s = normalizeTime(v[startCol] ?? "");
        const e = normalizeTime(v[endCol] ?? "");
        if (s === null || e === null) {
          badReason = `${s === null ? startCol : endCol}の時刻が読めません（「${s === null ? v[startCol] : v[endCol]}」）`;
          break;
        }
        if ((s && s !== (v[startCol] ?? "").trim()) || (e && e !== (v[endCol] ?? "").trim())) fixed++;
        if (s || e) breaks.push({ start: s, end: e });
      }
    }
    if (!badReason && result.fromTimeQard) {
      const read = parseSpanList(v[CSV_HEADERS.requestBreaks] ?? "");
      if (read.bad.length > 0) badReason = `${CSV_HEADERS.requestBreaks}の時刻が読めません（「${read.bad.join(" ")}」）`;
      requestBreaks = read.spans.filter((s) => s.start && s.end);
    }
    if (badReason) {
      result.invalid.push({ rowNumber: r.rowNumber, reason: badReason });
      continue;
    }
    result.fixedValues += fixed;
    const row: ImportRow = {
      rowNumber: r.rowNumber,
      staffId,
      name: names.get(staffId) ?? (v[CSV_HEADERS.name] ?? ""),
      date,
      times,
      breaks,
      requests,
      requestBreaks,
      noBreakRequest: result.fromTimeQard ? parseNoBreakRequest(v[CSV_HEADERS.noBreakRequest]) : false,
      requestReason: result.fromTimeQard ? (v[CSV_HEADERS.requestReason] ?? "") : "",
      cardless: result.fromTimeQard ? parseCardlessKinds(v[CSV_HEADERS.cardless]) : [],
      web: result.fromTimeQard ? parseCardlessKinds(v[CSV_HEADERS.web]) : [],
      notes: result.fromTimeQard ? parseNotes(v[CSV_HEADERS.notes]) : [],
    };
    const key = `${staffId}\u0000${date}`;
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  for (const list of byDay.values()) {
    const last = list[list.length - 1];
    result.rows.push(last);
    if (list.length > 1) {
      result.duplicates.push({ staffId: last.staffId, date: last.date, rowNumbers: list.map((x) => x.rowNumber) });
    }
  }
  result.rows.sort((a, b) => a.rowNumber - b.rowNumber);
  result.unknownIds = [...unknown].map(([id, rows]) => ({ id, rows }));
  result.fixedIds = [...fixedIds].map(([csvId, staffId]) => ({ csvId, staffId }));
  if (result.rows.length > 0) {
    const dates = result.rows.map((x) => x.date).sort();
    result.period = { from: dates[0], to: dates[dates.length - 1] };
  }
  return result;
};

/** 会社ファイルの、その日の勤怠（取り込み先） */
export interface ExistingDay {
  finalized: boolean;
  /** 修正の欄（手入力）の出勤・退勤 */
  manual: Record<TimeRequestKind, string>;
  /** 手入力した休憩の一覧（null なら打刻を使っている） */
  manualBreaks: BreakSpan[] | null;
  memo: string;
  /** その日は「休憩なし」にしてある */
  breakNone?: boolean;
}

export const dayKey = (staffId: string, date: string) => `${staffId}\u0000${date}`;

/** 申し出の種類の名前（「出勤」「休憩を取れなかった」。shared/timeqard の requestKindLabel） */
export const importRequestLabel = requestKindLabel;

/** 申し出（修正の欄・「休憩なし」に入れられるか） */
export interface ImportRequest {
  key: string;
  staffId: string;
  name: string;
  date: string;
  kind: RequestKind;
  /** 申し出た時刻（休憩は始め。「休憩を取れなかった」は ""） */
  time: string;
  /** 休憩の終わり（休憩だけ。ほかは ""） */
  endTime: string;
  reason: string;
  /** 修正の欄に入れられる（確定していない日で、その欄が空） */
  applicable: boolean;
  whyNot: string | null;
  /** 備考に書き足す文 */
  memoText: string;
  /** 休憩の申し出を足す元の一覧（取り込んだあとの、その日の休憩。手入力があれば手入力） */
  baseBreaks?: BreakSpan[];
}

export interface ImportPlan extends ReadImportResult {
  /** 打刻の列に入れる行（確定していない日） */
  toWrite: ImportRow[];
  /** 確定した日なので入れない行 */
  finalized: ImportRow[];
  requests: ImportRequest[];
}

/** 修正の欄が空か（Q は5文字（「08:58」）より短い値を時刻として読まない） */
const isBlankTime = (s: string | null | undefined) => (s ?? "").trim().length < 5;

/** 申出_理由の中の、休憩の申し出の名前（「休憩（12:00〜13:00）」。shared/timeqard の requestReasonText と同じ書き方） */
const breakReasonLabel = (s: TimeSpan) => `休憩（${timeLabel(s.start)}〜${timeLabel(s.end)}）`;

/**
 * 申出_理由の中から、その種類の理由を取り出す（「出勤：押し忘れた／退勤：押し間違えた」→ 退勤なら「押し間違えた」）
 * @param span 休憩の申し出のときの、休憩の時刻
 */
export const reasonForKind = (requestReason: string, kind: RequestKind, span?: TimeSpan) => {
  const label = kind === "no_break" ? NO_BREAK_SHORT : kind === "break" && span ? breakReasonLabel(span) : kind === "break" ? "休憩" : PUNCH_LABELS[kind];
  const item = requestReason
    .split("／")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${label}：`));
  return item ? item.slice(label.length + 1) : requestReason.trim();
};

/** 会社ファイルの勤怠と合わせて、入れる行・入れない行・申し出を決める */
export const planAttendanceImport = (read: ReadImportResult, existing: Map<string, ExistingDay>): ImportPlan => {
  const toWrite: ImportRow[] = [];
  const finalized: ImportRow[] = [];
  const requests: ImportRequest[] = [];
  for (const row of read.rows) {
    const day = existing.get(dayKey(row.staffId, row.date));
    if (day?.finalized) finalized.push(row);
    else toWrite.push(row);
    const base = (day?.manualBreaks ?? row.breaks) as BreakSpan[];
    const common = { staffId: row.staffId, name: row.name, date: row.date };
    for (const kind of TIME_REQUEST_KINDS) {
      const time = row.requests[kind];
      if (!time) continue;
      const reason = reasonForKind(row.requestReason, kind);
      const manual = day?.manual[kind] ?? "";
      let whyNot: string | null = null;
      if (day?.finalized) whyNot = "確定した日です";
      else if (!isBlankTime(manual)) whyNot = `修正の欄に、もう ${timeLabel(manual)} が入っています`;
      requests.push({
        ...common,
        key: `${dayKey(row.staffId, row.date)}\u0000${kind}`,
        kind,
        time,
        endTime: "",
        reason,
        applicable: whyNot === null,
        whyNot,
        memoText: `TimeQard の申し出：${PUNCH_LABELS[kind]} ${timeLabel(time)}${reason ? `（${reason}）` : ""}`,
      });
    }
    // 休憩：選ぶと、その日の休憩の一覧に足す（同じ時刻の休憩・重なる休憩は、申し出たものに置き換える）
    for (const span of row.requestBreaks) {
      const reason = reasonForKind(row.requestReason, "break", span);
      let whyNot: string | null = null;
      if (day?.finalized) whyNot = "確定した日です";
      else if (base.some((b) => sameSpan(b, span))) whyNot = "同じ休憩が、もう入っています";
      requests.push({
        ...common,
        key: `${dayKey(row.staffId, row.date)}\u0000break\u0000${span.start}\u0000${span.end}`,
        kind: "break",
        time: span.start,
        endTime: span.end,
        reason,
        applicable: whyNot === null,
        whyNot,
        memoText: `TimeQard の申し出：休憩 ${timeLabel(span.start)}〜${timeLabel(span.end)}${reason ? `（${reason}）` : ""}`,
        baseBreaks: base,
      });
    }
    // 「休憩を取れなかった」：選ぶと、その日の「休憩なし」にする（決まった休憩を引かない）
    if (row.noBreakRequest) {
      const reason = reasonForKind(row.requestReason, "no_break");
      let whyNot: string | null = null;
      if (day?.finalized) whyNot = "確定した日です";
      else if (day?.breakNone) whyNot = "もう「休憩なし」になっています";
      requests.push({
        ...common,
        key: `${dayKey(row.staffId, row.date)}\u0000no_break`,
        kind: "no_break",
        time: "",
        endTime: "",
        reason,
        applicable: whyNot === null,
        whyNot,
        memoText: `TimeQard の申し出：${reason || NO_BREAK_LABEL}`,
      });
    }
  }
  return { ...read, toWrite, finalized, requests };
};

const appendMemo = "memo = CASE WHEN memo IS NULL OR TRIM(memo) = '' THEN ? ELSE memo || '／' || ? END";

/**
 * 書き込む文。打刻の列（csv_…）は、確定していない日だけを入れ直す（いままでと同じ）。
 * 選んだ申し出は、確定していない日の、空の修正の欄に入れ、備考に書き足す（書き込むときにも、確定・空を確かめる）。
 * 休憩の申し出は、その日の休憩の一覧（手入力の一覧）に足す。
 */
export const importStatements = (plan: ImportPlan, selectedRequestKeys: Set<string>): SqlStatement[] => {
  const statements: SqlStatement[] = plan.toWrite.map((row) => ({
    sql: `INSERT INTO attendance (
        staff_id, work_date, csv_entry_time, csv_exit_time, csv_breaks, work_type, is_finalized
      ) VALUES (?, ?, ?, ?, ?, 'normal', 0)
      ON CONFLICT(staff_id, work_date) DO UPDATE SET
        csv_entry_time = excluded.csv_entry_time,
        csv_exit_time = excluded.csv_exit_time,
        csv_breaks = excluded.csv_breaks
      WHERE is_finalized = 0`,
    values: [row.staffId, row.date, row.times.entry, row.times.exit, row.breaks.length > 0 ? stringifyBreaks(row.breaks) : null],
  }));
  const breakRequests = new Map<string, ImportRequest[]>();
  for (const r of plan.requests) {
    if (!r.applicable || !selectedRequestKeys.has(r.key)) continue;
    if (r.kind === "no_break") {
      statements.push({
        sql: `UPDATE attendance SET break_none = 1, ${appendMemo}
          WHERE staff_id = ? AND work_date = ? AND is_finalized = 0 AND COALESCE(break_none, 0) = 0`,
        values: [r.memoText, r.memoText, r.staffId, r.date],
      });
      continue;
    }
    if (r.kind === "break") {
      const key = dayKey(r.staffId, r.date);
      breakRequests.set(key, [...(breakRequests.get(key) ?? []), r]);
      continue;
    }
    const col = ATTENDANCE_COLUMNS[r.kind].manual;
    statements.push({
      sql: `UPDATE attendance SET ${col} = ?, ${appendMemo}
        WHERE staff_id = ? AND work_date = ? AND is_finalized = 0 AND (${col} IS NULL OR LENGTH(TRIM(${col})) < 5)`,
      values: [r.time, r.memoText, r.memoText, r.staffId, r.date],
    });
  }
  for (const list of breakRequests.values()) {
    const first = list[0];
    const breaks = applyBreakRequests(first.baseBreaks ?? [], list.map((r) => ({ start: r.time, end: r.endTime })));
    const memo = list.map((r) => r.memoText).join("／");
    statements.push({
      sql: `UPDATE attendance SET breaks = ?, ${appendMemo}
        WHERE staff_id = ? AND work_date = ? AND is_finalized = 0`,
      values: [stringifyBreaks(breaks), memo, memo, first.staffId, first.date],
    });
  }
  return statements;
};

/**
 * CSV のファイルの中身を文字にする。UTF-8（BOM つき・なし）で読めなければ、Shift_JIS（Excel の「CSV（コンマ区切り）」で保存したもの）として読む
 */
export const decodeCsvBytes = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
};
