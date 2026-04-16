import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { fetchAddressByZip } from "./utils"; // 👈 utilsからインポート

interface Props {
    db: Database;
    onSetupComplete?: () => void;
}

export default function CompanyManager({ db, onSetupComplete }: Props) {
    const [hasSavedOnce, setHasSavedOnce] = useState(false);

    // --- 会社情報用ステート ---
    const [compName, setCompName] = useState("");
    const [compZip, setCompZip] = useState("");
    const [compAddr, setCompAddr] = useState("");
    const [compPhone, setCompPhone] = useState("");
    const [compNum, setCompNum] = useState(""); // 法人番号
    const [compRep, setCompRep] = useState("");
    const [compHealth, setCompHealth] = useState(""); // ✨追加
    const [compLabor, setCompLabor] = useState("");   // ✨追加
    const [headPref, setHeadPref] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isSearchingZip, setIsSearchingZip] = useState(false);

    // --- 支店管理用ステート ---
    const [branches, setBranches] = useState<any[]>([]);
    const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
    const [bName, setBName] = useState("");
    const [bZip, setBZip] = useState("");
    const [bPref, setBPref] = useState("");
    const [bAddr, setBAddr] = useState("");
    const [bPhone, setBPhone] = useState("");       // ✨追加
    const [bHealth, setBHealth] = useState("");     // ✨追加
    const [bLabor, setBLabor] = useState("");       // ✨追加
    const [isSearchingBZip, setIsSearchingBZip] = useState(false);
    const [deletingBranchId, setDeletingBranchId] = useState<number | null>(null);

    // フォーカス状態
    const [isZipFocus, setIsZipFocus] = useState(false);
    const [isBZipFocus, setIsBZipFocus] = useState(false);

    // 共通のフォーカスイベントハンドラ（コードをスッキリさせるため）
    const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
        e.currentTarget.style.borderColor = "#3498db";
        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(52, 152, 219, 0.2)";
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>, isError: boolean = false) => {
        e.currentTarget.style.borderColor = isError ? "#e74c3c" : "#ddd";
        e.currentTarget.style.boxShadow = "none";
    };

    // 🆕 共通：郵便番号を整形して住所を取得する関数
    const handleZipSearch = async (
        zip: string, 
        setZip: (z: string) => void, 
        setPref: (p: string) => void, 
        setAddr: (a: string) => void, 
        setLoading: (l: boolean) => void
    ) => {
        // 数字以外を除去（utils側でもやってますが、ここでもバリデーションとして実行）
        const cleanZip = zip.replace(/[^\d]/g, "");
        
        if (cleanZip.length !== 7) {
            alert("郵便番号は7桁で入力してください");
            return;
        }

        // 💡 ハイフンを自動挿入して見た目を整える
        const formattedZip = cleanZip.slice(0, 3) + "-" + cleanZip.slice(3);
        setZip(formattedZip);

        setLoading(true);
        try {
            // 💡 utils.ts の共通関数を呼び出す
            const res = await fetchAddressByZip(cleanZip);
            
            if (res) {
                setPref(res.address1);
                setAddr(res.address2 + res.address3);
            } else {
                alert("該当する住所が見つかりませんでした");
            }
        } catch (e) {
            console.error("住所検索エラー:", e);
            alert("住所検索中にエラーが発生しました");
        } finally {
            // ローディングが速すぎてチカチカするのを防ぐ
            setTimeout(() => setLoading(false), 300);
        }
    };

    const loadData = async () => {
        try {
            const res = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
            if (res.length > 0) {
                const c = res[0];
                setCompName(c.name || "");
                setCompZip(c.zip_code || "");
                setCompAddr(c.address || "");
                setCompPhone(c.phone || "");
                setCompNum(c.corporate_number || "");
                setCompRep(c.representative || "");
                setCompHealth(c.health_ins_num || ""); // ✨
                setCompLabor(c.labor_ins_num || "");   // ✨
                if (c.name) setHasSavedOnce(true);
            }
            const resB = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
            setBranches(resB);
            const head = resB.find(b => b.id === 1);
            if (head) setHeadPref(head.prefecture || "");
        } catch (e) { console.error("Load Error:", e); }
    };

    useEffect(() => { loadData(); }, [db]);

    const saveCompany = async () => {
        if (!compName.trim()) return alert("会社名/屋号は必須です");
        if (!headPref) return alert("都道府県を選択してください");
        let finalZip = compZip.replace(/[^\d]/g, "");
        if (finalZip.length === 7) finalZip = finalZip.slice(0, 3) + "-" + finalZip.slice(3);

        setIsSaving(true);
        try {
            await db.execute(
                `REPLACE INTO company (id, name, zip_code, address, phone, corporate_number, representative, health_ins_num, labor_ins_num) 
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [compName, compZip, compAddr, compPhone, compNum, compRep, compHealth, compLabor]
            );
            await db.execute(
                `UPDATE branches SET name = ?, zip_code = ?, prefecture = ?, address = ?, phone = ?, health_ins_num = ?, labor_ins_num = ? 
                WHERE id = 1`, 
                [compName, compZip, headPref, compAddr, compPhone, compHealth, compLabor]
            );
            setHasSavedOnce(true);
            await loadData();
            if (onSetupComplete) onSetupComplete();
            setTimeout(() => setIsSaving(false), 1000);
        } catch (e) { setIsSaving(false); }
    };

    const saveBranch = async () => {
        if (!bName || !bPref) return alert("名称と都道府県は必須です");
        
        // 郵便番号の整形（ハイフンありで統一して保存する場合）
        let finalZip = bZip.replace(/[^\d]/g, "");
        if (finalZip.length === 7) finalZip = finalZip.slice(0, 3) + "-" + finalZip.slice(3);

        try {
            if (editingBranchId !== null) {
                await db.execute(
                    `UPDATE branches SET 
                        name = ?, zip_code = ?, prefecture = ?, address = ?, 
                        phone = ?, health_ins_num = ?, labor_ins_num = ? 
                    WHERE id = ?`, 
                    [bName, finalZip, bPref, bAddr, bPhone, bHealth, bLabor, editingBranchId]
                );
            } else {
                await db.execute(
                    `INSERT INTO branches (
                        name, zip_code, prefecture, address, 
                        phone, health_ins_num, labor_ins_num
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                    [bName, finalZip, bPref, bAddr, bPhone, bHealth, bLabor]
                );
            }
            resetBranchForm();
            loadData();
        } catch (e) { 
            console.error(e);
            alert("支店情報の保存に失敗しました。");
        }
    };

    const resetBranchForm = () => { 
        setEditingBranchId(null); 
        setDeletingBranchId(null); // 追加
        setBName(""); 
        setBZip(""); 
        setBPref(""); 
        setBAddr(""); 
        setBPhone(""); setBHealth(""); setBLabor(""); // ✨
    };

    const startEditBranch = (b: any) => { 
        if (b.id === 1) return; // 💡 本店の場合は処理を中断
        setDeletingBranchId(null);
        setEditingBranchId(b.id);
        setBName(b.name); 
        setBZip(b.zip_code || ""); 
        setBPref(b.prefecture); 
        setBAddr(b.address || ""); 
        setBPhone(b.phone || "");        // ✨
        setBHealth(b.health_ins_num || ""); // ✨
        setBLabor(b.labor_ins_num || "");   // ✨
    };

    const deleteBranch = async (id: number) => {
        if (id === 1) return;

        // 【1回目】待機状態でなければ ID を記録して終了
        if (deletingBranchId !== id) {
            setDeletingBranchId(id);
            return;
        }

        // 【2回目】実際の削除処理
        try {
            let count = 0;
            try {
                const staffCount = await db.select<any[]>("SELECT COUNT(*) as count FROM staff WHERE branch_id = ?", [id]);
                count = staffCount[0]?.count || 0;
            } catch (e) { count = 0; }

            if (count > 0) {
                alert(`この支店には現在 ${count} 名の従業員が所属しているため、削除できません。`);
                setDeletingBranchId(null);
                return;
            }

            await db.execute("DELETE FROM branches WHERE id = ?", [id]);
            await loadData();
            
            if (editingBranchId === id) resetBranchForm();
            setDeletingBranchId(null); // 完了後にリセット

        } catch (e) {
            console.error(e);
            alert("削除に失敗しました。");
            setDeletingBranchId(null);
        }
    };

    const isSetup = compName.trim() !== "" && headPref !== "";

    // 法人番号検索ロジック（例）
    const searchCorporateNumber = async () => {
        if (compNum.length !== 13) return alert("法人番号は13桁で入力してください");
        
        setIsSearchingZip(true); // 便宜上同じローディングを使用
        try {
            // ここで実際には外部APIを叩きます
            // const res = await fetch(`https://api.example.com/hojin/${compNum}`);
            // const data = await res.json();
            
            // 以下、デモ用のアニメーション演出
            setTimeout(() => {
                alert("法人番号から会社名と住所を取得しました（シミュレーション）");
                setCompName("テスト株式会社");
                setCompZip("100-0001");
                setHeadPref("東京都");
                setCompAddr("千代田区千代田1-1");
                setIsSearchingZip(false);
            }, 800);
        } catch (e) {
            setIsSearchingZip(false);
        }
    };

    return (
        <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "30px", paddingBottom: "100px" }}>
            
            {!hasSavedOnce && (
                <div style={welcomeBannerStyle}>
                    <h2 style={{ margin: 0 }}>🚢 はじめに：初期設定</h2>
                    <p style={{ margin: "10px 0 0 0" }}>会社名と所在地を設定して、アプリを開始しましょう。</p>
                </div>
            )}

            <section>
                <h2 style={{ color: "#2c3e50", marginBottom: "20px", fontSize: "20px" }}>🏢 会社情報</h2>
                <div style={cardStyle}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                        
                        {/* --- 法人番号を最上部に配置 --- */}
                        <div style={{ gridColumn: "1 / 3", borderBottom: "1px solid #f1f5f9", paddingBottom: "20px", marginBottom: "5px" }}>
                            <label style={labelStyle}>法人番号 (13桁)</label>
                            <div style={{ display: "flex", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", borderRadius: "6px", overflow: "hidden" }}>
                                <input 
                                    value={compNum} 
                                    onChange={e => setCompNum(e.target.value)} 
                                    onFocus={handleFocus}
                                    onBlur={(e) => handleBlur(e)}
                                    placeholder="例: 1234567890123" 
                                    style={{ ...zipInputStyle, flex: 1 }} 
                                />
                                <button 
                                    onClick={() => alert("法人番号検索APIと連携して、情報を自動取得する機能をここに追加できます")}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#edf2f7")}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                                    style={{ ...zipBtnStyle, width: "120px", borderLeft: "1px solid #ddd" }}
                                >
                                    🔍 法人番号検索
                                </button>
                            </div>
                        </div>

                        <div style={{ gridColumn: "1 / 3" }}>
                            <label style={labelStyle}>会社名 / 屋号 (必須)</label>
                            <input 
                                value={compName} 
                                onChange={e => setCompName(e.target.value)} 
                                onFocus={handleFocus}
                                onBlur={(e) => handleBlur(e, !compName.trim())}
                                placeholder="株式会社 〇〇" 
                                style={{ 
                                    ...inputStyle, 
                                    borderColor: !compName.trim() ? "#e74c3c" : "#ddd",
                                }} 
                            />
                        </div>

                        {/* 住所セクション（ここも focus/blur を追加） */}
                        <div style={{ gridColumn: "1 / 3", backgroundColor: "#fcfcfc", padding: "15px", borderRadius: "8px", border: "1px solid #eee" }}>
                            <label style={labelStyle}>📍 本店所在地</label>
                            <div style={{ display: "flex", marginBottom: "10px", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                                <input 
                                    value={compZip} 
                                    onChange={e => setCompZip(e.target.value)} 
                                    onFocus={(e) => { setIsZipFocus(true); handleFocus(e); }}
                                    onBlur={(e) => { setIsZipFocus(false); handleBlur(e); }}
                                    placeholder="郵便番号" 
                                    style={{ 
                                        ...zipInputStyle, width: "150px", 
                                        zIndex: isZipFocus ? 2 : 0,
                                    }} 
                                />
                                <button 
                                    onClick={() => handleZipSearch(compZip, setCompZip, setHeadPref, setCompAddr, setIsSearchingZip)} 
                                    style={{ ...zipBtnStyle, zIndex: 1 }}
                                >
                                    {isSearchingZip ? "⌛" : "🔍 住所検索"}
                                </button>
                            </div>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <select 
                                    value={headPref} 
                                    onChange={e => setHeadPref(e.target.value)} 
                                    onFocus={handleFocus}
                                    // 未選択なら赤、選択済みなら通常色に戻す
                                    onBlur={(e) => handleBlur(e, !headPref)}
                                    style={{ 
                                        ...inputStyle, 
                                        width: "160px", 
                                        borderColor: !headPref ? "#e74c3c" : "#ddd", // 必須チェック
                                        color: !headPref ? "#e74c3c" : "#2c3e50"     // 文字色も少し変えると気づきやすい
                                    }}
                                >
                                    <option value="">都道府県 (必須)</option>
                                    {["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <input 
                                    value={compAddr} 
                                    onChange={e => setCompAddr(e.target.value)} 
                                    onFocus={handleFocus}
                                    onBlur={(e) => handleBlur(e)}
                                    placeholder="市区町村・番地" 
                                    style={inputStyle} 
                                />
                            </div>
                        </div>

                        <div>
                            <label style={labelStyle}>代表者名</label>
                            <input value={compRep} onChange={e => setCompRep(e.target.value)} onFocus={handleFocus} onBlur={(e) => handleBlur(e)} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>電話番号</label>
                            <input value={compPhone} onChange={e => setCompPhone(e.target.value)} onFocus={handleFocus} onBlur={(e) => handleBlur(e)} style={inputStyle} />
                        </div>

                        {/* ✨ 会社用の社会保険・労働保険番号入力欄 */}
                        <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", padding: "15px", backgroundColor: "#f0f9ff", borderRadius: "8px" }}>
                            <div><label style={labelStyle}>🛡️ 社会保険 整理記号・番号</label><input value={compHealth} onChange={e => setCompHealth(e.target.value)} placeholder="例: 12-あいう 1234" style={inputStyle} /></div>
                            <div><label style={labelStyle}>🏗️ 労働保険番号</label><input value={compLabor} onChange={e => setCompLabor(e.target.value)} placeholder="例: 12-1-03-123456-000" style={inputStyle} /></div>
                        </div>

                        <div style={{ gridColumn: "1 / 3" }}>
                            <button 
                                onClick={saveCompany} 
                                disabled={isSaving || !compName.trim() || !headPref} 
                                style={{ 
                                    ...btnStyle, 
                                    width: "100%", 
                                    backgroundColor: isSaving ? "#2ecc71" : (!hasSavedOnce ? "#3498db" : "#34495e"),
                                    opacity: (isSaving || !compName.trim() || !headPref) ? 0.6 : 1, // 押せないときは少し薄く
                                    cursor: (isSaving || !compName.trim() || !headPref) ? "not-allowed" : "pointer"
                                }}
                            >
                                {isSaving ? "✅ 保存完了" : (hasSavedOnce ? "💾 会社情報を更新" : "🚀 設定を完了して開始")}
                            </button>
                            
                            {/* 必須項目が漏れている場合のアシスト表示 */}
                            {(!compName.trim() || !headPref) && (
                                <p style={{ fontSize: "12px", color: "#e74c3c", textAlign: "center", marginTop: "8px", fontWeight: "bold" }}>
                                    ※会社名と都道府県を入力すると保存できます
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {hasSavedOnce && (
                <section>
                    <h2 style={{ color: "#2c3e50", marginBottom: "20px", fontSize: "20px" }}>📍 支店リスト</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "25px" }}>
                        {/* 左：リスト */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {branches.map((b) => (
                                <div key={b.id} style={{ ...branchCardStyle, borderLeft: b.id === 1 ? "5px solid #3498db" : "5px solid #94a3b8", backgroundColor: editingBranchId === b.id ? "#fff9db" : "white" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                            <span style={b.id === 1 ? headBadgeStyle : branchBadgeStyle}>{b.id === 1 ? "本店" : "支店"}</span>
                                            <strong>{b.name}</strong>
                                        </div>
                                        <div style={{ fontSize: "12px", color: "#7f8c8d" }}>〒{b.zip_code} {b.prefecture}{b.address}</div>
                                    </div>
                                    {b.id !== 1 && (
                                        <button onClick={() => startEditBranch(b)} style={editBtnStyle}>編集</button>
                                    )}
                                    {b.id !== 1 && (
                                        deletingBranchId === b.id ? (
                                            <div style={{ display: "flex", gap: "5px" }}>
                                                <button 
                                                    onClick={() => deleteBranch(b.id)} 
                                                    style={{ ...deleteBtnStyle, color: "white", backgroundColor: "#e74c3c", padding: "4px 10px", borderRadius: "4px", fontWeight: "bold" }}
                                                >
                                                    本当に削除
                                                </button>
                                                <button 
                                                    onClick={() => setDeletingBranchId(null)} 
                                                    style={{ ...editBtnStyle, color: "#7f8c8d" }}
                                                >
                                                    戻る
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => deleteBranch(b.id)} style={deleteBtnStyle}>削除</button>
                                        )
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 右：追加・編集ボックス */}
                        <div style={{ ...addBoxStyle, border: editingBranchId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
                            <h4 style={{ margin: "0 0 15px 0" }}>{editingBranchId !== null ? "📝 支店の編集" : "➕ 支店の追加"}</h4>
                            
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
                                    {isSearchingBZip ? "⌛" : "🔍"}
                                </button>
                            </div>

                            <select value={bPref} onChange={e => setBPref(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} style={{ ...inputStyle, ...inputBottomSpace }}>
                                <option value="">都道府県 (必須)</option>
                                    {["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"].map(p => <option key={p} value={p}>{p}</option>)}
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

                            <label style={miniLabelStyle}>社会保険番号 (支店固有の場合)</label>
                            <input 
                                value={bHealth} 
                                onChange={e => setBHealth(e.target.value)} 
                                placeholder="未入力なら本店と同じ"
                                style={{ ...inputStyle, ...inputBottomSpace }} 
                            />

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
                                        backgroundColor: (!bName || !bPref) ? "#bdc3c7" : "#2ecc71" 
                                    }}
                                >
                                    {(!bName || !bPref) ? "支店名と都道府県を入力" : (editingBranchId !== null ? "更新する" : "支店を追加")}
                                </button>
                                {editingBranchId !== null && <button onClick={resetBranchForm} style={{ ...addBtnStyle, backgroundColor: "#95a5a6" }}>取消</button>}
                            </div>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

const welcomeBannerStyle = { backgroundColor: "#ebf5fb", padding: "20px", borderRadius: "12px", border: "1px solid #3498db", color: "#2980b9" };
const cardStyle = { backgroundColor: "white", padding: "30px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const inputStyle = { 
    padding: "10px", 
    border: "1px solid #ddd", 
    borderRadius: "6px", 
    fontSize: "14px", 
    width: "100%", 
    boxSizing: "border-box" as const, 
    outline: "none", 
    transition: "all 0.2s ease-in-out", // アニメーション
};
const labelStyle = { fontSize: "13px", color: "#7f8c8d", marginBottom: "5px", display: "block", fontWeight: "bold" as const };
const btnStyle = { color: "white", border: "none", padding: "12px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "16px", fontWeight: "bold" as const, transition: "all 0.2s" };
const branchCardStyle = { display: "flex", alignItems: "center", padding: "15px 20px", borderRadius: "8px", border: "1px solid #eee", gap: "15px", backgroundColor: "white" };
const headBadgeStyle = { backgroundColor: "#3498db", color: "white", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" };
const branchBadgeStyle = { backgroundColor: "#94a3b8", color: "white", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" };
const deleteBtnStyle = { 
    background: "none", 
    border: "none", 
    color: "#e74c3c", 
    cursor: "pointer", 
    fontSize: "12px",
    minWidth: "60px" // 文字数が変わってもレイアウトがガタつかない
};
const editBtnStyle = { background: "none", border: "none", color: "#3498db", cursor: "pointer", fontSize: "12px", fontWeight: "bold" as const };
const subBtnStyle = { padding: "0 15px", borderRadius: "6px", border: "1px solid #ddd", cursor: "pointer", backgroundColor: "white", whiteSpace: "nowrap" as const };
const addBoxStyle = { backgroundColor: "#f8fafc", padding: "20px", borderRadius: "12px", alignSelf: "start" as const };
// ラベルの余白を最小限にする
const miniLabelStyle = { 
    fontSize: "11px", 
    fontWeight: "bold" as const, 
    color: "#94a3b8", 
    marginBottom: "1px", // 👈 4pxから1pxへ。ほぼ密着させます
    display: "block" 
};

// 入力欄の下に余白を作り、次のラベルとの距離を離す
const inputBottomSpace = {
    marginBottom: "12px" // 👈 これで「セット間」の距離を作ります
};
const addBtnStyle = { flex: 1, backgroundColor: "#2ecc71", color: "white", border: "none", padding: "12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" as const };
const zipInputStyle = { ...inputStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none", position: "relative" as const, transition: "all 0.2s" };
const zipBtnStyle = { ...subBtnStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, backgroundColor: "#f8fafc", transition: "all 0.2s" };