/**
 * 労働基準法・就業規則関連の定数
 * 法律で決まった数は、条文からスクリプトで作ったファイルを使う（手で書き写さない）：
 * ・constants/workHours.ts（scripts/import_work_hours.py）：法定労働時間（労働基準法32条）など
 * ・constants/laborStandards.ts（scripts/import_labor_standards.py）：割増賃金の率の最低・深夜の時間（37条・割増賃金令）、
 *   中小事業主にも1か月60時間を超えた時間外労働の率を使い始めた日（附則）、時間単位の年次有給休暇の上限の日数（39条4項）
 */
import { LEGAL_WORK_HOURS } from './workHours';
import { NIGHT_HOURS } from './laborStandards';

export { HOURLY_PAID_LEAVE_MAX_DAYS, LEGAL_PREMIUM_PERCENT, OVER60_HOURS, SME_OVER60_FROM } from './laborStandards';

/** 深夜労働の時間（労働基準法37条4項）：NIGHT_START_HOUR 時から、翌日の NIGHT_END_HOUR 時まで */
export const NIGHT_START_HOUR = NIGHT_HOURS.start;
export const NIGHT_END_HOUR = NIGHT_HOURS.end;

/** 労働時間の法的基準（労働基準法32条） */
export const LEGAL_WORK_HOURS_DAILY = LEGAL_WORK_HOURS.daily;
export const LEGAL_WORK_HOURS_WEEKLY = LEGAL_WORK_HOURS.weekly;

/** 端数処理のモード定義 */
export type RoundingMode = 'floor' | 'round' | 'ceil';

/** UIでの表示用ラベルと値のセット */
export const ROUNDING_OPTIONS: { label: string; value: RoundingMode }[] = [
  { label: '切り捨て', value: 'floor' },
  { label: '四捨五入', value: 'round' },
  { label: '切り上げ', value: 'ceil' },
];
