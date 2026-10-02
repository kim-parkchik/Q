/**
 * 従業員一覧の上部：支店での絞り込み・キーワード検索・在籍状態フィルタ
 * （StaffManager.tsx から分割）
 */
import { Search } from 'lucide-react';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function StaffFilterBar({ cm }: Props) {
    const {
        searchKeyword,
        setSearchKeyword,
        filterStatus,
        setFilterStatus,
        branches,
        branchFilters,
        setBranchFilters,
    } = cm;

    return (
        <section style={{ marginBottom: "20px" }}>
            {/* 1. 上段：支店選択 */}
            <div style={{ 
                backgroundColor: "white", 
                padding: "12px 20px", 
                borderRadius: "10px 10px 0 0", 
                border: "1px solid #e2e8f0",
                borderBottom: "none", 
                display: "flex",
                alignItems: "center",
                gap: "15px",
                flexWrap: "wrap"
            }}>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b" }}>対象支店:</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {branches.map(b => {
                        // 現在の支店名が、選択中配列に含まれているか
                        const isActive = branchFilters.includes(b.name);
                        
                        return (
                            <button
                                key={b.id}
                                onClick={() => {
                                    setBranchFilters(prev => 
                                        prev.includes(b.name) 
                                            ? prev.filter(v => v !== b.name) // あれば消す
                                            : [...prev, b.name]             // なければ足す
                                    );
                                }}
                                // 有給管理で定義した getFilterButtonStyle と同じロジックを適用
                                style={{
                                    padding: "4px 14px",
                                    borderRadius: "15px",
                                    borderWidth: "1px",
                                    borderStyle: "solid",
                                    borderColor: "#0055A4",
                                    backgroundColor: isActive ? "#0055A4" : "white",
                                    color: isActive ? "white" : "#0055A4",
                                    cursor: "pointer",
                                    fontSize: "11px",
                                    fontWeight: "bold",
                                    transition: "0.2s"
                                }}
                            >
                                {b.name}
                            </button>
                        );
                    })}
                </div>
                
                {/* リセットボタンの処理 */}
                <button 
                    onClick={() => {
                        setBranchFilters(branches.map(b => b.name)); // 全支店を選択状態に
                        setFilterStatus(["active", "on_leave", "retired"]);
                        setSearchKeyword("");
                    }}
                    style={{ 
                        marginLeft: "auto", 
                        fontSize: "11px", 
                        border: "none", 
                        background: "none", 
                        color: "#94a3b8", 
                        cursor: "pointer", 
                        textDecoration: "underline" 
                    }}
                >
                    条件をリセット
                </button>
            </div>

            {/* 2. 下段：キーワード検索 ＆ 状態フィルタ */}
            <div style={{ 
                backgroundColor: "#f1f5f9",
                padding: "10px 20px", 
                borderRadius: "0 0 10px 10px", 
                border: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                gap: "30px", // 有給管理(40px)より少し詰めて検索幅を確保
                height: "56px", 
                boxSizing: "border-box"
            }}>
                {/* 左側：キーワード検索（ここを幅広く持たせる） */}
                <div style={{ flex: "1", position: "relative" }}> {/* position: relative を追加 */}
                    {/* 検索アイコンを配置 */}
                    <Search 
                        size={16} 
                        style={{ 
                            position: "absolute", 
                            left: "10px", 
                            top: "50%", 
                            transform: "translateY(-50%)", 
                            color: "#94a3b8", 
                            pointerEvents: "none" 
                        }} 
                    />
                    <input 
                        placeholder="ID、名前、フリガナ、役割などで検索..." 
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        onFocus={(e) => {
                            e.currentTarget.style.borderColor = "#3498db";
                            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(52, 152, 219, 0.2)";
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = "#cbd5e1";
                            e.currentTarget.style.boxShadow = "none";
                        }}
                        style={{ 
                            width: "100%",
                            fontSize: "14px",
                            padding: "0 12px 0 32px", // 左側にアイコン分の余白(32px)を確保
                            height: "36px", 
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            boxSizing: "border-box",
                            backgroundColor: "white",
                            outline: "none", // デフォルトの黒枠を消す
                            transition: "all 0.2s ease-in-out" // 変化を滑らかに
                        }}
                    />
                </div>

                {/* 右側：状態フィルタ */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b" }}>状態:</span>
                    {[
                        { label: "在籍", value: "active", color: "#2ecc71" },
                        { label: "休職", value: "on_leave", color: "#f1c40f" },
                        { label: "退職", value: "retired", color: "#e74c3c" }
                    ].map(opt => {
                        const isActive = filterStatus.includes(opt.value);
                        return (
                            <button
                                key={opt.value}
                                onClick={() => setFilterStatus(prev => 
                                    prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                                )}
                                style={{
                                    padding: "4px 14px",
                                    borderRadius: "15px",
                                    border: `1px solid ${opt.color}`,
                                    backgroundColor: isActive ? opt.color : "white",
                                    color: isActive ? "white" : opt.color,
                                    cursor: "pointer",
                                    fontSize: "11px",
                                    fontWeight: "bold",
                                    height: "28px",
                                    lineHeight: "1"
                                }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
