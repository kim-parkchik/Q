/**
 * 従業員ファイル（Q → TimeQard）
 *
 * Q で書き出し、USB メモリなどで運んで TimeQard に読み込む（くわしくは timeqard/DESIGN.md の 5.3・付録 B）。
 * ・入れるもの：形式・会社名・会社の印・書き出した日時と、従業員ごとの スタッフID・名前・入社日・退職日・カードの確かめ用の値
 * ・入れないもの：給与・マイナンバー・住所・生年月日・電話・家族など
 * ・入れる人：書き出した日に在籍している人（退職日が空か、書き出した日から後）と、入社日がこれからの人
 */
import { isCardHash, isCompanyMark, sha256Hex } from "./codes";
import { isDateString, jstDate, parseIso } from "./time";

export const STAFF_FILE_FORMAT = "timeqard-staff";
export const STAFF_FILE_VERSION = 1;

export interface StaffFileEntry {
  id: string;
  name: string;
  joinDate: string | null;
  retirementDate: string | null;
  /** いま使えるカードの確かめ用の値（作り直す前のカードの値は入れない） */
  cardHashes: string[];
}

export interface StaffFile {
  format: typeof STAFF_FILE_FORMAT;
  version: number;
  companyName: string;
  companyMark: string;
  /** 書き出した日時（「2026-11-07T16:30:00+09:00」） */
  exportedAt: string;
  staff: StaffFileEntry[];
}

/** Q の従業員（書き出しに使う項目だけ） */
export interface StaffForExport {
  id: string | number;
  name: string;
  status?: string | null;
  join_date?: string | null;
  retirement_date?: string | null;
}

const dateOrNull = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return isDateString(v) ? v : null;
};

/**
 * 従業員ファイルに入れる人か。
 * 退職日が書き出した日から後（その日を含む）なら入れる（TimeQard は、退職日の次の日からは押させない）。
 * 退職日が空なら、在籍の状態が「退職」でなければ入れる（入社日がこれからの人も入れる。TimeQard は、入社日より前は押させない）。
 */
export const isInStaffFile = (s: StaffForExport, asOfDate: string) => {
  const retirement = dateOrNull(s.retirement_date);
  if (retirement) return retirement >= asOfDate;
  return (s.status ?? "active") !== "retired";
};

/** ID の並べ方（数字の部分は数として比べる：「2」は「10」より前） */
export const compareStaffId = (a: string, b: string) =>
  a.localeCompare(b, "ja", { numeric: true, sensitivity: "variant" });

/** 従業員ファイルの中身を作る */
export const buildStaffFile = (args: {
  companyName: string;
  companyMark: string;
  exportedAt: string;
  staff: StaffForExport[];
  /** スタッフID ごとの、いま使えるカードの確かめ用の値 */
  cardHashesByStaff: Map<string, string[]>;
}): StaffFile => {
  if (!isCompanyMark(args.companyMark)) throw new Error(`会社の印の形ではありません: ${args.companyMark}`);
  const exportedMs = parseIso(args.exportedAt);
  if (exportedMs === null) throw new Error(`書き出した日時の形ではありません: ${args.exportedAt}`);
  const asOf = jstDate(exportedMs);
  const staff = args.staff
    .filter((s) => isInStaffFile(s, asOf))
    .map<StaffFileEntry>((s) => ({
      id: String(s.id),
      name: (s.name ?? "").trim(),
      joinDate: dateOrNull(s.join_date),
      retirementDate: dateOrNull(s.retirement_date),
      cardHashes: [...(args.cardHashesByStaff.get(String(s.id)) ?? [])].sort(),
    }))
    .sort((a, b) => compareStaffId(a.id, b.id));
  return {
    format: STAFF_FILE_FORMAT,
    version: STAFF_FILE_VERSION,
    companyName: args.companyName.trim(),
    companyMark: args.companyMark,
    exportedAt: args.exportedAt,
    staff,
  };
};

/** 従業員ファイルの文字（JSON。人が開いても読めるように字下げする） */
export const serializeStaffFile = (file: StaffFile) => JSON.stringify(file, null, 2) + "\n";

/**
 * 中身の確かめ用の値（書き出した日時を除いた中身の SHA-256）。
 * Q は書き出したときの値を残しておき、そのあとに従業員・カードが変わったら「書き出し直してください」と知らせる。
 */
export const staffFileFingerprint = (file: StaffFile) =>
  sha256Hex(JSON.stringify({ companyName: file.companyName, companyMark: file.companyMark, staff: file.staff }));

/** ファイル名に使えない文字（\ / : * ? " < > |）を「_」にする */
export const safeFileNamePart = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "会社";

/** 従業員ファイルのファイル名（「○○株式会社_TimeQard従業員_2026-11-07.json」） */
export const staffFileName = (companyName: string, date: string) =>
  `${safeFileNamePart(companyName)}_TimeQard従業員_${date}.json`;

export type ParseStaffFileResult = { ok: true; file: StaffFile } | { ok: false; error: string };

/** 従業員ファイルを読む（形がおかしければ、わけを返す） */
export const parseStaffFile = (text: string): ParseStaffFileResult => {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "従業員ファイルとして読めませんでした（JSON の形ではありません）。Q で書き出したファイルを選んでください。" };
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || d.format !== STAFF_FILE_FORMAT) {
    return { ok: false, error: "TimeQard の従業員ファイルではありません。Q の「TimeQard（打刻）」の画面で書き出したファイルを選んでください。" };
  }
  if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 1) {
    return { ok: false, error: "従業員ファイルの形式の番号が読めません。" };
  }
  if (d.version > STAFF_FILE_VERSION) {
    return { ok: false, error: `新しい形式（${d.version}）の従業員ファイルです。TimeQard を新しくしてから読み込んでください。` };
  }
  if (typeof d.companyName !== "string" || d.companyName.trim() === "") {
    return { ok: false, error: "従業員ファイルに会社名がありません。" };
  }
  if (!isCompanyMark(d.companyMark)) {
    return { ok: false, error: "従業員ファイルの会社の印が読めません。" };
  }
  if (parseIso(d.exportedAt) === null) {
    return { ok: false, error: "従業員ファイルの書き出した日時が読めません。" };
  }
  if (!Array.isArray(d.staff)) {
    return { ok: false, error: "従業員ファイルに従業員の一覧がありません。" };
  }
  const staff: StaffFileEntry[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (d.staff as unknown[]).entries()) {
    const s = raw as Record<string, unknown>;
    const where = `${i + 1}人目`;
    if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.trim() === "") {
      return { ok: false, error: `従業員ファイルの${where}のスタッフID が読めません。` };
    }
    if (seen.has(s.id)) return { ok: false, error: `従業員ファイルに、同じスタッフID（${s.id}）が2つあります。` };
    seen.add(s.id);
    if (typeof s.name !== "string") return { ok: false, error: `従業員ファイルの${where}（ID ${s.id}）の名前が読めません。` };
    for (const key of ["joinDate", "retirementDate"] as const) {
      if (s[key] !== null && !isDateString(s[key])) {
        return { ok: false, error: `従業員ファイルの${where}（ID ${s.id}）の${key === "joinDate" ? "入社日" : "退職日"}が読めません。` };
      }
    }
    if (!Array.isArray(s.cardHashes) || !s.cardHashes.every(isCardHash)) {
      return { ok: false, error: `従業員ファイルの${where}（ID ${s.id}）のカードの値が読めません。` };
    }
    staff.push({
      id: s.id,
      name: s.name,
      joinDate: (s.joinDate as string | null) ?? null,
      retirementDate: (s.retirementDate as string | null) ?? null,
      cardHashes: [...(s.cardHashes as string[])],
    });
  }
  return {
    ok: true,
    file: {
      format: STAFF_FILE_FORMAT,
      version: d.version,
      companyName: d.companyName,
      companyMark: d.companyMark,
      exportedAt: d.exportedAt as string,
      staff,
    },
  };
};
