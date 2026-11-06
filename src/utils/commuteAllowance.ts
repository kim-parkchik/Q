/**
 * 通勤手当の非課税限度額（1か月当たり）：通勤の方法・片道の距離・定期代・有料道路・駐車場等から、その人の限度額を出す
 *
 * ■ 電車・バスなど（交通機関）だけ：1か月当たりの合理的な運賃等の額（最高限度 15万円）
 *   → Q では、支給する通勤手当を合理的な運賃等の額として、最高限度まで非課税にする
 * ■ マイカー・自転車など（交通用具）：片道の通勤距離の区分の額（2km未満は全額課税）
 *   ・勤め先・通勤に使う駅などの周辺の駐車場等の料金を負担するのが常例の人は、駐車場等の料金相当額（上限5,000円）を足す
 *     （令和8年4月1日以後に支払われるべき通勤手当から。2km未満の人は足さない）
 *   ・有料道路を使う人は、合理的な料金の額を足す（合計で最高限度 15万円）
 * ■ 両方（交通機関と交通用具）：合理的な運賃等の額（定期代など）と、上の交通用具の額の合計（最高限度 15万円）
 * ■ どの期間の表を使うかは、給与を支払う年月で決める（適用が始まる日はどれも月の初めの日。constants/tax/commuteLimits.ts）
 * 出典：所得税法9条、所得税法施行令20条の2
 *       国税庁 タックスアンサー No.2582（電車・バス通勤者）・No.2585（マイカー・自転車通勤者）
 *       国税庁「通勤手当の非課税限度額の改正に関するＱ＆Ａ」（令和8年4月）
 * ※ 障害者が2km未満を交通用具で通勤する場合など、個別の取扱い（国税庁の質疑応答事例）には対応していない
 */
import { COMMUTE_LIMIT_PERIODS, type CommuteLimitPeriod } from "../constants/tax/commuteLimits";

/** transit: 電車・バスなど（交通機関）だけ / vehicle: マイカー・自転車など（交通用具） / both: 両方 */
export type CommuteMethod = "transit" | "vehicle" | "both";

export const COMMUTE_METHOD_LABELS: Record<CommuteMethod, string> = {
  transit: "電車・バスなど",
  vehicle: "マイカー・自転車など",
  both: "電車・バスなどとマイカー・自転車など",
};

export interface CommuteSetting {
  method: CommuteMethod;
  /** マイカー・自転車などを使う片道の通勤距離（km） */
  distanceKm: number;
  /** 電車・バスなどの1か月当たりの合理的な運賃等の額（両方のとき。定期代など） */
  transitFare: number;
  /** 有料道路の1か月当たりの合理的な料金の額（マイカーなどの人） */
  toll: number;
  /** 1か月当たりの駐車場等の料金相当額（勤め先・通勤に使う駅などの周辺の駐車場・駐輪場。自宅の近くは入れない） */
  parking: number;
}

export const DEFAULT_COMMUTE_SETTING: CommuteSetting = { method: "transit", distanceKm: 0, transitFare: 0, toll: 0, parking: 0 };

const nonNeg = (v: unknown) => Math.max(0, Number(v) || 0);
const toMethod = (v: unknown): CommuteMethod => (v === "vehicle" || v === "both" ? v : "transit");

/** 従業員の commute_setting（JSON の文字列）を読む。空・壊れているときは電車・バスなどだけ（これまでの計算と同じ） */
export const parseCommuteSetting = (json: unknown): CommuteSetting => {
  if (typeof json !== "string" || !json.trim()) return { ...DEFAULT_COMMUTE_SETTING };
  try {
    const v = JSON.parse(json);
    return {
      method: toMethod(v?.method),
      distanceKm: nonNeg(v?.distanceKm),
      transitFare: Math.floor(nonNeg(v?.transitFare)),
      toll: Math.floor(nonNeg(v?.toll)),
      parking: Math.floor(nonNeg(v?.parking)),
    };
  } catch {
    return { ...DEFAULT_COMMUTE_SETTING };
  }
};

/** 保存用の JSON */
export const stringifyCommuteSetting = (s: CommuteSetting): string => JSON.stringify(parseCommuteSetting(JSON.stringify(s)));

/** 給与を支払う年月に使う表（その月の初めの日までに適用が始まっている、いちばん新しいもの） */
export const commuteLimitPeriodOf = (year: number, month: number): CommuteLimitPeriod => {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const applied = COMMUTE_LIMIT_PERIODS.filter((p) => p.from <= first);
  return applied.length > 0 ? applied[applied.length - 1] : COMMUTE_LIMIT_PERIODS[0];
};

export interface CommuteLimit {
  /** 1か月当たりの非課税限度額 */
  limit: number;
  /** 片道の距離の区分の額（マイカーなどの人。2km未満は 0） */
  distanceLimit: number;
  /** 足した駐車場等の料金相当額（上限まで） */
  parkingAddition: number;
  /** 最高限度で切ったか */
  capped: boolean;
}

/** 1か月当たりの非課税限度額 */
export const commuteLimitOf = (s: CommuteSetting, year: number, month: number): CommuteLimit => {
  const p = commuteLimitPeriodOf(year, month);
  if (s.method === "transit") return { limit: p.maxPerMonth, distanceLimit: 0, parkingAddition: 0, capped: false };
  const d = nonNeg(s.distanceKm);
  const band = p.distanceBands.find((b) => d >= b.fromKm && (b.toKm === null || d < b.toKm));
  const distanceLimit = band ? band.limit : 0;
  // 2km未満の人（区分の額が 0）には、駐車場等の料金相当額を足さない
  const parkingAddition = distanceLimit > 0 && p.parkingAdditionMax !== null ? Math.min(nonNeg(s.parking), p.parkingAdditionMax) : 0;
  const sum = (s.method === "both" ? nonNeg(s.transitFare) : 0) + nonNeg(s.toll) + distanceLimit + parkingAddition;
  return { limit: Math.min(sum, p.maxPerMonth), distanceLimit, parkingAddition, capped: sum > p.maxPerMonth };
};

/** 支給する通勤手当のうち、所得税がかからない額 */
export const nonTaxableCommuteOf = (commutePay: number, s: CommuteSetting, year: number, month: number): number =>
  Math.min(nonNeg(commutePay), commuteLimitOf(s, year, month).limit);

/** 画面に出す説明（「マイカー・自転車など 片道12km：7,300円 ＋ 駐車場等 5,000円 ＝ 12,300円」） */
export const describeCommuteLimit = (s: CommuteSetting, year: number, month: number): string => {
  const c = commuteLimitOf(s, year, month);
  const yen = (n: number) => `${n.toLocaleString()}円`;
  if (s.method === "transit") return `${COMMUTE_METHOD_LABELS.transit}：支給額を最高限度 ${yen(c.limit)} まで`;
  const parts = [
    s.method === "both" && s.transitFare > 0 ? `運賃等 ${yen(s.transitFare)}` : null,
    `片道${s.distanceKm}km ${c.distanceLimit > 0 ? yen(c.distanceLimit) : "（2km未満は全額課税）"}`,
    s.toll > 0 ? `有料道路 ${yen(s.toll)}` : null,
    c.parkingAddition > 0 ? `駐車場等 ${yen(c.parkingAddition)}` : null,
  ].filter(Boolean);
  return `${COMMUTE_METHOD_LABELS[s.method]}：${parts.join(" ＋ ")} ＝ ${yen(c.limit)}${c.capped ? "（最高限度）" : ""}`;
};
