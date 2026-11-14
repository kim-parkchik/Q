/**
 * 健康保険の保険者（会社設定の「社会保険規定」）と、健康保険料・介護保険料・子ども・子育て支援金（本人負担分）の計算
 *
 * ■ 協会けんぽ（kyokai）：料率は都道府県（支部）ごと（協会けんぽの公式の保険料額表から作った表。拠点の都道府県で決まる）。
 *   本人負担は、全体の料率の半分（折半）。
 * ■ 健康保険組合（union）：料率は組合ごとに決まり、組合は規約で会社の負担を半分より多くできる（健康保険法162条）。
 *   そのため、組合から知らされた「本人負担」の料率（健康保険・介護保険・子ども・子育て支援金）を、「何年何月分から」と一緒に
 *   会社設定で入れ、その月の分の料率で計算する（入れていない月は計算せず、知らせて確定できないようにする）。
 *   一般的な給与ソフトと同じ形（クラウド型の給与ソフトの「組合管掌事業所」：組合の保険料率を直接入れ、
 *   適用開始月の違う保険料率をいくつも登録できる）。
 *   標準報酬月額・標準賞与額の上限、介護保険（40〜64歳）、端数の決まり、計算のしかた（介護保険料は「健康保険＋介護保険」で
 *   計算して健康保険料を引く）は、協会けんぽと同じ。子ども・子育て支援金は令和8年4月分から（令和8年度は、被用者保険は国が示した
 *   一律の率 0.23%。組合が決める率なので、組合の知らせのとおり入れる）。
 * ■ 国民健康保険組合（kokuho。建設国保など）：健康保険（協会けんぽ・健康保険組合）に入っていないので、健康保険料・介護保険料・
 *   子ども・子育て支援金はかからない。国保組合の保険料（家族の人数などで決まる定額）は、従業員の画面で人ごとに月額を入れ、
 *   毎月の給与から引く（賞与からは引かない。クラウド型の給与ソフトの「国民健康保険組合」と同じ形）。
 *   厚生年金は、いままでどおりかかる（標準報酬月額を入れた人）。
 */
import * as Master from "../constants";
import { calcPremium } from "./socialInsurance";

export type InsurerType = "kyokai" | "union" | "kokuho";

export const INSURER_TYPE_LABELS: Record<InsurerType, string> = {
  kyokai: "協会けんぽ",
  union: "健康保険組合",
  kokuho: "国民健康保険組合",
};

export const toInsurerType = (value: unknown): InsurerType => (value === "union" || value === "kokuho" ? value : "kyokai");

/** 健康保険組合の料率（本人負担。%） */
export interface UnionRate {
  /** この料率を使いはじめる保険料の月（YYYY-MM） */
  from: string;
  health: number;
  care: number;
  childSupport: number;
}

export interface HealthInsurer {
  id: number;
  name: string;
  type: InsurerType;
  /** 健康保険組合の料率（from の古い順） */
  rates: UnionRate[];
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** 「2026-04」→「2026年4月分」 */
export const monthLabel = (from: string): string => {
  const [y, m] = from.split("-").map(Number);
  return Number.isFinite(y) && Number.isFinite(m) ? `${y}年${m}月分` : from;
};

/** 保険料の月に使う組合の料率（その月までに始まっている、いちばん新しいもの。なければ null） */
export const unionRateFor = (rates: UnionRate[], year: number, month: number): UnionRate | null => {
  const target = ym(year, month);
  let found: UnionRate | null = null;
  for (const r of rates) {
    if (r.from <= target && (!found || r.from >= found.from)) found = r;
  }
  return found;
};

interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/** 規定と、健康保険組合の料率を、規定の番号ごとに読む */
export const loadHealthInsurers = async (db: SelectDb): Promise<Map<number, HealthInsurer>> => {
  const groups = (await db.select<{ id: number; name: string; type: string }[]>("SELECT id, name, type FROM social_insurance_groups ORDER BY id")) ?? [];
  const rates = (await db.select<{ group_id: number; from_month: string; health_rate: number; care_rate: number; child_support_rate: number }[]>(
    "SELECT group_id, from_month, health_rate, care_rate, child_support_rate FROM social_insurance_group_rates ORDER BY group_id, from_month",
  )) ?? [];
  const map = new Map<number, HealthInsurer>();
  for (const g of groups) map.set(Number(g.id), { id: Number(g.id), name: String(g.name ?? ""), type: toInsurerType(g.type), rates: [] });
  for (const r of rates) {
    map.get(Number(r.group_id))?.rates.push({
      from: String(r.from_month),
      health: Number(r.health_rate) || 0,
      care: Number(r.care_rate) || 0,
      childSupport: Number(r.child_support_rate) || 0,
    });
  }
  return map;
};

/** 従業員の規定（未加入・規定がないときは null） */
export const insurerOf = (insurers: Map<number, HealthInsurer>, groupId: unknown): HealthInsurer | null => {
  const id = Number(groupId);
  return id > 0 ? insurers.get(id) ?? null : null;
};

export interface HealthPremiumInput {
  /** 健康保険の標準報酬月額・標準賞与額（上限で切った額） */
  base: number;
  /** 保険者（null は協会けんぽ） */
  insurer: HealthInsurer | null;
  /** 協会けんぽの料率に使う都道府県 */
  prefecture: string | null | undefined;
  /** 保険料の月（料率と、子ども・子育て支援金がかかるかを決める） */
  year: number;
  month: number;
  /** 介護保険の第2号被保険者（40〜64歳）か */
  nursing: boolean;
  /** 本人負担分の端数処理（会社の設定） */
  rounding: string;
}

export interface HealthPremiums {
  health: number;
  nursing: number;
  childSupport: number;
  /** 料率がわからないので健康保険料・介護保険料を計算していない（prefecture：協会けんぽの都道府県がわからない／unionRate：組合の、この月の分の料率を入れていない） */
  missing: "prefecture" | "unionRate" | null;
  /** 使った組合の料率（健康保険組合のとき） */
  unionRate: UnionRate | null;
}

/** その月の分の健康保険料・介護保険料・子ども・子育て支援金（本人負担分） */
export const healthPremiumsOf = (p: HealthPremiumInput): HealthPremiums => {
  const ins = Master.getInsuranceMaster(p.year, p.month);
  const type = p.insurer?.type ?? "kyokai";
  const none = { health: 0, nursing: 0, childSupport: 0 };
  // 子ども・子育て支援金は、令和8年4月分から（どの保険者も同じ）
  const childMonth = Master.isChildSupportMonth(ins, p.year, p.month) && !!ins.CHILD_SUPPORT_RATE;

  if (type === "kokuho") return { ...none, missing: null, unionRate: null };

  if (type === "union") {
    const rate = unionRateFor(p.insurer?.rates ?? [], p.year, p.month);
    if (!rate) return { ...none, missing: "unionRate", unionRate: null };
    // 本人負担の料率をそのまま掛ける（折半しない）
    const health = calcPremium(p.base, rate.health, p.rounding, 1);
    const nursing = p.nursing ? calcPremium(p.base, rate.health + rate.care, p.rounding, 1) - health : 0;
    const childSupport = childMonth ? calcPremium(p.base, rate.childSupport, p.rounding, 1) : 0;
    return { health, nursing, childSupport, missing: null, unionRate: rate };
  }

  // 協会けんぽ：都道府県の料率を折半。介護保険料は「健康保険＋介護保険」の料率でまとめて計算し、健康保険料を引いた残り
  // （協会けんぽの保険料額表と同じ）。都道府県がわからなければ、ほかの都道府県で仮に計算しない
  const kenpo = p.prefecture ? ins.KENPO_RATES[p.prefecture] : undefined;
  const childSupport = childMonth ? calcPremium(p.base, ins.CHILD_SUPPORT_RATE![1], p.rounding) : 0;
  if (!kenpo) return { ...none, childSupport, missing: "prefecture", unionRate: null };
  const health = calcPremium(p.base, kenpo[1], p.rounding);
  const nursing = p.nursing ? calcPremium(p.base, kenpo[1] + ins.KENPO_CARE_RATE[1], p.rounding) - health : 0;
  return { health, nursing, childSupport, missing: null, unionRate: null };
};

/** 料率の書き方（4.95%。小数は3けたまで） */
export const ratePercent = (n: number): string => `${Math.round(n * 1000) / 1000}%`;

/** 組合の料率の書き方（2026年4月分から：健康保険 4.95%・介護保険 0.9%・子ども・子育て支援金 0.115%） */
export const describeUnionRate = (r: UnionRate): string =>
  `${monthLabel(r.from)}から：健康保険 ${ratePercent(r.health)}・介護保険 ${ratePercent(r.care)}・子ども・子育て支援金 ${ratePercent(r.childSupport)}（本人負担）`;
