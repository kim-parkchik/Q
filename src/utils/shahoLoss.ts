/**
 * 退職以外で、在職中に健康保険・厚生年金保険の資格を失うとき（資格喪失届の喪失原因「社会保障協定」「特定減額特例対象者の任意喪失」。
 * 喪失原因のコードは CSV形式届書作成仕様書（第17.0版）の資格喪失届の項目16。constants/shahoTodoke.ts の SHAHO_LOSS_REASONS）
 *
 * staff.shaho_loss の JSON：{ cause, date（資格喪失年月日）, pensionOnly }
 * ・社会保障協定：相手国の制度に入る（相手国の適用証明書がある）ので、日本の制度の資格を失う。協定によっては年金だけが相手国の制度になり、
 *   健康保険は続く（pensionOnly）
 * ・特定減額特例対象者の任意喪失：特定減額特例対象者（最低賃金の減額の特例許可を受けた短時間労働者で、所定内賃金が少ない人）は、原則として
 *   健康保険・厚生年金保険の対象ではないが、事業主を経て日本年金機構に申出をすれば加入できる（日本年金機構「被保険者区分変更届」の詳細説明）。
 *   加入した人が申出をやめて資格を失うとき
 * ・保険料は、資格喪失年月日がある月の分からかからない（資格を失った月の前月分まで。退職のときと同じ）
 */
export type ShahoLossCause = "社会保障協定" | "特定減額特例対象者の任意喪失";

export const SHAHO_LOSS_CAUSES: ShahoLossCause[] = ["社会保障協定", "特定減額特例対象者の任意喪失"];

export interface ShahoLoss {
  cause: ShahoLossCause;
  /** 資格喪失年月日（YYYY-MM-DD） */
  date: string;
  /** 社会保障協定で、年金だけが相手国の制度になる（健康保険は続く） */
  pensionOnly: boolean;
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const parseShahoLoss = (v: unknown): ShahoLoss | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const x = JSON.parse(v);
    if (!x || !SHAHO_LOSS_CAUSES.includes(x.cause) || !isDate(x.date)) return null;
    return { cause: x.cause, date: x.date, pensionOnly: x.cause === "社会保障協定" && !!x.pensionOnly };
  } catch {
    return null;
  }
};

export const stringifyShahoLoss = (v: ShahoLoss | null): string | null =>
  v && SHAHO_LOSS_CAUSES.includes(v.cause) && isDate(v.date) ? JSON.stringify({ cause: v.cause, date: v.date, pensionOnly: v.cause === "社会保障協定" && v.pensionOnly }) : null;

/** その月の分から、資格を失っているか（both：健康保険と厚生年金、pension：厚生年金だけ。失っていなければ null） */
export const shahoLossOnMonth = (shahoLoss: unknown, year: number, month: number): "both" | "pension" | null => {
  const loss = typeof shahoLoss === "string" ? parseShahoLoss(shahoLoss) : (shahoLoss as ShahoLoss | null);
  if (!loss) return null;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  if (ym < loss.date.slice(0, 7)) return null;
  return loss.pensionOnly ? "pension" : "both";
};
