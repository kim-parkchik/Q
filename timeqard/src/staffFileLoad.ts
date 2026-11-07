/**
 * 従業員ファイルを読み込む前の確かめ（くわしくは timeqard/DESIGN.md の 4.6）
 *
 * ・会社の印が、いま読み込んでいるものと違うファイルは、そのままでは読み込まない（ほかの会社のファイルで上書きしないため）。
 *   どうしても切り替えるときは、管理の画面で確かめてから切り替える。
 * ・いま読み込んでいるものより古いファイルなら、知らせて確かめる。
 */
import { companyMarkLabel, jstDate, jstTime, parseIso, parseStaffFile, type StaffFile } from "../../shared/timeqard";
import type { KioskSettings } from "./store";

export type StaffFileCheck =
  | { kind: "error"; message: string }
  | { kind: "ok"; file: StaffFile }
  /** 確かめてから読み込む（会社が違う・古い） */
  | { kind: "confirm"; file: StaffFile; message: string; switching: boolean };

const when = (iso: string | null) => {
  const ms = iso ? parseIso(iso) : null;
  return ms === null ? "（不明）" : `${jstDate(ms)} ${jstTime(ms)}`;
};

export const checkStaffFile = (text: string, settings: Pick<KioskSettings, "companyMark" | "companyName" | "staffFileExportedAt">): StaffFileCheck => {
  const parsed = parseStaffFile(text);
  if (!parsed.ok) return { kind: "error", message: parsed.error };
  const file = parsed.file;
  if (settings.companyMark && file.companyMark !== settings.companyMark) {
    return {
      kind: "confirm",
      file,
      switching: true,
      message:
        `いま読み込んでいるのとは、ちがう会社の従業員ファイルです。\n\n` +
        `いま：${settings.companyName}（会社の印 ${companyMarkLabel(settings.companyMark)}）\n` +
        `このファイル：${file.companyName}（会社の印 ${companyMarkLabel(file.companyMark)}）\n\n` +
        `会社ファイルを作り直したときなど、どうしても切り替えるときだけ「切り替える」を押してください。` +
        `前の打刻は消えず、前の会社の印のまま残ります（この画面からは、切り替えたあとの会社の打刻だけを書き出します）。`,
    };
  }
  const current = settings.staffFileExportedAt ? parseIso(settings.staffFileExportedAt) : null;
  const incoming = parseIso(file.exportedAt);
  if (current !== null && incoming !== null && incoming < current) {
    return {
      kind: "confirm",
      file,
      switching: false,
      message:
        `いま読み込んでいるもの（${when(settings.staffFileExportedAt)} に書き出し）より、古い従業員ファイルです（${when(file.exportedAt)} に書き出し）。\n\n` +
        `古いファイルを読み込むと、そのあとに入社した人が押せなくなったり、作り直す前のカードが使えたりします。読み込みますか？`,
    };
  }
  return { kind: "ok", file };
};

/**
 * パスワードを忘れたときに、決め直してよい従業員ファイルか（同じ会社で、いま読み込んでいるものより新しいもの）
 */
export const checkStaffFileForReset = (text: string, settings: Pick<KioskSettings, "companyMark" | "staffFileExportedAt">): { ok: true; file: StaffFile } | { ok: false; message: string } => {
  const parsed = parseStaffFile(text);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const file = parsed.file;
  if (file.companyMark !== settings.companyMark) {
    return { ok: false, message: "いま読み込んでいる会社の従業員ファイルではありません。この会社の会社ファイルを開いた Q で書き出してください。" };
  }
  const current = settings.staffFileExportedAt ? parseIso(settings.staffFileExportedAt) : null;
  const incoming = parseIso(file.exportedAt);
  if (current === null || incoming === null || incoming <= current) {
    return {
      ok: false,
      message: `いま読み込んでいるもの（${when(settings.staffFileExportedAt)} に書き出し）より新しい従業員ファイルを、Q で書き出してから選んでください。`,
    };
  }
  return { ok: true, file };
};
