// 1. 各年度のマスターオブジェクトをインポート
import { INSURANCE_2024 } from './insurance2024';
import { INSURANCE_2025 } from './insurance2025';
import { INSURANCE_2026 } from './insurance2026';

// 2. 他のファイルで使い回すための「共通の型」をここで定義
export type InsuranceMasterType = typeof INSURANCE_2026;
export type EmpInsType = keyof typeof INSURANCE_2026.LABOR_INSURANCE_RATES;

// 3. 衝突しないオブジェクト名でそのままエクスポート
export { INSURANCE_2024, INSURANCE_2025, INSURANCE_2026 };