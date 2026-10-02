/**
 * 「一括操作 (CSV)」タブ：勤怠データの書き出し・取り込み
 * （AttendanceManager.tsx から分割）
 */
import { FileSpreadsheet, FileDown, FileUp } from 'lucide-react';
import { modernIconBtnStyle } from "../../../styles/styles";
import { S } from '../AttendanceManager.styles';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function CsvTab({ am }: Props) {
  const {
    payrollPeriod,
    handleExportRawCSV,
    handleExportFullCSV,
    handleImportCSV,
  } = am;

  return (
    <div style={{ ...S.card, borderTop: "4px solid #7f8c8d" }}>
      <h3 style={{ marginTop: 0 }}>データの入出力</h3>
      <p style={{ fontSize: "13px", color: "#666" }}>
        勤怠データの書き出し、およびCSVファイルからの取り込みを行います。
      </p>
      <div style={{ display: "flex", gap: "15px", marginTop: "20px" }}>
        
        {/* エクスポート側 */}
        <div style={{ flex: 1, padding: "15px", border: "1px solid #eee", borderRadius: "8px", backgroundColor: "#f9f9f9" }}>
          <h4 style={{ marginTop: 0 }}><FileUp size={20} style={S.iconWrapper} /> エクスポート設定</h4>
          
          {/* 🆕 期間指定フォーム */}
          <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "#fff", borderRadius: "6px", border: "1px solid #ddd" }}>
            <label style={{ fontSize: "11px", fontWeight: "bold", color: "#666", display: "block", marginBottom: "5px" }}>
              出力対象期間
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input 
                type="date" 
                value={payrollPeriod?.startStr} 
                style={{ ...S.input, padding: "4px" }} 
                onChange={() => {/* 必要に応じてカスタム期間用のstateを更新 */}}
              />
              <span>～</span>
              <input 
                type="date" 
                value={payrollPeriod?.endStr} 
                style={{ ...S.input, padding: "4px" }} 
              />
            </div>
            <p style={{ fontSize: "11px", color: "#e67e22", marginTop: "5px" }}>
              ※デフォルトで現在の選択月が表示されています
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <button onClick={handleExportRawCSV} style={modernIconBtnStyle("#7f8c8d")}>
              <FileSpreadsheet size={16} style={S.iconWrapper} /> 打刻ログ（Rawデータ）を出力
            </button>
            <button onClick={handleExportFullCSV} style={modernIconBtnStyle("#34495e")}>
              <FileUp size={16} style={S.iconWrapper} /> 確定フラグ付き詳細データを出力
            </button>
          </div>
        </div>

        {/* インポート側 */}
        <div style={{ flex: 1, padding: "15px", border: "1px solid #eee", borderRadius: "8px" }}>
          <h4 style={{ marginTop: 0 }}><FileDown size={20} style={S.iconWrapper} /> インポート</h4>
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "10px" }}>
            ファイル内の日付に基づき、全期間のデータを一括で取り込みます。
          </p>
          <button onClick={handleImportCSV} style={{ ...modernIconBtnStyle("#2980b9"), width: "100%" }}>
            <FileDown size={16} style={S.iconWrapper} /> CSVファイルを読み込む
          </button>
          <p style={{ fontSize: "11px", color: "#d35400", marginTop: "10px", fontWeight: "bold" }}>
            ※給与確定済みの期間は上書きされません。
          </p>
        </div>

      </div>
    </div>
  );
}
