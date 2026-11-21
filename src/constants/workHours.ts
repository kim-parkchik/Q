// このファイルは scripts/import_work_hours.py で作る（手で書き換えない）
// 労働基準法（roumu-forms/labor-standards-act.xml SHA-256 7ff8d8701deac403bccf47636e6f220d226d69568e0c6ba458dd46efd6e197d0）32条・32条の3・別表第一
// 労働基準法施行規則 第25条の2（roumu-forms/labor-standards-rule-25-2.xml SHA-256 730484b373d15e9798fbd7fcb773d7e64586debc3fa2ab56b85049f5fe0a1718）

/** 法定労働時間（労働基準法32条1項：1週間40時間、2項：1日8時間） */
export const LEGAL_WORK_HOURS = { weekly: 40, daily: 8 } as const;

/**
 * フレックスタイム制（労働基準法32条の3）：清算期間の上限（1項2号：3か月以内）と、清算期間が1か月を超えるときの
 * 1か月ごとの週平均の上限（2項：50時間）
 */
export const FLEX_LIMITS = { maxMonths: 3, monthCapWeeklyHours: 50 } as const;

/**
 * 週44時間の特例（特例措置対象事業場。労働基準法施行規則25条の2）：別表第一の事業のうち常時10人未満の労働者を使用する事業場は、
 * 1週間44時間・1日8時間まで（1項）。フレックスタイム制は清算期間が1か月以内のときだけ（3項）。
 * 清算期間が1か月を超えるフレックスタイム制・1年単位・1週間単位の変形労働時間制には使わない（4項）
 */
export const WEEKLY_44 = { weekly: 44, daily: 8, workersBelow: 10, flexMaxMonths: 1 } as const;

/** 週44時間の特例の事業（施行規則25条の2 1項。名前は労働基準法 別表第一。excluded はその号から除く事業） */
export const WEEKLY_44_BUSINESSES = [
  { item: 8, name: "物品の販売、配給、保管若しくは賃貸又は理容の事業", excluded: "" },
  { item: 10, name: "映画の製作又は映写、演劇その他興行の事業", excluded: "映画の製作の事業" },
  { item: 13, name: "病者又は虚弱者の治療、看護その他保健衛生の事業", excluded: "" },
  { item: 14, name: "旅館、料理店、飲食店、接客業又は娯楽場の事業", excluded: "" },
] as const;
