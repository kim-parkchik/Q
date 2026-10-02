/**
 * 初回セットアップ時（会社情報が未保存）に表示する入力フォーム
 * （CompanyManager.tsx から分割）
 */
import {
    PencilLine,
    Fingerprint,
    Building2,
    MapPin,
    Search,
    ShieldCheck,
    HardHat,
    UserRound,
    Phone,
    CalendarDays,
    Save,
    Check,
    Rocket,
    Loader2,
    AlertCircle
} from 'lucide-react';
import * as Master from '../../../constants';
import {
    welcomeBannerStyle,
    cardStyle,
    inputStyle,
    labelStyle,
    btnStyle,
    zipInputStyle,
    zipBtnStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';

interface Props {
    cm: CompanyManagerState;
}

export default function InitialSetupForm({ cm }: Props) {
    const {
        hasSavedOnce,
        compName,
        setCompName,
        compZip,
        setCompZip,
        compAddr,
        setCompAddr,
        compPhone,
        setCompPhone,
        compNum,
        setCompNum,
        compRep,
        setCompRep,
        compHealth,
        setCompHealth,
        compLabor,
        setCompLabor,
        headPref,
        setHeadPref,
        isSaving,
        isSearchingZip,
        setIsSearchingZip,
        weekStartDay,
        setWeekStartDay,
        isSearchingComp,
        setIsZipFocus,
        handleFocus,
        handleBlur,
        handleZipSearch,
        saveCompany,
        searchCorporateNumber,
    } = cm;

    return (
        <>
            <div style={welcomeBannerStyle}>
                <h2 style={{ margin: 0 }}><PencilLine size={18} /> はじめに：初期設定</h2>
                <p style={{ margin: "10px 0 0 0" }}>会社名と所在地を設定して、アプリを開始しましょう。</p>
            </div>

            <section>
                <div style={cardStyle}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                        {/* 法人番号検索セクション */}
                        <div style={{ gridColumn: "1 / 3", marginBottom: "-10px" }}>
                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                <Fingerprint size={16} /> 法人番号 (13桁)
                            </label>
                            <div style={{ display: "flex", border: "1px solid #ddd", borderRadius: "6px", overflow: "hidden" }}>
                                <input 
                                    value={compNum} 
                                    onChange={e => {
                                        // 全角数字を半角に変換し、数字以外を除去
                                        const val = e.target.value
                                            .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
                                            .replace(/[^\d]/g, "");
                                        setCompNum(val);
                                    }}
                                    onFocus={handleFocus} 
                                    onBlur={handleBlur} 
                                    maxLength={13}
                                    placeholder="例: 5130005004301" 
                                    style={{ ...zipInputStyle, flex: 1, border: "none" }} 
                                />
                                <button 
                                    onClick={searchCorporateNumber} 
                                    disabled={isSearchingComp || compNum.length !== 13}
                                    style={{ 
                                        ...zipBtnStyle, 
                                        width: "140px", 
                                        borderLeft: "1px solid #ddd",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "6px",
                                        cursor: isSearchingComp ? "not-allowed" : "pointer"
                                    }}
                                >
                                    {isSearchingComp ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Fingerprint size={14} />
                                    )}
                                    <span>{isSearchingComp ? "取得中..." : "名称・住所取得"}</span>
                                </button>
                            </div>
                        </div>

                        {/* 住所セクション（ここも focus/blur を追加） */}
                        <div style={{ 
                            gridColumn: "1 / 3", 
                            backgroundColor: "#fcfcfc", 
                            padding: "25px",         // 内側の余白を少し広めに
                            borderRadius: "10px", 
                            border: "1px solid #eee",
                            display: "flex", 
                            flexDirection: "column", 
                            gap: "20px",              // ★ これで枠内の項目同士に均等な隙間が空きます
                            marginBottom: "-10px"
                        }}>

                            {/* 会社名 */}
                            <div>
                                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Building2 size={16} /> 会社名 / 屋号 (必須)
                                </label>
                                <input 
                                    value={compName} 
                                    onChange={e => setCompName(e.target.value)} 
                                    onFocus={handleFocus}
                                    onBlur={(e) => handleBlur(e, !compName.trim())}
                                    placeholder="株式会社 〇〇" 
                                    style={{ ...inputStyle, borderColor: !compName.trim() ? "#e74c3c" : "#ddd" }} 
                                />
                            </div>
                            
                            {/* 代表者名 */}
                            <div>
                                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                    <UserRound size={16} /> 代表者名
                                </label>
                                <input 
                                    value={compRep} 
                                    onChange={e => setCompRep(e.target.value)} 
                                    onFocus={handleFocus} 
                                    onBlur={handleBlur} 
                                    placeholder="代表 太郎"
                                    style={inputStyle} 
                                />
                            </div>

                            {/* 本店所在地 */}
                            <div>
                                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                    <MapPin size={16} /> 本店所在地
                                </label>
                                <div style={{ display: "flex", marginBottom: "12px", borderRadius: "6px", overflow: "hidden" }}>
                                    <input value={compZip} onChange={e => setCompZip(e.target.value)} onFocus={(e) => { setIsZipFocus(true); handleFocus(e); }} onBlur={(e) => { setIsZipFocus(false); handleBlur(e); }} placeholder="郵便番号" style={{ ...zipInputStyle, width: "150px" }} />
                                    <button onClick={() => handleZipSearch(compZip, setCompZip, setHeadPref, setCompAddr, setIsSearchingZip)} style={zipBtnStyle}>
                                        {isSearchingZip ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} 住所検索
                                    </button>
                                </div>
                                <div style={{ display: "flex", gap: "10px" }}>
                                    <select 
                                        value={headPref} 
                                        onChange={e => setHeadPref(e.target.value)} 
                                        onFocus={handleFocus}
                                        // 未選択なら赤、選択済みなら通常色に戻す
                                        onBlur={(e) => handleBlur(e, !headPref)}
                                        style={{ 
                                            ...inputStyle, 
                                            width: "160px", 
                                            borderColor: !headPref ? "#e74c3c" : "#ddd", // 必須チェック
                                            color: !headPref ? "#e74c3c" : "#2c3e50"     // 文字色も少し変えると気づきやすい
                                        }}
                                    >
                                        <option value="">都道府県 (必須)</option>
                                        {Master.PREFECTURE_MASTER.map(p => (
                                            <option key={p.code} value={p.name}>
                                                {p.name}
                                            </option>
                                        ))}
                                    </select>
                                    <input 
                                        value={compAddr} 
                                        onChange={e => setCompAddr(e.target.value)} 
                                        onFocus={handleFocus}
                                        onBlur={(e) => handleBlur(e)}
                                        placeholder="市区町村・番地" 
                                        style={inputStyle} 
                                    />
                                </div>
                            </div>

                            {/* 電話番号 */}
                            <div>
                                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Phone size={16} /> 電話番号
                                </label>
                                <input value={compPhone} onChange={e => setCompPhone(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} placeholder="03-1234-5678" style={inputStyle} />
                            </div>
                        </div>

                        {/* 🆕 週の起算日設定 */}
                        <div style={{ 
                            gridColumn: "1 / 3", 
                            padding: "15px", 
                            backgroundColor: "#f8fafc", 
                            borderRadius: "8px", 
                            border: "1px solid #e2e8f0",
                            marginBottom: "-10px"
                        }}>
                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px" }}>
                                <CalendarDays size={16} color="#3498db" />
                                週の起算日
                                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "normal" }}>
                                    ※週40時間超の残業計算に使用します
                                </span>
                            </label>
                            <select 
                                value={weekStartDay} // ステートを定義
                                onChange={e => setWeekStartDay(Number(e.target.value))} 
                                style={{ ...inputStyle, width: "200px" }}
                            >
                                <option value={0}>日曜日 (原則)</option>
                                <option value={1}>月曜日</option>
                                <option value={2}>火曜日</option>
                                <option value={3}>水曜日</option>
                                <option value={4}>木曜日</option>
                                <option value={5}>金曜日</option>
                                <option value={6}>土曜日</option>
                            </select>
                        </div>

                        {/* 社保・労保番号 */}
                        <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", padding: "15px", backgroundColor: "#f0f9ff", borderRadius: "8px" }}>
                            <div>
                                <label style={labelStyle}>
                                    <ShieldCheck size={14} style={{ marginRight: '6px' }} /> 社会保険 整理記号・番号
                                </label>
                                <input value={compHealth} onChange={e => setCompHealth(e.target.value)} placeholder="例: 12-あいう 1234" style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>
                                    <HardHat size={14} style={{ marginRight: '6px' }} /> 労働保険番号
                                </label>
                                <input value={compLabor} onChange={e => setCompLabor(e.target.value)} placeholder="例: 12-1-03-123456-000" style={inputStyle} />
                            </div>
                        </div>

                        <div style={{ gridColumn: "1 / 3" }}>
                            <button 
                                onClick={saveCompany} 
                                disabled={isSaving || !compName.trim() || !headPref} 
                                style={{ 
                                    ...btnStyle, 
                                    width: "100%", 
                                    backgroundColor: isSaving ? "#2ecc71" : (!hasSavedOnce ? "#3498db" : "#34495e"),
                                    opacity: (isSaving || !compName.trim() || !headPref) ? 0.6 : 1,
                                    cursor: (isSaving || !compName.trim() || !headPref) ? "not-allowed" : "pointer",
                                    // 👇 アイコンと文字を中央に揃える
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "8px"
                                }}
                            >
                                {isSaving ? (
                                    <><Check size={18} /> 保存完了</>
                                ) : hasSavedOnce ? (
                                    <><Save size={18} /> 会社情報を更新</>
                                ) : (
                                    <><Rocket size={18} /> 設定を完了して開始</>
                                )}
                            </button>
                            
                            {/* 必須項目が漏れている場合のアシスト表示 */}
                            {(!compName.trim() || !headPref) && (
                                <p style={{ 
                                    fontSize: "12px", 
                                    color: "#e74c3c", 
                                    textAlign: "center", 
                                    marginTop: "8px", 
                                    fontWeight: "bold",
                                    // 👇 警告アイコンを添える
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px"
                                }}>
                                    <AlertCircle size={14} />
                                    ※会社名と都道府県を入力すると保存できます
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
