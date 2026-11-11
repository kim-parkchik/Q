/**
 * TimeQard の CSV（TimeQard → Q）と、CSV の読み方
 *
 * ・1人1日1行。Q のいまの取り込みの見出し（スタッフID・日付・出勤・退勤・休憩始・休憩終・外出・戻り）に、列を足す。
 *   Q は見出しの名前で列を探すので、列を足しても読める（くわしくは timeqard/DESIGN.md の 4.5・付録 A）。
 * ・名前・申し出の理由・注意などの文の中の、改行と「,」「"」は空白にする（前の Q の読み方でも崩れないように）。
 * ・読み方（parseCsv）は、引用符（"）でくくった値の中の「,」「""」・改行も正しく読む。
 */
import { PUNCH_KINDS, PUNCH_LABELS, punchKindOfLabel, type PunchKind } from "./kinds";

/** CSV の形の名前（「形式」の列）。形を変えたら番号を上げる（Q は、知っている番号までの CSV だけを取り込む） */
export const TIMEQARD_CSV_FORMAT_VERSION = 1;
export const TIMEQARD_CSV_FORMAT = `TimeQard ${TIMEQARD_CSV_FORMAT_VERSION}`;

/** 申し出の列の見出し（「申出_出勤」など） */
export const requestHeader = (kind: PunchKind) => `申出_${PUNCH_LABELS[kind]}`;

export const CSV_HEADERS = {
  staffId: "スタッフID",
  name: "名前",
  date: "日付",
  noBreakRequest: "申出_休憩なし",
  requestReason: "申出_理由",
  cardless: "カードなし",
  notes: "注意",
  companyMark: "会社の印",
  format: "形式",
} as const;

/** 列の順番（この順で書く） */
export const TIMEQARD_CSV_HEADERS: string[] = [
  CSV_HEADERS.staffId,
  CSV_HEADERS.name,
  CSV_HEADERS.date,
  ...PUNCH_KINDS.map((k) => PUNCH_LABELS[k]),
  ...PUNCH_KINDS.map(requestHeader),
  CSV_HEADERS.noBreakRequest,
  CSV_HEADERS.requestReason,
  CSV_HEADERS.cardless,
  CSV_HEADERS.notes,
  CSV_HEADERS.companyMark,
  CSV_HEADERS.format,
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
  /** 打刻の時刻（「08:58」。なければ ""） */
  times: Record<PunchKind, string>;
  /** 申し出た時刻（申し出がない種類は入れない） */
  requests: Partial<Record<PunchKind, string>>;
  /** 「休憩を取れなかった」の申し出がある（「申出_休憩なし」の列に「○」） */
  noBreakRequest: boolean;
  requestReason: string;
  /** ID で押した（カードなしの）打刻の種類 */
  cardless: PunchKind[];
  notes: string[];
  companyMark: string;
}

/** 文の中の改行・「,」・「"」を空白にする */
export const cleanCsvText = (s: string) => s.replace(/[\r\n,"]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** CSV の中身を作る（BOM は保存するときに付ける。行の終わりは CRLF） */
export const writeTimeQardCsv = (rows: TimeQardCsvRow[]): string => {
  const lines = [TIMEQARD_CSV_HEADERS.join(",")];
  for (const r of rows) {
    const cells = [
      r.staffId,
      r.name,
      r.date,
      ...PUNCH_KINDS.map((k) => r.times[k] ?? ""),
      ...PUNCH_KINDS.map((k) => r.requests[k] ?? ""),
      r.noBreakRequest ? NO_BREAK_MARK : "",
      r.requestReason,
      r.cardless.map((k) => PUNCH_LABELS[k]).join(" "),
      r.notes.join(NOTE_SEPARATOR),
      r.companyMark,
      TIMEQARD_CSV_FORMAT,
    ];
    lines.push(cells.map(cleanCsvText).join(","));
  }
  return lines.join("\r\n") + "\r\n";
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

/** 「カードなし」の列を読む（「出勤 退勤」→ entry・exit。知らない言葉は飛ばす） */
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
