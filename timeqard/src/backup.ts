/**
 * 毎日の控え（記録のファイルの写し。くわしくは timeqard/DESIGN.md の 4.2）
 *
 * ・古いパソコンが壊れたときのために、1日に1回、決めたフォルダ（USB メモリなど）に写しを作る。
 * ・写しは SQLite の VACUUM INTO で作る（使っている途中でも、そろった写しになる）。
 * ・新しいものから30個を残し、古い写し（TimeQard が作った名前のものだけ）を消す（「いま控えを作る」で作ったものも数える）。
 */
import { jstDate, jstTimeWithSeconds } from "../../shared/timeqard";
import { joinPath, pruneBackups } from "./platform";
import { setSetting, type KioskDb, type KioskSettings } from "./store";

export const BACKUP_KEEP = 30;

export const backupFileName = (now: number) => `TimeQard_控え_${jstDate(now)}_${jstTimeWithSeconds(now).replace(/:/g, "")}.db`;

/** いま控えを作る（作ったファイルの場所を返す。失敗したら、わけを設定に残して投げる） */
export const backupNow = async (db: KioskDb, dir: string, now = Date.now()) => {
  try {
    const path = await joinPath(dir, backupFileName(now));
    await db.execute("VACUUM INTO ?", [path]);
    await pruneBackups(dir, BACKUP_KEEP);
    await setSetting(db, "last_backup_date", jstDate(now));
    await setSetting(db, "last_backup_error", "");
    return path;
  } catch (e) {
    await setSetting(db, "last_backup_error", `${jstDate(now)}：${String(e)}`);
    throw e;
  }
};

/** 今日の控えがまだなら作る（控えのフォルダを決めていなければ何もしない） */
export const backupIfDue = async (db: KioskDb, settings: KioskSettings, now = Date.now()) => {
  if (!settings.backupDir || settings.lastBackupDate === jstDate(now)) return false;
  await backupNow(db, settings.backupDir, now);
  return true;
};
