import dayjs, { Dayjs } from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import minMax from 'dayjs/plugin/minMax';
import * as Master from '../constants';
import { DEFAULT_BASE_DATE } from "../constants/appConfig";

dayjs.extend(isSameOrBefore);
dayjs.extend(minMax);

// 時間文字列をDayjsに変換
export const parseToDayjs = (timeStr: string, baseDate: string = DEFAULT_BASE_DATE): Dayjs => {
  return dayjs(`${baseDate} ${timeStr}`, 'YYYY-MM-DD HH:mm');
};

// 指定期間内の深夜時間を計算（分単位）
export const getNightMinutesInPeriod = (start: Dayjs, end: Dayjs): number => {
  // 同じ時刻、または逆転している場合は 0
  if (end.isSameOrBefore(start)) return 0;

  let nightMinutes = 0;
  let current = start.clone();

  // ミリ秒単位での比較に強制して、24時間以上のループにも対応
  const endValue = end.valueOf();

  while (current.valueOf() < endValue) {
    const h = current.hour();
    
    // 深夜判定: 22時以降、または 5時未満
    if (h >= Master.NIGHT_START_HOUR || h < Master.NIGHT_END_HOUR) {
      nightMinutes++;
    }
    
    // 1分進める
    current = current.add(1, 'minute');

    // 無限ループ防止（念のため24時間以上の勤務はカット）
    if (nightMinutes > 1440) break; 
  }

  return nightMinutes;
};

/**
 * 週の開始日をキーとして返す（週40時間超の集計用）
 * weekStartDay: 0=日曜, 1=月曜, ..., 6=土曜
 */
export const getWeekKey = (dateStr: string, weekStartDay: number = 0): string => {
  // 1. Dayjsオブジェクトに変換
  const d = dayjs(dateStr);
  
  // 2. 現在の曜日(d.day())から、週の開始曜日までの差分を計算
  const diff = (d.day() - weekStartDay + 7) % 7;
  
  // 3. 差分を引いて「週の開始日」を求め、YYYY-MM-DD 形式で返す
  // .format() を使うことで、タイムゾーンによる日付ズレを確実に防ぎます
  return d.subtract(diff, 'day').format('YYYY-MM-DD');
};

/**
 * 小数形式の時間(8.5)を、日本語表記("8時間30分")に変換
 */
export const formatHours = (decimalHours: number): string => {
  if (!decimalHours || decimalHours <= 0) return "0分";
  const totalMinutes = Math.round(decimalHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
};

/**
 * 小数形式の時間(8.5)を、時刻形式("08:30")に変換
 */
export const decimalToTimeStr = (decimalHours: number): string => {
  const totalMinutes = Math.round(decimalHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
