/**
 * 「端数処理」タブ：残業代・社会保険・雇用保険の端数処理ルール
 * （CompanyManager.tsx から分割）
 */
import {
    ShieldCheck,
    HardHat,
    Save,
    Loader2,
    Clock,
    Hash
} from 'lucide-react';
import {
    tabContentStyle,
    roundingRowStyle,
    cardStyle,
    inputStyle,
    btnStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';

interface Props {
    cm: CompanyManagerState;
}

export default function RoundingTab({ cm }: Props) {
    const {
        isSaving,
        roundOvertime,
        setRoundOvertime,
        roundSocialIns,
        setRoundSocialIns,
        roundEmpIns,
        setRoundEmpIns,
        saveRoundingSettings,
    } = cm;

    return (
        <section style={tabContentStyle}>
            <div style={cardStyle}>
                <h3 style={{ marginTop: 0, fontSize: "16px", color: "#34495e", display: "flex", alignItems: "center", gap: "8px" }}>
                    <Hash size={20} color="#3498db" /> 各計算項目の端数処理ルール
                </h3>
                <p style={{ fontSize: "13px", color: "#7f8c8d", marginBottom: "20px" }}>
                    法令および就業規則に基づき、1円未満の端数をどのように処理するかを選択してください。
                </p>

                <div style={{ display: "grid", gap: "20px" }}>
                    {/* --- 残業代 --- */}
                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                        <div style={{ flex: 1 }}>
                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                <Clock size={16} color="#e67e22" /> 残業代・深夜手当
                            </strong>
                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                ※1ヶ月の合計額に対して適用されます。
                            </small>
                        </div>
                        <select 
                            value={roundOvertime} 
                            onChange={e => setRoundOvertime(e.target.value)} 
                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                        >
                            <option value="round">四捨五入（0.50円以上切上 / 労基法容認）</option>
                            <option value="currency_law">法的原則（0.51円以上切上 / 通貨単位法）</option>
                            <option value="ceil">常に切り上げ（従業員に有利）</option>
                            <option value="floor">常に切り捨て（⚠️未払いのリスクあり）</option>
                        </select>
                    </div>

                    {/* --- 社会保険 --- */}
                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                        <div style={{ flex: 1 }}>
                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                <ShieldCheck size={16} color="#27ae60" /> 社会保険料（個人負担分）
                            </strong>
                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                ※通貨単位法により、50銭以下切り捨てが一般的です。
                            </small>
                        </div>
                        <select 
                            value={roundSocialIns} 
                            onChange={e => setRoundSocialIns(e.target.value)} 
                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                        >
                            <option value="floor">切り捨て（一般的）</option>
                            <option value="round">四捨五入（特約がある場合）</option>
                            <option value="ceil">切り上げ</option>
                        </select>
                    </div>

                    {/* --- 雇用保険 --- */}
                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                        <div style={{ flex: 1 }}>
                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                <HardHat size={16} color="#2980b9" /> 雇用保険料（個人負担分）
                            </strong>
                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                ※50銭以下切り捨て、51銭以上切り上げルール。
                            </small>
                        </div>
                        <select 
                            value={roundEmpIns} 
                            onChange={e => setRoundEmpIns(e.target.value)} 
                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                        >
                            <option value="currency_law">法的原則：0.51円以上切上</option>
                            <option value="round">四捨五入（50銭ルールに近い）</option>
                            <option value="floor">切り捨て</option>
                            <option value="ceil">切り上げ</option>
                        </select>
                    </div>
                </div>

                <button 
                    onClick={saveRoundingSettings} // ← 用意してあった関数を呼び出す
                    disabled={isSaving}           // 保存中は連打できないようにする
                    style={{ 
                        ...btnStyle, 
                        marginTop: "30px", 
                        backgroundColor: "#34495e", 
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        opacity: isSaving ? 0.7 : 1, // 保存中は少し色を薄くする
                        cursor: isSaving ? "not-allowed" : "pointer"
                    }}
                >
                    {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    <span>{isSaving ? "保存中..." : "端数処理設定を保存"}</span>
                </button>
            </div>
        </section>
    );
}
