import "dayjs/locale/ja"; // 日本語ロケールをインポート
import dayjs from "dayjs";
dayjs.locale("ja");     // 日本語に設定
import { User, FileBox, RefreshCcw, Users } from 'lucide-react';
import { S } from './AttendanceManager.styles';
import { useAttendanceManager } from "./useAttendanceManager";
import { STATUS_OPTIONS, type AttendanceManagerProps, type AttendanceViewModel } from "./manager/types";
import CsvTab from "./manager/CsvTab";
import PeriodSelector from "./manager/PeriodSelector";
import StaffSelectBar from "./manager/StaffSelectBar";
import AttendanceTable from "./manager/AttendanceTable";
import SummaryBoard from "./manager/SummaryBoard";

export default function AttendanceManager(props: AttendanceManagerProps) {
  const am: AttendanceViewModel = {
    ...props,
    ...useAttendanceManager(props),
    statusOptions: STATUS_OPTIONS,
  };
  const { activeTab, setActiveTab, selectedStaffId, isLoading } = am;

  return (
    <div style={S.container}>
      {/* 🆕 タブメニュー */}
      <div style={S.tabContainer}>
        <button 
          onClick={() => setActiveTab("individual")} 
          style={S.tabButton(activeTab === "individual")}
        >
          <User size={18} style={S.iconWrapper} /> 個別編集・集計
        </button>
        <button 
          onClick={() => setActiveTab("csv")} 
          style={S.tabButton(activeTab === "csv")}
        >
          <FileBox size={18} style={S.iconWrapper} /> 一括操作 (CSV)
        </button>
      </div>

      {/* --- 📂 一括操作 (CSV) タブの内容 --- */}
      {activeTab === "csv" && (
        <CsvTab am={am} />
      )}
      {/* --- 👤 個別編集・集計 タブの内容 --- */}
      {activeTab === "individual" && (
        <>
          <PeriodSelector am={am} />

          <StaffSelectBar am={am} />

          {selectedStaffId ? (
            <>
              <section style={{ ...S.card, position: "relative", minHeight: "200px" }}>
                {/* 🆕 読み込み中の「幕」：isLoadingがtrueの時だけ出現 */}
                {isLoading && (
                  <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(255, 255, 255, 0.6)", // 薄い白
                    zIndex: 10,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    backdropFilter: "blur(2px)", // 🆕 背景を少しぼかすとおしゃれで安心感が出る
                    borderRadius: "8px"
                  }}>
                    <RefreshCcw size={32} className="animate-spin" style={{ color: "#3498db", marginBottom: "8px" }} />
                    <span style={{ color: "#3498db", fontWeight: "bold", fontSize: "14px" }}>読み込み中...</span>
                  </div>
                )}
                <AttendanceTable am={am} />

                <SummaryBoard am={am} />
              </section>
            </>
          ) : (
            // --- 未選択時：ガイドを表示 ---
            <div style={{ 
              ...S.summaryBoard, 
              display: "flex",           // 確実にflexを適用
              flexDirection: "column",   // 縦並びにする
              alignItems: "center",      // 左右中央
              justifyContent: "center",  // 上下中央
              background: "#f9f9f9", 
              border: "1px dashed #bdc3c7",
              minHeight: "120px"         // 少し高さを出すとより「空席感」が出て綺麗です
            }}>
              <div style={{ textAlign: "center", color: "#95a5a6" }}>
                <Users size={32} style={{ marginBottom: "8px", opacity: 0.7 }} />
                <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "4px" }}>
                  従業員を選択してください
                </div>
                <div style={{ fontSize: "12px" }}>
                  左上のリストから選択すると、ここに月次の給与概算が表示されます。
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
