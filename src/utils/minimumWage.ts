/**
 * 最低賃金のチェック（地域別最低賃金）
 *
 * ■ 比べ方：賃金を時間あたりにして、事業場がある都道府県の最低賃金（時間額）以上か（最低賃金法4条）
 *   ・時給：そのまま
 *   ・日給：1日の所定労働時間数で割る
 *   ・月給：月の所定労働時間数（月によって違うときは、1年間における1月平均所定労働時間数）で割る
 *   （最低賃金法施行規則2条）
 * ■ 比べるときに入れない賃金：臨時の賃金、1か月を超える期間ごとの賃金（賞与など）、
 *   所定労働時間を超える労働・所定労働日以外の労働の賃金、深夜の割増分（最低賃金法4条3項・施行規則1条）、
 *   精皆勤手当・通勤手当・家族手当（地域別最低賃金で算入しないと定めている賃金）
 * ■ 最低賃金は都道府県ごとに発効日が違う（同じ年度でも、10月から翌年3月まで）。
 * 出典：最低賃金法・最低賃金法施行規則（e-Gov 法令API）
 *       厚生労働省 地域別最低賃金の全国一覧（constants/minimumWage.ts）
 *
 * Q では、基本給だけを時間あたりにして比べる（手当が最低賃金の対象かどうかは、Q ではわからないため）。
 * 基本給が下回っていても、対象になる手当を合わせると上回ることはある。
 */
import { MINIMUM_WAGES, type MinimumWageEntry } from "../constants/minimumWage";

/** その日に効力がある最低賃金（データがない都道府県・データより前の日は null） */
export const minimumWageOn = (prefecture: string | null | undefined, date: string): MinimumWageEntry | null => {
  const entries = prefecture ? MINIMUM_WAGES[prefecture] : undefined;
  if (!entries) return null;
  const applied = entries.filter((e) => e.from <= date);
  return applied.length > 0 ? applied[applied.length - 1] : null;
};

/** その日より後に発効する、次の最低賃金（まだなければ null） */
export const nextMinimumWage = (prefecture: string | null | undefined, date: string): MinimumWageEntry | null => {
  const entries = prefecture ? MINIMUM_WAGES[prefecture] : undefined;
  return entries?.find((e) => e.from > date) ?? null;
};

/**
 * 基本給を時間あたりにした金額（求められなければ null）
 * @param dailyHours          1日の所定労働時間
 * @param monthlyAverageHours 1年間における1月平均所定労働時間（月給のとき）
 */
export const baseWagePerHour = (
  wageType: string,
  baseWage: number,
  dailyHours: number,
  monthlyAverageHours: number | null,
): number | null => {
  const wage = Number(baseWage) || 0;
  if (wage <= 0) return null;
  if (wageType === "monthly") return monthlyAverageHours && monthlyAverageHours > 0 ? wage / monthlyAverageHours : null;
  if (wageType === "daily") return dailyHours > 0 ? wage / dailyHours : null;
  return wage;
};

export interface MinimumWageCheck {
  minimum: MinimumWageEntry;
  /** 基本給を時間あたりにした金額 */
  perHour: number;
  /** 最低賃金以上か */
  ok: boolean;
}

/** 基本給（時間あたり）が、その日の最低賃金以上か（比べられなければ null） */
export const checkMinimumWage = (
  prefecture: string | null | undefined,
  date: string,
  perHour: number | null,
): MinimumWageCheck | null => {
  const minimum = minimumWageOn(prefecture, date);
  if (!minimum || perHour === null) return null;
  return { minimum, perHour, ok: perHour >= minimum.amount };
};

/** 「東京の最低賃金 1,226円（2025年10月3日から）」 */
export const describeMinimumWage = (prefecture: string, m: MinimumWageEntry): string => {
  const [y, mo, d] = m.from.split("-").map(Number);
  return `${prefecture}の最低賃金 ${m.amount.toLocaleString()}円（${y}年${mo}月${d}日から）`;
};
