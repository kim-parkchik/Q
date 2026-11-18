/**
 * 標準報酬月額の決定・改定の通知書（従業員に渡すもの）
 *
 * 年金事務所・健康保険組合から標準報酬の決定・改定の通知を受けたら、事業主は速やかに被保険者に知らせる
 * （健康保険法49条2項・厚生年金保険法29条2項）。一般的な給与ソフトの「標準報酬決定通知書」「標準報酬改定通知書」「保険料改定通知書」と同じく、
 * 適用する月・決定・改定の理由・決定後と従前の標準報酬月額（健康保険・厚生年金保険の等級）・その月の分の本人負担の保険料を出す。
 * 標準報酬月額は従業員の画面の履歴（utils/standardRemuneration.ts）、保険料は給与の計算と同じ（utils/healthInsurer.ts・calcPremium）。
 * 厚生年金保険の標準報酬月額は、健康保険の標準報酬月額を厚生年金保険の上限・下限で切った額（utils/remunerationReport.ts）。
 */
import * as Master from "../constants";
import { getInsuranceByAge } from "./calcSalary";
import { healthPremiumsOf, insurerOf, type HealthInsurer } from "./healthInsurer";
import { pensionStandardOf } from "./remunerationReport";
import { calcPremium } from "./socialInsurance";
import { REMUNERATION_REASON_LABELS, remunerationHistoryOf, type RemunerationReason } from "./standardRemuneration";

export interface NoticePremiums {
  health: number;
  nursing: number;
  childSupport: number;
  pension: number;
  total: number;
}

export interface RemunerationNotice {
  staffId: string;
  name: string;
  /** 何年何月分から（YYYY-MM） */
  from: string;
  reason: RemunerationReason;
  reasonLabel: string;
  /** 決定後の標準報酬月額と等級（厚生年金保険の対象でなければ pension は null） */
  health: number;
  healthGrade: number | null;
  pension: number | null;
  pensionGrade: number | null;
  /** 従前の標準報酬月額（資格取得時の決定などで、前がなければ null） */
  previousHealth: number | null;
  previousPension: number | null;
  /** その月の分の本人負担の保険料（計算できなければ null と理由） */
  premiums: NoticePremiums | null;
  notes: string[];
}

export interface NoticeContext {
  insurers: Map<number, HealthInsurer>;
  /** 拠点の id → 都道府県（協会けんぽの料率） */
  prefectureOf: (branchId: unknown) => string | null;
  /** 社会保険料の端数処理（会社の設定） */
  rounding: string;
}

/** 履歴の中で、ある月から使う標準報酬月額があるか（その月の通知を作る人） */
export const noticeMonths = (staffList: any[]): string[] =>
  [...new Set(staffList.flatMap((s) => remunerationHistoryOf(s).filter((e) => e.from && e.amount > 0).map((e) => e.from)))]
    .sort((a, b) => b.localeCompare(a));

const gradeOf = (standard: number, year: number, month: number) => {
  const ins = Master.getInsuranceMaster(year, month);
  const row = ins.KENPO_TABLE.grades.find((g) => g.standard === standard);
  return { health: row?.grade ?? null, pensionRow: ins.KENPO_TABLE.grades.find((g) => g.standard === standard && g.pensionGrade !== null) ?? null };
};

/** ある月から使う標準報酬月額の通知（その月から履歴が変わる人ごと） */
export const remunerationNotices = (staffList: any[], ym: string, ctx: NoticeContext): RemunerationNotice[] => {
  const [year, month] = ym.split("-").map(Number);
  const ins = Master.getInsuranceMaster(year, month);
  const range = { min: ins.PENSION_MIN_HYOJUN, max: ins.PENSION_MAX_HYOJUN };
  const out: RemunerationNotice[] = [];
  for (const s of staffList) {
    const history = remunerationHistoryOf(s);
    const idx = history.findIndex((e) => e.from === ym && e.amount > 0);
    if (idx < 0) continue;
    const entry = history[idx];
    const prev = idx > 0 ? history[idx - 1] : null;
    const byAge = getInsuranceByAge(String(s.birthday ?? ""), year, month, s.kouki_date, s.kaigo_exempt);
    const notes: string[] = [];
    const health = entry.amount;
    const pension = byAge.pension ? pensionStandardOf(health, range) : null;
    const g = gradeOf(health, year, month);
    const pensionGrade = pension === null ? null : ins.KENPO_TABLE.grades.find((x) => x.standard === pension)?.pensionGrade ?? null;
    let premiums: NoticePremiums | null = null;
    const insurer = insurerOf(ctx.insurers, s.social_insurance_group_id);
    const hp = byAge.health
      ? healthPremiumsOf({ base: health, insurer, prefecture: ctx.prefectureOf(s.branch_id), year, month, nursing: byAge.nursing, rounding: ctx.rounding })
      : { health: 0, nursing: 0, childSupport: 0, missing: null, unionRate: null };
    if (hp.missing === "prefecture") notes.push("拠点の都道府県がわからないので、健康保険料・介護保険料を計算していません。");
    else if (hp.missing === "unionRate") notes.push("健康保険組合の、この月の分の料率が入っていないので、健康保険料・介護保険料を計算していません。");
    else {
      const pen = pension === null ? 0 : calcPremium(pension, ins.PENSION_RATE[1], ctx.rounding);
      premiums = { health: hp.health, nursing: hp.nursing, childSupport: hp.childSupport, pension: pen, total: hp.health + hp.nursing + hp.childSupport + pen };
    }
    if (insurer?.type === "kokuho") notes.push("国民健康保険組合の人なので、健康保険の標準報酬月額・保険料は組合の決まりによります。");
    if (!byAge.health) notes.push("75歳以上（または後期高齢者医療の被保険者）なので、健康保険の保険料はかかりません。");
    if (!byAge.pension) notes.push("70歳以上なので、厚生年金保険の保険料はかかりません。");
    out.push({
      staffId: String(s.id), name: String(s.name ?? ""), from: ym, reason: entry.reason, reasonLabel: REMUNERATION_REASON_LABELS[entry.reason],
      health, healthGrade: g.health, pension, pensionGrade,
      previousHealth: prev && prev.amount > 0 ? prev.amount : null,
      previousPension: prev && prev.amount > 0 && pension !== null ? pensionStandardOf(prev.amount, range) : null,
      premiums, notes,
    });
  }
  return out.sort((a, b) => a.staffId.localeCompare(b.staffId, "ja", { numeric: true }));
};
