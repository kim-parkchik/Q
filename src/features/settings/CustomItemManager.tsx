import React from "react";
import * as S from "./CustomItemManager.styles";
import { useCustomItemManager } from "./useCustomItemManager";

interface Props {
    db: any; // Database型
    staffList: any[];
}

export default function CustomItemManager({ db, staffList }: Props) {
    const {
        activeTab, setActiveTab,
        items, earnings, deductions, selectedStaffId, setSelectedStaffId, staffValues,
        newItemName, setNewItemName, newItemType, setNewItemType, newItemCategory, setNewItemCategory,
        addMasterItem, deleteMasterItem, saveAmount,
        moveItem // ← 忘れずに受け取る
    } = useCustomItemManager(db);

    const getCategoryLabel = (cat: string) => {
        switch (cat) {
            case 'fixed': return '📌 固定';
            case 'variable': return '📝 変動';
            case 'formula': return '🤖 自動';
            default: return cat;
        }
    };

    return (
        <div style={S.container}>
            {/* --- タブメニュー --- */}
            <div style={S.tabContainer}>
                <button 
                    onClick={() => setActiveTab("master")} 
                    style={activeTab === "master" ? S.activeTab : S.tab}
                >
                    項目マスター設定
                </button>
                <button 
                    onClick={() => setActiveTab("assignment")} 
                    style={activeTab === "assignment" ? S.activeTab : S.tab}
                >
                    個人別金額設定
                </button>
            </div>

            {/* --- コンテンツエリア --- */}
            <div style={{ width: "100%" }}>
                {activeTab === "master" ? (
                    /* タブ1：項目マスター管理 */
                    <div style={S.card("#3498db")}>
                        <h3 style={S.header}>⚙️ 項目マスター設定</h3>
                        
                        {/* 新規追加エリア（ここは少しリッチな枠で囲む） */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "30px", background: "#f0f7ff", padding: "20px", borderRadius: "10px", border: "1px solid #d0e3ff" }}>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>タイプ</label>
                                    <select value={newItemType} onChange={e => setNewItemType(e.target.value as any)} style={{ ...S.input, width: "100%" }}>
                                        <option value="earning">💰 支給</option>
                                        <option value="deduction">💸 控除</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>計算区分</label>
                                    <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value as any)} style={{ ...S.input, width: "100%" }}>
                                        <option value="fixed">📌 固定（毎月同額）</option>
                                        <option value="variable">📝 変動（毎月入力）</option>
                                        <option value="formula">🤖 自動（数式計算）</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>項目名</label>
                                <input 
                                    placeholder="例: 役職手当、厚生年金など" 
                                    value={newItemName} 
                                    onChange={e => setNewItemName(e.target.value)}
                                    style={{ ...S.input, width: "100%" }}
                                />
                            </div>
                            <button onClick={addMasterItem} style={{ ...S.primaryBtn, marginTop: "5px" }}>＋ この内容で項目を作成</button>
                        </div>

                        {/* リスト表示エリア */}
                        <div style={{ display: "flex", gap: "30px" }}>
                            
                            {/* 左：支給カラム */}
                            <div style={{ flex: 1 }}>
                                <h4 style={{ color: "#3498db", borderBottom: "2px solid #3498db", paddingBottom: "5px", marginBottom: "15px" }}>💰 支給項目（マスター）</h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {earnings.map((item, index) => (
                                        <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: "bold", fontSize: "14px", color: "#333" }}>{item.name}</div>
                                                <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{getCategoryLabel(item.category)}</div>
                                            </div>
                                            
                                            {/* 並び替え・削除アクション */}
                                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                <div style={{ display: "flex", gap: "4px" }}>
                                                    <button 
                                                        onClick={() => moveItem(item.id, 'up')} 
                                                        disabled={index === 0}
                                                        style={{ ...S.orderBtn, opacity: index === 0 ? 0.3 : 1 }}
                                                    >▲</button>
                                                    <button 
                                                        onClick={() => moveItem(item.id, 'down')} 
                                                        disabled={index === earnings.length - 1}
                                                        style={{ ...S.orderBtn, opacity: index === earnings.length - 1 ? 0.3 : 1 }}
                                                    >▼</button>
                                                </div>
                                                <button onClick={() => deleteMasterItem(item.id)} style={{ ...S.delBtn, color: "#e74c3c", fontSize: "18px" }}>🗑️</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 右：控除カラム */}
                            <div style={{ flex: 1 }}>
                                <h4 style={{ color: "#e74c3c", borderBottom: "2px solid #e74c3c", paddingBottom: "5px", marginBottom: "15px" }}>💸 控除項目（マスター）</h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {deductions.map((item, index) => (
                                        <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: "bold", fontSize: "14px", color: "#333" }}>{item.name}</div>
                                                <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{getCategoryLabel(item.category)}</div>
                                            </div>
                                            
                                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                <div style={{ display: "flex", gap: "4px" }}>
                                                    <button 
                                                        onClick={() => moveItem(item.id, 'up')} 
                                                        disabled={index === 0}
                                                        style={{ ...S.orderBtn, opacity: index === 0 ? 0.3 : 1 }}
                                                    >▲</button>
                                                    <button 
                                                        onClick={() => moveItem(item.id, 'down')} 
                                                        disabled={index === deductions.length - 1}
                                                        style={{ ...S.orderBtn, opacity: index === deductions.length - 1 ? 0.3 : 1 }}
                                                    >▼</button>
                                                </div>
                                                <button onClick={() => deleteMasterItem(item.id)} style={{ ...S.delBtn, color: "#e74c3c", fontSize: "18px" }}>🗑️</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>
                    </div>
                ) : (
                    /* タブ2：個人別金額設定 */
                    <div style={S.card("#2ecc71")}>
                        <h3 style={S.header}>👤 個人別金額設定</h3>

                        {/* スタッフ選択 */}
                        <div style={{ marginBottom: "20px" }}>
                            <label style={{ fontSize: "12px", color: "#666", marginBottom: "5px", display: "block" }}>対象スタッフ</label>
                            <select 
                                value={selectedStaffId} 
                                onChange={e => setSelectedStaffId(e.target.value)} 
                                style={{ ...S.input, width: "100%", fontSize: "16px", fontWeight: "bold" }}
                            >
                                <option value="">スタッフを選択してください...</option>
                                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>

                        {selectedStaffId ? (
                            <div style={{ display: "flex", gap: "30px" }}>
                                {/* --- 左カラム：支給 --- */}
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ color: "#3498db", borderBottom: "2px solid #3498db", paddingBottom: "5px", marginBottom: "15px" }}>💰 支給項目</h4>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {earnings.map(item => (
                                            <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: "bold", fontSize: "14px" }}>{item.name}</div>
                                                    <div style={{ fontSize: "11px", color: "#999" }}>{getCategoryLabel(item.category)}</div>
                                                </div>
                                                {item.category !== 'formula' ? (
                                                    <div style={{ display: "flex", alignItems: "center", background: "#f8f9fa", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ddd" }}>
                                                        <span style={{ marginRight: "5px", color: "#666" }}>¥</span>
                                                        <input 
                                                            type="number" 
                                                            value={staffValues[item.id] || ""} 
                                                            onChange={e => saveAmount(item.id, Number(e.target.value))}
                                                            style={{ border: "none", background: "none", width: "90px", textAlign: "right", fontSize: "15px", fontWeight: "bold", outline: "none" }}
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div style={{ color: "#999", fontSize: "12px", fontStyle: "italic" }}>自動算出</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* --- 右カラム：控除 --- */}
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ color: "#e74c3c", borderBottom: "2px solid #e74c3c", paddingBottom: "5px", marginBottom: "15px" }}>💸 控除項目</h4>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {deductions.map(item => (
                                            <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: "bold", fontSize: "14px" }}>{item.name}</div>
                                                    <div style={{ fontSize: "11px", color: "#999" }}>{getCategoryLabel(item.category)}</div>
                                                </div>
                                                {item.category !== 'formula' ? (
                                                    <div style={{ display: "flex", alignItems: "center", background: "#fdf2f2", padding: "4px 8px", borderRadius: "4px", border: "1px solid #f5c6cb" }}>
                                                        <span style={{ marginRight: "5px", color: "#666" }}>¥</span>
                                                        <input 
                                                            type="number" 
                                                            value={staffValues[item.id] || ""} 
                                                            onChange={e => saveAmount(item.id, Number(e.target.value))}
                                                            style={{ border: "none", background: "none", width: "90px", textAlign: "right", fontSize: "15px", fontWeight: "bold", outline: "none" }}
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div style={{ color: "#999", fontSize: "12px", fontStyle: "italic" }}>自動算出</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: "center", padding: "40px", color: "#999", backgroundColor: "#f8f9fa", borderRadius: "8px", border: "2px dashed #eee" }}>
                                スタッフを選択すると、金額の設定ができます
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}