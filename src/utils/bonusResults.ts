/**
 * 賞与の確定結果（bonus_results）を保存する・取り消す文
 *
 * 確定した賞与は、年末調整・源泉徴収票・源泉徴収簿の1年分の集計に入る（支払った記録）。
 * 確定し直すときは、前の確定結果を消して保存し直すまでを、1つのトランザクションでまとめて行う（utils/dbBatch.ts の executeBatch）。
 * 途中で失敗したら、前の確定結果のまま残る。
 */
import type { SqlStatement } from "./dbBatch";
import type { PayLedger } from "./legalBooks";

/** 確定する1人分の賞与の計算結果（bonus_results の1行） */
export interface BonusResultCalc {
  totalEarnings: number;
  hyojunBonus: number;
  healthInsurance: number;
  nursingInsurance: number;
  childSupport: number;
  welfarePension: number;
  empInsurance: number;
  /** 所得税（令和6年分の定額減税を引いた後の額） */
  incomeTax: number;
  /** 引いた定額減税額（令和6年6月〜12月に支払う賞与。ほかは 0） */
  flatTaxReduction: number;
  customDeductions: number;
  netPay: number;
  isNursing: boolean;
  /** 賃金台帳の内訳（支給・控除の項目ごとの額。utils/legalBooks.ts） */
  ledger: PayLedger;
}

/**
 * 賞与を追加する文：賞与設定と、初めから有効にする項目（is_default_active）の紐付け
 * いま足した賞与の id は、賞与設定の中でいちばん大きい id（AUTOINCREMENT。まとめて保存している間はほかに足されない）
 */
export const buildAddBonusSettingStatements = (name: string, paymentDate: string): SqlStatement[] => {
  const [year, month] = paymentDate.split("-").map(Number);
  return [
    {
      sql: "INSERT INTO bonus_settings (name, target_year, target_month, payment_date) VALUES (?, ?, ?, ?)",
      values: [name, year, month, paymentDate],
    },
    {
      sql: `INSERT INTO bonus_setting_items (bonus_setting_id, item_id)
            SELECT (SELECT MAX(id) FROM bonus_settings), id FROM bonus_item_master WHERE is_default_active = 1`,
    },
  ];
};

/** 賞与を確定する文：前の確定結果を消し、1人ずつ保存し、確定済みにする */
export const buildFinalizeBonusStatements = (
  settingId: number,
  rows: { staff: { id: string | number }; calc: BonusResultCalc }[],
): SqlStatement[] => [
  { sql: "DELETE FROM bonus_results WHERE bonus_setting_id = ?", values: [settingId] },
  ...rows.map(({ staff, calc }) => ({
    sql: `INSERT INTO bonus_results (bonus_setting_id, staff_id, total_earnings, hyojun_bonus, health_insurance, nursing_insurance,
            child_support, welfare_pension, emp_insurance, income_tax, flat_tax_reduction, custom_deductions, net_pay, is_nursing, ledger)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      settingId, String(staff.id), calc.totalEarnings, calc.hyojunBonus, calc.healthInsurance, calc.nursingInsurance,
      calc.childSupport, calc.welfarePension, calc.empInsurance, calc.incomeTax, calc.flatTaxReduction, calc.customDeductions, calc.netPay,
      calc.isNursing ? 1 : 0, JSON.stringify(calc.ledger),
    ],
  })),
  { sql: "UPDATE bonus_settings SET is_closed = 1 WHERE id = ?", values: [settingId] },
];

/** 賞与の確定を取り消す文：確定結果を消し、計算中に戻す（年末調整などの集計から外れる） */
export const buildUnfinalizeBonusStatements = (settingId: number): SqlStatement[] => [
  { sql: "DELETE FROM bonus_results WHERE bonus_setting_id = ?", values: [settingId] },
  { sql: "UPDATE bonus_settings SET is_closed = 0 WHERE id = ?", values: [settingId] },
];
