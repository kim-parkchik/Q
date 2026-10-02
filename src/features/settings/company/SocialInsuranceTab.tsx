/**
 * 「社会保険規定」タブ：協会けんぽ・組合健保などの料率グループ管理
 * （CompanyManager.tsx から分割）
 */
import {
    Pencil,
    RotateCcw,
    PlusCircle,
    X
} from 'lucide-react';
import * as Master from '../../../constants';
import {
    tabContentStyle,
    cardStyle,
    inputStyle,
    btnStyle,
    editBtnStyle,
    addBoxStyle,
    miniLabelStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';

interface Props {
    cm: CompanyManagerState;
}

export default function SocialInsuranceTab({ cm }: Props) {
    const {
        sgName,
        setSgName,
        sgType,
        setSgType,
        sgHealthRate,
        setSgHealthRate,
        sgCareRate,
        setSgCareRate,
        sgPensionRate,
        setSgPensionRate,
        sgIsFixed,
        setSgIsFixed,
        sgFixedAmount,
        setSgFixedAmount,
        editingSgId,
        previewPref,
        setPreviewPref,
        showInactive,
        setShowInactive,
        sgCompHealthRate,
        setSgCompHealthRate,
        sgCompCareRate,
        setSgCompCareRate,
        sgCompPensionRate,
        setSgCompPensionRate,
        sgChildAllowanceRate,
        setSgChildAllowanceRate,
        sgCompFixedAmount,
        setSgCompFixedAmount,
        rates,
        saveSocialGroup,
        resetSgForm,
        startEditSg,
        getPlaceholder,
        toggleSocialGroupStatus,
        activeGroups,
        inactiveGroups,
    } = cm;

    return (
        <section style={tabContentStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "25px" }}>
                {/* 左側：一覧 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {/* --- 有効な規定 --- */}
                    {activeGroups.map(sg => (
                        <div key={sg.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px" }}>
                            <div>
                                <div style={{ fontWeight: "bold", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                                    {sg.name}
                                    {sg.id === 1 && (
                                        <span style={{ fontSize: "10px", backgroundColor: "#e1f5fe", color: "#0288d1", padding: "2px 6px", borderRadius: "4px" }}>システム既定</span>
                                    )}
                                </div>
                                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                                    {sg.type === 'kyokai' ? (
                                        <span style={{ color: "#0288d1" }}>都道府県により自動計算</span>
                                    ) : sg.is_fixed ? (
                                        <span style={{ color: "#2980b9" }}>定額: {sg.fixed_amount.toLocaleString()}円</span>
                                    ) : (
                                        `健保:${sg.health_rate}% / 年金:${sg.pension_rate}% / 介護:${sg.care_rate}%`
                                    )}
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={() => startEditSg(sg)} style={editBtnStyle}><Pencil size={14} /> 編集</button>
                                {sg.id !== 1 && (
                                    <button 
                                        onClick={() => toggleSocialGroupStatus(sg.id, sg.name, 1)} 
                                        style={{ ...editBtnStyle, color: "#e74c3c" }}
                                        title="廃止する"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* --- 廃止済みの規定（折りたたみ） --- */}
                    {inactiveGroups.length > 0 && (
                        <div style={{ marginTop: "10px" }}>
                            <button 
                                onClick={() => setShowInactive(!showInactive)}
                                style={{ fontSize: "12px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                            >
                                {showInactive ? "▲ 廃止済みを隠す" : `▼ 廃止済みの規定を表示 (${inactiveGroups.length}件)`}
                            </button>
                            
                            {showInactive && (
                                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {inactiveGroups.map(sg => (
                                        <div key={sg.id} style={{ ...cardStyle, opacity: 0.6, backgroundColor: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 15px" }}>
                                            <span style={{ fontSize: "13px", color: "#64748b" }}>{sg.name} (廃止)</span>
                                            <button 
                                                onClick={() => toggleSocialGroupStatus(sg.id, sg.name, 0)}
                                                style={{ ...editBtnStyle, color: "#27ae60", borderColor: "#27ae60" }}
                                            >
                                                <RotateCcw size={12} /> 復元
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 右側：フォーム */}
                <div style={{ ...addBoxStyle, border: editingSgId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
                    <h4 style={{ margin: "0 0 15px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                    {editingSgId !== null ? <Pencil size={20} color="#f1c40f" /> : <PlusCircle size={20} color="#3498db" />}
                    {editingSgId !== null ? "規定の編集" : "社保規定の追加"}
                    </h4>

                    <label style={miniLabelStyle}>規定名</label>
                    <input 
                    value={sgName} 
                    onChange={e => setSgName(e.target.value)} 
                    style={{ ...inputStyle, marginBottom: "15px" }} 
                    placeholder={getPlaceholder()}
                    />

                    <div style={{ marginBottom: "15px" }}>
                    <label style={miniLabelStyle}>種別</label>
                    <select 
                        value={sgType} 
                        onChange={e => {
                        setSgType(e.target.value);
                        if (e.target.value === "kyokai") setSgIsFixed(0);
                        }} 
                        style={inputStyle}
                        disabled={editingSgId === 1} // 初期データの協会けんぽは種別変更不可
                    >
                        {/* 編集時かつ協会けんぽの場合のみ選択肢に出す。新規追加時は出さない */}
                        {editingSgId === 1 && <option value="kyokai">協会けんぽ</option>}
                        <option value="union">健康保険組合</option>
                        <option value="kokuho">国保組合</option>
                    </select>
                    </div>

                    {/* 協会けんぽの場合の表示切り替え */}
                    {sgType === "kyokai" ? (
                        <div style={{ marginBottom: "20px" }}>
                            <div style={{ 
                            padding: "16px", 
                            backgroundColor: "#f8fafc", 
                            borderRadius: "10px", 
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.02)"
                            }}>
                            <div style={{ fontWeight: "bold", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "14px", color: "#1e293b" }}>
                                📊 適用料率（{Master.INSURANCE_2026.MASTER_YEAR}年{Master.INSURANCE_2026.MASTER_MONTH}月改定版）
                                </span>
                            </div>

                            {/* 都道府県切り替えセレクト */}
                            <div style={{ marginBottom: "12px" }}>
                                <label style={{ ...miniLabelStyle, color: "#64748b" }}>プレビューする都道府県</label>
                                <select 
                                value={previewPref} 
                                onChange={(e) => setPreviewPref(e.target.value)}
                                style={{ ...inputStyle, height: "32px", fontSize: "13px", padding: "0 8px" }}
                                >
                                {Object.keys(Master.INSURANCE_2026.KENPO_RATES).map(pref => (
                                    <option key={pref} value={pref}>{pref}</option>
                                ))}
                                </select>
                            </div>
                            
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px", backgroundColor: "#ffffff", padding: "12px", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                                <span style={{ color: "#64748b" }}>健康保険（{previewPref}）</span>
                                <span style={{ fontWeight: "800", color: "#2c3e50" }}>{rates.healthTotal}%</span>
                                </div>
                                
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                                <span style={{ color: "#64748b" }}>介護保険（全国一律）</span>
                                <span style={{ fontWeight: "800", color: "#2c3e50" }}>{rates.careTotal}%</span>
                                </div>
                                
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                                <span style={{ color: "#64748b" }}>厚生年金（全国共通）</span>
                                <span style={{ fontWeight: "800", color: "#2c3e50" }}>{rates.pensionTotal}%</span>
                                </div>
                            </div>

                            <p style={{ marginTop: "12px", fontSize: "11px", color: "#94a3b8", lineHeight: "1.4" }}>
                                ※ 実際の計算では、各スタッフが所属する支店の都道府県設定が優先されます。ここでは確認のみ可能です。
                            </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div style={{ marginBottom: "15px" }}>
                                <label style={miniLabelStyle}>計算方法</label>
                                <select value={sgIsFixed} onChange={e => setSgIsFixed(Number(e.target.value))} style={inputStyle}>
                                    <option value={0}>料率計算</option>
                                    <option value={1}>定額固定</option>
                                </select>
                            </div>

                            {/* sgIsFixed === 0 (料率計算) の場合の中身を差し替え */}
                            {sgIsFixed === 0 ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "15px", marginBottom: "20px" }}>
                                    
                                    {/* 本人負担率セクション */}
                                    <div style={{ padding: "10px", backgroundColor: "#f0f7ff", borderRadius: "8px" }}>
                                        <span style={{ fontSize: "11px", fontWeight: "bold", color: "#0056b3", display: "block", marginBottom: "8px" }}>👤 本人負担率（給与控除）</span>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                                            <div><label style={miniLabelStyle}>健保(%)</label><input type="number" step="0.001" value={sgHealthRate} onChange={e => setSgHealthRate(Number(e.target.value))} style={inputStyle} /></div>
                                            <div><label style={miniLabelStyle}>介護(%)</label><input type="number" step="0.001" value={sgCareRate} onChange={e => setSgCareRate(Number(e.target.value))} style={inputStyle} /></div>
                                            <div><label style={miniLabelStyle}>年金(%)</label><input type="number" step="0.001" value={sgPensionRate} onChange={e => setSgPensionRate(Number(e.target.value))} style={inputStyle} /></div>
                                        </div>
                                    </div>

                                    {/* 会社負担率セクション */}
                                    <div style={{ padding: "10px", backgroundColor: "#fff5f5", borderRadius: "8px" }}>
                                        <span style={{ fontSize: "11px", fontWeight: "bold", color: "#c0392b", display: "block", marginBottom: "8px" }}>🏢 会社負担率（法定福利費）</span>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                                            <div><label style={miniLabelStyle}>健保(%)</label><input type="number" step="0.001" value={sgCompHealthRate} onChange={e => setSgCompHealthRate(Number(e.target.value))} style={inputStyle} /></div>
                                            <div><label style={miniLabelStyle}>介護(%)</label><input type="number" step="0.001" value={sgCompCareRate} onChange={e => setSgCompCareRate(Number(e.target.value))} style={inputStyle} /></div>
                                            <div><label style={miniLabelStyle}>年金(%)</label><input type="number" step="0.001" value={sgCompPensionRate} onChange={e => setSgCompPensionRate(Number(e.target.value))} style={inputStyle} /></div>
                                        </div>
                                        <div style={{ marginTop: "10px" }}>
                                            <label style={miniLabelStyle}>子ども・子育て拠出金(%)</label>
                                            <input type="number" step="0.001" value={sgChildAllowanceRate} onChange={e => setSgChildAllowanceRate(Number(e.target.value))} style={inputStyle} />
                                        </div>
                                    </div>

                                </div>
                            ) : (
                                /* 定額固定の場合（こちらも本人・会社を分けたほうが親切です） */
                                <div style={{ marginBottom: "20px" }}>
                                    <div style={{ marginBottom: "10px" }}>
                                        <label style={miniLabelStyle}>本人負担・月額(円)</label>
                                        <input type="number" value={sgFixedAmount} onChange={e => setSgFixedAmount(Number(e.target.value))} style={inputStyle} />
                                    </div>
                                    <div>
                                        <label style={miniLabelStyle}>会社負担・月額(円)</label>
                                        <input type="number" value={sgCompFixedAmount} onChange={e => setSgCompFixedAmount(Number(e.target.value))} style={inputStyle} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    <div style={{ display: "flex", gap: "10px" }}>
                    <button 
                        onClick={saveSocialGroup} 
                        disabled={!sgName.trim()} 
                        style={{ ...btnStyle, flex: 1, backgroundColor: !sgName.trim() ? "#bdc3c7" : "#3498db" }}
                    >
                        {editingSgId !== null ? "変更を保存" : "追加する"}
                    </button>
                    {editingSgId !== null && <button onClick={resetSgForm} style={{ ...btnStyle, width: "70px", backgroundColor: "#95a5a6" }}>取消</button>}
                    </div>
                </div>
            </div>
        </section>
    );
}
