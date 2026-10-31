import * as S from "./PayStubModal.styles";
import { usePayStubModal } from './usePayStubModal';
import * as Master from '../../constants';
import { PREFECTURES } from '../../utils/calcSalary';
import { TAX_CALC_METHOD_LABELS } from '../../utils/incomeTax';

interface Props {
  db: any;
  staff: any;
  attendanceData: any[];
  year: number;
  month: number;
  companySettings: any; // これを追加
  onClose: () => void;
}

export default function PayStubModal(props: Props) {
  const {
    salary, extras, setExtras, isSaved, handleSaveResult,
    wageLabel, customEarningItems, customDeductionItems,
    earningItemsCount, deductionItemsCount, targetRows, insMaster, rateWarnings, flatTaxTotal, fmtH
  } = usePayStubModal(props);

  const padRows = (current: number, target: number) =>
  Array.from({ length: Math.max(0, target - current) }, (_, i) => (
    <tr key={`pad-${i}`} style={{ height: 34 }}>
      <td style={S.tdS} /><td style={S.tdS} />
    </tr>
  ));

  return (
    <div style={S.overlayS}>
      <div style={S.containerS}>
        <button onClick={props.onClose} className="no-print" style={S.closeBtnS}>✕</button>

        {/* ─── 操作パネル ─── */}
        <div className="no-print" style={S.panelS}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: 15 }}>給与明細 設定</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={S.labelS}>都道府県</label>
              <select value={extras.prefecture} onChange={e => setExtras(p => ({ ...p, prefecture: e.target.value }))} style={S.inputS}>
                {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={S.labelS}>扶養人数</label>
              <input type="number" min={0} max={7} value={extras.dependents} onChange={e => setExtras(p => ({ ...p, dependents: Number(e.target.value) }))} style={S.inputS} />
            </div>
            <div>
              <label style={S.labelS}>住民税</label>
              <input type="number" min={0} value={extras.residentTax} onChange={e => setExtras(p => ({ ...p, residentTax: Number(e.target.value) }))} style={S.inputS} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ ...S.printBtnS, flex: 1 }}>🖨 印刷・PDF保存</button>
            <button 
              onClick={handleSaveResult} 
              style={{ ...S.printBtnS, flex: 1, backgroundColor: isSaved ? "#27ae60" : "#8e44ad" }}
            >
              {isSaved ? "✅ 確定済み" : "💾 給与確定"}
            </button>
          </div>
          {rateWarnings.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              {rateWarnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
          {(!salary.isSocialInsEnrolled || !salary.isEmploymentInsEnrolled || !salary.isInsuredMonth || !salary.isHealthInsAgeTarget || !salary.isPensionAgeTarget) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              {!salary.isSocialInsEnrolled && <div>※ 健康保険・厚生年金は未加入のため控除していません（従業員設定の標準報酬月額・社保規定）。</div>}
              {salary.isSocialInsEnrolled && !salary.isInsuredMonth && <div>※ 社会保険料は、入社した月の分から、退職日の翌日（資格喪失日）がある月の前月分までかかるため、この月の分はかかりません（月末に退職した人は、退職した月の分までかかります）。</div>}
              {salary.isSocialInsEnrolled && salary.isInsuredMonth && !salary.isHealthInsAgeTarget && <div>※ 75歳の誕生月の分から、健康保険料・子ども・子育て支援金はかかりません（後期高齢者医療制度へ移るため）。</div>}
              {salary.isSocialInsEnrolled && salary.isInsuredMonth && !salary.isPensionAgeTarget && <div>※ 70歳に達した月（誕生日の前日がある月）の分から、厚生年金保険料はかかりません（70歳以上被用者）。</div>}
              {!salary.isEmploymentInsEnrolled && <div>※ 雇用保険は未加入のため控除していません（従業員設定の「雇用保険加入」）。</div>}
            </div>
          )}
        </div>

        {/* ─── 明細書本体 ─── */}
        <div id="print-area" style={{ padding: 16, backgroundColor: "white" }}>
          <h1 style={S.titleS}>給　与　明　細　書</h1>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 18, borderBottom: "1.5px solid #000", paddingBottom: 2, paddingRight: 40 }}>{props.staff.name} 様</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div>{props.year} 年 {props.month} 月分</div>
              {props.staff.periodLabel && (
                <div style={{ fontSize: 11, color: "#888" }}>勤怠期間 {props.staff.periodLabel}</div>
              )}
              <div style={{ fontSize: 11, color: "#888" }}>{wageLabel}</div>
            </div>
          </div>

          <table style={S.tableS}>
            <thead>
              <tr style={S.theadS}>
                <th style={S.thS}>出勤日数</th>
                <th style={S.thS}>総労働時間</th>
                <th style={S.thS}>法定内残業</th>
                <th style={S.thS}>残業(割増対象)</th>
                <th style={S.thS}>深夜時間</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.tdCtrS}>{salary.workDays} 日</td>
                <td style={S.tdCtrS}>{fmtH(salary.totalWorkHours)}</td>
                
                {/* 1.0倍分 */}
                <td style={S.tdCtrS}>{fmtH(salary.totalStatutoryOvertimeHours)}</td>
                
                {/* 割増対象 (25%〜) */}
                <td style={S.tdCtrS}>
                  <div>{fmtH(salary.standardPremiumHours + salary.highPremiumHours)}</div>
                                  
                  {/* 60時間を超えた分がある場合のみ、内訳を表示 */}
                  {salary.highPremiumHours > 0 && (
                    <div style={{ 
                      fontSize: '10px', 
                      color: '#d35400', 
                      marginTop: 2,
                      borderTop: '1px dotted #ccc' 
                    }}>
                      {Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超: {fmtH(salary.highPremiumHours)}
                    </div>
                  )}
                  {/* 中小企業の猶予（2023年3月まで）で、60時間超も25%で計算した分 */}
                  {salary.deferredHighPremiumHours > 0 && (
                    <div style={{ fontSize: '10px', color: '#7f8c8d', marginTop: 2, borderTop: '1px dotted #ccc' }}>
                      {Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超（中小企業の猶予で25%）: {fmtH(salary.deferredHighPremiumHours)}
                    </div>
                  )}
                </td>
                              
                <td style={S.tdCtrS}>{fmtH(salary.totalNightHours)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
            {/* 支給項目 */}
            <div style={{ flex: 1 }}>
              <table style={S.tableS}>
                <thead><tr style={S.theadS}><th colSpan={2} style={S.thS}>支給項目</th></tr></thead>
                <tbody>
                  <tr><td style={S.tdS}>基本給/時給分</td><td style={S.rtdS}>¥{salary.basePay.toLocaleString()}</td></tr>
                  
                  {/* 欠勤控除 */}
                  {salary.absenceDeduction > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>欠勤控除</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.absenceDeduction.toLocaleString()}</td></tr>
                  )}

                  {/* 残業手当の内訳分け */}
                  {salary.statutoryOvertimePay > 0 && (
                    <tr><td style={S.tdS}>時間外手当(法定内)</td><td style={S.rtdS}>¥{salary.statutoryOvertimePay.toLocaleString()}</td></tr>
                  )}
                  {salary.standardOvertimePay > 0 && (
                    <tr><td style={S.tdS}>時間外手当({Math.round((Master.OVERTIME_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.standardOvertimePay.toLocaleString()}</td></tr>
                  )}
                  {salary.highOvertimePay > 0 && (
                    <tr><td style={S.tdS}>時間外手当({Math.round((Master.OVERTIME_PREMIUM_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.highOvertimePay.toLocaleString()}</td></tr>
                  )}
                  {salary.holidayWorkPay > 0 && (
                    <tr><td style={S.tdS}>休日出勤手当({Math.round((Master.HOLIDAY_WORK_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.holidayWorkPay.toLocaleString()}</td></tr>
                  )}
                  {salary.paidLeavePay > 0 && (
                    <tr><td style={S.tdS}>有給休暇手当({fmtH(salary.paidLeaveHours)})</td><td style={S.rtdS}>¥{salary.paidLeavePay.toLocaleString()}</td></tr>
                  )}

                  <tr><td style={S.tdS}>深夜手当</td><td style={S.rtdS}>¥{salary.nightPay.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>通勤手当</td><td style={S.rtdS}>¥{salary.commutePay.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>{extras.allowanceName || "任意手当"}</td><td style={S.rtdS}>¥{salary.allowanceAmount.toLocaleString()}</td></tr>
                  
                  {customEarningItems.map((item, i) => (
                    <tr key={i}><td style={S.tdS}>{item.name}</td><td style={S.rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                  ))}

                  {padRows(earningItemsCount, targetRows)}
                  <tr style={S.totalRowS}><td style={S.tdS}>支給合計</td><td style={S.rtdS}>¥{salary.totalEarnings.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>

            {/* 控除項目 */}
            <div style={{ flex: 1 }}>
              <table style={S.tableS}>
                <thead><tr style={S.theadS}><th colSpan={2} style={S.thS}>控除項目</th></tr></thead>
                <tbody>
                  <tr><td style={S.tdS}>健康保険料</td><td style={S.rtdS}>¥{salary.healthInsurance.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>介護保険料</td><td style={S.rtdS}>¥{salary.nursingInsurance.toLocaleString()}</td></tr>
                  {salary.childSupport > 0 && (
                    <tr><td style={S.tdS}>子ども・子育て支援金</td><td style={S.rtdS}>¥{salary.childSupport.toLocaleString()}</td></tr>
                  )}
                  <tr><td style={S.tdS}>厚生年金保険料</td><td style={S.rtdS}>¥{salary.welfarePension.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>雇用保険料</td><td style={S.rtdS}>¥{salary.empInsurance.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>所得税</td><td style={S.rtdS}>¥{salary.incomeTax.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>住民税</td><td style={S.rtdS}>¥{salary.residentTax.toLocaleString()}</td></tr>
                  {customDeductionItems.map((item, i) => (
                    <tr key={i}><td style={S.tdS}>{item.name}</td><td style={S.rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                  ))}
                  {padRows(deductionItemsCount, targetRows)}
                  <tr style={S.totalRowS}><td style={S.tdS}>控除合計</td><td style={S.rtdS}>¥{salary.totalDeductions.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 定額減税（令和6年6月〜）：給与支払明細書には月次減税額を書く */}
          {flatTaxTotal > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
              定額減税額（所得税）：¥{salary.flatTaxReduction.toLocaleString()}
              <span style={{ color: "#666", marginLeft: 12 }}>
                （減税前の所得税 ¥{salary.incomeTaxBeforeReduction.toLocaleString()}／控除しきれなかった額 ¥{salary.flatTaxReductionRemaining.toLocaleString()}）
              </span>
            </div>
          )}

          <div style={{ marginTop: 24, textAlign: "right" }}>
            <div style={{ display: "inline-block", border: "2px solid #000", padding: "12px 28px" }}>
              <span>差引支払額：</span>
              <span style={{ fontSize: 30, fontWeight: "bold" }}>¥{salary.netPay.toLocaleString()}</span>
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 10, color: "#999", borderTop: "1px solid #ddd", paddingTop: 8 }}>
            ※ 健康保険料は協会けんぽ{extras.prefecture}支部の{insMaster.MASTER_YEAR}年{insMaster.MASTER_MONTH}月分からの料率、
            厚生年金は{insMaster.PENSION_RATE[1]}%（折半）、雇用保険は{insMaster.LABOR_FROM.year}年{insMaster.LABOR_FROM.month}月からの料率で計算。
            所得税は{props.year}年分の{TAX_CALC_METHOD_LABELS[extras.taxMethod ?? "table"]}（甲欄）、通勤手当は非課税限度額まで課税対象外。住民税は手入力値。
          </div>
        </div>
      </div>
      <style>{S.printStyle}</style>
    </div>
  );
}