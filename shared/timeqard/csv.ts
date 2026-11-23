/**
 * TimeQard の CSV（TimeQard → Q）と、CSV の読み方
 *
 * ・1人1日1行。出勤・退勤と、休憩の一覧（「12:00-13:00 15:00-15:10」。spans.ts）を書く（くわしくは timeqard/DESIGN.md の 4.5・付録 A）。
 *   Q は見出しの名前で列を探す。
 * ・名前・申し出の理由・注意などの文の中の、改行と「,」「"」は空白にする。
 * ・読み方（parseCsv）は、引用符（"）でくくった値の中の「,」「""」・改行も正しく読む。
 * ・1行ずつに、書き換えに気づくための「確かめ」の印を付ける（下の「確かめの印」）。
 */
import { checkMac, importCheckKey, isExportId, newExportId } from "./codes";
import { BREAK_LABEL, PUNCH_KINDS, PUNCH_LABELS, punchKindOfLabel, TIME_REQUEST_KINDS, type PunchKind, type TimeRequestKind } from "./kinds";
import { normalizeDate, normalizeTime } from "./normalize";
import { formatSpanList, parseSpanList, type TimeSpan } from "./spans";

/**
 * CSV の形の名前（「形式」の列）。形を変えたら番号を上げる（Q は、この番号の CSV だけを取り込む）
 * ・2：「確かめ」の列（確かめの印）を足した
 */
export const TIMEQARD_CSV_FORMAT_VERSION = 2;
export const TIMEQARD_CSV_FORMAT = `TimeQard ${TIMEQARD_CSV_FORMAT_VERSION}`;

/** 申し出の列の見出し（「申出_出勤」「申出_退勤」） */
export const requestHeader = (kind: TimeRequestKind) => `申出_${PUNCH_LABELS[kind]}`;

export const CSV_HEADERS = {
  staffId: "スタッフID",
  name: "名前",
  date: "日付",
  entry: PUNCH_LABELS.entry,
  exit: PUNCH_LABELS.exit,
  /** 休憩の一覧（「12:00-13:00 15:00-15:10」） */
  breaks: BREAK_LABEL,
  /** 申し出た休憩の一覧 */
  requestBreaks: `申出_${BREAK_LABEL}`,
  noBreakRequest: "申出_休憩なし",
  requestReason: "申出_理由",
  cardless: "カードなし",
  web: "ブラウザ",
  notes: "注意",
  companyMark: "会社の印",
  format: "形式",
  /** 確かめの印（「書き出しの番号-行の番号-行の数-印」。下の「確かめの印」） */
  check: "確かめ",
} as const;

/** 列の順番（この順で書く） */
export const TIMEQARD_CSV_HEADERS: string[] = [
  CSV_HEADERS.staffId,
  CSV_HEADERS.name,
  CSV_HEADERS.date,
  CSV_HEADERS.entry,
  CSV_HEADERS.exit,
  CSV_HEADERS.breaks,
  ...TIME_REQUEST_KINDS.map(requestHeader),
  CSV_HEADERS.requestBreaks,
  CSV_HEADERS.noBreakRequest,
  CSV_HEADERS.requestReason,
  CSV_HEADERS.cardless,
  CSV_HEADERS.web,
  CSV_HEADERS.notes,
  CSV_HEADERS.companyMark,
  CSV_HEADERS.format,
  CSV_HEADERS.check,
];

/** 注意が2つ以上あるときの区切り */
export const NOTE_SEPARATOR = "／";

/** 「申出_休憩なし」の列に書く印 */
export const NO_BREAK_MARK = "○";

/** 「申出_休憩なし」の列を読む（何か入っていれば申し出あり。列がない CSV は、申し出なし） */
export const parseNoBreakRequest = (s: string | undefined) => (s ?? "").trim() !== "";

/** CSV の1行（1人1日） */
export interface TimeQardCsvRow {
  staffId: string;
  name: string;
  date: string;
  /** 出勤・退勤の時刻（「08:58」。なければ ""） */
  times: Record<TimeRequestKind, string>;
  /** 休憩（始めか終わりの一方しかない休憩も入れる） */
  breaks: TimeSpan[];
  /** 申し出た出勤・退勤の時刻（申し出がない種類は入れない） */
  requests: Partial<Record<TimeRequestKind, string>>;
  /** 申し出た休憩 */
  requestBreaks: TimeSpan[];
  /** 「休憩を取れなかった」の申し出がある（「申出_休憩なし」の列に「○」） */
  noBreakRequest: boolean;
  requestReason: string;
  /** ID で押した（カードなしの）打刻の種類 */
  cardless: PunchKind[];
  /** ブラウザで押した打刻の種類 */
  web: PunchKind[];
  notes: string[];
  companyMark: string;
}

/** 文の中の改行・「,」・「"」を空白にする */
export const cleanCsvText = (s: string) => s.replace(/[\r\n,"]+/g, " ").replace(/\s{2,}/g, " ").trim();

/**
 * CSV の中身を作る（BOM は保存するときに付ける。行の終わりは CRLF）。
 * 1行ずつに、鍵（Q から従業員ファイルで受け取ったもの）で計算した確かめの印を付ける。
 * @param sign.exportId 書き出しの番号（ふつうは書き出すたびに作る。テストでは決まった値を渡す）
 */
export const writeTimeQardCsv = async (rows: TimeQardCsvRow[], sign: { key: string; exportId?: string }): Promise<string> => {
  const key = await importCheckKey(sign.key);
  const exportId = sign.exportId ?? newExportId();
  if (!isExportId(exportId)) throw new Error(`書き出しの番号の形ではありません: ${exportId}`);
  const lines = [TIMEQARD_CSV_HEADERS.join(",")];
  for (const [i, r] of rows.entries()) {
    const cells = [
      r.staffId,
      r.name,
      r.date,
      r.times.entry ?? "",
      r.times.exit ?? "",
      formatSpanList(r.breaks),
      ...TIME_REQUEST_KINDS.map((k) => r.requests[k] ?? ""),
      formatSpanList(r.requestBreaks),
      r.noBreakRequest ? NO_BREAK_MARK : "",
      r.requestReason,
      r.cardless.map((k) => PUNCH_LABELS[k]).join(" "),
      r.web.map((k) => PUNCH_LABELS[k]).join(" "),
      r.notes.join(NOTE_SEPARATOR),
      r.companyMark,
      TIMEQARD_CSV_FORMAT,
    ].map(cleanCsvText);
    // 印は、書いたとおりの値（Q が読む値）で計算する
    const values: Record<string, string> = Object.fromEntries(cells.map((c, idx) => [TIMEQARD_CSV_HEADERS[idx], c]));
    const position = { exportId, seq: i + 1, total: rows.length };
    const mac = await checkMac(key, checkText(values, cells[0], position));
    lines.push([...cells, formatCheck({ ...position, mac })].join(","));
  }
  return lines.join("\r\n") + "\r\n";
};

// --- 確かめの印 -----------------------------------------------------------------------------------
//
// TimeQard で書き出したあとに、CSV を Excel などで書き換えたこと（時刻を変えた・行を消した・足した・写した）に、Q が気づくための印。
// ・Q が会社ファイルごとに作った鍵（codes.ts の newCsvKey）を、従業員ファイルで TimeQard に渡す。TimeQard は1行ずつに、
//   その鍵で計算した印（HMAC-SHA256。codes.ts の checkMac）を「確かめ」の列に書き、Q は取り込む前に同じ計算をして比べる。
// ・印は、Q が取り込みに使う値を、Q と同じ読み方で読んだ形で計算する（checkText）。Excel で保存し直して、日付が「2026/11/4」、
//   時刻が「8:58」、ID の先頭の 0 が消えても、中身が同じなら合う。名前は計算に入れない（Q は CSV の名前を使わない。
//   Excel が Shift_JIS で保存し直すと、名前の字が化けることがあるため）。
// ・「確かめ」の列は「書き出しの番号-行の番号-行の数-印」（例「H4KD2QXA-1-31-…（26文字）」）。書き出しの番号・行の番号・行の数も
//   計算に入れるので、行を消すと行の番号が欠け、写した行は同じ行の番号が2つになり、ほかの書き出しの行をまぜると書き出しの番号が違う。
// ・鍵を知っている人が、わざと印を作り直すことまでは防げない（従業員ファイル・会社ファイル・TimeQard の記録に鍵が入るため）。

/** 印の計算に入れる文の初め（形を変えたら番号を上げる） */
const CHECK_TEXT_FORMAT = "TimeQard check 1";

/** 確かめの印の位置（書き出しの番号・行の番号（1から）・その書き出しの行の数） */
export interface CheckPosition {
  exportId: string;
  seq: number;
  total: number;
}

/**
 * 印の計算に入れる文（行の中身を、Q が取り込みに使う形に読んで並べたもの）
 * @param values 見出しの名前で引ける値（CSV に書いた値・CSV から読んだ値）
 * @param staffId スタッフID（Q は、Excel で先頭の 0 が消えた ID を直してから計算する）
 */
export const checkText = (values: Record<string, string>, staffId: string, position: CheckPosition): string => {
  const v = (header: string) => (values[header] ?? "").trim();
  const time = (header: string) => normalizeTime(v(header)) ?? v(header);
  const spans = (header: string) => {
    const read = parseSpanList(v(header));
    return read.bad.length > 0 ? v(header) : formatSpanList(read.spans);
  };
  const kinds = (header: string) => parseCardlessKinds(v(header)).map((k) => PUNCH_LABELS[k]).join(" ");
  return JSON.stringify([
    CHECK_TEXT_FORMAT,
    v(CSV_HEADERS.companyMark).normalize("NFKC").toUpperCase(),
    position.exportId,
    position.seq,
    position.total,
    staffId,
    normalizeDate(v(CSV_HEADERS.date)) ?? v(CSV_HEADERS.date),
    ...TIME_REQUEST_KINDS.map((k) => time(PUNCH_LABELS[k])),
    spans(CSV_HEADERS.breaks),
    ...TIME_REQUEST_KINDS.map((k) => time(requestHeader(k))),
    spans(CSV_HEADERS.requestBreaks),
    parseNoBreakRequest(v(CSV_HEADERS.noBreakRequest)) ? NO_BREAK_MARK : "",
    v(CSV_HEADERS.requestReason),
    kinds(CSV_HEADERS.cardless),
    kinds(CSV_HEADERS.web),
    parseNotes(v(CSV_HEADERS.notes)).join(NOTE_SEPARATOR),
  ]);
};

/** 「確かめ」の列の値（「書き出しの番号-行の番号-行の数-印」） */
export const formatCheck = (c: CheckPosition & { mac: string }) => `${c.exportId}-${c.seq}-${c.total}-${c.mac}`;

/** 「確かめ」の列を読む（形が違えば null） */
export const parseCheck = (s: string | undefined): (CheckPosition & { mac: string }) | null => {
  const m = /^([A-Z2-7]{8})-(\d{1,7})-(\d{1,7})-([A-Z2-7]{26})$/.exec((s ?? "").normalize("NFKC").trim().toUpperCase());
  if (!m) return null;
  const seq = Number(m[2]);
  const total = Number(m[3]);
  if (seq < 1 || seq > total) return null;
  return { exportId: m[1], seq, total, mac: m[4] };
};

/** 確かめの印を確かめた結果（行の番号は、見出しを1行目として数える） */
export interface CsvCheckResult {
  /** 印が合った行の数 */
  checkedRows: number;
  /** 中身が、書き出したときと違う行（印が合わない） */
  changedRows: number[];
  /** 確かめの印がない・読めない行（あとから足した行など） */
  noCheckRows: number[];
  /** 同じ行（書き出しの番号と行の番号が同じで、印が合う）の2つ目から（写した行） */
  copiedRows: number[];
  /** 書き出したときより足りない行の数（消した行） */
  missingRows: number;
  /** いくつかの書き出しの行がまじっている */
  mixed: boolean;
}

/** 書き換えたところがあるか */
export const csvCheckProblem = (c: CsvCheckResult) =>
  c.changedRows.length > 0 || c.noCheckRows.length > 0 || c.copiedRows.length > 0 || c.missingRows > 0 || c.mixed;

/**
 * CSV の行の確かめの印を確かめる（Q が取り込む前に使う）
 * @param staffIds 行のスタッフID の候補（CSV のままの ID と、Q の従業員の ID に直したもの。どれかで合えばよい）
 */
export const verifyCsvChecks = async (records: CsvRecord[], keyText: string, staffIds: (r: CsvRecord) => string[]): Promise<CsvCheckResult> => {
  const key = await importCheckKey(keyText);
  const result: CsvCheckResult = { checkedRows: 0, changedRows: [], noCheckRows: [], copiedRows: [], missingRows: 0, mixed: false };
  const groupOf = (c: CheckPosition) => `${c.exportId}-${c.total}`;
  /** 書き出しごとの、印が合った行の番号 */
  const checked = new Map<string, Set<number>>();
  /** 書き出しごとの、ある行の番号（印が合わない行も、あるものとして数える。書き換えた行を、消した行として数えないため） */
  const present = new Map<string, Set<number>>();
  const totals = new Map<string, number>();
  for (const r of records) {
    const check = parseCheck(r.values[CSV_HEADERS.check]);
    if (!check) {
      result.noCheckRows.push(r.rowNumber);
      continue;
    }
    let ok = false;
    for (const id of new Set(staffIds(r).filter((x) => x !== ""))) {
      if ((await checkMac(key, checkText(r.values, id, check))) === check.mac) {
        ok = true;
        break;
      }
    }
    const group = groupOf(check);
    totals.set(group, check.total);
    present.set(group, (present.get(group) ?? new Set<number>()).add(check.seq));
    if (!ok) {
      result.changedRows.push(r.rowNumber);
      continue;
    }
    const seqs = checked.get(group) ?? new Set<number>();
    if (seqs.has(check.seq)) {
      result.copiedRows.push(r.rowNumber);
      continue;
    }
    checked.set(group, seqs.add(check.seq));
    result.checkedRows++;
  }
  // 足りない行は、印が合った行のある書き出しだけで数える（印が合わない行の書き出しの番号・行の数は、書き換えたものかもしれない）
  for (const group of checked.keys()) result.missingRows += (totals.get(group) ?? 0) - (present.get(group)?.size ?? 0);
  result.mixed = checked.size > 1;
  return result;
};

/**
 * CSV を、行と値に分ける（RFC 4180）。
 * 引用符でくくった値の中の「,」・改行と、「""」（引用符そのもの）を読む。先頭の BOM は取る。行の終わりは CRLF・LF・CR のどれでもよい。
 */
export const parseCsv = (text: string): string[][] => {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false; // いまの値が引用符で始まったか（空の値と、引用符でくくった空の値 "" を分ける）
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      quotedField = false;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = false;
      if (c === "\r" && s[i + 1] === "\n") i++;
    } else {
      field += c;
    }
  }
  if (field !== "" || quotedField || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

/** 見出しの名前で値を引ける行（rowNumber は、見出しを1行目として数えた行の番号） */
export interface CsvRecord {
  rowNumber: number;
  values: Record<string, string>;
}

/** 1行目を見出しとして読み、値を見出しの名前で引けるようにする（値の前後の空白は取る。空の行は飛ばす） */
export const parseCsvRecords = (text: string): { headers: string[]; records: CsvRecord[] } => {
  const table = parseCsv(text);
  const firstIndex = table.findIndex((r) => r.some((v) => v.trim() !== ""));
  if (firstIndex < 0) return { headers: [], records: [] };
  const headers = table[firstIndex].map((h) => h.trim());
  const records: CsvRecord[] = [];
  for (let i = firstIndex + 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells.some((v) => v.trim() !== "")) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h !== "" && !(h in values)) values[h] = (cells[idx] ?? "").trim();
    });
    records.push({ rowNumber: i + 1, values });
  }
  return { headers, records };
};

/** 「形式」の列を読む（「TimeQard 1」→ 1。TimeQard の形でなければ null） */
export const parseFormatVersion = (s: string | undefined): number | null => {
  const m = (s ?? "").normalize("NFKC").trim().match(/^TimeQard\s*(\d+)$/i);
  return m ? Number(m[1]) : null;
};

/** 「カードなし」「ブラウザ」の列を読む（「出勤 退勤」→ entry・exit。知らない言葉は飛ばす） */
export const parseCardlessKinds = (s: string | undefined): PunchKind[] => {
  const kinds = (s ?? "")
    .normalize("NFKC")
    .split(/[\s、,]+/)
    .map(punchKindOfLabel)
    .filter((k): k is PunchKind => k !== null);
  return PUNCH_KINDS.filter((k) => kinds.includes(k));
};

/** 「注意」の列を読む（「／」で区切る） */
export const parseNotes = (s: string | undefined): string[] =>
  (s ?? "")
    .split(NOTE_SEPARATOR)
    .map((x) => x.trim())
    .filter((x) => x !== "");
