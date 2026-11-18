/**
 * 介護保険の適用除外（介護保険適用除外等該当・非該当届）
 *
 * 40歳以上65歳未満の健康保険の被保険者は介護保険の第2号被保険者で、健康保険料と一緒に介護保険料を払う。
 * 次の理由で第2号被保険者でなくなったとき（該当）・その理由がなくなったとき（非該当）は、被保険者が事業主を経由して届け出る
 * （40歳・65歳になったときは届け出ない）。日本年金機構「介護保険適用除外等該当・非該当届」の詳細説明・記入例による。
 *   1：国外居住者（転勤で外国に住むようになった） 2：身体障害者療養施設入居者（介護保険の適用除外の施設に入所した）
 *   3：在留資格3か月以下の外国人
 * 介護保険料：第2号被保険者に該当しなくなった月の分から、介護保険料をかけない（その月に再び該当したときは、かける。健康保険法156条2項）。
 * 再び該当した月の分からは、介護保険料をかける。
 * 被保険者の期間は staff.kaigo_exempt（JSON の配列）に残す。被扶養者の届は印刷するだけ（被保険者の保険料は変わらない）。
 */
import dayjs from "dayjs";

export type KaigoExemptReason = "1" | "2" | "3";
export const KAIGO_EXEMPT_REASONS: Record<KaigoExemptReason, string> = {
  "1": "国外居住者",
  "2": "身体障害者療養施設入居者",
  "3": "在留資格３カ月以下の外国人",
};

export interface KaigoExemptPeriod {
  reason: KaigoExemptReason;
  /** 該当の年月日（第2号被保険者でなくなった日） */
  from: string;
  /** 非該当の年月日（理由がなくなった日。続いていれば空） */
  to: string;
  /** 入居施設の名称・所在地（理由2のとき） */
  facility: string;
  facilityAddress: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseKaigoExempt = (json: unknown): KaigoExemptPeriod[] => {
  if (typeof json !== "string" || !json.trim()) return [];
  try {
    const a = JSON.parse(json);
    if (!Array.isArray(a)) return [];
    return a
      .filter((p) => p && DATE.test(String(p.from)))
      .map((p) => ({
        reason: (["1", "2", "3"].includes(String(p.reason)) ? String(p.reason) : "1") as KaigoExemptReason,
        from: String(p.from),
        to: DATE.test(String(p.to ?? "")) ? String(p.to) : "",
        facility: String(p.facility ?? ""),
        facilityAddress: String(p.facilityAddress ?? ""),
      }))
      .sort((a, b) => a.from.localeCompare(b.from));
  } catch {
    return [];
  }
};

export const stringifyKaigoExempt = (periods: KaigoExemptPeriod[]): string | null => (periods.length > 0 ? JSON.stringify(periods) : null);

/** その月の分の介護保険料をかけない（適用除外）か */
export const kaigoExemptMonth = (json: unknown, year: number, month: number): boolean => {
  const target = dayjs(new Date(year, month - 1, 1));
  return parseKaigoExempt(json).some((p) => {
    const from = dayjs(p.from).startOf("month");
    const to = p.to ? dayjs(p.to).startOf("month") : null;
    return !target.isBefore(from) && (!to || target.isBefore(to));
  });
};

/** 届を残す：該当なら期間を足し、非該当なら続いている期間を閉じる */
export const recordKaigoExempt = (
  json: unknown,
  kind: "該当" | "非該当",
  date: string,
  reason: KaigoExemptReason,
  facility = "",
  facilityAddress = "",
): KaigoExemptPeriod[] => {
  const periods = parseKaigoExempt(json);
  if (kind === "該当") {
    if (periods.some((p) => p.from === date)) return periods;
    return [...periods, { reason, from: date, to: "", facility, facilityAddress }].sort((a, b) => a.from.localeCompare(b.from));
  }
  const open = [...periods].reverse().find((p) => !p.to && p.from <= date);
  if (!open) return periods;
  return periods.map((p) => (p === open ? { ...p, to: date } : p));
};
