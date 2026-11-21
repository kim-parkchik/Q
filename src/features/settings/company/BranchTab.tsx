/**
 * 「支店リスト」タブ：拠点（都道府県＝健保料率の基準）の管理
 * （CompanyManager.tsx から分割）
 */
import {
    MapPin,
    Search,
    Trash2,
    AlertTriangle,
    Pencil,
    RotateCcw,
    PlusCircle,
    CheckCircle2,
    X
} from 'lucide-react';
import * as Master from '../../../constants';
import {
    tabContentStyle,
    inputStyle,
    branchCardStyle,
    headBadgeStyle,
    branchBadgeStyle,
    deleteBtnStyle,
    editBtnStyle,
    addBoxStyle,
    miniLabelStyle,
    inputBottomSpace,
    addBtnStyle,
    zipInputStyle,
    zipBtnStyle,
    editingBadgeStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';
import { parseWeekly44Business, weekly44Problem, WEEKLY_44_OPTIONS } from '../../../utils/weekly44';
import { LEGAL_WORK_HOURS, WEEKLY_44, WEEKLY_44_BUSINESSES } from '../../../constants/workHours';

interface Props {
    cm: CompanyManagerState;
}

export default function BranchTab({ cm }: Props) {
    const {
        branches,
        editingBranchId,
        bName,
        setBName,
        bZip,
        setBZip,
        bPref,
        setBPref,
        bAddr,
        setBAddr,
        bPhone,
        setBPhone,
        bHealth,
        setBHealth,
        bLabor,
        setBLabor,
        isSearchingBZip,
        setIsSearchingBZip,
        deletingBranchId,
        setDeletingBranchId,
        isBZipFocus,
        setIsBZipFocus,
        handleFocus,
        handleBlur,
        handleZipSearch,
        saveBranch,
        resetBranchForm,
        startEditBranch,
        deleteBranch,
        saveBranchWeekly44,
        branchWorkers,
    } = cm;

    return (
        <section style={tabContentStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "25px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {/* 週44時間の特例（特例措置対象事業場。労働基準法施行規則25条の2。utils/weekly44.ts） */}
                    <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.6, padding: "8px 10px", backgroundColor: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                        <b>週{WEEKLY_44.weekly}時間の特例</b>：労働基準法 別表第一の{WEEKLY_44_BUSINESSES.map(x => `第${x.item}号`).join("・")}の事業
                        （商業・映画演劇業・保健衛生業・接客娯楽業）で、常時{WEEKLY_44.workersBelow}人未満の労働者を使用する事業場は、
                        1週間{WEEKLY_44.weekly}時間・1日{WEEKLY_44.daily}時間まで働かせられます（労働基準法施行規則25条の2）。拠点ごとに選ぶと、その拠点の人は
                        週{WEEKLY_44.weekly}時間を超えた時間を時間外労働にします（選ばなければ週{LEGAL_WORK_HOURS.weekly}時間）。人数と事業は会社で確かめて選んでください（パート・アルバイトも数えます）。
                        フレックスタイム制は清算期間が{WEEKLY_44.flexMaxMonths}か月以内のときだけで、1か月を超える人には使いません。
                    </div>
                    {branches.map((b) => {
                        const isDeleting = deletingBranchId === b.id;
                        const isEditing = editingBranchId === b.id;

                        return (
                            <div key={b.id} style={{ 
                                ...branchCardStyle, 
                                borderLeft: b.id === 1 ? "5px solid #3498db" : isDeleting ? "5px solid #e74c3c" : "5px solid #94a3b8", 
                                backgroundColor: isEditing ? "#fff9db" : isDeleting ? "#fff5f5" : "white",
                                display: "flex",
                                alignItems: "center"
                            }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                                        <span style={b.id === 1 ? headBadgeStyle : branchBadgeStyle}>
                                            {b.id === 1 ? "本店" : "支店"}
                                        </span>
                                        <strong>{b.name}</strong>
                                    </div>
                                    
                                    {/* 🏠 住所表示を2段に変更 */}
                                    <div style={{ fontSize: "12px", color: "#7f8c8d", lineHeight: "1.5", display: "flex", alignItems: "flex-start", gap: "6px", marginTop: "4px" }}>
                                        <MapPin size={12} style={{ marginTop: "3px" }} />
                                        <div>
                                            <div>〒{b.zip_code}</div>
                                            <div style={{ wordBreak: "break-all" }}>
                                                {b.prefecture}{b.address}
                                            </div>
                                        </div>
                                    </div>
                                    {/* 週44時間の特例：選ぶとすぐ保存する（本店も支店も、ここで選ぶ） */}
                                    <div style={{ marginTop: "6px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                        <label htmlFor={`weekly44-${b.id}`} style={{ color: "#475569" }}>週{WEEKLY_44.weekly}時間の特例</label>
                                        <select
                                            id={`weekly44-${b.id}`}
                                            value={parseWeekly44Business(b.weekly44_business) ?? ""}
                                            onChange={e => saveBranchWeekly44(b.id, e.target.value === "" ? null : Number(e.target.value))}
                                            style={{ fontSize: "12px", padding: "2px 4px", maxWidth: "420px" }}
                                        >
                                            <option value="">使わない（週{LEGAL_WORK_HOURS.weekly}時間）</option>
                                            {WEEKLY_44_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                        <span style={{ color: "#94a3b8" }}>在籍 {branchWorkers[Number(b.id)] ?? 0}人（役員を除く）</span>
                                    </div>
                                    {weekly44Problem(b.weekly44_business, branchWorkers[Number(b.id)] ?? 0) && (
                                        <div style={{ marginTop: "4px", fontSize: "11px", color: "#b45309", lineHeight: 1.5 }}>
                                            ⚠ {weekly44Problem(b.weekly44_business, branchWorkers[Number(b.id)] ?? 0)}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                    {b.id === 1 ? (
                                        // 🏠 本店の場合：2行に分けて右寄せで表示
                                        <div style={{ 
                                            fontSize: "11px", 
                                            color: "#94a3b8", 
                                            fontStyle: "italic", 
                                            lineHeight: "1.4",
                                            textAlign: "right", // 右側に寄せてボタン位置と合わせる
                                            paddingRight: "5px" 
                                        }}>
                                            ※本社の情報は「基本情報」<br />
                                            タブで編集できます
                                        </div>
                                    ) : (
                                        // 🏢 支店の場合：編集・削除ロジック
                                        editingBranchId === b.id ? (
                                            <span style={editingBadgeStyle}><Pencil size={14} /> 編集中...</span>
                                        ) : (
                                            <>
                                                {(editingBranchId === null && (deletingBranchId === null || isDeleting)) && (
                                                    <>
                                                        {isDeleting ? (
                                                            <div style={{ display: "flex", alignItems: "center", marginRight: "12px" }}>
                                                                <button 
                                                                    onClick={() => deleteBranch(b.id)} 
                                                                    style={{ ...deleteBtnStyle, backgroundColor: "#e74c3c", color: "white", marginRight: "20px" }}
                                                                >
                                                                    <AlertTriangle size={14} /> 本当に削除
                                                                </button>
                                                                <button onClick={() => setDeletingBranchId(null)} style={{ ...editBtnStyle, backgroundColor: "#95a5a6", color: "white" }}>
                                                                    <X size={14} />取消
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => startEditBranch(b)} style={editBtnStyle}><Pencil size={14} /> 編集</button>
                                                                <button onClick={() => setDeletingBranchId(b.id)} style={deleteBtnStyle}><Trash2 size={14} /> 削除</button>
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {/* 右：追加・編集ボックス */}
                <div style={{ ...addBoxStyle, border: editingBranchId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
                    <h4 style={{ margin: "0 0 15px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                        {editingBranchId !== null ? <Pencil size={20} color="#f1c40f" /> : <PlusCircle size={20} color="#3498db" />}
                        {editingBranchId !== null ? "支店の編集" : "支店の追加"}
                    </h4>
                    
                    <label style={miniLabelStyle}>支店名</label>
                    <input value={bName} onChange={e => setBName(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} style={{ ...inputStyle, ...inputBottomSpace }} />
                    
                    <div style={{ display: "flex", ...inputBottomSpace, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                        <input 
                            value={bZip} 
                            onChange={e => setBZip(e.target.value)} 
                            onFocus={(e) => { setIsBZipFocus(true); handleFocus(e); }}
                            onBlur={(e) => { setIsBZipFocus(false); handleBlur(e); }}
                            placeholder="郵便番号" 
                            style={{ ...zipInputStyle, zIndex: isBZipFocus ? 2 : 0 }} 
                        />
                        <button 
                            onClick={() => handleZipSearch(bZip, setBZip, setBPref, setBAddr, setIsSearchingBZip)} 
                            style={{ ...zipBtnStyle, zIndex: 1, borderLeft: "1px solid #ddd" }}
                        >
                            {isSearchingBZip ? <RotateCcw size={16} className="animate-spin" /> : <Search size={16} />}
                        </button>
                    </div>

                    <select value={bPref} onChange={e => setBPref(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} style={{ ...inputStyle, ...inputBottomSpace }}>
                        <option value="">都道府県 (必須)</option>
                        {Master.PREFECTURE_MASTER.map(p => (
                            <option key={p.code} value={p.name}>
                                {p.name}
                            </option>
                        ))}
                    </select>

                    <input value={bAddr} onChange={e => setBAddr(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} placeholder="市区町村・番地" style={{ ...inputStyle, ...inputBottomSpace }} />
                    
                    {/* ✨ 支店固有の項目 */}
                    <label style={miniLabelStyle}>支店電話番号</label>
                    <input 
                        value={bPhone} 
                        onChange={e => setBPhone(e.target.value)} 
                        placeholder="空欄なら本店と同じ"
                        style={{ ...inputStyle, ...inputBottomSpace }} 
                    />

                    <label style={miniLabelStyle}>社会保険番号（この支店が本店とは別の適用事業所のとき）</label>
                    <input 
                        value={bHealth} 
                        onChange={e => setBHealth(e.target.value)} 
                        placeholder="未入力なら本店と同じ（本店の適用事業所）"
                        style={{ ...inputStyle, marginBottom: "4px" }} 
                    />
                    <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5, marginBottom: "12px" }}>
                        空なら、この支店の人は本店の適用事業所に入っている人として、協会けんぽの健康保険料率は本店の都道府県で計算します
                        （健康保険法160条。支店を本店にまとめて届けている会社）。入れると、この支店の都道府県の料率で計算します。
                        社会保険の届書の電子申請用のファイルは本店の事業所で作るので、別の適用事業所の人の届書は、その事業所で別に出してください。
                        最低賃金と現物給与の価額は、どちらでも支店の都道府県です。
                    </div>

                    <label style={miniLabelStyle}>労働保険番号 (支店固有の場合)</label>
                    <input 
                        value={bLabor} 
                        onChange={e => setBLabor(e.target.value)} 
                        placeholder="未入力なら本店と同じ"
                        style={{ ...inputStyle, ...inputBottomSpace }} 
                    />
                    <div style={{ display: "flex", gap: "10px" }}>
                        <button 
                            onClick={saveBranch} 
                            disabled={!bName || !bPref}
                            style={{ 
                                ...addBtnStyle, 
                                backgroundColor: (!bName || !bPref) ? "#bdc3c7" : "#2ecc71",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px", // アイコンと文字の間隔
                                fontSize: "14px", // 文字を少しだけ大きく（もし小さければ）
                                padding: "8px 16px"
                            }}
                        >
                            {(!bName || !bPref) ? (
                                "支店名と都道府県を入力"
                            ) : (
                                <>
                                    {editingBranchId !== null ? <CheckCircle2 size={16} /> : <PlusCircle size={16} />}
                                    {editingBranchId !== null ? "更新する" : "支店を追加"}
                                </>
                            )}
                        </button>
                        {/* {editingBranchId !== null && <button onClick={resetBranchForm} style={{ ...addBtnStyle, backgroundColor: "#95a5a6" }}>取消</button>} */}
                        {editingBranchId !== null && (
                            <button 
                                onClick={resetBranchForm} 
                                style={{ 
                                    ...addBtnStyle, 
                                    backgroundColor: "#95a5a6", 
                                    width: '80px',
                                    // 👇 ここを追加
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px",
                                    fontSize: "14px"
                                }}
                            >
                                <X size={16} />
                                <span>取消</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
