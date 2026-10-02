/**
 * 「給与規定グループ」タブ：締め日・支払日のグループ管理
 * （CompanyManager.tsx から分割）
 */
import {
    Trash2,
    AlertTriangle,
    Pencil,
    PlusCircle,
    CheckCircle2,
    X,
    Clock
} from 'lucide-react';
import {
    tabContentStyle,
    inputStyle,
    btnStyle,
    branchCardStyle,
    headBadgeStyle,
    deleteBtnStyle,
    editBtnStyle,
    addBoxStyle,
    miniLabelStyle,
    editingBadgeStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';

interface Props {
    cm: CompanyManagerState;
}

export default function PayrollGroupTab({ cm }: Props) {
    const {
        payrollGroups,
        pgName,
        setPgName,
        pgClosingDay,
        setPgClosingDay,
        pgIsNextMonth,
        setPgIsNextMonth,
        pgPaymentDay,
        setPgPaymentDay,
        editingPgId,
        deletingPgId,
        setDeletingPgId,
        startEditPg,
        resetPgForm,
        savePayrollGroup,
        deletePayrollGroup,
    } = cm;

    return (
        <section style={tabContentStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "25px" }}>
                {/* 左側：グループ一覧 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {payrollGroups.map((pg) => (
                        <div key={pg.id} style={{ 
                            ...branchCardStyle, 
                            borderLeft: "5px solid #10b981",
                            backgroundColor: editingPgId === pg.id ? "#fff9db" : "white" // 編集中の色
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    {pg.id === 1 && (
                                        <span style={{ ...headBadgeStyle, backgroundColor: "#10b981", display: "flex", alignItems: "center", gap: "4px" }}>
                                            <CheckCircle2 size={12} />基本
                                        </span>
                                    )}
                                    <strong>{pg.name}</strong>
                                </div>
                                <div style={{ fontSize: "12px", color: "#7f8c8d", display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                                    <Clock size={12} />
                                    <span>
                                        締: {pg.closing_day === 99 ? "末日" : `${pg.closing_day}日`} / 
                                        払: {pg.is_next_month ? "翌月" : "当月"} {pg.payment_day === 99 ? "末日" : `${pg.payment_day}日`}
                                    </span>
                                </div>
                            </div>
                            
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                {editingPgId === pg.id ? (
                                    <span style={{...editingBadgeStyle, display: "flex", alignItems: "center", gap: "4px"}}><Pencil size={14} />編集中...</span>
                                ) : (
                                    <>
                                        {/* 他の行を編集中、または他の行を削除待機中は操作不能にする */}
                                        {(editingPgId === null && (deletingPgId === null || deletingPgId === pg.id)) && (
                                            <>
                                                {deletingPgId === pg.id ? (
                                                    // 🗑️ 削除待機状態
                                                    <div style={{ 
                                                        display: "flex", 
                                                        alignItems: "center", 
                                                        marginRight: "12px" // ★ ここでセット全体を左に押し出します（編集ボタンの横幅分ほど）
                                                    }}>
                                                        <button onClick={() => deletePayrollGroup(pg.id)} style={{ ...deleteBtnStyle, backgroundColor: "#e74c3c", color: "white", display: "flex", alignItems: "center", gap: "4px" }}>
                                                            <AlertTriangle size={14} />本当に削除
                                                        </button>
                                                        <button onClick={() => setDeletingPgId(null)} style={{ ...editBtnStyle, backgroundColor: "#95a5a6", color: "white", display: "flex", alignItems: "center", gap: "4px" }}>
                                                            <X size={14} />取消
                                                        </button>
                                                    </div>
                                                ) : (
                                                    // 通常状態
                                                    <>
                                                        <button onClick={() => startEditPg(pg)} style={{...editBtnStyle, display: "flex", alignItems: "center", gap: "4px"}}>
                                                            <Pencil size={14} />編集
                                                        </button>
                                                        {pg.id !== 1 && (
                                                            <button onClick={() => setDeletingPgId(pg.id)} style={{...deleteBtnStyle, display: "flex", alignItems: "center", gap: "4px"}}>
                                                                <Trash2 size={14} />削除
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 右側：追加・編集フォーム */}
                <div style={{ ...addBoxStyle, border: editingPgId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
                    <h4 style={{ margin: "0 0 15px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                        {editingPgId !== null ? <Pencil size={20} color="#f1c40f" /> : <PlusCircle size={20} color="#10b981" />}
                        {editingPgId !== null ? "規定の編集" : "グループの追加"}
                    </h4>
                    
                    <label style={miniLabelStyle}>グループ名</label>
                    <input value={pgName} onChange={e => setPgName(e.target.value)} style={{ ...inputStyle, marginBottom: "15px" }} />
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
                        <div>
                            <label style={miniLabelStyle}>締日</label>
                            <select value={pgClosingDay} onChange={e => setPgClosingDay(Number(e.target.value))} style={inputStyle}>
                                {[...Array(28)].map((_, i) => <option key={i+1} value={i+1}>{i+1}日</option>)}
                                <option value={99}>末日</option>
                            </select>
                        </div>
                        <div>
                            <label style={miniLabelStyle}>支払時期</label>
                            <select value={pgIsNextMonth} onChange={e => setPgIsNextMonth(Number(e.target.value))} style={inputStyle}>
                                <option value={0}>当月払い</option>
                                <option value={1}>翌月払い</option>
                            </select>
                        </div>
                    </div>

                    <label style={miniLabelStyle}>支払日</label>
                    {/* 締日・支払日共通の選択肢生成 */}
                    <select 
                        value={pgPaymentDay} 
                        onChange={e => setPgPaymentDay(Number(e.target.value))} 
                        style={{ ...inputStyle, marginBottom: "20px" }}
                    >
                        {[...Array(28)].map((_, i) => (
                            <option key={i+1} value={i+1}>{i+1}日</option>
                        ))}
                        <option value={99}>末日</option>
                    </select>

                    <div style={{ display: "flex", gap: "10px" }}>
                        <button 
                            onClick={savePayrollGroup} 
                            // 👇 ここを修正：pgName が空（または空白のみ）の場合は無効化
                            disabled={!pgName.trim()} 
                            style={{ 
                                ...btnStyle, 
                                flex: 1, 
                                backgroundColor: !pgName.trim() ? "#bdc3c7" : (editingPgId !== null ? "#f1c40f" : "#10b981"), 
                                color: editingPgId !== null ? "#000" : "#fff",
                                // 👇 無効な時のカーソルも指定しておくと親切です
                                cursor: !pgName.trim() ? "not-allowed" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                fontSize: "14px"
                            }}
                        >
                            {/* 👇 文言も少し変えると分かりやすくなります */}
                            {!pgName.trim() ? (
                                "グループ名を入力してください"
                            ) : (
                                <>
                                    {editingPgId !== null ? <CheckCircle2 size={16} /> : <PlusCircle size={16} />}
                                    <span>{editingPgId !== null ? "更新する" : "登録する"}</span>
                                </>
                            )}
                        </button>
                        {editingPgId !== null && (
                            <button 
                                onClick={resetPgForm} 
                                style={{ 
                                    ...btnStyle, 
                                    width: "80px", 
                                    backgroundColor: "#95a5a6", 
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px"
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
