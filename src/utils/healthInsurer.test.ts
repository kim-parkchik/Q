/**
 * 健康保険の保険者（協会けんぽ・健康保険組合・国民健康保険組合）と、健康保険料・介護保険料・子ども・子育て支援金（healthInsurer.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  describeUnionRate, healthPremiumsOf, insurerOf, loadHealthInsurers, unionRateFor, type HealthInsurer, type UnionRate,
} from "./healthInsurer";
import { calcPremium } from "./socialInsurance";
import { INSURANCE_2026 } from "../constants/insurance";
import { DB_SCHEMAS } from "../types/dbSchema";

const LAW = "currency_law";
const rate = (from: string, health: number, care: number, childSupport: number): UnionRate => ({ from, health, care, childSupport });
const union = (rates: UnionRate[]): HealthInsurer => ({ id: 2, name: "確かめ健康保険組合", type: "union", rates });
const kokuho: HealthInsurer = { id: 3, name: "確かめ建設国保", type: "kokuho", rates: [] };
const base = { base: 300000, prefecture: "東京", year: 2026, month: 6, nursing: false, rounding: LAW };

describe("健康保険組合の料率（何年何月分から）", () => {
  const rates = [rate("2025-04", 4.4, 0.8, 0), rate("2026-04", 4.5, 0.8, 0.115)];
  test("その月までに始まっている、いちばん新しい料率を使う。始まる前の月は null", () => {
    expect(unionRateFor(rates, 2026, 3)?.health).toBe(4.4);
    expect(unionRateFor(rates, 2026, 4)?.health).toBe(4.5);
    expect(unionRateFor(rates, 2027, 1)?.health).toBe(4.5);
    expect(unionRateFor(rates, 2025, 3)).toBeNull();
    // 並び順に関係なく選ぶ
    expect(unionRateFor([...rates].reverse(), 2026, 5)?.health).toBe(4.5);
  });
  test("料率の書き方", () => {
    expect(describeUnionRate(rates[1])).toBe("2026年4月分から：健康保険 4.5%・介護保険 0.8%・子ども・子育て支援金 0.115%（本人負担）");
  });
});

describe("健康保険料・介護保険料・子ども・子育て支援金（本人負担分）", () => {
  test("協会けんぽ：都道府県の料率を折半。介護保険料は「健康保険＋介護保険」で計算して健康保険料を引く", () => {
    const tokyo = INSURANCE_2026.KENPO_RATES["東京"][1];
    const p = healthPremiumsOf({ ...base, insurer: null, nursing: true });
    expect(p.health).toBe(calcPremium(300000, tokyo, LAW));
    expect(p.nursing).toBe(calcPremium(300000, tokyo + INSURANCE_2026.KENPO_CARE_RATE[1], LAW) - p.health);
    expect(p.childSupport).toBe(345); // 300,000 × 0.23% ÷ 2
    expect(p.missing).toBeNull();
  });
  test("協会けんぽで都道府県がわからなければ、健康保険料・介護保険料は計算しない（支援金は全国で同じ率なので計算する）", () => {
    const p = healthPremiumsOf({ ...base, insurer: null, prefecture: "", nursing: true });
    expect([p.health, p.nursing, p.childSupport, p.missing]).toEqual([0, 0, 345, "prefecture"]);
  });
  test("健康保険組合：組合の本人負担の料率をそのまま掛ける（折半しない）。都道府県は使わない", () => {
    const p = healthPremiumsOf({ ...base, insurer: union([rate("2026-04", 4.5, 0.8, 0.115)]), prefecture: "", nursing: true });
    // 300,000 × 4.5% = 13,500、300,000 × (4.5% + 0.8%) = 15,900 → 介護 2,400、300,000 × 0.115% = 345
    expect([p.health, p.nursing, p.childSupport, p.missing]).toEqual([13500, 2400, 345, null]);
    expect(p.unionRate?.from).toBe("2026-04");
    // 40歳になる前・65歳から（第2号被保険者でない）は介護保険料がかからない
    expect(healthPremiumsOf({ ...base, insurer: union([rate("2026-04", 4.5, 0.8, 0.115)]) }).nursing).toBe(0);
  });
  test("健康保険組合でも、子ども・子育て支援金は令和8年4月分から（3月分までは率を入れていてもかからない）", () => {
    const p = healthPremiumsOf({ ...base, month: 3, insurer: union([rate("2026-01", 4.5, 0.8, 0.115)]) });
    expect([p.health, p.childSupport]).toEqual([13500, 0]);
  });
  test("健康保険組合の端数も、会社の設定どおり（原則は50銭以下切り捨て・50銭超切り上げ）", () => {
    // 150,000 × 4.553% = 6,829.5円
    const r = union([rate("2026-04", 4.553, 0, 0)]);
    expect(healthPremiumsOf({ ...base, base: 150000, insurer: r }).health).toBe(6829);
    expect(healthPremiumsOf({ ...base, base: 150000, insurer: r, rounding: "round" }).health).toBe(6830);
  });
  test("健康保険組合で、その月の分の料率がなければ計算しない（ほかの料率で仮に計算しない）", () => {
    const p = healthPremiumsOf({ ...base, insurer: union([rate("2026-07", 4.5, 0.8, 0.115)]), nursing: true });
    expect([p.health, p.nursing, p.childSupport, p.missing]).toEqual([0, 0, 0, "unionRate"]);
  });
  test("国民健康保険組合の人は、健康保険料・介護保険料・子ども・子育て支援金がかからない", () => {
    const p = healthPremiumsOf({ ...base, insurer: kokuho, nursing: true });
    expect([p.health, p.nursing, p.childSupport, p.missing]).toEqual([0, 0, 0, null]);
  });
});

describe("会社ファイルから読む", () => {
  test("規定と組合の料率を、規定の番号ごとに読む。未加入・ない番号は null", async () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec("INSERT INTO social_insurance_groups (id, name, type) VALUES (1, '協会けんぽ', 'kyokai'), (2, '確かめ健康保険組合', 'union'), (3, '確かめ建設国保', 'kokuho')");
    db.exec(`INSERT INTO social_insurance_group_rates (group_id, from_month, health_rate, care_rate, child_support_rate)
             VALUES (2, '2026-04', 4.5, 0.8, 0.115), (2, '2025-04', 4.4, 0.8, 0)`);
    const select = async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T;
    const insurers = await loadHealthInsurers({ select });
    expect(insurerOf(insurers, 2)).toEqual(union([rate("2025-04", 4.4, 0.8, 0), rate("2026-04", 4.5, 0.8, 0.115)]));
    expect(insurerOf(insurers, 3)).toEqual(kokuho);
    expect(insurerOf(insurers, 1)?.type).toBe("kyokai");
    expect(insurerOf(insurers, null)).toBeNull();
    expect(insurerOf(insurers, 9)).toBeNull();
    // 同じ月の料率は2つ入れられない
    expect(() => db.exec("INSERT INTO social_insurance_group_rates (group_id, from_month, health_rate) VALUES (2, '2026-04', 4.6)")).toThrow();
  });
});
