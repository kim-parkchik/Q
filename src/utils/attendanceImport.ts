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
 * ・カードなしで押した打刻・注意・申し出を一覧で出す。申し出は、選んだものだけを修正の欄（手入力の欄）に入れ、備考に書き足す。
 * ・書き込みは、1つのトランザクションでまとめてする（途中で止まって半分だけ入ることがないように）。
 */
import {
  companyMarkLabel,
  CSV_HEADERS,
  isCompanyMark,
  normalizeDate,
  normalizeTime,
  parseCardlessKinds,
  parseCsvRecords,
  parseFormatVersion,
  parseNotes,
  PUNCH_KINDS,
  PUNCH_LABELS,
  requestHeader,
  TIMEQARD_CSV_FORMAT_VERSION,
  timeLabel,
  toHalfWidth,
  type PunchKind,
} from "../../shared/timeqard";
import type { SqlStatement } from "./dbBatch";

/** Q の勤怠の、打刻の列（csv_…）と、修正の列（手入力） */
export const ATTENDANCE_COLUMNS: Record<PunchKind, { csv: string; manual: string }> = {
  entry: { csv: "csv_entry_time", manual: "entry_time" },
  exit: { csv: "csv_exit_time", manual: "exit_time" },
  break_start: { csv: "csv_break_start", manual: "break_start" },
  break_end: { csv: "csv_break_end", manual: "break_end" },
  out: { csv: "csv_out_time", manual: "out_time" },
  return: { csv: "csv_return_time", manual: "return_time" },
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
  times: Record<PunchKind, string>;
  requests: Partial<Record<PunchKind, string>>;
  requestReason: string;
  cardless: PunchKind[];
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

const emptyTimes = (): Record<PunchKind, string> => ({ entry: "", exit: "", break_start: "", break_end: "", out: "", return: "" });

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
      "見出しの行に「スタッフID」と「日付」がありません。\n1行目が「スタッフID,日付,出勤,退勤,休憩始,休憩終,外出,戻り」のような見出しの CSV を選んでください。";
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
    const requests: Partial<Record<PunchKind, string>> = {};
    let badReason: string | null = null;
    for (const k of PUNCH_KINDS) {
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
      requests,
      requestReason: result.fromTimeQard ? (v[CSV_HEADERS.requestReason] ?? "") : "",
      cardless: result.fromTimeQard ? parseCardlessKinds(v[CSV_HEADERS.cardless]) : [],
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
  /** 修正の欄（手入力）の値 */
  manual: Record<PunchKind, string>;
  memo: string;
}

export const dayKey = (staffId: string, date: string) => `${staffId}\u0000${date}`;

/** 申し出（修正の欄に入れられるか） */
export interface ImportRequest {
  key: string;
  staffId: string;
  name: string;
  date: string;
  kind: PunchKind;
  time: string;
  reason: string;
  /** 修正の欄に入れられる（確定していない日で、その欄が空） */
  applicable: boolean;
  whyNot: string | null;
  /** 備考に書き足す文 */
  memoText: string;
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

/** 申出_理由の中から、その種類の理由を取り出す（「出勤：押し忘れた／退勤：押し間違えた」→ 退勤なら「押し間違えた」） */
export const reasonForKind = (requestReason: string, kind: PunchKind) => {
  const label = PUNCH_LABELS[kind];
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
    for (const kind of PUNCH_KINDS) {
      const time = row.requests[kind];
      if (!time) continue;
      const reason = reasonForKind(row.requestReason, kind);
      const manual = day?.manual[kind] ?? "";
      let whyNot: string | null = null;
      if (day?.finalized) whyNot = "確定した日です";
      else if (!isBlankTime(manual)) whyNot = `修正の欄に、もう ${timeLabel(manual)} が入っています`;
      requests.push({
        key: `${dayKey(row.staffId, row.date)}\u0000${kind}`,
        staffId: row.staffId,
        name: row.name,
        date: row.date,
        kind,
        time,
        reason,
        applicable: whyNot === null,
        whyNot,
        memoText: `TimeQard の申し出：${PUNCH_LABELS[kind]} ${timeLabel(time)}${reason ? `（${reason}）` : ""}`,
      });
    }
  }
  return { ...read, toWrite, finalized, requests };
};

/**
 * 書き込む文。打刻の列（csv_…）は、確定していない日だけを入れ直す（いままでと同じ）。
 * 選んだ申し出は、確定していない日の、空の修正の欄に入れ、備考に書き足す（書き込むときにも、確定・空を確かめる）。
 */
export const importStatements = (plan: ImportPlan, selectedRequestKeys: Set<string>): SqlStatement[] => {
  const statements: SqlStatement[] = plan.toWrite.map((row) => ({
    sql: `INSERT INTO attendance (
        staff_id, work_date,
        csv_entry_time, csv_exit_time, csv_break_start, csv_break_end, csv_out_time, csv_return_time,
        work_type, is_finalized
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'normal', 0)
      ON CONFLICT(staff_id, work_date) DO UPDATE SET
        csv_entry_time = excluded.csv_entry_time,
        csv_exit_time = excluded.csv_exit_time,
        csv_break_start = excluded.csv_break_start,
        csv_break_end = excluded.csv_break_end,
        csv_out_time = excluded.csv_out_time,
        csv_return_time = excluded.csv_return_time
      WHERE is_finalized = 0`,
    values: [row.staffId, row.date, ...PUNCH_KINDS.map((k) => row.times[k])],
  }));
  for (const r of plan.requests) {
    if (!r.applicable || !selectedRequestKeys.has(r.key)) continue;
    const col = ATTENDANCE_COLUMNS[r.kind].manual;
    statements.push({
      sql: `UPDATE attendance SET
          ${col} = ?,
          memo = CASE WHEN memo IS NULL OR TRIM(memo) = '' THEN ? ELSE memo || '／' || ? END
        WHERE staff_id = ? AND work_date = ? AND is_finalized = 0 AND (${col} IS NULL OR LENGTH(TRIM(${col})) < 5)`,
      values: [r.time, r.memoText, r.memoText, r.staffId, r.date],
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
