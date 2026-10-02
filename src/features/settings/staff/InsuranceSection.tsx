/**
 * 「税・社会保険・労働保険」：加入区分・標準報酬月額・扶養人数・各種番号
 * （StaffManager.tsx から分割）
 */
import { UserCheck, Shield, Timer, Banknote } from 'lucide-react';
import { HYOJUN_OPTIONS } from './staffOptions';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function InsuranceSection({ cm }: Props) {
    const {
        targetIsExecutive,
        setTargetIsExecutive,
        targetIsOvertimeEligible,
        setTargetIsOvertimeEligible,
        targetDependents,
        setTargetDependents,
        targetResidentTax,
        setTargetResidentTax,
        targetStandardRemuneration,
        setTargetStandardRemuneration,
        targetIsEmploymentInsEligible,
        setTargetIsEmploymentInsEligible,
        targetHealthInsNum,
        setTargetHealthInsNum,
        targetPensionNum,
        setTargetPensionNum,
        targetEmploymentInsNum,
        setTargetEmploymentInsNum,
        targetSocialInsGroupId,
        setTargetSocialInsGroupId,
        socialGroups,
    } = cm;

    return (
        <div style={{ marginTop: "10px" }}>
            <h4 style={{ borderLeft: "4px solid #9b59b6", paddingLeft: "10px", margin: "0 0 10px 0", fontSize: "14px" }}>税・社会保険・労働保険</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {/* --- 3大フラグ・スイッチ群 --- */}
                <div style={{ gridColumn: "span 2", display: "flex", gap: "15px", backgroundColor: "#f8fafc", padding: "10px", borderRadius: "5px", border: "1px solid #e2e8f0" }}>
                    <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer", gap: "6px" }}>
                        <input 
                            type="checkbox" 
                            checked={targetIsExecutive === 1} 
                            onChange={e => setTargetIsExecutive(e.target.checked ? 1 : 0)}
                        />
                        <UserCheck size={14} color="#64748b" />
                        役員
                    </label>

                    <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer", gap: "6px" }}>
                        <input 
                            type="checkbox" 
                            checked={targetIsEmploymentInsEligible === 1} 
                            onChange={e => setTargetIsEmploymentInsEligible(e.target.checked ? 1 : 0)}
                        />
                        <Shield size={14} color="#64748b" />
                        雇用保険加入
                    </label>

                    <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer", gap: "6px" }}>
                        <input 
                            type="checkbox" 
                            checked={targetIsOvertimeEligible === 1} 
                            onChange={e => setTargetIsOvertimeEligible(e.target.checked ? 1 : 0)}
                        />
                        <Timer size={14} color="#64748b" />
                        残業代対象
                    </label>
                </div>
                {/* 🆕 扶養人数（1fr） */}
                <div>
                    <label style={labelStyle}>扶養人数</label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <input type="number" value={targetDependents} onChange={e => setTargetDependents(Number(e.target.value))} style={{ ...inputStyle, paddingRight: "30px", textAlign: "right" }} />
                        <span style={{ position: "absolute", right: "10px", fontSize: "12px", color: "#7f8c8d" }}>人</span>
                    </div>
                </div>

                {/* 🆕 住民税額（span 2 を外して 1fr に） */}
                <div>
                    <label style={labelStyle}>住民税額（月額）</label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <input type="number" value={targetResidentTax} onChange={e => setTargetResidentTax(Number(e.target.value))} style={{ ...inputStyle, paddingRight: "30px", textAlign: "right" }} />
                        <span style={{ position: "absolute", right: "10px", fontSize: "12px", color: "#7f8c8d" }}>円</span>
                    </div>
                </div>


                {/* <div style={{ gridColumn: "span 2" }}> */}
                <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>

                    {/* 上段：入力欄 2つを横並びにする */}
                    <div style={{ display: "flex", gap: "15px", alignItems: "flex-end" }}>
                        
                        {/* 左側 4割: 社保規定 */}
                        <div style={{ flex: 4 }}>
                            <label style={labelStyle}>
                                <Shield size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                                適用する社保規定
                            </label>
                            <select 
                                value={targetSocialInsGroupId} 
                                onChange={e => setTargetSocialInsGroupId(Number(e.target.value))}
                                style={{ ...inputStyle, fontFamily: "monospace", fontSize: "12px"}}
                            >
                                <option value={0}>未加入 / 適用除外</option>
                                {socialGroups.map(sg => (
                                    <option key={sg.id} value={sg.id}>{sg.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* 右側 6割: 標準報酬月額 */}
                        <div style={{ flex: 6 }}>
                            <label style={labelStyle}>
                                <Banknote size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                                標準報酬月額（社会保険計算用）
                            </label>
                            <select
                                value={targetStandardRemuneration} 
                                onChange={(e) => setTargetStandardRemuneration(Number(e.target.value))}
                                style={{ ...inputStyle, fontFamily: "monospace", fontSize: "12px" }} 
                            >
                                <option value={0}>0: 未加入・対象外</option>
                                {HYOJUN_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 下段：注釈（自動的に下に配置される） */}
                    <div style={{ width: "100%" }}>
                        <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 0 240px" }}>
                            ※決定通知書に記載されている等級の金額を選択してください。
                        </p>
                    </div>
                </div>
                {/* 🆕 各種被保険者番号 */}
                <div style={{ 
                    gridColumn: "span 2", 
                    display: "grid", 
                    gridTemplateColumns: "1fr 1fr", 
                    gap: "10px", 
                    marginTop: "6px", 
                    borderTop: "1px dashed #e2e8f0", 
                    paddingTop: "8px" 
                }}>
                    {/* 健康保険 */}
                    <div>
                        <label style={{ 
                            ...labelStyle, 
                            color: targetStandardRemuneration > 0 ? "#2c3e50" : "#bdc3c7" 
                        }}>
                            健康保険 被保険者番号
                        </label>
                        <input 
                            type="text" 
                            value={targetStandardRemuneration > 0 ? targetHealthInsNum : ""} 
                            onChange={e => setTargetHealthInsNum(e.target.value)} 
                            disabled={targetStandardRemuneration === 0} // 👈 0（未加入）なら入力不可
                            style={{ 
                                ...inputStyle, 
                                backgroundColor: targetStandardRemuneration > 0 ? "#fff" : "#f1f5f9",
                                cursor: targetStandardRemuneration > 0 ? "text" : "not-allowed" 
                            }} 
                            placeholder={targetStandardRemuneration > 0 ? "例: 12345" : "社会保険未加入"}
                        />
                    </div>

                    {/* 厚生年金 */}
                    <div>
                        <label style={{ 
                            ...labelStyle, 
                            color: targetStandardRemuneration > 0 ? "#2c3e50" : "#bdc3c7" 
                        }}>
                            厚生年金 整理番号
                        </label>
                        <input 
                            type="text" 
                            value={targetStandardRemuneration > 0 ? targetPensionNum : ""} 
                            onChange={e => setTargetPensionNum(e.target.value)} 
                            disabled={targetStandardRemuneration === 0} // 👈 0（未加入）なら入力不可
                            style={{ 
                                ...inputStyle, 
                                backgroundColor: targetStandardRemuneration > 0 ? "#fff" : "#f1f5f9",
                                cursor: targetStandardRemuneration > 0 ? "text" : "not-allowed" 
                            }} 
                            placeholder={targetStandardRemuneration > 0 ? "例: 67890" : "社会保険未加入"}
                        />
                    </div>

                    {/* 雇用保険（こちらは既存の targetIsEmploymentInsEligible で制御） */}
                    <div style={{ gridColumn: "span 2" }}>
                        <label style={{ 
                            ...labelStyle, 
                            color: targetIsEmploymentInsEligible === 1 ? "#2c3e50" : "#bdc3c7" 
                        }}>
                            雇用保険 被保険者番号
                        </label>
                        <input 
                            type="text" 
                            value={targetIsEmploymentInsEligible === 1 ? targetEmploymentInsNum : ""} 
                            onChange={e => setTargetEmploymentInsNum(e.target.value)} 
                            disabled={targetIsEmploymentInsEligible === 0} 
                            style={{ 
                                ...inputStyle, 
                                backgroundColor: targetIsEmploymentInsEligible === 1 ? "#fff" : "#f1f5f9",
                                cursor: targetIsEmploymentInsEligible === 1 ? "text" : "not-allowed" 
                            }} 
                            placeholder={targetIsEmploymentInsEligible === 1 ? "例: 1234-567890-1" : "雇用保険未加入"}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
