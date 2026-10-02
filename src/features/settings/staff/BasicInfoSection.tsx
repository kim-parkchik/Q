/**
 * 「基本情報」：氏名・フリガナ・生年月日・性別・住所・電話など
 * （StaffManager.tsx から分割）
 */
import { Search, Loader2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function BasicInfoSection({ cm }: Props) {
    const {
        editingId,
        isSearchingZip,
        targetId,
        setTargetId,
        targetName,
        setTargetName,
        targetFurigana,
        setTargetFurigana,
        targetBirthday,
        setTargetBirthday,
        targetGender,
        setTargetGender,
        targetZip,
        setTargetZip,
        targetAddress,
        setTargetAddress,
        targetPhone,
        setTargetPhone,
        targetMobile,
        setTargetMobile,
        handleZipSearch,
        isIdDuplicated,
    } = cm;

    return (
        <>
            <h4 style={{ borderLeft: "4px solid #3498db", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>基本情報</h4>
        
            <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                    {/* 従業員IDエリア */}
                    <div>
                        <label style={labelStyle}>
                            従業員ID 
                            <span style={{ 
                                marginLeft: "6px", 
                                color: "#e74c3c", 
                                fontSize: "10px", 
                                backgroundColor: "#fdedec", 
                                padding: "1px 4px", 
                                borderRadius: "3px" 
                            }}>必須</span>
                        </label>
                        <input placeholder="001" value={targetId} onChange={e => setTargetId(e.target.value)} style={{ ...inputStyle, borderColor: isIdDuplicated() ? "#e74c3c" : "#ddd" }} disabled={!!editingId} />
                    </div>
                </div>

                {/* 氏名エリア */}
                <div style={{ flex: 2 }}>
                    <label style={labelStyle}>
                        氏名
                        <span style={{ 
                            marginLeft: "6px", 
                            color: "#e74c3c", 
                            fontSize: "10px", 
                            backgroundColor: "#fdedec", 
                            padding: "1px 4px", 
                            borderRadius: "3px" 
                        }}>必須</span>
                    </label>
                    <input placeholder="浜 太郎" value={targetName} onChange={e => setTargetName(e.target.value)} style={inputStyle} />
                    <input placeholder="はま たろう" value={targetFurigana} onChange={e => setTargetFurigana(e.target.value)} style={{ ...inputStyle, marginTop: "4px", fontSize: "12px", height: "30px" }} />
                </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
                {/* 生年月日 */}
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>生年月日</label>
                    <input 
                    type="date" 
                    value={targetBirthday} 
                    onChange={e => setTargetBirthday(e.target.value)} 
                    style={inputStyle} 
                    />
                </div>

                {/* 性別 */}
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>性別</label>
                    <select 
                    value={targetGender || "unknown"} 
                    onChange={e => setTargetGender(e.target.value)} 
                    style={inputStyle}
                    >
                    <option value="unknown">未設定 / 回答しない</option>
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                    </select>
                </div>
            </div>

            {/* 郵便番号セクションをグループ化 */}
            <div style={{ width: "50%" }}> {/* 幅を半分に制限 */}
                <label style={labelStyle}>郵便番号</label>
                <div 
                    className="zip-container" // CSSで光らせるためのクラス（後述）
                    style={{ 
                        display: "flex", 
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)", 
                        borderRadius: "6px", 
                        marginTop: "4px",
                        height: "38px",
                        border: "1px solid #ddd", // 枠線を親に持たせる
                        overflow: "hidden",
                        transition: "all 0.2s", // アニメーション
                    }}
                >
                    <input 
                        placeholder="000-0000" 
                        value={targetZip} 
                        onChange={e => setTargetZip(e.target.value)} 
                        onFocus={(e) => e.currentTarget.parentElement!.style.borderColor = "#3498db"} // フォーカスで青く
                        onBlur={(e) => e.currentTarget.parentElement!.style.borderColor = "#ddd"}    // 外れたら戻す
                        style={{ 
                            ...inputStyle, 
                            height: "100%", 
                            border: "none", // 中の枠線は消す
                            outline: "none", // ブラウザ標準の青枠を消す（親が光るため）
                            flex: 1,
                            marginTop: 0,
                            padding: "0 12px"
                        }} 
                    />
                    <button 
                        onClick={handleZipSearch}
                        disabled={isSearchingZip}
                        style={{ 
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "0 15px", 
                            height: "100%",
                            backgroundColor: "#f8fafc", 
                            border: "none", // 枠線は親が持っているので不要
                            borderLeft: "1px solid #ddd", // 入力欄との境界線だけ残す
                            cursor: isSearchingZip ? "not-allowed" : "pointer", 
                            fontSize: "12px", 
                            color: "#3498db", 
                            fontWeight: "bold", 
                            whiteSpace: "nowrap",
                            transition: "all 0.2s"
                        }}
                    >
                        {isSearchingZip ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Search size={14} />
                        )}
                        <span>住所検索</span>
                    </button>
                </div>
            </div>

            {/* 住所セクションをグループ化 */}
            <div>
                <label style={labelStyle}>住所</label>
                <textarea 
                    value={targetAddress} 
                    onChange={e => setTargetAddress(e.target.value)} 
                    style={{ ...inputStyle, height: "80px", resize: "none", marginTop: "4px" }} 
                />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>電話番号</label>
                    <input placeholder="03-xxxx-xxxx" value={targetPhone} onChange={e => setTargetPhone(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>携帯電話</label>
                    <input placeholder="090-xxxx-xxxx" value={targetMobile} onChange={e => setTargetMobile(e.target.value)} style={inputStyle} />
                </div>
            </div>
            <div style={{ gridColumn: "span 2", marginTop: "5px" }}>
                <label style={{ ...labelStyle, color: "#95a5a6" }}>マイナンバー</label>
                <input 
                    type="text" 
                    value="" 
                    readOnly 
                    placeholder="**** **** **** (現在は入力できません)"
                    style={{ 
                        ...inputStyle, 
                        backgroundColor: "#f5f5f5", 
                        color: "#999", 
                        cursor: "not-allowed",
                        border: "1px solid #eee"
                    }} 
                />
            </div>
        </>
    );
}
