/**
 * 月の集計結果（勤務日数・残業・深夜・交通費・欠勤控除・支給見込み）
 * （AttendanceManager.tsx から分割）
 */
import { Banknote } from 'lucide-react';
import { formatHours } from "../../../utils/timeUtils";
import * as Master from '../../../constants';
import { S } from '../AttendanceManager.styles';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function SummaryBoard({ am }: Props) {
  const {
    selectedStaff,
    monthlyWorkData,
    calcResult,
  } = am;

  return (
    <>
      {/* --- スタッフ選択済み：計算結果を表示 --- */}
      <div style={S.summaryBoard}>
        <div>
          <div style={{ fontSize: "12px", color: "#bdc3c7" }}>基本情報</div>
          <div style={{ fontSize: "18px", fontWeight: "bold" }}>
            {Object.values(monthlyWorkData).filter(d => d.is_finalized).length}日 / {formatHours(calcResult?.totalWorkHours || 0)}
          </div>
          {selectedStaff?.wage_type === "monthly" && (
            <div style={{ fontSize: "11px", color: "#95a5a6" }}>月給: ¥{Number(selectedStaff?.base_wage || 0).toLocaleString()}</div>
          )}
           {selectedStaff?.wage_type === "daily" && (
            <div style={{ fontSize: "11px", color: "#95a5a6" }}>日給: ¥{Number(selectedStaff?.base_wage || 0).toLocaleString()}</div>
          )}
           {selectedStaff?.wage_type === "hourly" && (
            <div style={{ fontSize: "11px", color: "#95a5a6" }}>時給: ¥{Number(selectedStaff?.base_wage || 0).toLocaleString()}</div>
          )}
        </div>
                    
        <div>
          <div style={{ fontSize: "12px", color: "#e74c3c" }}>残業合計 (割増込)</div>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: "#e74c3c" }}>
            {formatHours(calcResult?.totalOvertimeHours ?? 0)}
          </div>
          {(calcResult?.highPremiumHours ?? 0) > 0 && (
            <div style={{ fontSize: "11px", color: "#ff7675" }}> 
              (うち{Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超 [{(Master.OVERTIME_PREMIUM_RATE - 1) * 100}%増]: {formatHours(calcResult?.highPremiumHours ?? 0)}) 
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: "12px", color: "#f1c40f" }}>深夜合計</div>
          <div style={{ fontSize: "18px", fontWeight: "bold", color: "#f1c40f" }}>{formatHours(calcResult?.totalNightHours ?? 0)}</div>
        </div>

        {/* 交通費：常に出す */}
        <div>
          <div style={{ fontSize: "12px", color: "#bdc3c7" }}>交通費</div>
          <div style={{ fontSize: "18px", fontWeight: "bold" }}>
            ¥{(calcResult?.commutePay ?? 0).toLocaleString()}
          </div>
        </div>

        {/* 🆕 欠勤控除がある場合のみ追加で表示：三項演算子ではなく「&&」で差し込む */}
        {calcResult && calcResult.absenceDeduction > 0 && (
          <div style={{ borderLeft: "1px solid #eee", paddingLeft: "15px" }}>
            <div style={{ fontSize: "12px", color: "#ff7675" }}>欠勤控除</div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ff7675" }}>
              -¥{calcResult.absenceDeduction.toLocaleString()}
            </div>
          </div>
        )}

        <div style={{ borderLeft: "1px solid #7f8c8d", paddingLeft: "20px", textAlign: "right", marginLeft: "auto" }}>
          <div style={{ fontSize: "12px", color: "#2ecc71" }}>
            <Banknote size={14} style={{ verticalAlign: "middle", marginRight: "4px" }} /> 
            差引総支給額（概算）
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#2ecc71" }}>
            ¥{(calcResult?.totalEarnings ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: "10px", color: "#95a5a6" }}>※残業・深夜・交通費・控除を反映済</div>
        </div>
      </div>
    </>
  );
}
