import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { fetch } from '@tauri-apps/plugin-http';
import { ask } from '@tauri-apps/plugin-dialog';
import { 
    Fingerprint,
    Building2,    // 基本情報（ビル）
    FileText,     // 給与規定（書類）
    MapPin,       // 支店リスト（ピン）
    Calculator,   // 端数処理（計算機）
    Search,       // 検索（ルーペ）
    ShieldCheck,  // 社会保険（盾）
    HardHat,      // 労働保険（ヘルメット）
    UserRound,    // 代表者
    Phone,        // 電話
    CalendarDays, // 週の起算日
    Save,
    Check,
    Rocket,         // 保存
    Trash2,       // 削除
    AlertTriangle,
    Pencil,       // 編集
    RotateCcw,    // リセット・戻る
    Loader2,      // ローディング（⌛の代わり）
    AlertCircle,
    PlusCircle,
    CheckCircle2,
    X,
    Clock,
    Hash
} from 'lucide-react';
import { fetchAddressByZip } from "../../utils/addressUtils";

interface Props {
    db: Database;
    onSetupComplete?: () => void;
}

export default function CompanyManager({ db, onSetupComplete }: Props) {
    // --- タブ管理 ---
    const [activeSubTab, setActiveSubTab] = useState<"info" | "branches" | "rounding" | "payroll">("info");
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
    const [weekStartDay, setWeekStartDay] = useState(0);
    const [isWeekStartEditable, setIsWeekStartEditable] = useState(false);
    const [originalWeekStartDay, setOriginalWeekStartDay] = useState(0);
    const [isSearchingComp, setIsSearchingComp] = useState(false);

    // --- 給与規定グループ用ステート ---
    const [payrollGroups, setPayrollGroups] = useState<any[]>([]);
    const [pgName, setPgName] = useState("");
    const [pgClosingDay, setPgClosingDay] = useState(99); // 99を末日とする
    const [pgIsNextMonth, setPgIsNextMonth] = useState(0); // 0:当月, 1:翌月
    const [pgPaymentDay, setPgPaymentDay] = useState(25);
    const [editingPgId, setEditingPgId] = useState<number | null>(null);
    const [deletingPgId, setDeletingPgId] = useState<number | null>(null);

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

    // --- 🆕 端数処理設定用ステート ---
    // 残業代：労基法で「四捨五入」が明確に認められているため round が標準的
    const [roundOvertime, setRoundOvertime] = useState("round"); 

    // 社会保険：法的原則は「50銭以下切り捨て」のため currency_law が最も正確
    const [roundSocialIns, setRoundSocialIns] = useState("currency_law"); 

    // 雇用保険：通貨単位法（0.51円から切上）が厳格に適用されるため currency_law が推奨
    const [roundEmpIns, setRoundEmpIns] = useState("currency_law");

    // --- タブ切り替えボタンのスタイル ---
    const subTabStyle = (isActive: boolean) => ({
        padding: "10px 20px",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "bold" as const,
        border: "none",
        borderBottom: isActive ? "3px solid #3498db" : "3px solid transparent",
        backgroundColor: "transparent",
        color: isActive ? "#3498db" : "#7f8c8d",
        transition: "all 0.2s"
    });

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
                setWeekStartDay(c.week_start_day ?? 0); // 👈 0（日曜）をデフォルトに
                setOriginalWeekStartDay(c.week_start_day); // 👈 保存用に「元の値」を記憶
                setCompHealth(c.health_ins_num || "");
                setCompLabor(c.labor_ins_num || "");
                // --- 👇 🆕 端数処理設定をDBから読み込む ---
                setRoundOvertime(c.round_overtime || "round");
                setRoundSocialIns(c.round_social_ins || "floor");
                setRoundEmpIns(c.round_emp_ins || "round");
                if (c.name) setHasSavedOnce(true);
            }
            const resB = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
            setBranches(resB);
            const head = resB.find(b => b.id === 1);
            if (head) setHeadPref(head.prefecture || "");
            const resPG = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
            setPayrollGroups(resPG);
        } catch (e) { console.error("Load Error:", e); }
    };

    useEffect(() => { loadData(); }, [db]);

    const revalidateAllAttendance = async (newStartDay: number) => {
        try {
            // 全従業員の未確定勤怠を一括で「要チェック」にする
            // (ロック機能がある場合は WHERE lock_status = 0 などを追加)
            await db.execute(
                `UPDATE attendance 
                SET is_error = 1, 
                    error_message = '週の起算日が変更されました。集計結果を再確認してください。'`
            );
            console.log("全勤怠データの再検証フラグを立てました。");
            } catch (e) {
                console.error("Revalidation Error:", e);
                alert("勤怠データの再検証中にエラーが発生しました。");
            }
        };

    const saveCompany = async () => {
        if (!compName.trim()) return alert("会社名/屋号は必須です");
        if (!headPref) return alert("都道府県を選択してください");
        let finalZip = compZip.replace(/[^\d]/g, "");
        if (finalZip.length === 7) finalZip = finalZip.slice(0, 3) + "-" + finalZip.slice(3);

        // --- 1. 起算日の変更があるか事前にチェック ---
        // (originalWeekStartDay は loadData 時にステートに保存しておいた元の値)
        const isWeekStartChanged = hasSavedOnce && (weekStartDay !== originalWeekStartDay);

        if (isWeekStartChanged) {
            const ok = await ask(
                "週の起算日を変更すると、全ての勤怠データの残業計算がやり直しになります。一部のデータが「要再確認」状態になる可能性がありますが、実行しますか？",
                { title: '重要：設定の変更', kind: 'warning' }
            );
            if (!ok) return; // キャンセルなら保存自体を中止
        }

        setIsSaving(true);
        try {
            await db.execute(
                `REPLACE INTO company (
                    id, name, zip_code, address, phone, corporate_number, representative, 
                    health_ins_num, labor_ins_num, 
                    round_overtime, round_social_ins, round_emp_ins, week_start_day
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    compName, compZip, compAddr, compPhone, compNum, compRep, 
                    compHealth, compLabor, 
                    roundOvertime, roundSocialIns, roundEmpIns, weekStartDay
                ]
            );
            await db.execute(
                `UPDATE branches SET name = ?, zip_code = ?, prefecture = ?, address = ?, phone = ?, health_ins_num = ?, labor_ins_num = ? 
                WHERE id = 1`, 
                [compName, compZip, headPref, compAddr, compPhone, compHealth, compLabor]
            );

            // --- 3. 【重要】カレンダーの再検証ロジックを走らせる ---
            if (isWeekStartChanged) {
                // 全従業員の勤怠データを再評価する関数を呼び出す
                // (この関数は別途定義するか、親から渡す必要があります)
                await revalidateAllAttendance(weekStartDay); 
            }

            setHasSavedOnce(true);
            await loadData();

            if (onSetupComplete) onSetupComplete();
            setTimeout(() => setIsSaving(false), 1000);
            setIsWeekStartEditable(false); // 保存が終わったら編集モードを自動で閉じるのが親切です

        } catch (e) { setIsSaving(false); }
    };

    // 編集開始
    const startEditPg = (pg: any) => {
        setEditingPgId(pg.id);
        setPgName(pg.name);
        setPgClosingDay(pg.closing_day);
        setPgIsNextMonth(pg.is_next_month);
        setPgPaymentDay(pg.payment_day);
    };

    // フォームのリセット（キャンセル時）
    const resetPgForm = () => {
        setEditingPgId(null);
        setPgName("");
        setPgClosingDay(99);
        setPgIsNextMonth(0);
        setPgPaymentDay(25);
    };

    // 保存処理（新規登録・更新兼用）
    const savePayrollGroup = async () => {
        if (!pgName) return alert("グループ名を入力してください");

        try {
            if (editingPgId !== null) {
                // 更新
                await db.execute(
                    `UPDATE payroll_groups SET name=?, closing_day=?, is_next_month=?, payment_day=? WHERE id=?`,
                    [pgName, pgClosingDay, pgIsNextMonth, pgPaymentDay, editingPgId]
                );
            } else {
                // 新規
                await db.execute(
                    "INSERT INTO payroll_groups (name, closing_day, is_next_month, payment_day) VALUES (?, ?, ?, ?)",
                    [pgName, pgClosingDay, pgIsNextMonth, pgPaymentDay]
                );
            }
            resetPgForm();
            loadData();
        } catch (e) {
            console.error(e);
            alert("保存に失敗しました");
        }
    };

    const deletePayrollGroup = async (id: number) => {
        try {
            // 所属人数チェック
            const staffCount = await db.select<any[]>("SELECT COUNT(*) as count FROM staff WHERE payroll_group_id = ?", [id]);
            if ((staffCount[0]?.count || 0) > 0) {
                alert("この規定には従業員が紐付いているため削除できません。");
                setDeletingPgId(null);
                return;
            }

            await db.execute("DELETE FROM payroll_groups WHERE id = ?", [id]);
            setDeletingPgId(null);
            loadData();
        } catch (e) {
            alert("削除に失敗しました");
        }
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

    // --- 🆕 端数処理設定だけを保存する関数 ---
    const saveRoundingSettings = async () => {
        setIsSaving(true);
        try {
            await db.execute(
                `UPDATE company SET 
                    round_overtime = ?, 
                    round_social_ins = ?, 
                    round_emp_ins = ? 
                WHERE id = 1`,
                [roundOvertime, roundSocialIns, roundEmpIns]
            );
            alert("端数処理設定を保存しました");
            await loadData(); // 最新状態を再読み込み
        } catch (e) {
            console.error(e);
            alert("保存に失敗しました");
        } finally {
            setIsSaving(false);
        }
    };

    // 法人番号検索ロジック
    const searchCorporateNumber = async () => {
        if (compNum.length !== 13) return alert("法人番号は13桁で入力してください");
        
        setIsSearchingComp(true);
        try {
            // --- Step 1: 国税庁から名称と住所を取得 ---
            const ntaUrl = `https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=${compNum}`;
            const resNta = await fetch(ntaUrl, { 
                method: 'GET', 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                redirect: 'follow' 
            });
            const html = await resNta.text();

            const nameMatch = html.match(/<p class="nodeName">([\s\S]*?)<\/p>/) || html.match(/<dt>商号又は名称<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
            const addrMatch = html.match(/<p class="nodeAddress">([\s\S]*?)<\/p>/) || html.match(/<dt>本店又は主たる事務所の所在地<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);

            if (nameMatch && addrMatch) {
                const cleanName = nameMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
                const cleanAddr = addrMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

                setCompName(cleanName);

                // --- Step 2: 郵便番号を粘り強く検索 (末尾から1文字ずつ削る) ---
                let foundZip = "";
                let searchAddr = cleanAddr.replace(/[0-9０-９-－].*$/, "").trim();

                while (searchAddr.length >= 5) {
                    try {
                        const zipUrl = `https://zipcloud.ibsnet.co.jp/api/search?address=${encodeURIComponent(searchAddr)}`;
                        
                        const resZip = await fetch(zipUrl, { 
                            method: 'GET',
                            // 🆕 TauriのプラグインHTTPで、ブラウザであることをより強く主張する
                            headers: {
                                'Accept': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            },
                            connectTimeout: 5000 // タイムアウト設定
                        });

                        const zipData: any = await resZip.json();

                        // デバッグ用: コンソールで中身を確認
                        console.log(`Searching: ${searchAddr}`, zipData);

                        if (zipData && zipData.results && zipData.results.length > 0) {
                            const z = zipData.results[0];
                            foundZip = `${z.zipcode.substring(0, 3)}-${z.zipcode.substring(3)}`;
                            break; 
                        }
                    } catch (e) {
                        console.error("Zip search error:", e);
                    }
                    searchAddr = searchAddr.slice(0, -1);
                }
                setCompZip(foundZip);

                // 都道府県切り出し
                const prefs = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
                let detectedPref = prefs.find(p => cleanAddr.startsWith(p)) || "";

                if (detectedPref) {
                    setHeadPref(detectedPref);
                    setCompAddr(cleanAddr.replace(detectedPref, "").trim());
                } else {
                    setCompAddr(cleanAddr);
                }
            } else {
                throw new Error("法人情報の取得に失敗しました。番号を確認してください。");
            }
        } catch (e) {
            console.error(e);
            alert("情報の取得に失敗しました。");
        } finally {
            setIsSearchingComp(false);
        }
    };

    return (
        <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "30px", paddingBottom: "100px" }}>
        
            {/* --- 1. 未保存（初回）ならタブを出さずに「会社情報」だけ表示 --- */}
            {!hasSavedOnce ? (
                <>
                    <div style={welcomeBannerStyle}>
                        <h2 style={{ margin: 0 }}>🚢 はじめに：初期設定</h2>
                        <p style={{ margin: "10px 0 0 0" }}>会社名と所在地を設定して、アプリを開始しましょう。</p>
                    </div>

                    <section>
                        <div style={cardStyle}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                                {/* 法人番号検索セクション */}
                                <div style={{ gridColumn: "1 / 3", marginBottom: "-10px" }}>
                                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                        <Fingerprint size={16} /> 法人番号 (13桁)
                                    </label>
                                    <div style={{ display: "flex", border: "1px solid #ddd", borderRadius: "6px", overflow: "hidden" }}>
                                        <input 
                                            value={compNum} 
                                            onChange={e => setCompNum(e.target.value.replace(/[^\d]/g, ""))} // 数字以外を除去
                                            onFocus={handleFocus} 
                                            onBlur={handleBlur} 
                                            maxLength={13}
                                            placeholder="例: 1234567890123" 
                                            style={{ ...zipInputStyle, flex: 1, border: "none" }} 
                                        />
                                        <button 
                                            onClick={searchCorporateNumber} 
                                            disabled={isSearchingComp || compNum.length !== 13}
                                            style={{ 
                                                ...zipBtnStyle, 
                                                width: "140px", 
                                                borderLeft: "1px solid #ddd",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: "6px",
                                                cursor: isSearchingComp ? "not-allowed" : "pointer"
                                            }}
                                        >
                                            {isSearchingComp ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                                <Fingerprint size={14} />
                                            )}
                                            <span>{isSearchingComp ? "取得中..." : "名称・住所取得"}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* 住所セクション（ここも focus/blur を追加） */}
                                <div style={{ 
                                    gridColumn: "1 / 3", 
                                    backgroundColor: "#fcfcfc", 
                                    padding: "25px",         // 内側の余白を少し広めに
                                    borderRadius: "10px", 
                                    border: "1px solid #eee",
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: "20px",              // ★ これで枠内の項目同士に均等な隙間が空きます
                                    marginBottom: "-10px"
                                }}>

                                    {/* 会社名 */}
                                    <div>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Building2 size={16} /> 会社名 / 屋号 (必須)
                                        </label>
                                        <input 
                                            value={compName} 
                                            onChange={e => setCompName(e.target.value)} 
                                            onFocus={handleFocus}
                                            onBlur={(e) => handleBlur(e, !compName.trim())}
                                            placeholder="株式会社 〇〇" 
                                            style={{ ...inputStyle, borderColor: !compName.trim() ? "#e74c3c" : "#ddd" }} 
                                        />
                                    </div>
                                    
                                    {/* 代表者名 */}
                                    <div>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                            <UserRound size={16} /> 代表者名
                                        </label>
                                        <input 
                                            value={compRep} 
                                            onChange={e => setCompRep(e.target.value)} 
                                            onFocus={handleFocus} 
                                            onBlur={handleBlur} 
                                            placeholder="代表 太郎"
                                            style={inputStyle} 
                                        />
                                    </div>

                                    {/* 本店所在地 */}
                                    <div>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                            <MapPin size={16} /> 本店所在地
                                        </label>
                                        <div style={{ display: "flex", marginBottom: "12px", borderRadius: "6px", overflow: "hidden" }}>
                                            <input value={compZip} onChange={e => setCompZip(e.target.value)} onFocus={(e) => { setIsZipFocus(true); handleFocus(e); }} onBlur={(e) => { setIsZipFocus(false); handleBlur(e); }} placeholder="郵便番号" style={{ ...zipInputStyle, width: "150px" }} />
                                            <button onClick={() => handleZipSearch(compZip, setCompZip, setHeadPref, setCompAddr, setIsSearchingZip)} style={zipBtnStyle}>
                                                {isSearchingZip ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} 住所検索
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

                                    {/* 電話番号 */}
                                    <div>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Phone size={16} /> 電話番号
                                        </label>
                                        <input value={compPhone} onChange={e => setCompPhone(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} placeholder="03-1234-5678" style={inputStyle} />
                                    </div>
                                </div>

                                {/* 🆕 週の起算日設定 */}
                                <div style={{ 
                                    gridColumn: "1 / 3", 
                                    padding: "15px", 
                                    backgroundColor: "#f8fafc", 
                                    borderRadius: "8px", 
                                    border: "1px solid #e2e8f0",
                                    marginBottom: "-10px"
                                }}>
                                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px" }}>
                                        <CalendarDays size={16} color="#3498db" />
                                        週の起算日
                                        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "normal" }}>
                                            ※週40時間超の残業計算に使用します
                                        </span>
                                    </label>
                                    <select 
                                        value={weekStartDay} // ステートを定義
                                        onChange={e => setWeekStartDay(Number(e.target.value))} 
                                        style={{ ...inputStyle, width: "200px" }}
                                    >
                                        <option value={0}>日曜日 (原則)</option>
                                        <option value={1}>月曜日</option>
                                        <option value={2}>火曜日</option>
                                        <option value={3}>水曜日</option>
                                        <option value={4}>木曜日</option>
                                        <option value={5}>金曜日</option>
                                        <option value={6}>土曜日</option>
                                    </select>
                                </div>

                                {/* 社保・労保番号 */}
                                <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", padding: "15px", backgroundColor: "#f0f9ff", borderRadius: "8px" }}>
                                    <div>
                                        <label style={labelStyle}>
                                            <ShieldCheck size={14} style={{ marginRight: '6px' }} /> 社会保険 整理記号・番号
                                        </label>
                                        <input value={compHealth} onChange={e => setCompHealth(e.target.value)} placeholder="例: 12-あいう 1234" style={inputStyle} />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>
                                            <HardHat size={14} style={{ marginRight: '6px' }} /> 労働保険番号
                                        </label>
                                        <input value={compLabor} onChange={e => setCompLabor(e.target.value)} placeholder="例: 12-1-03-123456-000" style={inputStyle} />
                                    </div>
                                </div>

                                <div style={{ gridColumn: "1 / 3" }}>
                                    <button 
                                        onClick={saveCompany} 
                                        disabled={isSaving || !compName.trim() || !headPref} 
                                        style={{ 
                                            ...btnStyle, 
                                            width: "100%", 
                                            backgroundColor: isSaving ? "#2ecc71" : (!hasSavedOnce ? "#3498db" : "#34495e"),
                                            opacity: (isSaving || !compName.trim() || !headPref) ? 0.6 : 1,
                                            cursor: (isSaving || !compName.trim() || !headPref) ? "not-allowed" : "pointer",
                                            // 👇 アイコンと文字を中央に揃える
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "8px"
                                        }}
                                    >
                                        {isSaving ? (
                                            <><Check size={18} /> 保存完了</>
                                        ) : hasSavedOnce ? (
                                            <><Save size={18} /> 会社情報を更新</>
                                        ) : (
                                            <><Rocket size={18} /> 設定を完了して開始</>
                                        )}
                                    </button>
                                    
                                    {/* 必須項目が漏れている場合のアシスト表示 */}
                                    {(!compName.trim() || !headPref) && (
                                        <p style={{ 
                                            fontSize: "12px", 
                                            color: "#e74c3c", 
                                            textAlign: "center", 
                                            marginTop: "8px", 
                                            fontWeight: "bold",
                                            // 👇 警告アイコンを添える
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "4px"
                                        }}>
                                            <AlertCircle size={14} />
                                            ※会社名と都道府県を入力すると保存できます
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </>
            ) : (

                /* --- 2. 保存済みなら「設定タブ」を表示して多機能に切り替え --- */
                <>
                    <div>
                        <div style={{ display: "flex", borderBottom: "1px solid #ddd", gap: "5px" }}>
                            <button onClick={() => setActiveSubTab("info")} style={subTabStyle(activeSubTab === "info")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Building2 size={16} /> 基本情報
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("payroll")} style={subTabStyle(activeSubTab === "payroll")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <FileText size={16} /> 給与規定グループ
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("branches")} style={subTabStyle(activeSubTab === "branches")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <MapPin size={16} /> 支店リスト
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("rounding")} style={subTabStyle(activeSubTab === "rounding")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Calculator size={16} /> 端数処理
                                </div>
                            </button>
                        </div>
                    </div>

                    {activeSubTab === "info" && (
                        <section style={tabContentStyle}>
                            <div style={cardStyle}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                                    {/* 法人番号検索セクション */}
                                    <div style={{ gridColumn: "1 / 3", marginBottom: "-10px" }}>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Fingerprint size={16} /> 法人番号 (13桁)
                                        </label>
                                        <div style={{ display: "flex", border: "1px solid #ddd", borderRadius: "6px", overflow: "hidden" }}>
                                            <input 
                                                value={compNum} 
                                                onChange={e => setCompNum(e.target.value.replace(/[^\d]/g, ""))} // 数字以外を除去
                                                onFocus={handleFocus} 
                                                onBlur={handleBlur} 
                                                maxLength={13}
                                                placeholder="例: 1234567890123" 
                                                style={{ ...zipInputStyle, flex: 1, border: "none" }} 
                                            />
                                            <button 
                                                onClick={searchCorporateNumber} 
                                                disabled={isSearchingComp || compNum.length !== 13}
                                                style={{ 
                                                    ...zipBtnStyle, 
                                                    width: "140px", 
                                                    borderLeft: "1px solid #ddd",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    gap: "6px",
                                                    cursor: isSearchingComp ? "not-allowed" : "pointer"
                                                }}
                                            >
                                                {isSearchingComp ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <Fingerprint size={14} />
                                                )}
                                                <span>{isSearchingComp ? "取得中..." : "名称・住所取得"}</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div style={{ 
                                        gridColumn: "1 / 3", 
                                        backgroundColor: "#fcfcfc", 
                                        padding: "25px",         // 内側の余白を少し広めに
                                        borderRadius: "10px", 
                                        border: "1px solid #eee",
                                        display: "flex", 
                                        flexDirection: "column", 
                                        gap: "20px",              // ★ これで枠内の項目同士に均等な隙間が空きます
                                        marginBottom: "-10px"
                                    }}>
                                        {/* 会社名 */}
                                        <div>
                                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                                <Building2 size={16} /> 会社名 / 屋号 (必須)
                                            </label>
                                            <input 
                                                value={compName} 
                                                onChange={e => setCompName(e.target.value)} 
                                                onFocus={handleFocus}
                                                onBlur={(e) => handleBlur(e, !compName.trim())}
                                                placeholder="株式会社 〇〇" 
                                                style={{ ...inputStyle, borderColor: !compName.trim() ? "#e74c3c" : "#ddd" }} 
                                            />
                                        </div>
                                        
                                        {/* 代表者名 */}
                                        <div>
                                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                                <UserRound size={16} /> 代表者名
                                            </label>
                                            <input 
                                                value={compRep} 
                                                onChange={e => setCompRep(e.target.value)} 
                                                onFocus={handleFocus} 
                                                onBlur={handleBlur} 
                                                placeholder="代表 太郎"
                                                style={inputStyle} 
                                            />
                                        </div>

                                        {/* 本店所在地 */}
                                        <div>
                                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                                <MapPin size={16} /> 本店所在地
                                            </label>
                                            <div style={{ display: "flex", marginBottom: "12px", borderRadius: "6px", overflow: "hidden" }}>
                                                <input value={compZip} onChange={e => setCompZip(e.target.value)} onFocus={(e) => { setIsZipFocus(true); handleFocus(e); }} onBlur={(e) => { setIsZipFocus(false); handleBlur(e); }} placeholder="郵便番号" style={{ ...zipInputStyle, width: "150px" }} />
                                                <button onClick={() => handleZipSearch(compZip, setCompZip, setHeadPref, setCompAddr, setIsSearchingZip)} style={zipBtnStyle}>
                                                    {isSearchingZip ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} 住所検索
                                                </button>
                                            </div>
                                            <div style={{ display: "flex", gap: "10px" }}>
                                                <select value={headPref} onChange={e => setHeadPref(e.target.value)} onFocus={handleFocus} onBlur={(e) => handleBlur(e, !headPref)} style={{ ...inputStyle, width: "160px" }}>
                                                    <option value="">都道府県 (必須)</option>
                                                    {["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"].map(p => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                                <input value={compAddr} onChange={e => setCompAddr(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} placeholder="市区町村・番地" style={{ ...inputStyle, flex: 1 }} />
                                            </div>
                                        </div>

                                        {/* 電話番号 */}
                                        <div>
                                            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                                                <Phone size={16} /> 電話番号
                                            </label>
                                            <input value={compPhone} onChange={e => setCompPhone(e.target.value)} onFocus={handleFocus} onBlur={handleBlur} placeholder="03-1234-5678" style={inputStyle} />
                                        </div>
                                    </div>

                                    {/* 🆕 週の起算日設定（保存済み版：ガードレール付き） */}
                                    <div style={{ 
                                        gridColumn: "1 / 3", 
                                        padding: "15px", 
                                        backgroundColor: isWeekStartEditable ? "#fff5f5" : "#f8fafc", // 編集時は注意喚起の色に
                                        borderRadius: "8px", 
                                        border: isWeekStartEditable ? "1px solid #feb2b2" : "1px solid #e2e8f0",
                                        marginBottom: "-10px"
                                    }}>
                                        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px" }}>
                                            <CalendarDays size={16} color="#3498db" />
                                            週の起算日
                                            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "normal" }}>
                                                ※週40時間超の残業計算に使用します
                                            </span>
                                        </label>

                                        <div style={{ display: "flex", alignItems: "center", gap: "15px", marginTop: "5px" }}>
                                            <select 
                                                disabled={!isWeekStartEditable} // チェックしないと触れない
                                                value={weekStartDay} 
                                                onChange={e => setWeekStartDay(Number(e.target.value))} 
                                                style={{ 
                                                    ...inputStyle, 
                                                    width: "200px",
                                                    backgroundColor: isWeekStartEditable ? "#white" : "#e2e8f0",
                                                    cursor: isWeekStartEditable ? "pointer" : "not-allowed"
                                                }}
                                            >
                                                <option value={0}>日曜日 (原則)</option>
                                                <option value={1}>月曜日</option>
                                                <option value={2}>火曜日</option>
                                                <option value={3}>水曜日</option>
                                                <option value={4}>木曜日</option>
                                                <option value={5}>金曜日</option>
                                                <option value={6}>土曜日</option>
                                            </select>

                                            <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontSize: "12px", color: "#e53e3e" }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isWeekStartEditable}
                                                    onChange={async (e) => {
                                                        // チェックを入れようとした（編集モードにしようとした）とき
                                                        if (e.target.checked) {
                                                            const ok = await ask(
                                                                "起算日を変更すると、未確定の勤怠データの残業計算が即座に再計算されます。続行しますか？", 
                                                                { title: '重要：設定の変更', kind: 'warning' }
                                                            );

                                                            if (ok) {
                                                                // Yesを押した時だけチェックを入れる
                                                                setIsWeekStartEditable(true);
                                                            } else {
                                                                // Noを押した時はチェックを入れない（何もしない）
                                                                setIsWeekStartEditable(false);
                                                            }
                                                        } else {
                                                            // チェックを外そうとしたときは、確認なしでオフにする
                                                            setIsWeekStartEditable(false);
                                                        }
                                                    }}
                                                />
                                                設定を変更する
                                            </label>
                                        </div>
                                    </div>

                                    {/* 社保・労保番号 */}
                                    <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", padding: "15px", backgroundColor: "#f0f9ff", borderRadius: "8px" }}>
                                        <div>
                                            <label style={labelStyle}>
                                                <ShieldCheck size={14} style={{ marginRight: '6px' }} /> 社会保険 整理記号・番号
                                            </label>
                                            <input value={compHealth} onChange={e => setCompHealth(e.target.value)} placeholder="例: 12-あいう 1234" style={inputStyle} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>
                                                <HardHat size={14} style={{ marginRight: '6px' }} /> 労働保険番号
                                            </label>
                                            <input value={compLabor} onChange={e => setCompLabor(e.target.value)} placeholder="例: 12-1-03-123456-000" style={inputStyle} />
                                        </div>
                                    </div>

                                    <div style={{ gridColumn: "1 / 3" }}>
                                        <button 
                                            onClick={saveCompany} 
                                            disabled={isSaving || !compName.trim() || !headPref} 
                                            style={{ 
                                                ...btnStyle, 
                                                width: "100%", 
                                                backgroundColor: isSaving ? "#2ecc71" : (!hasSavedOnce ? "#3498db" : "#34495e"),
                                                // 👇 アイコンと文字を中央に揃える
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: "8px",
                                                transition: "all 0.2s" // 変化を滑らかに
                                            }}
                                        >
                                            {isSaving ? (
                                                <>
                                                    <Loader2 size={18} className="animate-spin" />
                                                    <span>保存中...</span>
                                                </>
                                            ) : hasSavedOnce ? (
                                                <>
                                                    <Save size={18} />
                                                    <span>会社情報を更新</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Rocket size={18} />
                                                    <span>設定を完了して開始</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {activeSubTab === "payroll" && (
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
                    )}

                    {activeSubTab === "branches" && (
                        <section style={tabContentStyle}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "25px" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
                    )}

                    {activeSubTab === "rounding" && (
                        <section style={tabContentStyle}>
                            <div style={cardStyle}>
                                <h3 style={{ marginTop: 0, fontSize: "16px", color: "#34495e", display: "flex", alignItems: "center", gap: "8px" }}>
                                    <Hash size={20} color="#3498db" /> 各計算項目の端数処理ルール
                                </h3>
                                <p style={{ fontSize: "13px", color: "#7f8c8d", marginBottom: "20px" }}>
                                    法令および就業規則に基づき、1円未満の端数をどのように処理するかを選択してください。
                                </p>

                                <div style={{ display: "grid", gap: "20px" }}>
                                    {/* --- 残業代 --- */}
                                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                                        <div style={{ flex: 1 }}>
                                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                                <Clock size={16} color="#e67e22" /> 残業代・深夜手当
                                            </strong>
                                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                                ※1ヶ月の合計額に対して適用されます。
                                            </small>
                                        </div>
                                        <select 
                                            value={roundOvertime} 
                                            onChange={e => setRoundOvertime(e.target.value)} 
                                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                                        >
                                            <option value="round">四捨五入（0.50円以上切上 / 労基法容認）</option>
                                            <option value="currency_law">法的原則（0.51円以上切上 / 通貨単位法）</option>
                                            <option value="ceil">常に切り上げ（従業員に有利）</option>
                                            <option value="floor">常に切り捨て（⚠️未払いのリスクあり）</option>
                                        </select>
                                    </div>

                                    {/* --- 社会保険 --- */}
                                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                                        <div style={{ flex: 1 }}>
                                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                                <ShieldCheck size={16} color="#27ae60" /> 社会保険料（個人負担分）
                                            </strong>
                                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                                ※通貨単位法により、50銭以下切り捨てが一般的です。
                                            </small>
                                        </div>
                                        <select 
                                            value={roundSocialIns} 
                                            onChange={e => setRoundSocialIns(e.target.value)} 
                                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                                        >
                                            <option value="floor">切り捨て（一般的）</option>
                                            <option value="round">四捨五入（特約がある場合）</option>
                                            <option value="ceil">切り上げ</option>
                                        </select>
                                    </div>

                                    {/* --- 雇用保険 --- */}
                                    <div style={{ ...roundingRowStyle, gap: "20px" }}>
                                        <div style={{ flex: 1 }}>
                                            <strong style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                                                <HardHat size={16} color="#2980b9" /> 雇用保険料（個人負担分）
                                            </strong>
                                            <small style={{ color: "#95a5a6", marginLeft: "22px", display: "block" }}>
                                                ※50銭以下切り捨て、51銭以上切り上げルール。
                                            </small>
                                        </div>
                                        <select 
                                            value={roundEmpIns} 
                                            onChange={e => setRoundEmpIns(e.target.value)} 
                                            style={{ ...inputStyle, width: "320px", flexShrink: 0 }}
                                        >
                                            <option value="currency_law">法的原則：0.51円以上切上</option>
                                            <option value="round">四捨五入（50銭ルールに近い）</option>
                                            <option value="floor">切り捨て</option>
                                            <option value="ceil">切り上げ</option>
                                        </select>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => alert("端数設定を保存しました（DBへ要保存）")}
                                    style={{ 
                                        ...btnStyle, 
                                        marginTop: "30px", 
                                        backgroundColor: "#34495e", 
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "8px"
                                    }}
                                >
                                    <Save size={18} />
                                    <span>端数処理設定を保存</span>
                                </button>
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

// 追加のスタイル
const tabContentStyle = {
    animation: "fadeIn 0.3s ease-in-out"
};

const roundingRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "15px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0"
};
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
const editingBadgeStyle = {
  fontSize: "12px",
  color: "#f39c12",
  fontWeight: "bold" as const,
  padding: "6px 12px",
  backgroundColor: "#fff9db",
  borderRadius: "4px",
  border: "1px solid #f1c40f"
};

// 削除確認中の背景用スタイル
const deletingRowStyle = {
  backgroundColor: "#fff5f5",
  borderLeft: "5px solid #e74c3c", // 削除中は赤色に変更
};