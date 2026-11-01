/**
 * 年末調整の表・計算式（年分ごと）
 * いまは令和8年分だけ。ほかの年分は null（年末調整の計算はしない）
 */
import { NENCHO_2026 } from './nencho2026';
import type { NenchoMaster } from './nenchoTypes';

export type { NenchoMaster, EmploymentIncomeSegment, InsuranceFormula } from './nenchoTypes';
export { NENCHO_2026 };

const MASTERS: Record<number, NenchoMaster> = { 2026: NENCHO_2026 };

/** その年分の年末調整の表（まだ用意していない年分は null） */
export const getNenchoMaster = (year: number): NenchoMaster | null => MASTERS[year] ?? null;
