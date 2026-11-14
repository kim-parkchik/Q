import { 
  Settings, 
  UserRound, 
  PlusCircle, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  CircleDollarSign, 
  Wallet, 
  Pin, 
  FileEdit, 
  Cpu 
} from 'lucide-react';
import * as S from "./CustomItemManager.styles";
import { useCustomItemManager } from "./useCustomItemManager";
import type { AverageWageKind } from "../../utils/averageWage";

interface Props {
  db: any; // Database型
  staffList: any[];
}

export default function CustomItemManager({ db, staffList }: Props) {
  const {
    activeTab, setActiveTab,
    earnings, deductions, selectedStaffId, setSelectedStaffId, staffValues,
    newItemName, setNewItemName, newItemType, setNewItemType, newItemCategory, setNewItemCategory,
    addMasterItem, deleteMasterItem, saveAmount, setOvertimeBase, setAverageWage,
    moveItem // ← 忘れずに受け取る
  } = useCustomItemManager(db);

  const getCategoryContent = (cat: string) => {
    switch (cat) {
      case 'fixed': return <><Pin size={12} /> 固定</>;
      case 'variable': return <><FileEdit size={12} /> 変動</>;
      case 'formula': return <><Cpu size={12} /> 自動</>;
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
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Settings size={18} /> 項目マスター設定
          </div>
        </button>
        <button 
          onClick={() => setActiveTab("assignment")} 
          style={activeTab === "assignment" ? S.activeTab : S.tab}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <UserRound size={18} /> 個人別金額設定
          </div>
        </button>
      </div>

      <div style={{ width: "100%" }}>
        {activeTab === "master" ? (
          <div style={S.card}>                        
            {/* 新規追加エリア */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "30px", background: "#f0f7ff", padding: "20px", borderRadius: "10px", border: "1px solid #d0e3ff" }}>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>タイプ</label>
                  <select value={newItemType} onChange={e => setNewItemType(e.target.value as any)} style={{ ...S.input, width: "100%" }}>
                    <option value="earning">支給</option>
                    <option value="deduction">控除</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>計算区分</label>
                  <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value as any)} style={{ ...S.input, width: "100%" }}>
                    <option value="fixed">固定（毎月同額）</option>
                    <option value="variable">変動（毎月入力）</option>
                    <option value="formula">自動（数式計算）</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "#5d87a1", fontWeight: "bold" }}>項目名</label>
                <input 
                  placeholder="例: 役職手当、厚生年金など" 
                  value={newItemName} 
                  onChange={e => setNewItemName(e.target.value)}
                  style={{ ...S.input, width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <button onClick={addMasterItem} style={{ ...S.primaryBtn, marginTop: "5px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <PlusCircle size={18} /> この内容で項目を作成
              </button>
            </div>

            {/* リスト表示エリア */}
            <div style={{ display: "flex", gap: "30px" }}>
              {/* 左：支給カラム */}
              <div style={{ flex: 1 }}>
                <h4 style={{ color: "#3498db", borderBottom: "2px solid #3498db", paddingBottom: "5px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <CircleDollarSign size={20} /> 支給項目（マスター）
                </h4>
                <p style={{ fontSize: "11px", color: "#666", lineHeight: 1.7, margin: "0 0 12px 0" }}>
                  「残業代の時給に入れる」にチェックした手当は、基本給と合わせて残業代・休日手当・深夜手当の時給の計算に入れます。
                  入れなくてよいのは、家族手当・通勤手当・別居手当・子女教育手当・住宅手当・臨時に支払う賃金・1か月を超える期間ごとに支払う賃金だけです（労働基準法37条5項・施行規則21条）。
                  これに当たるかは名前ではなく中身で決まります（家族の人数に関係なく一律に払う家族手当、距離に関係なく一律に払う通勤手当などは入れます）。
                  <br />「平均賃金」は、休業手当・休業補償・解雇予告手当に使う平均賃金（労働基準法12条）での扱いです。結婚祝金・見舞金などの臨時の賃金と、3か月を超える期間ごとに払う賃金は「入れない」にします。
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {earnings.map((item, index) => (
                    <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "bold", fontSize: "14px", color: "#333" }}>{item.name}</div>
                        <div style={{ fontSize: "11px", color: "#666", marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                          {getCategoryContent(item.category)}
                        </div>
                        <label style={{ fontSize: "11px", color: item.in_overtime_base ? "#333" : "#b45309", marginTop: "6px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Number(item.in_overtime_base) !== 0}
                            onChange={e => setOvertimeBase(item.id, e.target.checked)}
                          />
                          残業代の時給に入れる
                        </label>
                        {/* 平均賃金（労働基準法12条）での扱い。休業手当・休業補償・解雇予告手当に使う（utils/averageWage.ts） */}
                        <label style={{ fontSize: "11px", color: item.average_wage === "none" ? "#b45309" : "#333", marginTop: "6px", display: "flex", alignItems: "center", gap: "4px" }}
                          title="平均賃金を計算するときの扱い。月額で決まる手当は「月で決まる賃金」、歩合などは「日・時間・出来高で決まる賃金」（日給・時給の人の最低保障に使います）。結婚祝金・見舞金などの臨時の賃金と、3か月を超える期間ごとに払う賃金は「入れない」にします（労働基準法12条4項）">
                          平均賃金：
                          <select value={item.average_wage} onChange={e => setAverageWage(item.id, e.target.value as AverageWageKind)} style={{ fontSize: "11px", padding: "1px 2px" }}>
                            <option value="month">月で決まる賃金</option>
                            <option value="time">日・時間・出来高で決まる賃金</option>
                            <option value="none">入れない（臨時の賃金など）</option>
                          </select>
                        </label>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button onClick={() => moveItem(item.id, 'up')} disabled={index === 0} style={{ ...S.orderBtn, opacity: index === 0 ? 0.3 : 1 }}>
                            <ChevronUp size={16} />
                          </button>
                          <button onClick={() => moveItem(item.id, 'down')} disabled={index === earnings.length - 1} style={{ ...S.orderBtn, opacity: index === earnings.length - 1 ? 0.3 : 1 }}>
                            <ChevronDown size={16} />
                          </button>
                        </div>
                        <button onClick={() => deleteMasterItem(item.id)} style={{ ...S.delBtn, color: "#e74c3c" }}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右：控除カラム */}
              <div style={{ flex: 1 }}>
                <h4 style={{ color: "#e74c3c", borderBottom: "2px solid #e74c3c", paddingBottom: "5px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Wallet size={20} /> 控除項目（マスター）
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {deductions.map((item, index) => (
                    <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "bold", fontSize: "14px", color: "#333" }}>{item.name}</div>
                        <div style={{ fontSize: "11px", color: "#666", marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                          {getCategoryContent(item.category)}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button onClick={() => moveItem(item.id, 'up')} disabled={index === 0} style={{ ...S.orderBtn, opacity: index === 0 ? 0.3 : 1 }}>
                            <ChevronUp size={16} />
                          </button>
                          <button onClick={() => moveItem(item.id, 'down')} disabled={index === deductions.length - 1} style={{ ...S.orderBtn, opacity: index === deductions.length - 1 ? 0.3 : 1 }}>
                            <ChevronDown size={16} />
                          </button>
                        </div>
                        <button onClick={() => deleteMasterItem(item.id)} style={{ ...S.delBtn, color: "#e74c3c" }}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* タブ2：個人別金額設定 */
          <div style={S.card}>
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
                <div style={{ flex: 1 }}>
                  <h4 style={{ color: "#3498db", borderBottom: "2px solid #3498db", paddingBottom: "5px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <CircleDollarSign size={20} /> 支給項目
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {earnings.map(item => (
                      <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: "bold", fontSize: "14px" }}>{item.name}</div>
                          <div style={{ fontSize: "11px", color: "#999", display: "flex", alignItems: "center", gap: "4px" }}>
                            {getCategoryContent(item.category)}
                          </div>
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
                          <div style={{ color: "#999", fontSize: "12px", fontStyle: "italic", display: "flex", alignItems: "center", gap: "4px" }}>
                            <Cpu size={14} /> 自動算出
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <h4 style={{ color: "#e74c3c", borderBottom: "2px solid #e74c3c", paddingBottom: "5px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <Wallet size={20} /> 控除項目
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {deductions.map(item => (
                      <div key={item.id} style={{ ...S.itemRow(item.type), padding: "10px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: "bold", fontSize: "14px" }}>{item.name}</div>
                          <div style={{ fontSize: "11px", color: "#999", display: "flex", alignItems: "center", gap: "4px" }}>
                            {getCategoryContent(item.category)}
                          </div>
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
                          <div style={{ color: "#999", fontSize: "12px", fontStyle: "italic", display: "flex", alignItems: "center", gap: "4px" }}>
                            <Cpu size={14} /> 自動算出
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px", color: "#999", backgroundColor: "#f8f9fa", borderRadius: "8px", border: "2px dashed #eee" }}>
                <UserRound size={32} style={{ marginBottom: "10px", opacity: 0.5 }} />
                <br />
                スタッフを選択すると、金額の設定ができます
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}