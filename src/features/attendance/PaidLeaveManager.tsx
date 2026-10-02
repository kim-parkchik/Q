import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";

interface Props {
  db: Database;
  staffList: any[];
}

const PaidLeaveManager: React.FC<Props> = ({ db, staffList }) => {
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>(["active"]);

  // 🆕 Stateに変更：マスタ上の全店舗名
  const [allBranchNames, setAllBranchNames] = useState<string[]>([]);
  // 支店フィルタの状態
  const [branchFilters, setBranchFilters] = useState<string[]>([]);

  // 🆕 データベースから「全店舗名」を直接取得する
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await db.select<any[]>("SELECT name FROM branches ORDER BY id ASC");
        const names = res.map(b => b.name);
        setAllBranchNames(names);
        // 初回のみ、全ての支店を選択状態にする
        setBranchFilters(names);
      } catch (error) {
        console.error("支店リストの取得に失敗:", error);
      }
    };
    fetchBranches();
  }, [db]); // dbが変わった時（初回）のみ実行

  const [grants, setGrants] = useState<any[]>([]);

  // 日付・フォーム関連のState
  const today = new Date().toISOString().split('T')[0];
  const [grantDate, setGrantDate] = useState(today);
  const [days, setDays] = useState(10);
  const [usageDate, setUsageDate] = useState(today);
  const [usageDays, setUsageDays] = useState(1.0);
  const [leaveName, setLeaveName] = useState("法定有給");
  const [expiryDate, setExpiryDate] = useState("");
  const [usageHistory, setUsageHistory] = useState<any[]>([]);

  // 付与日が変更されたら、自動で「2年後の前日」を計算してセット（あくまでデフォルト値）
  useEffect(() => {
    const d = new Date(grantDate);
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + 2);
      d.setDate(d.getDate() - 1);
      setExpiryDate(d.toISOString().split('T')[0]);
    }
  }, [grantDate]);

  // 付与枠と取得履歴をまとめて読み込む
  const loadAllData = async (staffId: string) => {
    if (!staffId) return;

    // 1. 付与枠の読み込み
    const resGrants = await db.select<any[]>(
      "SELECT * FROM paid_leave_grants WHERE staff_id = ? ORDER BY grant_date DESC",
      [staffId]
    );
    setGrants(resGrants);

    // 2. 取得履歴の読み込み
    const resHistory = await db.select<any[]>(
      `SELECT * FROM paid_leave_usage WHERE staff_id = ? ORDER BY usage_date DESC`,
      [staffId]
    );
    setUsageHistory(resHistory);
  };

  // 🌟 ここが重要！初期読み込みを loadAllData に
  useEffect(() => {
    if (selectedStaffId) {
      loadAllData(selectedStaffId);
    }
  }, [selectedStaffId]);

  // 🌟 付与処理の最後
  const handleAddGrant = async () => {
    if (!selectedStaffId) return;
    try {
      await db.execute(
        "INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
        [selectedStaffId, leaveName, grantDate, expiryDate, days]
      );
      await loadAllData(selectedStaffId); // 👈 全データ更新
      alert(`「${leaveName}」を登録しました。`);
    } catch (error) {
      console.error(error);
      alert("登録に失敗しました。");
    }
  };

  // 🌟 消化処理の最後
  const handleUseLeave = async () => {
    if (!selectedStaffId) return;
    try {
      const availableGrants = await db.select<any[]>(
        `SELECT * FROM paid_leave_grants 
        WHERE staff_id = ? AND (days_granted - days_used) > 0 
        AND expiry_date >= ?
        ORDER BY grant_date ASC`, 
        [selectedStaffId, usageDate]
      );

      if (availableGrants.length === 0) {
        alert("有効な残日数がありません。");
        return;
      }

      let remainingToReduce = usageDays;
      for (const grant of availableGrants) {
        if (remainingToReduce <= 0) break;
        const grantRemaining = grant.days_granted - grant.days_used;
        const reduceAmount = Math.min(grantRemaining, remainingToReduce);

        await db.execute(
          "UPDATE paid_leave_grants SET days_used = days_used + ? WHERE id = ?",
          [reduceAmount, grant.id]
        );
        remainingToReduce -= reduceAmount;
      }
        
      // 2. 取得履歴テーブルに記録
      await db.execute(
        "INSERT INTO paid_leave_usage (staff_id, usage_date, days_used) VALUES (?, ?, ?)",
        [selectedStaffId, usageDate, usageDays]
      );

      await loadAllData(selectedStaffId); // 👈 ここも全データ更新に変える
      alert(`${usageDate}に ${usageDays}日 分の消化を記録しました。`);
    } catch (error) {
      console.error(error);
      alert("エラーが発生しました。");
    }
  };

  // ✨ フィルタリングロジック
  const filteredStaffList = staffList.filter(s => {
    const matchesStatus = activeFilters.includes(s.status);
    const matchesBranch = branchFilters.includes(s.branch_name);
    return matchesStatus && matchesBranch;
  });

  // ✨ フィルタ変更時のリセットロジック
  useEffect(() => {
    if (selectedStaffId) {
      const isStillVisible = filteredStaffList.some(s => String(s.id) === String(selectedStaffId));
      if (!isStillVisible) setSelectedStaffId("");
    }
  }, [activeFilters, branchFilters, filteredStaffList]); // filteredStaffList 自体も監視対象へ

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* <div style={{ padding: "20px", background: "#f8fafc", borderRadius: "8px", minHeight: "100vh" }}> */}
            
      <section style={{ marginBottom: "20px" }}>
        {/* 1. 上段：支店選択（グループ分けの役割） */}
        <div style={{ 
          backgroundColor: "white", 
          padding: "12px 20px", 
          borderRadius: "10px 10px 0 0", // 下側は繋げる
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "#e2e8f0",
          borderBottom: "none", // 下の段と合体させる
          display: "flex",
          alignItems: "center",
          gap: "15px",
          flexWrap: "wrap"
        }}>
          <span style={filterLabelStyle}>対象支店:</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {/* 🆕 allBranchNames を使用してボタンを生成 */}
            {allBranchNames.map(branchName => (
              <button
                key={branchName}
                onClick={() => {
                  setBranchFilters(prev => 
                    prev.includes(branchName) 
                      ? prev.filter(v => v !== branchName) 
                      : [...prev, branchName]
                  );
                }}
                style={getFilterButtonStyle(branchFilters.includes(branchName), "#0055A4")}
              >
                {branchName}
              </button>
            ))}
          </div>
                    
          <button 
            onClick={() => {
              setActiveFilters(["active"]); // 「在籍」のみに戻す
              setBranchFilters(allBranchNames); // 「全支店選択」に戻す
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

        {/* 2. 下段：従業員選択 ＆ 状態フィルタ ＆ 残日数表示（高さ固定） */}
        <div style={{ 
          backgroundColor: "#f1f5f9",
          padding: "10px 20px", // パディングを少し調整
          borderRadius: "0 0 10px 10px", 
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          gap: "40px",
          height: "52px", // ✨ 親要素の高さを固定（padding等を含めた計算値）
          boxSizing: "border-box"
        }}>
          {/* 左側：セレクトボックス（高さ32px） */}
          <div style={{ flex: "0 1 450px" }}> 
            <select 
            value={selectedStaffId} 
            onChange={e => setSelectedStaffId(e.target.value)} 
            style={{ 
              width: "100%",
              fontSize: "14px",
              padding: "0 12px",
              height: "32px", // ✨ 明示的に高さを指定
              borderRadius: "6px",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: "#cbd5e1",
              cursor: "pointer",
              backgroundColor: "white",
              lineHeight: "30px"
            }}
            >
            <option value="">-- 従業員を選択 ({filteredStaffList.length}名) --</option>
            {filteredStaffList.map(s => (
              <option key={s.id} value={s.id}>
              [{s.branch_name || "本部"}] {s.id}: {s.name}
              </option>
            ))}
            </select>
          </div>

          {/* 右側：状態フィルタ（高さ32px程度で安定） */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={filterLabelStyle}>状態:</span>
            {[
            { label: "在籍", value: "active", color: "#2ecc71" },
            { label: "休職", value: "on_leave", color: "#f1c40f" },
            { label: "退職", value: "retired", color: "#e74c3c" }
            ].map(opt => (
            <button
              key={opt.value}
              onClick={() => {
              setActiveFilters(prev => 
                prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
              );
              }}
              style={{
              ...getFilterButtonStyle(activeFilters.includes(opt.value), opt.color),
              height: "28px", // ✨ ボタンの高さも固定
              lineHeight: "1"
              }}
            >
              {opt.label}
            </button>
            ))}
          </div>

          {/* ✨ 右端：残日数表示エリア（非表示時も高さを維持） */}
          <div style={{ 
            marginLeft: "auto", 
            minWidth: "120px", // 幅も確保しておくとガタつかない
            display: "flex", 
            justifyContent: "flex-end" 
          }}>
            {selectedStaffId ? (
              <div style={{ 
                backgroundColor: "#002D62", 
                color: "white", 
                padding: "4px 15px", 
                borderRadius: "6px",
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                height: "32px", // ✨ セレクトボックスと高さを合わせる
                boxSizing: "border-box"
              }}>
                <span style={{ fontSize: "10px", opacity: 0.8 }}>残日数</span>
                <span style={{ fontSize: "16px", fontWeight: "bold" }}>
                {grants.reduce((sum, g) => sum + (g.days_granted - g.days_used), 0)}
                <small style={{ marginLeft: "4px", fontSize: "10px", fontWeight: "normal" }}>日</small>
                </span>
              </div>
            ) : (
              /* 未選択時：見えない要素を置いて高さを保つ、または単に空にする（親がheight固定なのでこれでもOK） */
              <div style={{ height: "32px" }} />
            )}
          </div>
        </div>
      </section>

      {selectedStaffId ? (
        <>
          {/* 付与・消化フォームエリア */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
            {/* 付与フォーム */}
            <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #38a169" }}>
              <h3 style={{ marginTop: 0, marginBottom: "15px", fontSize: "16px", color: "#2f855a", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>➕</span> 有給・休暇の付与
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={miniLabelStyle}>休暇名称</label>
                  <input type="text" list="leave-names" value={leaveName} onChange={e => setLeaveName(e.target.value)} style={formInputStyle} />
                  <datalist id="leave-names">
                    <option value="法定有給" /><option value="夏季休暇" /><option value="特別休暇" />
                  </datalist>
                </div>
                <div>
                  <label style={miniLabelStyle}>付与日数</label>
                  <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} style={formInputStyle} />
                </div>
                <div>
                  <label style={miniLabelStyle}>付与日</label>
                  <input type="date" value={grantDate} onChange={e => setGrantDate(e.target.value)} style={formInputStyle} />
                </div>
                <div>
                  <label style={miniLabelStyle}>有効期限</label>
                  <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={formInputStyle} />
                </div>
              </div>
              <button onClick={handleAddGrant} style={{ ...actionBtnStyle, backgroundColor: "#38a169", marginTop: "15px" }}>付与を実行する</button>
            </div>

            {/* 消化フォーム */}
            <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #e53e3e" }}>
              <h3 style={{ marginTop: 0, marginBottom: "15px", fontSize: "16px", color: "#c53030", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>➖</span> 有給の消化記録
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={miniLabelStyle}>取得日</label>
                  <input type="date" value={usageDate} onChange={e => setUsageDate(e.target.value)} style={formInputStyle} />
                </div>
                <div>
                  <label style={miniLabelStyle}>消化区分</label>
                  <select value={usageDays} onChange={e => setUsageDays(Number(e.target.value))} style={formInputStyle}>
                    <option value={1.0}>1.0日 (全休)</option>
                    <option value={0.5}>0.5日 (半休)</option>
                  </select>
                </div>
              </div>
              <div style={{ height: "58px" }}></div> {/* 高さを揃えるための調整 */}
              <button onClick={handleUseLeave} style={{ ...actionBtnStyle, backgroundColor: "#e53e3e", marginTop: "15px" }}>消化を記録する</button>
            </div>
          </div>
          {/* テーブルセクション */}
          <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ marginTop: 0, fontSize: "15px", borderLeft: "4px solid #3498db", paddingLeft: "10px", marginBottom: "15px" }}>休暇保有状況</h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={thStyle}>名称</th>
                  <th style={thStyle}>付与日</th>
                  <th style={thStyle}>有効期限</th>
                  <th style={thStyle}>付与数</th>
                  <th style={thStyle}>消化数</th>
                  <th style={thStyle}>残数</th>
                </tr>
              </thead>
              <tbody>
                {grants.map(g => (
                  <tr key={g.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdStyle}>{g.name}</td>
                    <td style={tdStyle}>{g.grant_date}</td>
                    <td style={tdStyle}>{g.expiry_date}</td>
                    <td style={tdStyle}>{g.days_granted}日</td>
                    <td style={tdStyle}>{g.days_used}日</td>
                    <td style={{ ...tdStyle, fontWeight: "bold", color: (g.days_granted - g.days_used) > 0 ? "#2c3e50" : "#cbd5e1" }}>
                      {g.days_granted - g.days_used}日
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ marginTop: "30px", fontSize: "15px", borderLeft: "4px solid #94a3b8", paddingLeft: "10px", marginBottom: "15px" }}>取得履歴（直近）</h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={thStyle}>取得日</th>
                  <th style={thStyle}>消化日数</th>
                  <th style={thStyle}>備考</th>
                </tr>
              </thead>
              <tbody>
                {usageHistory.length > 0 ? usageHistory.map(u => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdStyle}>{u.usage_date}</td>
                    <td style={tdStyle}>{u.days_used === 0.5 ? "0.5日 (半休)" : "1.0日 (全休)"}</td>
                    <td style={tdStyle}>{u.description || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>履歴はありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "100px", color: "#94a3b8", backgroundColor: "white", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
          従業員を選択してください
        </div>
      )}
    </div>
  );
};

// スタイル定数
const miniLabelStyle = { fontSize: "11px", color: "#64748b", fontWeight: "bold", display: "block", marginBottom: "4px" };
const formInputStyle = { width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "14px", boxSizing: "border-box" as const };
const actionBtnStyle = { width: "100%", padding: "10px", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const };
const thStyle = { padding: "12px 10px", textAlign: "left" as const, fontSize: "12px", color: "#64748b", borderBottom: "2px solid #e2e8f0" };
const tdStyle = { padding: "12px 10px", fontSize: "14px", borderBottom: "1px solid #f1f5f9" };
// 🆕 追加するスタイルヘルパー
const filterLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "bold",
  color: "#64748b",
  minWidth: "40px"
};

const getFilterButtonStyle = (isActive: boolean, color: string): React.CSSProperties => ({
  padding: "4px 14px",
  borderRadius: "15px",
  // ⚠️ border: `1px solid ${color}` を分解
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: color, 
  
  backgroundColor: isActive ? color : "white",
  color: isActive ? "white" : color,
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: "bold",
  transition: "0.2s",
  whiteSpace: "nowrap",
  outline: "none" // フォーカス時の挙動も安定させる
});
export default PaidLeaveManager;