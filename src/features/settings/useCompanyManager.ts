/**
 * 会社設定画面（CompanyManager）の状態とデータ操作
 * 画面の見た目は company/ 以下の各タブ、ロジックはここにまとめる
 */
import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { fetch } from '@tauri-apps/plugin-http';
import { ask } from '@tauri-apps/plugin-dialog';
import * as Master from '../../constants';
import { fetchAddressByZip } from "../../utils/addressUtils";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";

interface UseCompanyManagerArgs {
    db: Database;
    onSetupComplete?: () => void;
}

export function useCompanyManager({ db, onSetupComplete }: UseCompanyManagerArgs) {
    const toast = useToast();
    const dialog = useMessageDialog();

    // --- タブ管理 ---
    const [activeSubTab, setActiveSubTab] = useState<"info" | "branches" | "rounding" | "payroll" | "social">("info");
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
    // 保存済みの値（変更があったかどうかの判定に使う）
    const [savedInfo, setSavedInfo] = useState<Record<string, string | number> | null>(null);
    const [savedRounding, setSavedRounding] = useState<Record<string, string> | null>(null);
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

    // --- 社会保険（健保規定）グループ用ステート ---
    const [socialGroups, setSocialGroups] = useState<any[]>([]);
    const [sgName, setSgName] = useState("");
    const [sgType, setSgType] = useState("union"); // kyokai, union, kokuho
    const [sgHealthRate, setSgHealthRate] = useState(10.0); // 健康保険料率
    const [sgCareRate, setSgCareRate] = useState(1.6);     // 介護保険料率
    const [sgPensionRate, setSgPensionRate] = useState(18.3); // 厚生年金料率
    const [sgIsFixed, setSgIsFixed] = useState(0);         // 0:率計算, 1:定額(国保など)
    const [sgFixedAmount, setSgFixedAmount] = useState(0);  // 定額時の金額
    const [editingSgId, setEditingSgId] = useState<number | null>(null);
    const [deletingSgId, setDeletingSgId] = useState<number | null>(null);
    const [previewPref, setPreviewPref] = useState("京都");
    const [showInactive, setShowInactive] = useState(false);
    // --- 社会保険規定（会社負担分）のState ---
    const [sgCompHealthRate, setSgCompHealthRate] = useState(0);
    const [sgCompCareRate, setSgCompCareRate] = useState(0);
    const [sgCompPensionRate, setSgCompPensionRate] = useState(Master.INSURANCE_2026.PENSION_RATE[0]); // デフォルトは折半率
    const [sgChildAllowanceRate, setSgChildAllowanceRate] = useState(Master.INSURANCE_2026.CHILD_ALLOWANCE_RATE);
    const [sgCompFixedAmount, setSgCompFixedAmount] = useState(0); // 定額時の会社負担用

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

    /**
     * 法人番号（13桁）が正しい形式か検証する
     * @param code 13桁の数字文字列
     * @returns boolean
     */
    const isValidCorporateNumber = (code: string): boolean => {
        if (!/^\d{13}$/.test(code)) return false;

        const digits = code.split("").map(Number);
        const checkDigit = digits[0];

        // 2〜13桁
        const base = digits.slice(1).reverse();

        let oddSum = 0;   // 奇数桁
        let evenSum = 0;  // 偶数桁

        base.forEach((digit, index) => {
            if ((index + 1) % 2 === 0) {
                evenSum += digit;
            } else {
                oddSum += digit;
            }
        });

        const total = evenSum * 2 + oddSum;
        const remainder = total % 9;
        const calculatedCheckDigit = (9 - remainder) % 10;

        return checkDigit === calculatedCheckDigit;
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
            dialog.warning("郵便番号は7桁で入力してください");
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
                dialog.warning("該当する住所が見つかりませんでした");
            }
        } catch (e) {
            console.error("住所検索エラー:", e);
            dialog.error("住所検索中にエラーが発生しました");
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

            // 「保存済みの値」を記録（画面の値と比べて、変更があれば保存ボタンを有効にする）
            if (res.length > 0) {
                const c = res[0];
                setSavedInfo({
                    compName: c.name || "", compZip: c.zip_code || "", compAddr: c.address || "",
                    compPhone: c.phone || "", compNum: c.corporate_number || "", compRep: c.representative || "",
                    compHealth: c.health_ins_num || "", compLabor: c.labor_ins_num || "",
                    weekStartDay: c.week_start_day ?? 0, headPref: head?.prefecture || "",
                });
                setSavedRounding({
                    roundOvertime: c.round_overtime || "round",
                    roundSocialIns: c.round_social_ins || "floor",
                    roundEmpIns: c.round_emp_ins || "round",
                });
            }
            const resPG = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
            setPayrollGroups(resPG);
            const resSG = await db.select<any[]>("SELECT * FROM social_insurance_groups ORDER BY id ASC");
            setSocialGroups(resSG);
        } catch (e) { console.error("Load Error:", e); }
    };

    useEffect(() => { loadData(); }, [db]);

    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    const revalidateAllAttendance = async (newStartDay: number) => {
        const msg = `週の起算日が【${dayNames[newStartDay]}曜日】に変更されました。集計を再確認してください。`;
        try {
            // 全従業員の未確定勤怠を一括で「要チェック」にする
            // (ロック機能がある場合は WHERE lock_status = 0 などを追加)
            await db.execute(
                `UPDATE attendance SET is_error = 1, error_message = ?`,
                [msg] // ここで引数を使う！
            );
            console.log("全勤怠データの再検証フラグを立てました。");
        } catch (e) {
                console.error("Revalidation Error:", e);
                dialog.error("勤怠データの再検証中にエラーが発生しました。");
        }
    };

    const saveCompany = async () => {
        if (!compName.trim()) return dialog.warning("会社名/屋号は必須です");
        if (!headPref) return dialog.warning("都道府県を選択してください");
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
            // ※ REPLACE INTO だと行を作り直すため、ここに書いていない列（祝日の取得先・
            //   バックアップ世代数など）が初期値に戻ってしまう。UPDATE で必要な列だけ更新する。
            await db.execute(
                `UPDATE company SET
                    name = ?, zip_code = ?, address = ?, phone = ?, corporate_number = ?, representative = ?,
                    health_ins_num = ?, labor_ins_num = ?,
                    round_overtime = ?, round_social_ins = ?, round_emp_ins = ?, week_start_day = ?
                WHERE id = 1`,
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

        } catch (e) {
            console.error("Company Save Error:", e);
            setIsSaving(false);
            dialog.error("会社情報の保存に失敗しました。");
        }
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

    // 計算用のヘルパー
    const getRates = (pref: string) => {
        // 1. 都道府県別の料率を取得（見つからない場合は京都をフォールバックに）
        const rateData = Master.INSURANCE_2026.KENPO_RATES[pref] || Master.INSURANCE_2026.KENPO_RATES["京都"];
        
        // rateData[1] が「総料率」です
        const healthTotal = rateData[1]; 
        
        // 2. 介護保険料率（総額）を取得
        const careTotal = Master.INSURANCE_2026.KENPO_CARE_RATE[1]; 
        
        // 3. 厚生年金料率（総額）を取得
        const pensionTotal = Master.INSURANCE_2026.PENSION_RATE[1];

        return {
            healthTotal: healthTotal.toFixed(2),
            careTotal: careTotal.toFixed(2),
            pensionTotal: pensionTotal.toFixed(2)
        };
    };
    const rates = getRates(previewPref);

    const saveSocialGroup = async () => {
        if (!sgName.trim()) return dialog.warning("規定名を入力してください");

        // パラメータを配列にまとめる（順番が命です！）
        const params = [
            sgName,               // name
            sgType,               // type
            sgIsFixed,            // is_fixed
            sgHealthRate,         // health_rate
            sgCareRate,           // care_rate
            sgPensionRate,        // pension_rate
            sgFixedAmount,        // fixed_amount
            sgCompHealthRate,     // comp_health_rate
            sgCompCareRate,       // comp_care_rate
            sgCompPensionRate,    // comp_pension_rate
            sgChildAllowanceRate, // child_allowance_rate
            sgCompFixedAmount,    // comp_fixed_amount (新設)
            1                     // is_active (新規時は常に1)
        ];

        const isEdit = editingSgId !== null;
        try {
            if (editingSgId !== null) {
                // --- UPDATE (編集) ---
                // 最後の ? は WHERE id=? 用の editingSgId
                await db.execute(
                    `UPDATE social_insurance_groups SET 
                        name=?, type=?, is_fixed=?, 
                        health_rate=?, care_rate=?, pension_rate=?, fixed_amount=?,
                        comp_health_rate=?, comp_care_rate=?, comp_pension_rate=?, 
                        child_allowance_rate=?, comp_fixed_amount=?, is_active=?
                    WHERE id=?`,
                    [...params, editingSgId]
                );
            } else {
                // --- INSERT (新規追加) ---
                await db.execute(
                    `INSERT INTO social_insurance_groups (
                        name, type, is_fixed, 
                        health_rate, care_rate, pension_rate, fixed_amount,
                        comp_health_rate, comp_care_rate, comp_pension_rate, 
                        child_allowance_rate, comp_fixed_amount, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params
                );
            }

            toast.success(isEdit ? `「${sgName}」を更新しました` : `「${sgName}」を追加しました`);
            resetSgForm();
            loadData();
        } catch (e) {
            console.error(e);
            dialog.error("社会保険規定の保存に失敗しました。");
        }
    };

    const resetSgForm = () => {
        setEditingSgId(null);
        setSgName("");
        setSgType("union"); // 🆕 ここ！デフォルトの種別（追加画面の初期値）に戻す
        setSgIsFixed(0);
        setSgHealthRate(0);
        setSgCareRate(0);
        setSgPensionRate(18.3); // 厚生年金は18.3%を初期値にしても良いですね
        setSgFixedAmount(0);
        setSgCompHealthRate(0);
        setSgCompCareRate(0);
        setSgCompPensionRate(Master.INSURANCE_2026.PENSION_RATE[0]);
        setSgChildAllowanceRate(Master.INSURANCE_2026.CHILD_ALLOWANCE_RATE);
        setSgCompFixedAmount(0);
        
        setEditingSgId(null);
    };

    const startEditSg = (sg: any) => {
        setEditingSgId(sg.id); setSgName(sg.name); setSgType(sg.type);
        setSgHealthRate(sg.health_rate); setSgCareRate(sg.care_rate);
        setSgPensionRate(sg.pension_rate); setSgIsFixed(sg.is_fixed);
        setSgFixedAmount(sg.fixed_amount);
        setSgCompHealthRate(sg.comp_health_rate || 0);
        setSgCompCareRate(sg.comp_care_rate || 0);
        setSgCompPensionRate(sg.comp_pension_rate || Master.INSURANCE_2026.PENSION_RATE[0]);
        setSgChildAllowanceRate(sg.child_allowance_rate || Master.INSURANCE_2026.CHILD_ALLOWANCE_RATE);
        setSgCompFixedAmount(sg.comp_fixed_amount || 0);
    };

    const getPlaceholder = () => {
        if (sgType === "union") return "例: ○○健康保険組合";
        if (sgType === "kokuho") return "例: ○○建設国民健康保険組合";
        return "規定名を入力してください";
    };

    const toggleSocialGroupStatus = async (id: number, currentName: string, currentActiveStatus: number) => {
        if (!db) return;

        // 現在 1(有効) なら 0(廃止) へ、 現在 0(廃止) なら 1(有効) へ
        const nextStatus = currentActiveStatus === 1 ? 0 : 1;

        if (nextStatus === 0) {
            // 廃止しようとしている場合：使用中チェック
            const usage = await db.select<any[]>("SELECT id FROM staff WHERE social_insurance_group_id = ?", [id]);
            if (usage.length > 0) {
                dialog.warning(`「${currentName}」は現在使用中の従業員がいるため、廃止できません。`);
                return;
            }
            const ok = await ask(
                `「${currentName}」を廃止しますか？\n(新規登録時の選択肢に表示されなくなります)`,
                { title: '確認', kind: 'warning' }
            );
            if (!ok) return;
        }

        try {
            await db.execute(
                "UPDATE social_insurance_groups SET is_active = ? WHERE id = ?",
                [nextStatus, id]
            );
            // refreshSocialGroups ではなく、既存の loadData を呼ぶ
            await loadData(); 
            
            toast.success(nextStatus === 1 ? `「${currentName}」を復元しました` : `「${currentName}」を廃止しました`);
        } catch (e) {
            console.error("Status Toggle Error:", e);
            dialog.error("状態の更新に失敗しました。");
        }
    };

    // 保存処理（新規登録・更新兼用）
    const savePayrollGroup = async () => {
        if (!pgName) return dialog.warning("グループ名を入力してください");

        const isEdit = editingPgId !== null;
        const savedName = pgName;
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
            toast.success(isEdit ? `「${savedName}」を更新しました` : `「${savedName}」を追加しました`);
        } catch (e) {
            console.error(e);
            dialog.error("保存に失敗しました");
        }
    };

    const deletePayrollGroup = async (id: number) => {
        try {
            // 所属人数チェック
            const staffCount = await db.select<any[]>("SELECT COUNT(*) as count FROM staff WHERE payroll_group_id = ?", [id]);
            if ((staffCount[0]?.count || 0) > 0) {
                dialog.warning("この規定には従業員が紐付いているため削除できません。");
                setDeletingPgId(null);
                return;
            }

            await db.execute("DELETE FROM payroll_groups WHERE id = ?", [id]);
            setDeletingPgId(null);
            loadData();
            toast.success("給与規定グループを削除しました");
        } catch (e) {
            dialog.error("削除に失敗しました");
        }
    };

    const saveBranch = async () => {
        if (!bName || !bPref) return dialog.warning("名称と都道府県は必須です");
        
        // 郵便番号の整形（ハイフンありで統一して保存する場合）
        let finalZip = bZip.replace(/[^\d]/g, "");
        if (finalZip.length === 7) finalZip = finalZip.slice(0, 3) + "-" + finalZip.slice(3);

        const isEdit = editingBranchId !== null;
        const savedName = bName;
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
            toast.success(isEdit ? `「${savedName}」を更新しました` : `「${savedName}」を追加しました`);
        } catch (e) { 
            console.error(e);
            dialog.error("支店情報の保存に失敗しました。");
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
                dialog.warning(`この支店には現在 ${count} 名の従業員が所属しているため、削除できません。`);
                setDeletingBranchId(null);
                return;
            }

            await db.execute("DELETE FROM branches WHERE id = ?", [id]);
            await loadData();
            
            if (editingBranchId === id) resetBranchForm();
            setDeletingBranchId(null); // 完了後にリセット
            toast.success("支店を削除しました");

        } catch (e) {
            console.error(e);
            dialog.error("削除に失敗しました。");
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
            toast.success("端数処理設定を保存しました");
            await loadData(); // 最新状態を再読み込み
        } catch (e) {
            console.error(e);
            dialog.error("保存に失敗しました");
        } finally {
            setIsSaving(false);
        }
    };

    // 法人番号検索ロジック
    const searchCorporateNumber = async () => {
        // 前後の空白削除（念のため）
        const targetNum = compNum.trim();

        if (targetNum.length !== 13) {
            return dialog.warning("法人番号は13桁で入力してください。");
        }

        // バリデーション実行
        if (!isValidCorporateNumber(targetNum)) {
            return dialog.warning("法人番号の形式（チェックディジット）が正しくありません。入力ミスがないか再度ご確認ください。");
        }

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

                const found = Master.PREFECTURE_MASTER.find(p => cleanAddr.startsWith(p.name));
                let detectedPref = found ? found.name : "";

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
            dialog.error("情報の取得に失敗しました。");
        } finally {
            setIsSearchingComp(false);
        }
    };

    // 変更があるか（保存ボタンの有効・無効に使う）
    const currentInfo: Record<string, string | number> = {
        compName, compZip, compAddr, compPhone, compNum, compRep,
        compHealth, compLabor, weekStartDay, headPref,
    };
    const isInfoDirty = savedInfo === null || Object.keys(currentInfo).some((k) => currentInfo[k] !== savedInfo[k]);
    const isRoundingDirty = savedRounding === null
        || roundOvertime !== savedRounding.roundOvertime
        || roundSocialIns !== savedRounding.roundSocialIns
        || roundEmpIns !== savedRounding.roundEmpIns;

    // データを有効・無効で分ける
    const activeGroups = socialGroups.filter(sg => sg.is_active === 1);
    const inactiveGroups = socialGroups.filter(sg => sg.is_active === 0);

    return {
        isInfoDirty,
        isRoundingDirty,
        activeSubTab,
        setActiveSubTab,
        hasSavedOnce,
        setHasSavedOnce,
        compName,
        setCompName,
        compZip,
        setCompZip,
        compAddr,
        setCompAddr,
        compPhone,
        setCompPhone,
        compNum,
        setCompNum,
        compRep,
        setCompRep,
        compHealth,
        setCompHealth,
        compLabor,
        setCompLabor,
        headPref,
        setHeadPref,
        isSaving,
        setIsSaving,
        isSearchingZip,
        setIsSearchingZip,
        weekStartDay,
        setWeekStartDay,
        isWeekStartEditable,
        setIsWeekStartEditable,
        originalWeekStartDay,
        setOriginalWeekStartDay,
        isSearchingComp,
        setIsSearchingComp,
        payrollGroups,
        setPayrollGroups,
        pgName,
        setPgName,
        pgClosingDay,
        setPgClosingDay,
        pgIsNextMonth,
        setPgIsNextMonth,
        pgPaymentDay,
        setPgPaymentDay,
        editingPgId,
        setEditingPgId,
        deletingPgId,
        setDeletingPgId,
        socialGroups,
        setSocialGroups,
        sgName,
        setSgName,
        sgType,
        setSgType,
        sgHealthRate,
        setSgHealthRate,
        sgCareRate,
        setSgCareRate,
        sgPensionRate,
        setSgPensionRate,
        sgIsFixed,
        setSgIsFixed,
        sgFixedAmount,
        setSgFixedAmount,
        editingSgId,
        setEditingSgId,
        deletingSgId,
        setDeletingSgId,
        previewPref,
        setPreviewPref,
        showInactive,
        setShowInactive,
        sgCompHealthRate,
        setSgCompHealthRate,
        sgCompCareRate,
        setSgCompCareRate,
        sgCompPensionRate,
        setSgCompPensionRate,
        sgChildAllowanceRate,
        setSgChildAllowanceRate,
        sgCompFixedAmount,
        setSgCompFixedAmount,
        branches,
        setBranches,
        editingBranchId,
        setEditingBranchId,
        bName,
        setBName,
        bZip,
        setBZip,
        bPref,
        setBPref,
        bAddr,
        setBAddr,
        bPhone,
        setBPhone,
        bHealth,
        setBHealth,
        bLabor,
        setBLabor,
        isSearchingBZip,
        setIsSearchingBZip,
        deletingBranchId,
        setDeletingBranchId,
        roundOvertime,
        setRoundOvertime,
        roundSocialIns,
        setRoundSocialIns,
        roundEmpIns,
        setRoundEmpIns,
        isZipFocus,
        setIsZipFocus,
        isBZipFocus,
        setIsBZipFocus,
        handleFocus,
        handleBlur,
        isValidCorporateNumber,
        handleZipSearch,
        loadData,
        dayNames,
        revalidateAllAttendance,
        saveCompany,
        startEditPg,
        resetPgForm,
        getRates,
        rates,
        saveSocialGroup,
        resetSgForm,
        startEditSg,
        getPlaceholder,
        toggleSocialGroupStatus,
        savePayrollGroup,
        deletePayrollGroup,
        saveBranch,
        resetBranchForm,
        startEditBranch,
        deleteBranch,
        saveRoundingSettings,
        searchCorporateNumber,
        activeGroups,
        inactiveGroups,
    };
}

export type CompanyManagerState = ReturnType<typeof useCompanyManager>;
