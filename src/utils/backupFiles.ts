/**
 * 会社ファイルのバックアップ（.qb）の名前と、残す世代の整理
 *
 * ■ 名前：「会社ファイルの名前_YYYYMMDD_HHMMSS.qb」（書類/Q/Backup。以前は秒のない「_HHMM」）
 * ■ 世代の整理：その会社ファイルのバックアップだけを新しい順に並べ、残す数（会社設定の backup_generations）より古いものを消す。
 *   名前の頭が同じ別の会社ファイル（「山田商店.qp」に対する「山田商店2.qp」など）のバックアップや、
 *   バックアップから作った写し（「山田商店_20261106_120130_復元.qp」）のバックアップは、数えない・消さない
 * ■ バックアップを開くとき：.qb は直接開かずに、写しの会社ファイル（.qp）を作って開く（restoredFileName）。
 *   開くと、表の更新やログの書き込みでバックアップの中身が変わってしまうため
 */
import { EXT_BACKUP, EXT_MAIN } from "../constants/appConfig";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 正規表現で、その文字のまま探すための書き方 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 会社ファイルの名前（拡張子を除く）。"/書類/Q/山田商店.qp" → "山田商店" */
export const companyBaseName = (path: string): string => {
  const fileName = path.split(/[\\/]/).pop() || `data.${EXT_MAIN}`;
  return fileName.replace(/\.[^/.]+$/, "");
};

/** バックアップのファイル名（秒まで入れる。同じ分のうちに2回閉じても、名前がぶつからないように） */
export const backupFileName = (baseName: string, now: Date): string => {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${baseName}_${date}_${time}.${EXT_BACKUP}`;
};

/** その会社ファイルのバックアップか（以前の「_HHMM」の名前も含む） */
export const isBackupOf = (fileName: string, baseName: string): boolean =>
  new RegExp(`^${escapeRegExp(baseName)}_\\d{8}_\\d{4}(\\d{2})?\\.${escapeRegExp(EXT_BACKUP)}$`).test(fileName);

/**
 * 残す世代数を超えた、古いバックアップのファイル名（その会社ファイルのものだけ）
 * @param keep 残す世代数（1未満・数でなければ10）
 */
export const backupsToDelete = (fileNames: string[], baseName: string, keep: unknown): string[] => {
  const n = Math.floor(Number(keep));
  const generations = Number.isFinite(n) && n >= 1 ? n : 10;
  return fileNames
    .filter((name) => isBackupOf(name, baseName))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // 新しい順（名前の後ろが日時なので、名前の順でよい）
    .slice(generations);
};

/** バックアップから作る写しの会社ファイルの名前。"山田商店_20261106_120130.qb" → "山田商店_20261106_120130_復元.qp" */
export const restoredFileName = (backupPath: string): string => `${companyBaseName(backupPath)}_復元.${EXT_MAIN}`;

/** バックアップ（.qb）か */
export const isBackupFile = (path: string): boolean => path.toLowerCase().endsWith(`.${EXT_BACKUP}`);
