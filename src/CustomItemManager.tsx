import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";

interface Props {
  db: Database;
  staffList: any[];
}

interface SalaryItem {
  id: number;
  name: string;
  type: "earning" | "deduction";
  category: "fixed" | "variable" | "formula";
}

export default function CustomItemManager({ db, staffList }: Props) {
  const [items, setItems] = useState<SalaryItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [staffValues, setStaffValues] = useState<Record<number, number>>({});

  // 項目追加用
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"earning" | "deduction">("earning");
  const [newItemCategory, setNewItemCategory] = useState<"fixed" | "variable" | "formula">("fixed");

  useEffect(() => {
    loadMasterItems();
  }, [db]);

  useEffect(() => {
    if (selectedStaffId) {
      loadStaffValues(selectedStaffId);
    }
  }, [selectedStaffId]);

  const loadMasterItems = async () => {
    const res = await db.select<SalaryItem[]>("SELECT * FROM salary_item_master ORDER BY category ASC, id ASC");
    setItems(res);
  };

  const loadStaffValues = async (staffId: string) => {
    const res = await db.select<any[]>(
      "SELECT item_id, amount FROM staff_salary_values WHERE staff_id = ?",
      [staffId]
    );
    const valueMap: Record<number, number> = {};
    res.forEach((v) => (valueMap[v.item_id] = v.amount));
    setStaffValues(valueMap);
  };

  const addMasterItem = async () => {
    if (!newItemName.trim()) return;
    await db.execute(
      "INSERT INTO salary_item_master (name, type, category) VALUES (?, ?, ?)",
      [newItemName, newItemType, newItemCategory]
    );
    setNewItemName("");
    loadMasterItems();
  };

  const deleteMasterItem = async (id: number) => {
    if (!confirm("この項目を削除しますか？")) return;
    await db.execute("DELETE FROM salary_item_master WHERE id = ?", [id]);
    loadMasterItems();
  };

  const saveAmount = async (itemId: number, amount: number) => {
    if (!selectedStaffId) return;
    await db.execute(
      "INSERT OR REPLACE INTO staff_salary_values (staff_id, item_id, amount) VALUES (?, ?, ?)",
      [selectedStaffId, itemId, amount]
    );
    setStaffValues(prev => ({ ...prev, [itemId]: amount }));
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'fixed': return '📌 固定';
      case 'variable': return '📝 変動';
      case 'formula': return '🤖 自動';
      default: return cat;
    }
  };

  return (
    <div style={{ display: "flex", gap: "30px", maxWidth: "1200px", margin: "0 auto" }}>
      
      {/* 左：項目マスター管理 */}
      <div style={{ flex: 1, background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <h3 style={{ marginTop: 0, borderBottom: "2px solid #3498db", paddingBottom: "10px" }}>⚙️ 項目設定</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px", background: "#f8f9fa", padding: "15px", borderRadius: "8px" }}>
          <div style={{ display: "flex", gap: "5px" }}>
            <select value={newItemType} onChange={e => setNewItemType(e.target.value as any)} style={inputStyle}>
              <option value="earning">支給</option>
              <option value="deduction">控除</option>
            </select>
            <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value as any)} style={inputStyle}>
              <option value="fixed">📌 固定</option>
              <option value="variable">📝 変動</option>
              <option value="formula">🤖 自動</option>
            </select>
          </div>
          <input 
            placeholder="項目名 (例: 役職手当, 欠勤控除)" 
            value={newItemName} 
            onChange={e => setNewItemName(e.target.value)}
            style={inputStyle}
          />
          <button onClick={addMasterItem} style={btnStyle}>項目を追加</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {items.map(item => (
            <div key={item.id} style={{ ...itemRowStyle, borderLeft: `4px solid ${item.type === 'earning' ? '#3498db' : '#e74c3c'}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: "14px" }}>{item.name}</div>
                <div style={{ fontSize: "11px", color: "#666" }}>{getCategoryLabel(item.category)}</div>
              </div>
              <button onClick={() => deleteMasterItem(item.id)} style={delBtnStyle}>🗑️</button>
            </div>
          ))}
        </div>
      </div>

      {/* 右：個人別設定 */}
      <div style={{ flex: 1.5, background: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <h3 style={{ marginTop: 0, borderBottom: "2px solid #2ecc71", paddingBottom: "10px" }}>👤 個人別金額設定</h3>
        
        <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: "20px" }}>
          <option value="">スタッフを選択...</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {selectedStaffId && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {items.map(item => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "15px", padding: "8px", borderBottom: "1px solid #eee" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: item.category === 'formula' ? "normal" : "bold" }}>
                    {item.name} {item.category === 'formula' && <span style={{fontSize: '11px', color: '#999'}}>(自動計算)</span>}
                  </div>
                </div>
                {item.category !== 'formula' ? (
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ marginRight: "5px", color: "#666" }}>¥</span>
                    <input 
                      type="number" 
                      value={staffValues[item.id] || ""} 
                      onChange={e => saveAmount(item.id, Number(e.target.value))}
                      style={{ ...inputStyle, width: "120px", textAlign: "right" }}
                      placeholder="0"
                    />
                  </div>
                ) : (
                  <div style={{ color: "#999", fontSize: "13px", fontStyle: "italic" }}>計算エンジンにより自動算出</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = { padding: "8px", borderRadius: "4px", border: "1px solid #ddd" };
const btnStyle = { backgroundColor: "#3498db", color: "white", border: "none", padding: "10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" as const };
const delBtnStyle = { background: "none", border: "none", cursor: "pointer", fontSize: "16px" };
const itemRowStyle = { display: "flex", alignItems: "center", padding: "8px 12px", backgroundColor: "#fff", border: "1px solid #eee", marginBottom: "4px" };