// このファイルは scripts/import_labor_standards.py で作る（手で書き換えない）
// 労働基準法（roumu-forms/labor-standards-act.xml SHA-256 7ff8d8701deac403bccf47636e6f220d226d69568e0c6ba458dd46efd6e197d0）37条1項・4項・39条4項・附則
// 労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令（平成六年政令第五号。
//   roumu-forms/wage-premium-order.xml SHA-256 90442057b982e16e8393fa6e97d94ec3fda09557064156e09551c110f51cd04a）

/**
 * 割増賃金の率の最低（%）。これより低くはできない
 * ・overtime：時間外労働、holiday：法定休日の労働（労働基準法37条1項・割増賃金令。政令の率は37条1項の25%〜50%の範囲）
 * ・over60：1か月の時間外労働が60時間を超えた分（37条1項ただし書）
 * ・night：深夜の労働（37条4項）
 */
export const LEGAL_PREMIUM_PERCENT = { overtime: 25, holiday: 35, over60: 50, night: 25 } as const;

/** 1か月の時間外労働がこの時間を超えた分は、over60 の率（労働基準法37条1項ただし書） */
export const OVER60_HOURS = 60;

/**
 * 深夜の時間（労働基準法37条4項：午後10時から午前5時まで）。
 * 厚生労働大臣が必要と認めて定める地域・期間の「午後11時から午前6時まで」は、Q では使わない
 */
export const NIGHT_HOURS = { start: 22, end: 5 } as const;

/**
 * 中小事業主にも、1か月60時間を超えた時間外労働の率（over60）を使い始めた日。この日より前は、労働基準法の附則138条で、
 * 中小事業主には使わなかった（附則138条を削った日。平成30年7月6日法律第71号 附則1条3号）
 */
export const SME_OVER60_FROM = "2023-04-01";

/** 時間を単位として与えることができる年次有給休暇の日数の上限（1年に。労働基準法39条4項2号：5日以内） */
export const HOURLY_PAID_LEAVE_MAX_DAYS = 5;
