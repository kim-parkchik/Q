/**
 * 外国人の方の在留資格の情報（従業員ごと。staff.foreign_info の JSON。外国人の方でなければ空）
 *
 * 在留カードで確かめて入れる（在留カードを持たない人は、旅券・在留資格証明書など）。次の書類は、どれもここの値を使う。
 * ・雇用保険の資格取得届・資格喪失届・転勤届・個人番号登録届（外国人雇用状況の届出を兼ねる。utils/koyoReport.ts）
 * ・外国人雇用状況届出書（雇用保険に入らない人。utils/gaikokujinReport.ts）
 * ・厚生年金保険被保険者ローマ字氏名届（utils/shahoOtherForms.ts）・労働者死傷病報告（utils/rousaiForms.ts）
 * 在留カードの画像は持たない（写しを残すことは法律で決まっていない。厚生労働省「外国人雇用状況の届出 Q&A」問7：
 * 届出に在留カードなどの写しは出さず、事業主が在留カードなどで確かめて届け出る）。代わりに、在留カードを確かめた日を残す。
 * 在留資格（「外交」「公用」）と特別永住者は、外国人雇用状況の届出の対象ではない。
 */
import dayjs from "dayjs";
import { KOYO_NATIONALITIES, KOYO_RESIDENCE_STATUSES } from "../constants/koyoTodoke";

export interface ForeignInfo {
  /** 氏名（ローマ字。在留カードのとおり） */
  romaji: string;
  /** 国籍・地域（雇用保険の届書の仕様書 参考資料３の名前。在留カードの国籍・地域） */
  nationality: string;
  /** 在留資格のコード（同 参考資料４） */
  status: string;
  /** 在留資格がコード「30」（不明）のときの在留資格か理由（20字まで） */
  statusText: string;
  /** 在留期間（満了日。YYYY-MM-DD） */
  periodEnd: string;
  /** 資格外活動許可の有無 */
  permission: "" | "有" | "無";
  /** 在留カード番号（英字2・数字8・英字2の12字） */
  card: string;
  /** 派遣・請負就労区分（派遣・請負で、主としてほかの事業所で働く） */
  dispatch: "" | "該当" | "非該当";
  /** 在留カードを確かめた日（YYYY-MM-DD） */
  checkedOn: string;
}

export const emptyForeignInfo = (): ForeignInfo => ({
  romaji: "", nationality: "", status: "", statusText: "", periodEnd: "", permission: "", card: "", dispatch: "", checkedOn: "",
});

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const date = (v: unknown): string => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** 値（JSON の字か、読んだもの）を読む。外国人の方でなければ（空・壊れている）null */
export const parseForeignInfo = (json: unknown): ForeignInfo | null => {
  let f: any = null;
  try {
    f = typeof json === "string" && json.trim() ? JSON.parse(json) : json && typeof json === "object" ? json : null;
  } catch {
    f = null;
  }
  if (!f || typeof f !== "object") return null;
  return {
    romaji: str(f.romaji), nationality: str(f.nationality), status: str(f.status), statusText: str(f.statusText),
    periodEnd: date(f.periodEnd), permission: pick(f.permission, ["", "有", "無"] as const, ""), card: str(f.card),
    dispatch: pick(f.dispatch, ["", "該当", "非該当"] as const, ""), checkedOn: date(f.checkedOn),
  };
};

/** staff.foreign_info に書く（外国人の方でなければ null） */
export const stringifyForeignInfo = (f: ForeignInfo | null): string | null => (f ? JSON.stringify(f) : null);

/** 従業員の在留資格の情報（外国人の方でなければ null） */
export const foreignOf = (staff: any): ForeignInfo | null => parseForeignInfo(staff?.foreign_info);

/** 選べる国籍・地域（[名前, コード]）と在留資格 */
export const NATIONALITY_OPTIONS = KOYO_NATIONALITIES;
export const RESIDENCE_STATUS_OPTIONS = KOYO_RESIDENCE_STATUSES;

/** 国籍・地域のコード（参考資料３。なければ空） */
export const nationalityCodeOf = (name: string): string => KOYO_NATIONALITIES.find(([n]) => n === name)?.[1] ?? "";

/** 在留資格（コード → 雇用保険の届書のファイルに書く値。不明（30）は入れた在留資格か理由） */
export const residenceStatusOf = (foreign: ForeignInfo): { code: string; csv: string; name: string } | null => {
  const s = KOYO_RESIDENCE_STATUSES.find((x) => x.code === foreign.status);
  if (!s) return null;
  return { code: s.code, csv: s.free ? [...foreign.statusText.trim()].slice(0, 20).join("") : s.csv, name: s.free ? foreign.statusText.trim() : s.name };
};

/** 在留期間の満了日を知らせはじめる日数（満了日まで3か月を切った人を知らせる） */
export const RESIDENCE_ALERT_MONTHS = 3;

/** 在留期間の満了日の知らせ（過ぎた・近い。満了日がなければ null） */
export const residencePeriodAlert = (f: ForeignInfo | null, today: string): { state: "expired" | "soon"; periodEnd: string; days: number } | null => {
  if (!f?.periodEnd) return null;
  const days = dayjs(f.periodEnd).diff(dayjs(today), "day");
  if (days < 0) return { state: "expired", periodEnd: f.periodEnd, days };
  if (dayjs(f.periodEnd).isBefore(dayjs(today).add(RESIDENCE_ALERT_MONTHS, "month").add(1, "day"))) return { state: "soon", periodEnd: f.periodEnd, days };
  return null;
};
