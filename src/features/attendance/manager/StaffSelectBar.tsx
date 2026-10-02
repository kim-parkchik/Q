/**
 * 従業員の選択（在籍状態フィルタ付き）と一括保存ボタン
 * （AttendanceManager.tsx から分割）
 */
import { FileStack } from 'lucide-react';
import { modernIconBtnStyle } from "../../../styles/styles";
import { S } from '../AttendanceManager.styles';
import type { AttendanceViewModel, Staff } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function StaffSelectBar({ am }: Props) {
  const {
    selectedStaffId,
    setSelectedStaffId,
    monthlyWorkData,
    activeFilters,
    setActiveFilters,
    filteredStaffList,
    toggleFilter,
    saveAllMonthlyData,
    statusOptions,
  } = am;

  return (
    <>
      {/* 🆕 従業員選択・フィルタ・一括保存セクション */}
      <section style={S.actionSection}>
        {/* 左側：従業員選択カード（フィルタ機能付き） */}
        <div style={S.staffSelectCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* 左側：従業員選択セレクトボックス（幅をさらに拡大） */}
            <div style={{ width: "500px" }}> 
              <select 
                value={selectedStaffId} 
                onChange={e => setSelectedStaffId(e.target.value)} 
                style={{ ...S.input, height: "32px", padding: "4px 10px" }}
              >
                <option value="">-- 従業員を選択してください --</option>
                {filteredStaffList.map((s: Staff) => ( // ← ここに : Staff を追加
                  <option key={s.id} value={s.id}>
                    [{s.id}] {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 右側：フィルタボタン群（右端に固定） */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginLeft: "auto" }}>
              {statusOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => toggleFilter(opt.value)}
                  style={S.filterButton(activeFilters.includes(opt.value), opt.color)}
                >
                  {opt.label}
                </button>
              ))}
              <button 
                onClick={() => setActiveFilters(["active", "on_leave", "retired"])}
                style={{ 
                  fontSize: "11px", 
                  border: "none", 
                  background: "none", 
                  color: "#3498db", 
                  cursor: "pointer", 
                  textDecoration: "underline",
                  marginLeft: "4px"
                }}
              >
                すべて
              </button>
            </div>
          </div>
        </div>

        {/* 右側：一括保存ボタンエリア（枠は固定、中身だけ条件で消える） */}
        <div style={{ flex: "0 0 235px", display: "flex", alignItems: "flex-end" }}>
          {selectedStaffId && Object.values(monthlyWorkData).some(row => !row.is_finalized && (row.in || row.out)) ? (
            <button 
              onClick={saveAllMonthlyData} 
              style={{ 
                ...modernIconBtnStyle("#e67e22"), 
                fontSize: "12px", 
                padding: "4px 12px",
                height: "32px",
                width: "100%", // 235pxいっぱいに広げる
                whiteSpace: "nowrap"
              }}
            >
              <FileStack size={18} style={{ ...S.iconWrapper, marginRight: "0" }} /> 
              未保存分をすべて保存
            </button>
          ) : (
            // 条件に合わない時は何も表示しない（でも枠は確保されているのでレイアウトが崩れない）
            null
          )}
        </div>
      </section>
    </>
  );
}
