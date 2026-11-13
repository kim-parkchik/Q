/**
 * BonusManager.tsx — 賞与計算・管理
 *
 * 賞与の法的ポイント:
 *  - 標準賞与額 = 賞与支給額（1,000円未満切り捨て）
 *  - 健康保険料 = 標準賞与額 × 料率（年度の累計573万円が上限。この賞与より前に支払った賞与と合わせて数える。utils/bonusInsurance.ts）
 *  - 厚生年金保険料 = 標準賞与額 × 料率（1か月150万円が上限。同じ月に2回以上支払ったときは合わせて）
 *  - 雇用保険料 = 賞与支給額 × 料率（標準賞与額でなく実額にかける）
 *  - 所得税 = （賞与 − 社会保険料等）× 算出率（率は、前月に支払った給与の社会保険料等控除後の額と扶養親族等の数で決まる。
 *    前月の給与がない・賞与が前月の給与の10倍を超えるときは、月額表を使う方法。utils/incomeTax.ts）
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { 
  Gift, 
  ClipboardList, 
  Calculator, 
  Plus, 
  Trash2, 
  Layers, 
  CheckCircle, 
  RefreshCw, 
  Pencil,
  PlusCircle,
  Database as DatabaseIcon, // 名前が被るのでリネーム
  ListChecks,
  AlertTriangle
} from 'lucide-react';
import * as S from "./BonusManager.styles";
import { useBonusManager } from "./useBonusManager";
import { describeFlatTaxPayment } from "../../utils/flatTaxReduction";

interface Props {
  db: Database;
  staffList: any[];
}

const SwitchRow = ({ 
  item, 
  isActive, 
  toggleItemActive 
}: { 
  item: any, 
  isActive: boolean, 
  toggleItemActive: (id: number) => void 
}) => (
  <label style={{ 
    display: "flex", 
    alignItems: "center", 
    justifyContent: "space-between", 
    cursor: "pointer",
    padding: "8px 0",
    borderBottom: "1px solid #fafafa",
    transition: "0.2s"
  }}>
    <span style={{ 
      fontSize: 13, 
      color: isActive ? "#2c3e50" : "#95a5a6",
      fontWeight: isActive ? "bold" : "normal"
    }}>
      {item.name}
    </span>

    <div style={S.switchBase}>
      <input 
        type="checkbox" 
        checked={isActive}
        onChange={() => toggleItemActive(item.id)}
        style={S.switchInput}
      />
      <span style={S.slider(isActive)}>
        <span style={S.sliderCircle(isActive)} />
      </span>
    </div>
  </label>
);

export default function BonusManager({ db, staffList }: Props) {
  // 分割代入で必要なものをすべて取り出す
  const {
    // ── 1. 画面全体の制御 ──
    activeTab,
    setActiveTab,

    // ── 2. 賞与設定 (タブ①: 賞与一覧) ──
    settings,
    selectedSettingId,
    setSelectedSettingId,
    // フォーム用State
    settingName, 
    setSettingName, 
    newPaymentDate,
    setNewPaymentDate,
    // 編集・追加アクション
    editingSettingId,
    startSettingEdit,
    saveSettingEdit,
    cancelSettingEdit,
    addSetting,
    deleteSetting,

    // ── 3. 項目マスター (タブ②: 支給・控除項目) ──
    items,
    // フォーム用State
    newItemName,
    setNewItemName,
    newItemType,
    setNewItemType,
    newItemIsDefault,
    setNewItemIsDefault,
    // 編集・追加アクション
    editingItemId,
    startEdit,
    saveEdit,
    cancelEdit,
    addItem,
    deleteItem,

    // ── 4. 計算ロジック・値保持 (タブ③: 賞与計算) ──
    activeItemIds,
    toggleItemActive,
    staffValues,
    saveStaffValue,
    calcBonusForStaff,
    bonusStaffList,
    finalizeBonus,
    unfinalizeBonus,
    rateWarnings,
    prevMonth
  } = useBonusManager(db, staffList);
  const selectedSetting = settings.find(s => s.id === selectedSettingId);

  // マスター表示用
  const masterEarningItems = items.filter(i => i.type === 'earning');
  const masterDeductionItems = items.filter(i => i.type === 'deduction');

  // 計算用（賞与ごと）
  const activeItems = items.filter(i => activeItemIds.includes(i.id));
  const earningItems = activeItems.filter(i => i.type === 'earning');
  const deductionItems = activeItems.filter(i => i.type === 'deduction');

  // ── レンダリング ────────────────────────────────────────────
  return (
    <div style={S.container}>
      {/* ── タブナビゲーション ── */}
      <div style={S.tabContainer}>
        {([
          ['list', '賞与設定', <Gift size={18} />],
          ['items', '支給・控除項目', <ClipboardList size={18} />],
          // settingsがある時だけ「計算」を表示
          ...(settings.length > 0 ? [['calc', '社員別金額・計算', <Calculator size={18} />] as const] : [])
        ] as const).map(([key, label, icon]) => (
          <button 
            key={key} 
            onClick={() => {
              // 🆕 違うタブに移動するときだけリセットと切り替えを実行
              cancelEdit();
              cancelSettingEdit();
              setActiveTab(key);
            }}
            // 🆕 今いるタブならクリックできないようにする
            disabled={activeTab === key} 
            style={{
              ...(activeTab === key ? S.activeTabBtn : S.tabBtn),
              // 🆕 今いるタブなら「禁止マーク」にするか、クリック不可な感じを出す
              cursor: activeTab === key ? "default" : "pointer",
            }}
          >
            <div style={S.tabInner}>
              {icon}
              <span style={{ marginLeft: 8 }}>{label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          タブ①: 賞与設定一覧
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'list' && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20 }}>
          {/* ── タブ①内の左カラム: 新規作成 or 編集フォーム ── */}
          <div style={S.card}>
            <h3 style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: "8px" }}>
              {editingSettingId ? (
                <>
                  <Pencil size={20} color="#27ae60" />
                  <span>賞与設定を編集</span>
                </>
              ) : (
                <>
                  <PlusCircle size={20} color="#3498db" />
                  <span>新しい賞与を追加</span>
                </>
              )}
            </h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={S.label}>賞与名称</label>
                <input 
                  type="text" 
                  value={settingName} 
                  onChange={e => setSettingName(e.target.value)}
                  placeholder="夏季賞与・冬季賞与 など" 
                  style={S.input} 
                />
              </div>
              <div>
                <label style={S.label}>支給日</label>
                <input 
                  type="date" 
                  value={newPaymentDate} 
                  onChange={e => setNewPaymentDate(e.target.value)} 
                  style={S.input} 
                />
              </div>

              {/* ボタンの切り替え */}
              {editingSettingId ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    onClick={saveSettingEdit} 
                    disabled={!settingName.trim() || !newPaymentDate} 
                    style={{ 
                      ...S.btn, 
                      flex: 1, 
                      backgroundColor: (!settingName.trim() || !newPaymentDate) ? "#ccc" : "#27ae60" 
                    }}
                  >
                    <CheckCircle size={16} style={{ marginRight: 4 }} />更新保存
                  </button>
                  <button 
                    onClick={cancelSettingEdit} 
                    style={{ ...S.btn, flex: 1, backgroundColor: "#95a5a6" }}
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <button 
                  onClick={addSetting} 
                  disabled={!settingName.trim() || !newPaymentDate} 
                  style={{
                    ...S.btn,
                    backgroundColor: (!settingName.trim() || !newPaymentDate) ? "#ccc" : "#3498db"
                  }}
                >
                  <Plus size={16} style={{ marginRight: 4 }} />追加
                </button>
              )}
            </div>
          </div>

          {/* 賞与設定一覧 */}
          <div style={S.card}>
            <h3 style={S.sectionTitle}>
              <Layers size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              賞与設定一覧
            </h3>
            {settings.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#95a5a6" }}>
                <Gift size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
                <p>登録されている賞与がありません。</p>
                <p style={{ fontSize: 12 }}>左側のフォームから「夏季賞与」などを追加してください。</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {settings.map(s => {
                  const isEditingThis = selectedSettingId === s.id; // 現在選択中かどうか

                  return (
                    <div key={s.id} style={{
                      border: "1px solid #eee",
                      borderRadius: 8,
                      overflow: "hidden",
                      opacity: (editingSettingId && editingSettingId !== s.id) ? 0.6 : 1,
                      backgroundColor: isEditingThis ? "#fffcf5" : "white"
                    }}>
                      {/* メイン行：クリックで選択＆展開 */}
                      <div 
                        onClick={() => {
                          // 🆕 ガード：編集中ならアコーディオンの切り替えを無効化する
                          if (editingSettingId) {
                            // お好みで「編集中です」とアラートを出しても良いですが、
                            // ボタンを消していればユーザーも「今は無理だな」と察してくれます
                            return; 
                          }
                          setSelectedSettingId(s.id);
                        }}
                        style={{ 
                          ...S.itemRow, 
                          // 🆕 編集中はカーソルを「禁止」にする
                          cursor: editingSettingId ? "not-allowed" : "pointer",
                          margin: 0, 
                          borderRadius: 0,
                          borderLeft: `4px solid ${s.is_closed ? "#bdc3c7" : "#f39c12"}`,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          {/* 名前とステータスを横並びにする */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: "bold", fontSize: 14 }}>{s.name}</span>
                            
                            {/* ステータスバッジ */}
                            <span style={{ 
                              fontSize: 10, 
                              padding: "2px 8px", 
                              borderRadius: 10,
                              display: "inline-flex", 
                              alignItems: "center", 
                              gap: 3,
                              backgroundColor: s.is_closed ? "#f0f0f0" : "#fef3cd",
                              color: s.is_closed ? "#666" : "#e67e22",
                              border: s.is_closed ? "1px solid #ddd" : "1px solid #fbd38d"
                            }}>
                              {s.is_closed ? <CheckCircle size={12} /> : <RefreshCw size={12} />}
                              {s.is_closed ? "確定済" : "計算中"}
                            </span>
                          </div>
                          
                          {/* 支給年月を下に配置 */}
                          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                            {s.target_year}年{s.target_month}月支給
                          </div>
                        </div>

                        {/* ── ボタンエリア ── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {/* 編集中は他の行の操作ボタンを隠す */}
                          {!editingSettingId ? (
                            <>
                              <button onClick={e => { e.stopPropagation(); startSettingEdit(s); }} style={S.delBtn} title="設定を編集">
                                <Pencil size={16} color="#3498db" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); deleteSetting(s.id); }} style={S.delBtn} title="設定を削除">
                                <Trash2 size={16} color="#e74c3c" />
                              </button>
                            </>
                          ) : (
                            // 編集中の行だけに「編集中」ラベルを出しても親切
                            editingSettingId === s.id && <span style={{ fontSize: 10, color: "#27ae60", fontWeight: "bold" }}>編集中...</span>
                          )}
                        </div>
                      </div>

                      {/* ニョキニョキ出る部分（アコーディオン） */}
                      {isEditingThis && (
                        <div style={{ 
                          padding: "20px", 
                          backgroundColor: "white", 
                          borderTop: "1px solid #eee",
                          animation: "slideDown 0.2s ease-out"
                        }}>
                          <div style={{ 
                            display: "grid", 
                            gridTemplateColumns: "1fr 1fr", // 💡 ここで左右2カラムに固定
                            gap: "20px 40px" 
                          }}>
                            
                            {/* --- 支給グループ（左カラム） --- */}
                            <div>
                              <div style={{ fontSize: 11, color: "#3498db", fontWeight: "bold", marginBottom: 10, borderBottom: "1px solid #eaf2f8" }}>支給項目</div>
                              {items.filter(item => item.type === 'earning').map(item => (
                                <SwitchRow 
                                  key={item.id} 
                                  item={item} 
                                  isActive={activeItemIds.includes(item.id)} 
                                  toggleItemActive={toggleItemActive} // 💡 これが必要！
                                />
                              ))}
                            </div>

                            {/* --- 控除グループ（右カラム） --- */}
                            <div>
                              <div style={{ fontSize: 11, color: "#e74c3c", fontWeight: "bold", marginBottom: 10, borderBottom: "1px solid #fdf2f2" }}>控除項目</div>
                              {items.filter(item => item.type === 'deduction').map(item => (
                                <SwitchRow 
                                  key={item.id} 
                                  item={item} 
                                  isActive={activeItemIds.includes(item.id)} 
                                  toggleItemActive={toggleItemActive} // 💡 これが必要！
                                />
                              ))}
                            </div>
                          </div>

                          {/* ── アコーディオン内の「計算開始」ボタン ── */}
                          <div style={{ marginTop: 24, textAlign: "right", borderTop: "1px dashed #eee", paddingTop: 16 }}>
                            {editingSettingId ? (
                              <div style={{ color: "#e67e22", fontSize: 12, fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                <AlertTriangle size={14} />
                                編集中は計算を開始できません
                              </div>
                            ) : (
                              <button onClick={() => setActiveTab('calc')} style={S.btn}>
                                この項目で計算を開始する →
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          タブ②: 支給・控除項目マスター
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'items' && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20 }}>
          {/* 項目追加フォーム */}
          <div style={S.card}>
            <h3 style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: "8px" }}>
              {editingItemId ? (
                <>
                  <Pencil size={20} color="#27ae60" />
                  <span>項目を編集</span>
                </>
              ) : (
                <>
                  <PlusCircle size={20} color="#3498db" />
                  <span>項目を追加</span>
                </>
              )}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={S.label}>項目名</label>
                <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)}
                  placeholder="基本賞与・特別手当 など" style={S.input} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                {/* --- 種別選択 --- */}
                <div style={{ flex: 1 }}>
                  <label style={S.label}>種別</label>
                  <select 
                    value={newItemType} 
                    onChange={e => setNewItemType(e.target.value as any)} 
                    // 🆕 編集モード時は無効化（!!でbooleanに変換）
                    disabled={!!editingItemId} 
                    style={{ 
                      ...S.input,
                      // 🆕 無効時は少し背景をグレーにして「変えられない感」を出す
                      backgroundColor: editingItemId ? "#f5f5f5" : "white",
                      cursor: editingItemId ? "not-allowed" : "pointer"
                    }}
                  >
                    <option value="earning">支給</option>
                    <option value="deduction">控除（カスタム）</option>
                  </select>
                  
                  {/* 🆕 編集モード時のみ補足を表示しても親切です */}
                  {editingItemId && (
                    <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>
                      ※種別は変更できません
                    </div>
                  )}
                </div>

                {/* --- 標準項目チェック（編集時も変更可能にする） --- */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "18px" }}>
                  <input 
                    type="checkbox" 
                    id="defaultActive"
                    checked={newItemIsDefault}
                    onChange={e => setNewItemIsDefault(e.target.checked)}
                    // 🆕 editingItemId があっても disabled にしない
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  <label 
                    htmlFor="defaultActive" 
                    style={{ 
                      fontSize: "12px", 
                      cursor: "pointer", 
                      color: "#606266", 
                      whiteSpace: "nowrap" 
                    }}
                  >
                    標準項目として登録
                  </label>
                </div>
              </div>
              {editingItemId ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    onClick={saveEdit} 
                    // 🆕 項目名が空、または空白のみなら無効化
                    disabled={!newItemName.trim()} 
                    style={{ 
                      ...S.btn, 
                      flex: 1, 
                      backgroundColor: !newItemName.trim() ? "#ccc" : "#27ae60",
                      cursor: !newItemName.trim() ? "not-allowed" : "pointer"
                    }}
                  >
                    <CheckCircle size={16} style={{ marginRight: 4 }} />更新保存
                  </button>
                  <button onClick={cancelEdit} style={{ ...S.btn, flex: 1, backgroundColor: "#95a5a6" }}>
                    キャンセル
                  </button>
                </div>
              ) : (
                <button 
                  onClick={addItem} 
                  // 🆕 項目名が空なら無効化
                  disabled={!newItemName.trim()} 
                  style={{ 
                    ...S.btn, 
                    backgroundColor: !newItemName.trim() ? "#ccc" : "#3498db",
                    cursor: !newItemName.trim() ? "not-allowed" : "pointer",
                    transition: "background-color 0.2s ease"
                  }}
                >
                  <Plus size={16} style={{ marginRight: 4 }} />追加
                </button>
              )}
            </div>
            
            <div style={S.autoCalcNote}>
              <strong>自動計算される控除項目（入力不要）</strong><br />
              ✓ 健康保険料 / 介護保険料<br />
              ✓ 厚生年金 / 雇用保険 / 所得税
            </div>
          </div>

          {/* 項目一覧 */}
          <div style={S.card}>
            <h3 style={S.sectionTitle}>
              <DatabaseIcon size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              登録済み項目（名前を変更できます）
            </h3>

            {/* 支給グループ */}
            {masterEarningItems.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: "bold", color: "#3498db", marginBottom: 6, display: "flex", alignItems: "center" }}>
                  <ListChecks size={14} style={{ marginRight: 4 }} />
                  【支給項目】
                </div>
                {masterEarningItems.map(item => (
                  <div key={item.id} style={{ ...S.itemRow, borderLeft: `4px solid ${item.type === 'earning' ? "#3498db" : "#e74c3c"}` }}>
                    <span style={{ flex: 1, fontWeight: "bold", fontSize: 13 }}>{item.name}</span>
                    
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* 🆕 編集開始ボタン */}
                      <button onClick={() => startEdit(item)} style={S.delBtn} title="編集">
                        <Pencil size={16} color="#3498db" /> 
                      </button>
                      
                      {/* 削除ボタン */}
                      <button onClick={() => deleteItem(item.id)} style={S.delBtn} title="削除">
                        <Trash2 size={16} color="#e74c3c" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* 控除グループ */}
            {masterDeductionItems.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: "bold", color: "#e74c3c", marginBottom: 6, marginTop: 12, display: "flex", alignItems: "center" }}>
                  <ListChecks size={14} style={{ marginRight: 4 }} />
                  【カスタム控除項目】
                </div>
                {masterDeductionItems.map(item => (
                  <div key={item.id} style={{ ...S.itemRow, borderLeft: `4px solid ${item.type === 'earning' ? "#3498db" : "#e74c3c"}` }}>
                    <span style={{ flex: 1, fontWeight: "bold", fontSize: 13 }}>{item.name}</span>
                    
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* 🆕 編集開始ボタン */}
                      <button onClick={() => startEdit(item)} style={S.delBtn} title="編集">
                        <Pencil size={16} color="#3498db" /> 
                      </button>
                      
                      {/* 削除ボタン */}
                      <button onClick={() => deleteItem(item.id)} style={S.delBtn} title="削除">
                        <Trash2 size={16} color="#e74c3c" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {items.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#bdc3c7" }}>
                <DatabaseIcon size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>項目がありません</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          タブ③: 社員別金額入力・計算プレビュー
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'calc' && (
        <>
          {/* 賞与選択 */}
          <div style={{ ...S.card, marginBottom: 16 }}>
            <label style={S.label}>対象の賞与を選択</label>
            <select value={selectedSettingId ?? ""} onChange={e => setSelectedSettingId(Number(e.target.value))}
              style={{ ...S.input, maxWidth: 400 }}>
              <option value="">-- 選択してください --</option>
              {settings.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.target_year}年{s.target_month}月）
                </option>
              ))}
            </select>
            {selectedSetting && items.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button
                  onClick={finalizeBonus}
                  style={{ padding: "8px 16px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", cursor: "pointer", backgroundColor: selectedSetting.is_closed ? "#64748b" : "#16a34a" }}
                >
                  {selectedSetting.is_closed ? "確定し直す" : "この賞与を確定"}
                </button>
                {selectedSetting.is_closed ? (
                  <button
                    onClick={unfinalizeBonus}
                    title="確定結果を消して、計算中に戻します（年末調整などの集計から外れます）。間違えて作った賞与を消すときや、支給日を直すときに使います"
                    style={{ padding: "8px 12px", border: "1px solid #94a3b8", borderRadius: 6, color: "#475569", backgroundColor: "white", cursor: "pointer" }}
                  >
                    確定を取り消す
                  </button>
                ) : null}
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {selectedSetting.is_closed
                    ? "確定済みです。金額を直したときは、もう一度確定してください（年末調整の集計に使います）。確定した賞与は、消すことも支給日を変えることもできません（先に確定を取り消してください）。"
                    : "確定すると、年末調整の1年分の集計に入ります。"}
                </span>
              </div>
            )}
          </div>

          {/* 料率・税額表が登録されていない年月の注意 */}
          {rateWarnings.length > 0 && (
            <div style={{ ...S.card, marginBottom: 16, backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
              {rateWarnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}

          {/* 警告メッセージ */}
          {selectedSettingId && items.length === 0 && (
            <div style={{ 
              ...S.card, 
              backgroundColor: "#fff7ed", // 非常に薄いオレンジ
              border: "1px solid #ffedd5",
              color: "#9a3412", // 濃い茶褐色（読みやすさ重視）
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "24px"
            }}>
              <AlertTriangle size={24} color="#f97316" />
              <div style={{ fontWeight: "bold" }}>
                先に「支給・控除項目」タブで項目を追加してください
                <p style={{ fontSize: 12, fontWeight: "normal", margin: "4px 0 0 0", opacity: 0.8 }}>
                  計算の対象となる項目（基本賞与など）が登録されていません。
                </p>
              </div>
            </div>
          )}

          {/* 拠点の都道府県がわからない人（健康保険料・介護保険料を計算していない。確定できない） */}
          {selectedSettingId && items.length > 0 && (() => {
            const unknown = bonusStaffList
              .map(s => ({ s, c: calcBonusForStaff(s) }))
              .filter(({ c }) => !!c && c.totalEarnings > 0 && c.prefectureUnknown);
            return unknown.length > 0 ? (
              <div style={{ ...S.card, marginBottom: 16, backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
                ⚠ 次の人は、拠点の都道府県がわからないため、健康保険料と介護保険料を計算していません（0円）。直すまで、この賞与は確定できません。
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {unknown.map(({ s, c }) => <div key={s.id}>・{s.name}：{c?.prefectureProblem}</div>)}
                </div>
              </div>
            ) : null;
          })()}

          {/* 健康保険組合の、賞与を支給する月の分の料率がない人（健康保険料・介護保険料を計算していない。確定できない） */}
          {selectedSettingId && items.length > 0 && (() => {
            const missing = bonusStaffList
              .map(s => ({ s, c: calcBonusForStaff(s) }))
              .filter(({ c }) => !!c && c.totalEarnings > 0 && c.insurerRateMissing);
            return missing.length > 0 ? (
              <div style={{ ...S.card, marginBottom: 16, backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
                ⚠ 次の人は、健康保険組合の、賞与を支給する月の分の料率が入っていないため、健康保険料と介護保険料を計算していません（0円）。
                会社設定の「社会保険規定」で組合の料率を入れるまで、この賞与は確定できません。
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {missing.map(({ s, c }) => <div key={s.id}>・{s.name}：{c?.insurerName}</div>)}
                </div>
              </div>
            ) : null;
          })()}

          {/* 前月に給与を払うはずなのに、まだ確定していない人（前月の給与がないものとして所得税を計算している） */}
          {selectedSettingId && items.length > 0 && prevMonth && (() => {
            const names = bonusStaffList
              .filter(s => { const c = calcBonusForStaff(s); return !!c && c.totalEarnings > 0 && c.prevSalaryStatus === "unconfirmed"; })
              .map(s => s.name);
            return names.length > 0 ? (
              <div style={{ ...S.card, marginBottom: 16, backgroundColor: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
                ⚠ 次の人は、前月（{prevMonth.year}年{prevMonth.month}月）に支払う給与がまだ確定していないため、前月の給与がないものとして所得税を計算しています（月額表を使う方法）：{names.join("・")}
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  給与明細で前月の給与を確定してから、この賞与を確定してください。休職などで前月に給与を払っていない人は、このままで構いません。
                </div>
              </div>
            ) : null;
          })()}

          {selectedSettingId && items.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead>
                  <tr style={S.thead}>
                    <th style={{ ...S.th, minWidth: 120 }}>氏名</th>
                    {/* 支給項目 */}
                    {earningItems.map(item => (
                      <th key={item.id} style={{ ...S.th, color: "#2980b9", minWidth: 110 }}>{item.name}</th>
                    ))}
                    <th style={{ ...S.th, backgroundColor: "#ebf5fb", minWidth: 90 }}>支給合計</th>
                    {/* 自動計算控除 */}
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 90 }}>健保</th>
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 80 }}>介護</th>
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 80 }}>支援金</th>
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 90 }}>厚生年金</th>
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 80 }}>雇用保険</th>
                    <th style={{ ...S.th, color: "#c0392b", minWidth: 80 }}>所得税</th>
                    {/* カスタム控除 */}
                    {deductionItems.map(item => (
                      <th key={item.id} style={{ ...S.th, color: "#c0392b", minWidth: 110 }}>{item.name}</th>
                    ))}
                    <th style={{ ...S.th, backgroundColor: "#fdf2f8", minWidth: 90 }}>控除合計</th>
                    <th style={{ ...S.th, backgroundColor: "#f0fdf4", minWidth: 100, fontWeight: "bold" }}>差引支給額</th>
                  </tr>
                </thead>
                <tbody>
                  {bonusStaffList.map(staff => {
                    const calc = calcBonusForStaff(staff);
                    
                    // 1. calc が null（賞与設定が未選択など）の場合は、この行を表示しない
                    if (!calc) return null;

                    const vals = staffValues[staff.id] ?? {};

                    return (
                      <tr key={staff.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={S.td}>
                          <div style={{ fontWeight: "bold", fontSize: 13 }}>{staff.name}</div>
                          {staff.furigana && <div style={{ fontSize: 10, color: "#999" }}>{staff.furigana}</div>}
                        </td>
                        {/* 支給項目入力欄 */}
                        {earningItems.map(item => (
                          <td key={item.id} style={S.td}>
                            <input 
                              type="number" 
                              min={0}
                              value={vals[item.id] ?? ""}
                              placeholder="0"
                              onChange={e => saveStaffValue(staff.id, item.id, Number(e.target.value))}
                              style={S.tableInput} // ← ここ！
                            />
                          </td>
                        ))}
                        {/* 支給合計 */}
                        <td style={{ ...S.td, textAlign: "right", fontWeight: "bold", backgroundColor: "#ebf5fb" }}>
                          ¥{calc.totalEarnings.toLocaleString()}
                        </td>
                        {/* 自動計算控除 */}
                        <td
                          style={{ ...S.td, textAlign: "right", fontSize: 12, color: calc.isHealthTarget ? "#666" : "#bbb" }}
                          title={calc.isHealthTarget ? `この賞与より前に支払った賞与の、年度の標準賞与額の累計：${calc.earlierHealthTotal.toLocaleString()}円／この賞与の健康保険の標準賞与額：${calc.healthHyojun.toLocaleString()}円` : undefined}
                        >
                          ¥{calc.healthInsurance.toLocaleString()}
                          {calc.prefectureUnknown && (
                            <div style={{ fontSize: 10, color: "#b91c1c" }}>⚠ 都道府県が不明</div>
                          )}
                          {calc.insurerRateMissing && (
                            <div style={{ fontSize: 10, color: "#b91c1c" }}>⚠ 組合の料率がない</div>
                          )}
                          {calc.isHealthTarget && calc.healthHyojun < calc.hyojunBonus && (
                            <div style={{ fontSize: 10, color: "#b45309" }}>年度の上限（573万円）まで</div>
                          )}
                        </td>
                        {/* 介護保険（条件付きで色変更） */}
                        <td style={{ ...S.td, textAlign: "right", fontSize: 12, color: calc.isNursing ? "#c0392b" : "#bbb" }}>
                          ¥{calc.nursingInsurance.toLocaleString()}
                        </td>
                        {/* 子ども・子育て支援金（令和8年4月分から） */}
                        <td style={{ ...S.td, textAlign: "right", fontSize: 12, color: calc.childSupport > 0 ? "#666" : "#bbb" }}>
                          ¥{calc.childSupport.toLocaleString()}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontSize: 12, color: calc.isPensionTarget ? "#666" : "#bbb" }}>
                          ¥{calc.welfarePension.toLocaleString()}
                          {calc.isPensionTarget && calc.pensionHyojun < calc.hyojunBonus && (
                            <div style={{ fontSize: 10, color: "#b45309" }}>同じ月で150万円まで</div>
                          )}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontSize: 12, color: calc.isEmploymentInsEnrolled ? "#666" : "#bbb" }}>¥{calc.empInsurance.toLocaleString()}</td>
                        <td style={{ ...S.td, textAlign: "right", fontSize: 12, color: "#666" }}>
                          ¥{calc.incomeTax.toLocaleString()}
                          {calc.flatTaxReduction > 0 && (
                            <div style={{ fontSize: 10, color: "#2f855a" }} title={`減税前の所得税 ¥${calc.incomeTaxBeforeReduction.toLocaleString()}／この賞与のあとに残る減税額 ¥${calc.flatTaxRemainingAfter.toLocaleString()}`}>
                              定額減税 −¥{calc.flatTaxReduction.toLocaleString()}
                            </div>
                          )}
                          {calc.totalEarnings > 0 && calc.flatTaxLaterUsed.length > 0 && (
                            <div style={{ fontSize: 10, color: "#b45309" }} title={`${calc.flatTaxLaterUsed.map(describeFlatTaxPayment).join("・")}で、先に定額減税を引いて確定しています`}>
                              ⚠ 後の給与・賞与で先に減税
                            </div>
                          )}
                          {calc.totalEarnings > 0 && calc.prevSalaryStatus === "unconfirmed" && (
                            <div style={{ fontSize: 10, color: "#b45309" }}>⚠ 前月の給与が未確定</div>
                          )}
                          {calc.totalEarnings > 0 && calc.prevSalaryStatus !== "unconfirmed" && calc.taxByMonthlyTable && (
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>月額表で計算</div>
                          )}
                        </td>
                        {/* カスタム控除入力欄 */}
                        {deductionItems.map(item => (
                          <td key={item.id} style={S.td}>
                            <input type="number" min={0}
                              value={vals[item.id] ?? ""}
                              placeholder="0"
                              onChange={e => saveStaffValue(staff.id, item.id, Number(e.target.value))}
                              style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" }} />
                          </td>
                        ))}
                        {/* 控除合計 */}
                        <td style={{ ...S.td, textAlign: "right", fontWeight: "bold", backgroundColor: "#fdf2f8" }}>
                          ¥{calc.totalDeductions.toLocaleString()}
                        </td>
                        {/* 差引支給額 */}
                        <td style={{ 
                          ...S.td, 
                          textAlign: "right", 
                          fontWeight: "bold", 
                          fontSize: 14,
                          backgroundColor: "#f0fdf4", 
                          color: calc.netPay > 0 ? "#27ae60" : "#e74c3c" 
                        }}>
                          ¥{calc.netPay.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedSettingId && items.length > 0 && (
            <div style={S.footerNote}>
              ※ 標準賞与額 = 支給合計の1,000円未満切り捨て。健保上限573万円、厚生年金上限150万円（1回あたり）。
              社保・雇用保険に加入していない人と、75歳の誕生月から（健康保険・介護保険・支援金）・70歳に達した月から（厚生年金）の人には、その保険料はかかりません（灰色の欄）。
              入社日より前に支払う賞与と、退職した月に支払う賞与（月末退職を除く）にも、社会保険料はかかりません（雇用保険料はかかります）。
              産休・育休で免除される月に支払う賞与も同じです（育休は、期間が1か月を超えるときだけ）。
              健康保険の573万円は、この賞与より前に同じ年度（4月〜翌年3月）に支払った賞与の標準賞与額と合わせた上限です（後で支払う賞与は数えません。育休などで保険料が免除された賞与も数えます）。
              厚生年金の150万円は、同じ月に2回以上支払ったときは合わせた上限です。
              所得税は、前月に支払った給与（社会保険料等を引いた額）と扶養親族等の数から、算出率の表の率で計算します。前月の給与がない人と、賞与が前月の給与の10倍を超える人は、月額表を使う方法で計算します（国税庁「賞与に対する源泉徴収税額の算出率の表」の備考）。
              前月の給与は確定した給与から読むので、前月の給与を先に確定してください。
              令和6年6月1日以後に支払う賞与は、定額減税（月次減税）の残りを所得税から引きます（本人と同一生計配偶者・扶養親族1人につき3万円の合計から、この賞与より前に支払った給与・賞与で引いた額を引いた残り。
              同じ日に払う給与と賞与は給与から先に引きます）。定額減税は払う日の順に引くので、給与と賞与は払う日の順に確定してください。
              確定後は「賞与支払届」を年金事務所・健康保険組合に提出してください。
            </div>
          )}
        </>
      )}
    </div>
  );
}