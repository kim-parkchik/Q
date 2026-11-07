/**
 * 会社ファイルのバックアップ（.qb）の名前と、残す世代の整理
 *
 * ■ 名前：「会社ファイルの名前_YYYYMMDD_HHMMSS.qb」（書類/Q/Backup。以前は秒のない「_HHMM」）
 * ■ 世代の整理：その会社ファイルのバックアップだけを新しい順に並べ、残す数（会社設定の backup_generations）より古いものを消す。
 *   名前の頭が同じ別の会社ファイル（「山田商店.qp」に対する「山田商店2.qp」など）のバックアップや、
 *   バックアップから作った写し（「山田商店_20261106_120130_復元.qp」）のバックアップは、数えない・消さない
 * ■ バックアップを開くとき：.qb は直接開かずに、写しの会社ファイル（.qp）を作って開く（restoredFileName）。
 *   開くと、表の更新やログの書き込みでバックアップの中身が変わってしまうため
 * ■ マイナンバーの暗号化を始める前に作ったバックアップには、暗号化していない番号が残る。
 *   マイナンバーの画面で、その会社ファイルのバックアップのうち、名前の日時が暗号化を始めた日時より前のものを出し、消せるようにする
 *   （backupsBeforeEncryption。名前の日時は、会社ファイルを閉じてバックアップを作った時刻）
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

/**
 * バックアップを作った日時（名前から読む。"山田商店_20261106_120130.qb" → "2026-11-06 12:01:30"）
 * 以前の秒のない名前（「_HHMM」）は 00 秒とする。その会社ファイルのバックアップでなければ null
 */
export const backupTimeOf = (fileName: string, baseName: string): string | null => {
  if (!isBackupOf(fileName, baseName)) return null;
  const m = fileName.slice(baseName.length).match(/^_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?\./);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? "00"}` : null;
};

/**
 * その会社ファイルのバックアップを、マイナンバーの暗号化を始める前のものと、始めてからのものに分ける（どちらも古い順）
 * @param startedAt 暗号化を始めた日時（my_number_keys.created_at。"YYYY-MM-DD HH:MM:SS"。バックアップの名前と同じく、その PC の時刻）
 */
export const backupsBeforeEncryption = (fileNames: string[], baseName: string, startedAt: string): { before: string[]; after: string[] } => {
  const list = fileNames
    .map((name) => ({ name, time: backupTimeOf(name, baseName) }))
    .filter((x): x is { name: string; time: string } => x.time !== null)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return {
    before: list.filter((x) => x.time < startedAt).map((x) => x.name),
    after: list.filter((x) => x.time >= startedAt).map((x) => x.name),
  };
};

/** バックアップから作る写しの会社ファイルの名前。"山田商店_20261106_120130.qb" → "山田商店_20261106_120130_復元.qp" */
export const restoredFileName = (backupPath: string): string => `${companyBaseName(backupPath)}_復元.${EXT_MAIN}`;

/** バックアップ（.qb）か */
export const isBackupFile = (path: string): boolean => path.toLowerCase().endsWith(`.${EXT_BACKUP}`);
