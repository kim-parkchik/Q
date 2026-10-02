/**
 * 支給月の選択と、計算期間（締め日）の表示
 * （AttendanceManager.tsx から分割）
 */
import { Calendar } from 'lucide-react';
import dayjs from "dayjs";
import { S } from '../AttendanceManager.styles';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function PeriodSelector({ am }: Props) {
  const {
    targetYear,
    setTargetYear,
    targetMonth,
    setTargetMonth,
    selectedStaffId,
    payrollPeriod,
  } = am;

  return (
    <>
      {/* 年月選択エリア */}
      <div style={{ ...S.dateControlArea, position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      
        {/* 左側：支給月選択セレクトボックス */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "11px", color: "#7f8c8d", fontWeight: "bold" }}>支給対象月</label>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <select 
                value={targetYear} 
                onChange={e => setTargetYear(Number(e.target.value))} 
                style={{ ...S.input, width: "100px", fontWeight: "bold" }}
              >
                {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select 
                value={targetMonth} 
                onChange={e => setTargetMonth(Number(e.target.value))} 
                style={{ ...S.input, width: "110px", fontWeight: "bold", color: "#2c3e50" }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}月支給分</option>
                ))}
              </select>
            </div>
          </div>

          <button 
            onClick={() => { 
              const now = dayjs(); 
              setTargetYear(now.year()); 
              setTargetMonth(now.month() + 1); 
            }} 
            style={{ ...S.secondaryBtn, height: "36px" }}
          >
            <Calendar size={16} style={S.iconWrapper} />今月に戻る
          </button>
        </div>

        {/* 🆕 右側：スタッフ個別の計算期間ラベル（大きく、右端に固定） */}
        <div style={{ minWidth: "300px", textAlign: "right" }}>
          {selectedStaffId && payrollPeriod ? (
            <div style={{ 
              display: "inline-block",
              padding: "8px 20px",
              backgroundColor: "#2c3e50", // 濃い色で引き締める
              color: "#ffffff",
              borderRadius: "8px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              borderBottom: "4px solid #3498db" // アクセントの青
            }}>
              <div style={{ fontSize: "11px", color: "#bdc3c7", marginBottom: "2px", textAlign: "left" }}>
                集計対象期間
              </div>
              <div style={{ fontSize: "18px", fontWeight: "bold", fontFamily: "monospace", letterSpacing: "1px" }}>
                {payrollPeriod.startStr.replace(/-/g, '/')} 
                <span style={{ margin: "0 10px", color: "#3498db" }}>～</span>
                {payrollPeriod.endStr.replace(/-/g, '/')}
              </div>
            </div>
          ) : (
            /* 未選択時は枠だけ確保してガタつきを防ぐ、あるいは薄いガイドを表示 */
            <div style={{ fontSize: "12px", color: "#bdc3c7", padding: "24px" }}>
              従業員を選択すると集計期間が表示されます
            </div>
          )}
        </div>
      </div>
    </>
  );
}
