/**
 * 年末調整の表・計算式と、源泉徴収票の記載に使う区分（年分ごと）
 * いまは令和8年分だけ。ほかの年分は null（年末調整の計算・源泉徴収票の作成はしない）
 */
import { NENCHO_2026 } from './nencho2026';
import { GENSEN_2026 } from './gensen2026';
import type { NenchoMaster, WithholdingSlipMaster } from './nenchoTypes';

export type { NenchoMaster, EmploymentIncomeSegment, InsuranceFormula, WithholdingSlipMaster } from './nenchoTypes';
export { NENCHO_2026, GENSEN_2026 };

const MASTERS: Record<number, NenchoMaster> = { 2026: NENCHO_2026 };
const SLIP_MASTERS: Record<number, WithholdingSlipMaster> = { 2026: GENSEN_2026 };

/** その年分の年末調整の表（まだ用意していない年分は null） */
export const getNenchoMaster = (year: number): NenchoMaster | null => MASTERS[year] ?? null;

/** その年分の源泉徴収票の記載に使う区分（まだ用意していない年分は null） */
export const getWithholdingSlipMaster = (year: number): WithholdingSlipMaster | null => SLIP_MASTERS[year] ?? null;
