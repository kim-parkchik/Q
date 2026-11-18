/**
 * 社会保険料・労働保険料の集計表（会社負担分と、年金事務所の納入告知額との照らし合わせ）
 *
 * ■ 社会保険料（保険料の月ごと）：日本年金機構「保険料の計算方法について」による。
 *   ・納入告知額は、被保険者ごとの標準報酬月額・標準賞与額に、制度ごとの保険料率を掛けた額を合計し、合計の1円未満を切り捨てる
 *     （被保険者ごとには端数を処理しない）
 *   ・事業主負担分は、納入告知額から、被保険者が負担する額（給与・賞与から引いた額）の合計を引いた額
 *   Q は、その月の分に保険料がかかる人（入社・退職・年齢・産休と育休の免除は給与の計算と同じ。utils/calcSalary.ts）の標準報酬月額と、
 *   その月に支払った賞与の標準賞与額（厚生年金は1か月150万円、健康保険は年度で573万円まで）から、協会けんぽの料率（拠点の都道府県ごと）で
 *   健康保険料（介護保険料を含む）・子ども・子育て支援金・厚生年金保険料・子ども・子育て拠出金（事業主だけが負担）の見込みを出す。
 *   本人負担は、その月の分を引いた給与（当月徴収はその月に支給、翌月徴収は次の月に支給。給与規定グループの設定）と、その月に支払った賞与から。
 *   健康保険組合・国民健康保険組合の人の健康保険料は、組合の決まりによるので本人負担だけを出す
 * ■ 労働保険料（支給した月ごと）：その月に支給した給与・賞与の労働保険の賃金（年度更新と同じ。utils/nendoKoshin.ts）から、
 *   雇用保険料の本人負担（給与・賞与から引いた額）と会社負担の見込み（賃金 × 事業主負担の率）、労災保険料（賃金 × 労災保険率。会社だけが負担）を出す。
 *   年度の保険料は年度更新で申告・精算する（ここは毎月の会計の見込み）
 */
import * as Master from "../constants";
import { checkInsuredMonth, checkSocialInsEnrolled, getInsuranceByAge } from "./calcSalary";
import { insurerOf, type HealthInsurer } from "./healthInsurer";
import { checkLeaveExemptMonth, exemptLeavePeriodsOf } from "./leaveExemption";
import { pensionStandardOf } from "./remunerationReport";
import { getStandardRemuneration } from "./standardRemuneration";

export interface PremiumSalary {
  staff_id: string;
  target_year: number;
  target_month: number;
  health_insurance: number;
  nursing_insurance: number;
  child_support: number;
  welfare_pension: number;
  kokuho_premium: number;
  emp_insurance: number;
  total_earnings: number;
  non_remuneration: number;
  in_kind_emp: number;
}

export interface PremiumBonus {
  staff_id: string;
  payment_date: string;
  hyojun_bonus: number;
  health_insurance: number;
  nursing_insurance: number;
  child_support: number;
  welfare_pension: number;
  emp_insurance: number;
  total_earnings: number;
}

export interface PremiumInput {
  year: number;
  month: number;
  staffList: any[];
  /** その月と次の月に支給した、確定した給与 */
  salaries: PremiumSalary[];
  /** その年度（4月〜翌3月）に支払った、確定した賞与（健康保険の年度の上限を見る） */
  bonuses: PremiumBonus[];
  insurers: Map<number, HealthInsurer>;
  prefectureOf: (branchId: unknown) => string | null;
  /** 給与規定グループの社会保険料の徴収（current：当月徴収・next：翌月徴収） */
  collectionOf: (groupId: unknown) => string;
  /** その人の拠点の労災保険率（1,000分の。わからなければ null） */
  rousaiRateOf: (staff: any) => number | null;
}

export interface PremiumLine {
  label: string;
  /** 納入告知額の見込み（わからなければ null） */
  total: number | null;
  employee: number;
  /** 会社負担（total − employee。total がなければ null） */
  company: number | null;
}

export interface PremiumSummary {
  social: PremiumLine[];
  socialPersons: number;
  labor: { label: string; wages: number; employee: number; company: number | null }[];
  notes: string[];
}

const n = (v: unknown) => Number(v) || 0;
/** 料率（%）を 1,000倍の整数にする（掛け算の小数の誤差で、切り捨てが1円ずれないように、整数で足してから最後に割る） */
const milli = (ratePercent: number) => Math.round(ratePercent * 1000);
/** 1円未満を切り捨てる（整数で足した「額 × 料率の1,000倍」を 100,000 で割る） */
const floorYen = (scaled: number) => Math.floor(scaled / 100000);
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const nextYm = (y: number, m: number) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });

export const premiumSummary = (p: PremiumInput): PremiumSummary => {
  const { year, month } = p;
  const ins = Master.getInsuranceMaster(year, month);
  const childMonth = Master.isChildSupportMonth(ins, year, month) && !!ins.CHILD_SUPPORT_RATE;
  const notes: string[] = [];
  const range = { min: ins.PENSION_MIN_HYOJUN, max: ins.PENSION_MAX_HYOJUN };
  const monthKey = ym(year, month);
  const next = nextYm(year, month);
  const fyStart = month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;

  // 協会けんぽは、都道府県ごとに料率が違うので、都道府県ごとに合計して切り捨てる
  const kenpo = new Map<string, { health: number; child: number }>();
  let pensionBase = 0;
  let contributionBase = 0;
  const emp = { kyokaiHealth: 0, kyokaiChild: 0, unionHealth: 0, unionChild: 0, pension: 0, kokuho: 0 };
  let unionPeople = 0;
  let persons = 0;
  const pending: string[] = [];
  const addKenpo = (pref: string, health: number, child: number) => {
    const cur = kenpo.get(pref) ?? { health: 0, child: 0 };
    cur.health += health;
    cur.child += child;
    kenpo.set(pref, cur);
  };

  for (const s of p.staffList) {
    const id = String(s.id);
    const insurer = insurerOf(p.insurers, s.social_insurance_group_id);
    const type = insurer?.type ?? "kyokai";
    const byAge = getInsuranceByAge(String(s.birthday ?? ""), year, month, s.kouki_date, s.kaigo_exempt);
    const insured = checkSocialInsEnrolled(s, year, month) && checkInsuredMonth(s.join_date, s.retirement_date, year, month)
      && !checkLeaveExemptMonth(exemptLeavePeriodsOf(s), year, month);
    // 本人負担：その月の分を引いた給与（当月徴収はその月、翌月徴収は次の月に支給）
    const collectNext = p.collectionOf(s.payroll_group_id) === "next";
    const payYm = collectNext ? next : { y: year, m: month };
    const sal = p.salaries.find((x) => String(x.staff_id) === id && Number(x.target_year) === payYm.y && Number(x.target_month) === payYm.m);
    if (insured) {
      persons += 1;
      const std = getStandardRemuneration(s, year, month);
      if (!sal && (byAge.health || byAge.pension)) pending.push(String(s.name ?? id));
      if (byAge.health && type === "kyokai") {
        const pref = p.prefectureOf(s.branch_id);
        const rate = pref ? ins.KENPO_RATES[pref] : undefined;
        if (!pref || !rate) notes.push(`${s.name ?? id}さんは拠点の都道府県がわからないので、健康保険料の見込みに入れていません。`);
        else addKenpo(pref, Math.min(std, ins.KENPO_MAX_HYOJUN) * (milli(rate[1]) + (byAge.nursing ? milli(ins.KENPO_CARE_RATE[1]) : 0)),
          childMonth ? Math.min(std, ins.KENPO_MAX_HYOJUN) * milli(ins.CHILD_SUPPORT_RATE![1]) : 0);
      }
      if (byAge.health && type === "union") unionPeople += 1;
      if (byAge.pension) {
        const ps = pensionStandardOf(std, range);
        pensionBase += ps * milli(ins.PENSION_RATE[1]);
        contributionBase += ps;
      }
    }
    if (sal) {
      if (type === "kyokai") { emp.kyokaiHealth += n(sal.health_insurance) + n(sal.nursing_insurance); emp.kyokaiChild += n(sal.child_support); }
      if (type === "union") { emp.unionHealth += n(sal.health_insurance) + n(sal.nursing_insurance); emp.unionChild += n(sal.child_support); }
      emp.pension += n(sal.welfare_pension);
      emp.kokuho += n(sal.kokuho_premium);
    }
    // その月に支払った賞与
    const mine = p.bonuses.filter((b) => String(b.staff_id) === id).sort((a, b) => a.payment_date.localeCompare(b.payment_date));
    let earlierHealth = 0;
    for (const b of mine) {
      if (b.payment_date < fyStart) continue;
      const hyojun = n(b.hyojun_bonus);
      const healthStd = Math.max(0, Math.min(hyojun, ins.HEALTH_INS_ANNUAL_LIMIT - earlierHealth));
      const inMonth = b.payment_date.slice(0, 7) === monthKey;
      if (inMonth) {
        if (n(b.health_insurance) > 0 && type === "kyokai") {
          const pref = p.prefectureOf(s.branch_id);
          const rate = pref ? ins.KENPO_RATES[pref] : undefined;
          if (pref && rate) addKenpo(pref, healthStd * (milli(rate[1]) + (n(b.nursing_insurance) > 0 ? milli(ins.KENPO_CARE_RATE[1]) : 0)),
            childMonth && n(b.child_support) > 0 ? healthStd * milli(ins.CHILD_SUPPORT_RATE![1]) : 0);
        }
        if (n(b.welfare_pension) > 0) {
          const ps = Math.min(hyojun, ins.PENSION_INS_SINGLE_LIMIT);
          pensionBase += ps * milli(ins.PENSION_RATE[1]);
          contributionBase += ps;
        }
        if (type === "kyokai") { emp.kyokaiHealth += n(b.health_insurance) + n(b.nursing_insurance); emp.kyokaiChild += n(b.child_support); }
        if (type === "union") { emp.unionHealth += n(b.health_insurance) + n(b.nursing_insurance); emp.unionChild += n(b.child_support); }
        emp.pension += n(b.welfare_pension);
      }
      if (n(b.health_insurance) > 0) earlierHealth += healthStd;
    }
  }

  const healthTotal = [...kenpo.values()].reduce((t, v) => t + floorYen(v.health), 0);
  const childTotal = [...kenpo.values()].reduce((t, v) => t + floorYen(v.child), 0);
  const pensionTotal = floorYen(pensionBase);
  const contribution = floorYen(contributionBase * milli(ins.CHILD_ALLOWANCE_RATE));
  const line = (label: string, total: number | null, employee: number): PremiumLine => ({ label, total, employee, company: total === null ? null : total - employee });
  const social: PremiumLine[] = [
    line("健康保険料（介護保険料を含む。協会けんぽ）", healthTotal, emp.kyokaiHealth),
    ...(childMonth ? [line("子ども・子育て支援金（協会けんぽ）", childTotal, emp.kyokaiChild)] : []),
    line("厚生年金保険料", pensionTotal, emp.pension),
    line("子ども・子育て拠出金（会社だけが負担）", contribution, 0),
  ];
  if (unionPeople > 0 || emp.unionHealth > 0) {
    social.push(line("健康保険料（介護保険料・子ども・子育て支援金を含む。健康保険組合）", null, emp.unionHealth + emp.unionChild));
    notes.push("健康保険組合の人の保険料の合計と会社負担は、組合の決まり（料率・負担の割合）によるので、本人負担だけを出しています。");
  }
  if (emp.kokuho > 0) social.push(line("国民健康保険組合の保険料", null, emp.kokuho));
  if (pending.length > 0) {
    notes.push(`次の人は、この月の分の保険料を引く給与（当月徴収はこの月、翌月徴収は次の月に支給）がまだ確定していないので、本人負担に入っていません：${pending.join("・")}`);
  }

  // 労働保険料（その月に支給した給与・賞与）
  let koyoWages = 0;
  let koyoEmp = 0;
  let koyoCompany = 0;
  let rousaiWages = 0;
  let rousaiPremium = 0;
  let rousaiUnknown = false;
  const paidThisMonth = [
    ...p.salaries.filter((x) => Number(x.target_year) === year && Number(x.target_month) === month)
      .map((x) => ({ staffId: String(x.staff_id), wage: n(x.total_earnings) - n(x.non_remuneration) + n(x.in_kind_emp), emp: n(x.emp_insurance) })),
    ...p.bonuses.filter((b) => b.payment_date.slice(0, 7) === monthKey)
      .map((b) => ({ staffId: String(b.staff_id), wage: n(b.total_earnings), emp: n(b.emp_insurance) })),
  ];
  for (const x of paidThisMonth) {
    const s = p.staffList.find((y) => String(y.id) === x.staffId);
    if (!s) continue;
    const koyoInsured = Number(s.is_employment_ins_eligible ?? 1) !== 0;
    const executiveOut = Number(s.is_executive) === 1 && !koyoInsured;
    if (koyoInsured) {
      const type = (s.employment_insurance_type || "general") as Master.EmpInsType;
      const rates = ins.LABOR_INSURANCE_RATES[type] ?? ins.LABOR_INSURANCE_RATES.general;
      koyoWages += x.wage;
      koyoEmp += x.emp;
      // 率は小数（0.0135 など）なので、10万倍の整数にして掛ける
      koyoCompany += x.wage * (Math.round(rates[1] * 100000) - Math.round(rates[0] * 100000));
    }
    if (!executiveOut) {
      rousaiWages += x.wage;
      const rate = p.rousaiRateOf(s);
      if (rate === null) rousaiUnknown = true;
      else rousaiPremium += x.wage * Math.round(rate * 100);
    }
  }
  if (rousaiUnknown) notes.push("労災保険の事業の種類が入っていない拠点の人がいるので、労災保険料の見込みに入れていない人がいます（会社設定の「雇用保険・労働保険」で入れます）。");
  return {
    social, socialPersons: persons,
    labor: [
      { label: "雇用保険料", wages: koyoWages, employee: koyoEmp, company: Math.floor(koyoCompany / 100000) },
      { label: "労災保険料（会社だけが負担）", wages: rousaiWages, employee: 0, company: Math.floor(rousaiPremium / 100000) },
    ],
    notes: [...new Set(notes)],
  };
};
