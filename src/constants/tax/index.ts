// 1. 各年度のマスターオブジェクトをインポート
import { TAX_2025 } from './tax2025';
import { TAX_2026 } from './tax2026';

// 2. 他のファイルで使い回すための「共通の型」をここで定義（★追加）
export type TaxMasterType = typeof TAX_2026;

// 3. 衝突しないオブジェクト名でそのままエクスポート
export { TAX_2025, TAX_2026 };