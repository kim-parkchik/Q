/**
 * アプリケーション全体のシステム設定
 */

export const DEFAULT_BASE_DATE = '2026-01-01';

/** ドキュメントフォルダ内に作成するメインディレクトリ名 */
export const APP_DIR_NAME = "Q";

/** バックアップを保存するサブディレクトリ名 */
export const BACKUP_DIR_NAME = "Backup";

/** ログファイルを保存するサブディレクトリ名 (必要であれば) */
export const LOG_DIR_NAME = "Logs";

/** CSVなどの出力ファイルを保存するときの初期フォルダ名（保存先は毎回選べる） */
export const EXPORT_DIR_NAME = "Export";

/** --- 拡張子の定義 --- */
/** メインデータベース (Active Project) */
export const EXT_MAIN = "qp";
/** バックアップファイル (Backup) */
export const EXT_BACKUP = "qb";
/** システムログファイル (Log) */
export const EXT_LOG = "qlog";

/** ダイアログ表示用のフィルタ名 */
export const APP_PROJECT_NAME = "Q Payroll File";

/** --- 業務ロジックに関する定数 --- */

/** 
 * システムがサポートする最小年 (2026年1月〜)
 * これ以前のデータは作成・計算の対象外とする
 */
export const SYSTEM_MIN_YEAR = 2026;

// 祝日データ取得用（内閣府提供のCSV）
export const HOLIDAY_CSV_URL_DEFAULT = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";