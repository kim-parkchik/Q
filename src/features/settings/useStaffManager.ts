/**
 * 従業員管理画面（StaffManager）の状態とデータ操作
 * 画面の見た目は staff/ 以下の各セクション、ロジックはここにまとめる
 */
import { useState, useEffect, useRef } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import {
    commonZipAddress, formatZip, lookupZip, normalizeZip, pickZipAddress, zipAddressKanaText, zipAddressText,
    ZIP_CHOOSE_MESSAGE, ZIP_CHOOSE_TITLE, ZIP_NOT_FOUND_MESSAGE,
} from "../../utils/zipcode";
import { useMessageDialog } from "../../components/MessageDialog";
import { STAFF_RECORD_TABLES } from "../../types/dbSchema";
import { parseLeavePeriods, stringifyLeavePeriods, validateLeavePeriod, type LeavePeriod } from "../../utils/leaveExemption";
import { parseInKind, stringifyInKind, validateInKindEntry, type InKindEntry } from "../../utils/genbutsu";
import { dependentProblems, parseHealthDependents, stringifyHealthDependents, type HealthDependent } from "../../utils/healthDependents";
import { emptyKoyoInfo, parseKoyoInfo, stringifyKoyoInfo, type KoyoInfo } from "../../utils/koyoInfo";
import { parseForeignInfo, stringifyForeignInfo, type ForeignInfo } from "../../utils/foreignInfo";
import { parseShahoLoss, stringifyShahoLoss, type ShahoLoss } from '../../utils/shahoLoss';
import { toTaxColumn, type TaxColumn } from "../../utils/incomeTax";
import { countAnnualWorkDays, type CalendarContext } from "../../utils/annualWorkDays";
import { averageDailyHoursOf, parseWeekdayHours, stringifyWeekdayHours, sumScheduledHours, toHours, WEEKDAY_KEYS, type WeekdayHours } from "../../utils/scheduledHours";
import {
    latestStandardRemuneration, remunerationHistoryOf, stringifyRemunerationHistory, validateRemunerationHistory,
    type RemunerationEntry,
} from "../../utils/standardRemuneration";
import {
    dependentsHistoryOf, stringifyDependentsHistory, stringifyWageHistory, toWageType, validateHistory, wageHistoryOf,
    type DependentsEntry, type WageEntry,
} from "../../utils/staffHistory";
import { residentTaxScheduleOf, stringifyResidentTaxSchedule, type ResidentTaxYear } from "../../utils/residentTax";
import { loadCustomItems } from "../../utils/calcSalary";
import { overtimeHourlyRateOf } from "../../utils/fixedOvertime";
import { parsePremiumRates } from "../../utils/premiumRates";
import { DEFAULT_COMMUTE_SETTING, parseCommuteSetting, stringifyCommuteSetting, type CommuteSetting } from "../../utils/commuteAllowance";
import { fromStaffAccountForm, loadStaffBankAccounts, staffBankAccountStatements, toStaffAccountForm, type StaffAccountForm } from "../../utils/bankAccounts";
import { bankAccountProblems } from "../../utils/zengin";
import { executeBatch } from "../../utils/dbBatch";
import { compareTargetOf, dependentsRuleText, parseSavedDeclarations, suggestDependents, type SavedDeclaration } from "../../utils/withholdingDependents";
import { todayYmd } from "../../utils/myNumberRetention";
import { remunerationMissingOf } from "../../utils/remunerationMissing";

interface UseStaffManagerArgs {
    db: Database;
    onDataChange: () => void;
    staffList: any[];
}

interface CalendarPattern {
    id: number;
    name: string;
}

export function useStaffManager({ db, onDataChange, staffList }: UseStaffManagerArgs) {
    const dialog = useMessageDialog();
    // =========================================================
    // 1. システム・画面制御状態
    // =========================================================
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isSearchingZip, setIsSearchingZip] = useState(false); // 郵便番号検索中

    // --- 表示・ソート・絞り込み ---
    const [sortKey, setSortKey] = useState<"id" | "branch_id">("id");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
    const [searchKeyword, setSearchKeyword] = useState("");
    const [filterStatus, setFilterStatus] = useState(["active", "on_leave", "retired"]);

    // =========================================================
    // 2. 従業員 基本情報 (targetXxx)
    // =========================================================
    const [targetId, setTargetId] = useState("");
    const [targetName, setTargetName] = useState("");
    const [targetFurigana, setTargetFurigana] = useState("");
    const [targetBirthday, setTargetBirthday] = useState("");
    const [targetGender, setTargetGender] = useState("");
    
    // --- 連絡先・住所 ---
    const [targetZip, setTargetZip] = useState("");
    const [targetAddress, setTargetAddress] = useState("");
    const [targetAddressKana, setTargetAddressKana] = useState(""); // 住所のフリガナ（マイナンバーを書かない資格取得届に書く）
    const [targetPhone, setTargetPhone] = useState("");
    const [targetMobile, setTargetMobile] = useState("");

    // --- 所属・入退社・ステータス ---
    const [targetBranchId, setTargetBranchId] = useState(1);
    const [targetStatus, setTargetStatus] = useState("active");
    const [targetJoinDate, setTargetJoinDate] = useState(new Date().toISOString().split('T')[0]);
    const [targetRetirementDate, setTargetRetirementDate] = useState("");
    const [targetIsExecutive, setTargetIsExecutive] = useState(0); // 役員か

    // =========================================================
    // 3. 勤務ルール・時間設定
    // =========================================================
    // --- カレンダー・曜日 ---
    const [targetPatternId, setTargetPatternId] = useState(1);
    const [targetWorkDays, setTargetWorkDays] = useState<Record<string, boolean>>({
        mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false
    });

    // --- 所定労働時間・始業 ---
    const [targetScheduledIn, setTargetScheduledIn] = useState(""); // 標準始業
    const [targetDailyHours, setTargetDailyHours] = useState(8.0);  // 1日の計算用(h)
    const [targetHours, setTargetHours] = useState(8);              // 入力用(時)
    const [targetMinutes, setTargetMinutes] = useState(0);           // 入力用(分)

    // --- フレックス・コアタイム ---
    const [targetIsFlex, setTargetIsFlex] = useState(false);
    const [targetCoreStart, setTargetCoreStart] = useState("");
    const [targetCoreEnd, setTargetCoreEnd] = useState("");

    // =========================================================
    // 4. 給与・手当・控除設定
    // =========================================================
    const [targetWageType, setTargetWageType] = useState("hourly"); // 時給/月給
    const [targetWage, setTargetWage] = useState(1200);
    const [targetIsOvertimeEligible, setTargetIsOvertimeEligible] = useState(1); // 残業代支給対象か

    // --- 固定残業代（みなし） ---
    const [targetFixedOvertimeHours, setTargetFixedOvertimeHours] = useState(0);
    const [targetFixedOvertimeAmount, setTargetFixedOvertimeAmount] = useState(0);

    // --- 通勤費・社保・税金 ---
    const [targetCommuteType, setTargetCommuteType] = useState("daily");
    const [targetCommuteAmount, setTargetCommuteAmount] = useState(0);
    // 通勤の方法・片道の距離・定期代・有料道路・駐車場等（通勤手当の非課税限度額に使う。utils/commuteAllowance.ts）
    const [targetCommuteSetting, setTargetCommuteSetting] = useState<CommuteSetting>({ ...DEFAULT_COMMUTE_SETTING });
    // 給与規定グループの「決まった休憩」を使うか（初めは使う。utils/fixedBreak.ts）
    const [targetFixedBreakApply, setTargetFixedBreakApply] = useState(true);
    const [targetDependents, setTargetDependents] = useState(0);
    // 基本給・扶養人数の履歴（utils/staffHistory.ts）。上の入力欄は、いちばん新しい履歴の値と「何年何月分から」（From）
    // 〜Past は、それより前の履歴
    const [targetWageHistoryPast, setTargetWageHistoryPast] = useState<WageEntry[]>([]);
    const [targetWageFrom, setTargetWageFrom] = useState("");
    const [targetDependentsHistoryPast, setTargetDependentsHistoryPast] = useState<DependentsEntry[]>([]);
    const [targetDependentsFrom, setTargetDependentsFrom] = useState("");
    const [targetFlatTaxReductionPersons, setTargetFlatTaxReductionPersons] = useState(0); // 令和6年分 定額減税の人数
    const [targetLeavePeriods, setTargetLeavePeriods] = useState<LeavePeriod[]>([]); // 休業・休職の期間（産休・育休の社会保険料の免除・休業の日の給与と勤怠）
    const [targetInKind, setTargetInKind] = useState<InKindEntry[]>([]); // 現物で払う報酬（社宅・食事・自社製品など。utils/genbutsu.ts）
    const [targetHealthDependents, setTargetHealthDependents] = useState<HealthDependent[]>([]); // 健康保険の被扶養者（utils/healthDependents.ts）
    const [targetKoukiDate, setTargetKoukiDate] = useState(""); // 後期高齢者医療の障害認定を受けた日（この日に健康保険の資格を失う）
    const [targetShahoLoss, setTargetShahoLoss] = useState<ShahoLoss | null>(null); // 在職中に退職以外で社会保険の資格を失う日（utils/shahoLoss.ts）
    const [targetKoyoInfo, setTargetKoyoInfo] = useState<KoyoInfo>(emptyKoyoInfo()); // 雇用保険の届書に書くこと（utils/koyoInfo.ts）
    const [targetForeignInfo, setTargetForeignInfo] = useState<ForeignInfo | null>(null); // 在留資格の情報（外国人の方。utils/foreignInfo.ts）
    const [targetTaxColumn, setTargetTaxColumn] = useState<TaxColumn>("kou"); // 源泉所得税の欄（甲欄・乙欄・丙欄）
    const [targetResidentTax, setTargetResidentTax] = useState(0); // 住民税の月額（以前の入れ方。年度の額を入れていない月に使う）
    const [targetResidentTaxSchedule, setTargetResidentTaxSchedule] = useState<ResidentTaxYear[]>([]); // 住民税の年度ごとの12か月（utils/residentTax.ts）
    const [targetResidentTaxMunicipality, setTargetResidentTaxMunicipality] = useState(""); // 住民税の市区町村（団体コード。utils/localGov.ts）
    // 標準報酬月額の履歴（何年何月分から・いくら）。最初の1件は「入社したときから」
    const [targetRemunerationHistory, setTargetRemunerationHistory] = useState<RemunerationEntry[]>([{ from: "", amount: 0, reason: "shutoku" }]);
    const targetStandardRemuneration = latestStandardRemuneration(targetRemunerationHistory); // いちばん新しい標準報酬月額
    const remunerationHistoryError = validateRemunerationHistory(targetRemunerationHistory);
    // 基本給・扶養人数の履歴の全体（それより前の履歴 ＋ 入力欄のいちばん新しい値）
    const targetWageHistory: WageEntry[] = [
        ...targetWageHistoryPast,
        { from: targetWageFrom, wageType: toWageType(targetWageType), amount: Number(targetWage) || 0 },
    ];
    const targetDependentsHistory: DependentsEntry[] = [
        ...targetDependentsHistoryPast,
        { from: targetDependentsFrom, count: Number(targetDependents) || 0 },
    ];
    const wageHistoryError = validateHistory(targetWageHistory);
    const dependentsHistoryError = validateHistory(targetDependentsHistory);

    /** 変更を足すときの「何年何月分から」の初めの値：今月（いちばん新しい履歴が今月以降なら、その翌月） */
    const nextFrom = (latest: string) => {
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (!latest || latest < thisMonth) return thisMonth;
        const [y, m] = latest.split('-').map(Number);
        return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    };
    /** 昇給・給与形態の変更を足す：いまの入力欄の値を履歴に移し、入力欄を新しい月の分にする */
    const addWageChange = () => {
        setTargetWageHistoryPast(targetWageHistory);
        setTargetWageFrom(nextFrom(targetWageFrom));
    };
    /** 前の履歴を消す（前の履歴がなくなったら、入力欄の値を入社したときからにする） */
    const removeWagePast = (index: number) => {
        const rest = targetWageHistoryPast.filter((_, i) => i !== index);
        setTargetWageHistoryPast(rest);
        if (rest.length === 0) setTargetWageFrom("");
    };
    const addDependentsChange = () => {
        setTargetDependentsHistoryPast(targetDependentsHistory);
        setTargetDependentsFrom(nextFrom(targetDependentsFrom));
    };
    // 年末調整の画面に保存した、この人の申告書（扶養人数を、申告書から数えた人数と比べる。utils/withholdingDependents.ts）
    const [targetDeclarations, setTargetDeclarations] = useState<SavedDeclaration[]>([]);
    // 読み込んでいる人（別の人に切り替えたあとに、前の人の申告書が届いても使わない）
    const declarationsFor = useRef<string | null>(null);
    // 比べる年：きょうか、扶養人数のいちばん新しい行の始まりの遅いほう（その年分の申告書がなければ、前の年分から数えた見込み）
    const dependentsTarget = compareTargetOf(targetDependentsFrom, todayYmd());
    const dependentsSuggestion = suggestDependents(targetDeclarations, dependentsTarget.year, targetTaxColumn, dependentsTarget.payDate);
    const dependentsRule = dependentsRuleText(dependentsTarget.year, targetTaxColumn, dependentsTarget.payDate);
    const removeDependentsPast = (index: number) => {
        const rest = targetDependentsHistoryPast.filter((_, i) => i !== index);
        setTargetDependentsHistoryPast(rest);
        if (rest.length === 0) setTargetDependentsFrom("");
    };
    const [targetIsEmploymentInsEligible, setTargetIsEmploymentInsEligible] = useState(1); // 雇用保険
    const [targetHealthInsNum, setTargetHealthInsNum] = useState("");      // 健康保険被保険者番号
    const [targetPensionNum, setTargetPensionNum] = useState("");          // 厚生年金整理番号
    const [targetEmploymentInsNum, setTargetEmploymentInsNum] = useState(""); // 雇用保険被保険者番号

    const [targetSocialInsGroupId, setTargetSocialInsGroupId] = useState(1); // 🆕 追加
    const [targetKokuhoPremium, setTargetKokuhoPremium] = useState(0); // 国保組合の保険料（月額。社保規定が国保組合の人だけ）
    // 労働者名簿の項目（労働基準法107条・施行規則53条。utils/legalBooks.ts）
    const [targetJobType, setTargetJobType] = useState("");             // 従事する業務の種類
    const [targetDepartment, setTargetDepartment] = useState("");       // 部門（支給控除一覧表・仕訳を部門ごとにまとめる）
    const [targetCareerHistory, setTargetCareerHistory] = useState(""); // 履歴
    const [targetRetirementReason, setTargetRetirementReason] = useState(""); // 退職の事由（解雇はその理由も）
    const [targetDeathDate, setTargetDeathDate] = useState("");         // 死亡の年月日
    const [targetDeathCause, setTargetDeathCause] = useState("");       // 死亡の原因
    const [targetBasicPensionNumber, setTargetBasicPensionNumber] = useState(""); // 基礎年金番号（70歳以上被用者の届書に書く。utils/bonusReport.ts）
    const [targetMultiOffice, setTargetMultiOffice] = useState(false);            // 二以上事業所勤務者（届書の備考に印を付ける）
    const [targetProbationEnd, setTargetProbationEnd] = useState("");   // 試用期間の終わる日（平均賃金で、試用期間の日と賃金を除く。utils/averageWage.ts）
    // 振込先口座（給与・賞与の振込データ。固定額の口座と、残りを振り込む口座。utils/bankAccounts.ts）
    const [targetBankAccounts, setTargetBankAccounts] = useState<StaffAccountForm[]>([]);
    const [savedBankAccounts, setSavedBankAccounts] = useState("[]");
    const [targetEmpInsType, setTargetEmpInsType] = useState(""); // 🆕 追加 (NULL=会社設定に従う)

    // =========================================================
    // 5. 外部データ・計算用マスタ
    // =========================================================
    const [socialGroups, setSocialGroups] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [branchFilters, setBranchFilters] = useState<string[]>(branches.map(b => b.name));
    const [calendarPatterns, setCalendarPatterns] = useState<CalendarPattern[]>([]);
    const [annualWorkDays, setAnnualWorkDays] = useState(245); // 計算結果（統計用）
    // 曜日ごとの所定労働時間（契約曜日の横に入れる。曜日で時間が違う人だけ。utils/scheduledHours.ts）
    const [targetWeekdayHours, setTargetWeekdayHours] = useState<WeekdayHours>({});
    // 1年間の所定労働日を数えたカレンダー（曜日の時間を足して、1年間の所定労働時間を出す）
    const [annualCtx, setAnnualCtx] = useState<{ ctx: CalendarContext; year: number } | null>(null);
    const [payrollGroups, setPayrollGroups] = useState<any[]>([]);
    const [targetPayrollGroupId, setTargetPayrollGroupId] = useState(1);
    
    // 住所検索：日本郵便の郵便番号データを Q の中で引き（utils/zipcode.ts。郵便番号を外に送らない）、住所と住所のフリガナを入れる。
    // 町域がいくつもある郵便番号は選んでもらい、選ばなければ、どれにも同じ部分（都道府県・市区町村）だけを入れる
    const handleZipSearch = async () => {
        const zip7 = normalizeZip(targetZip);
        if (!zip7) {
            dialog.warning("郵便番号は7桁の数字で入力してください。");
            return;
        }
        setTargetZip(formatZip(zip7)); // 入力欄の見た目もハイフンありに更新

        setIsSearchingZip(true);
        try {
            const candidates = await lookupZip(zip7);
            if (candidates.length === 0) {
                dialog.warning(ZIP_NOT_FOUND_MESSAGE);
                return;
            }
            const picked = await pickZipAddress(candidates, (labels) => dialog.choose(ZIP_CHOOSE_MESSAGE, labels, ZIP_CHOOSE_TITLE));
            const a = picked ?? commonZipAddress(candidates);
            if (!a) return;
            setTargetAddress(zipAddressText(a));
            setTargetAddressKana(zipAddressKanaText(a));
        } catch (e) {
            console.error("住所検索エラー:", e);
            dialog.error("住所の検索に失敗しました。");
        } finally {
            setIsSearchingZip(false);
        }
    };

    // --- 年間稼働日数を計算する関数 (patternIdを引数に取る) ---
    // 数え方は utils/annualWorkDays.ts（給与明細の最低賃金のチェックと同じ）
    const calculateDays = async (patternId: number, currentWorkDays: Record<string, boolean>) => {
        if (!db) return;
        const year = new Date().getFullYear(); 
        try {
            let holidays = new Set<string>();
            const companyCalendar: Record<string, number> = {};
            if (patternId !== 0) {
                const resHolidays = await db.select<any[]>("SELECT holiday_date FROM holiday_master");
                holidays = new Set(resHolidays.map(h => h.holiday_date.replaceAll("/", "-")));
                // 指定された pattern_id の設定のみを取得
                const resCompany = await db.select<any[]>(
                    "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
                    [patternId]
                );
                resCompany.forEach(c => { companyCalendar[c.work_date] = c.is_holiday; });
            }
            setAnnualWorkDays(countAnnualWorkDays(year, patternId, currentWorkDays, holidays, companyCalendar));
            setAnnualCtx({ ctx: { patternId, workDays: currentWorkDays, holidays, companyCalendar }, year });
        } catch (e) {
            console.error("日数計算エラー:", e);
        }
    };

    // 時・分が変更されたら、計算用の小数値を更新する
    useEffect(() => {
        const decimalHours = targetHours + (targetMinutes / 60);
        setTargetDailyHours(decimalHours);
    }, [targetHours, targetMinutes]);

    // --- 初期化処理 ---
    useEffect(() => {
        const init = async () => {
            if (!db) return;
            await fetchSocialGroups();
            await fetchBranches();
            await fetchPayrollGroups();
            
            // カレンダーパターン一覧を取得
            const patterns = await db.select<CalendarPattern[]>("SELECT * FROM calendar_patterns ORDER BY id ASC");
            setCalendarPatterns(patterns);

            if (!editingId) {
                await calculateDays(targetPatternId, targetWorkDays);
            }
        };
        init();
    }, [db]);

    // パターンが変更されたら日数を再計算
    useEffect(() => {
        calculateDays(targetPatternId, targetWorkDays);
    }, [targetPatternId, targetWorkDays, db]); // dbも依存配列に入れておくと安全です

    // 絞り込みと言語検索を適用
    const filteredList = staffList.filter(s => {
        // 1. ステータス絞り込み
        const matchesStatus = filterStatus.includes(s.status || "active");
        
        // 2. キーワード検索 (ID, 名前, フリガナ)
        const keyword = searchKeyword.toLowerCase();
        const matchesKeyword = 
            String(s.id).includes(keyword) ||
            s.name.toLowerCase().includes(keyword) ||
            (s.furigana || "").toLowerCase().includes(keyword);

        // 🆕 3. 店舗絞り込み（ここを修正！）
        // staffList の branch_name が、選択中の配列 branchFilters に含まれているかチェック
        const matchesBranch = branchFilters.includes(s.branch_name);

        return matchesStatus && matchesKeyword && matchesBranch;
    });

    // filteredList に対してソートを行う
    const sortedAndFilteredList = [...filteredList].sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];

        // localeCompare を使うと、数値・文字列を問わず「人間にとって自然な順序」で並び替えてくれます
        // { numeric: true } を指定するのがポイントです
        if (sortOrder === "asc") {
            return String(valA).localeCompare(String(valB), undefined, { numeric: true });
        } else {
            return String(valB).localeCompare(String(valA), undefined, { numeric: true });
        }
    });

    // ヘッダーをクリックした時の処理
    const handleSort = (key: "id" | "branch_id") => {
        if (sortKey === key) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortOrder("asc");
        }
    };

    // 新規登録の前に、直前に編集した人の値が残らないよう全項目を初期値に戻す
    const clearForm = () => {
        setTargetId(""); setTargetName(""); setTargetFurigana(""); setTargetBirthday(""); setTargetGender("");
        setTargetJoinDate(new Date().toISOString().split('T')[0]);
        setTargetRetirementDate("");
        setTargetStatus("active");
        setTargetIsExecutive(0);
        setTargetZip(""); setTargetAddress(""); setTargetAddressKana(""); setTargetPhone(""); setTargetMobile("");
        setTargetBranchId(1); setTargetPayrollGroupId(1); setTargetPatternId(1);
        setTargetWorkDays({ mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false });
        // 1日の所定労働時間は空から（入れるまで給与を確定できない。黙って8時間にしない）
        setTargetScheduledIn(""); setTargetHours(0); setTargetMinutes(0); setTargetWeekdayHours({});
        setTargetIsFlex(false); setTargetCoreStart(""); setTargetCoreEnd("");
        setTargetWageType("hourly"); setTargetWage(1200); setTargetIsOvertimeEligible(1);
        setTargetFixedOvertimeHours(0); setTargetFixedOvertimeAmount(0);
        setTargetCommuteType("daily"); setTargetCommuteAmount(0); setTargetCommuteSetting({ ...DEFAULT_COMMUTE_SETTING });
        setTargetFixedBreakApply(true);
        setTargetDependents(0); setTargetResidentTax(0); setTargetResidentTaxSchedule([]); setTargetResidentTaxMunicipality(""); setTargetFlatTaxReductionPersons(0);
        setTargetWageHistoryPast([]); setTargetWageFrom("");
        setTargetDependentsHistoryPast([]); setTargetDependentsFrom("");
        setTargetDeclarations([]); declarationsFor.current = null;
        setTargetLeavePeriods([]);
        setTargetInKind([]);
        setTargetHealthDependents([]);
        setTargetKoukiDate("");
        setTargetShahoLoss(null);
        setTargetKoyoInfo(emptyKoyoInfo());
        setTargetForeignInfo(null);
        setTargetTaxColumn("kou");
        setTargetRemunerationHistory([{ from: "", amount: 0, reason: "shutoku" }]);
        setTargetIsEmploymentInsEligible(1);
        setTargetHealthInsNum(""); setTargetPensionNum(""); setTargetEmploymentInsNum("");
        setTargetSocialInsGroupId(1);
        setTargetKokuhoPremium(0);
        setTargetBankAccounts([]);
        setSavedBankAccounts("[]");
        setTargetJobType(""); setTargetDepartment(""); setTargetCareerHistory(""); setTargetRetirementReason(""); setTargetDeathDate(""); setTargetDeathCause("");
        setTargetProbationEnd("");
        setTargetBasicPensionNumber(""); setTargetMultiOffice(false);
        setTargetEmpInsType("");
        setEditingId(null);
    };

    const startEdit = (s: any) => {
        setDeletingId(null);
        setEditingId(s.id);
        // 振込先口座は別の表から読む
        setTargetBankAccounts([]);
        setSavedBankAccounts("[]");
        setTargetDeclarations([]);
        if (db) {
            loadStaffBankAccounts(db, s.id)
                .then((map) => {
                    const forms = (map.get(String(s.id)) ?? []).map(toStaffAccountForm);
                    setTargetBankAccounts(forms);
                    setSavedBankAccounts(JSON.stringify(forms));
                })
                .catch((e) => console.error("振込先口座の読み込みエラー:", e));
            // 年末調整の画面に保存した申告書（扶養人数と比べるだけ。読めなくても、従業員の編集はできる）
            declarationsFor.current = String(s.id);
            db.select<any[]>("SELECT year, declaration, result FROM year_end_adjustments WHERE staff_id = ?", [s.id])
                .then((rows) => { if (declarationsFor.current === String(s.id)) setTargetDeclarations(parseSavedDeclarations(rows ?? [])); })
                .catch((e) => console.error("年末調整の申告書の読み込みエラー:", e));
        }
        setTargetId(s.id);
        setTargetName(s.name);
        setTargetFurigana(s.furigana || "");
        setTargetBirthday(s.birthday || "");
        setTargetGender(s.gender || "unknown");
        setTargetJoinDate(s.join_date || "");
        setTargetRetirementDate(s.retirement_date || ""); // 🆕
        setTargetStatus(s.status || "active"); // 🆕
        setTargetZip(s.zip_code || "");
        setTargetAddress(s.address || "");
        setTargetAddressKana(s.address_kana || "");
        setTargetPhone(s.phone || ""); // 👈 追加
        setTargetMobile(s.mobile || ""); // 👈 追加
        // 基本給は、いちばん新しい履歴を入力欄に、それより前を履歴の一覧に出す
        const wageHistory = wageHistoryOf(s);
        const latestWage = wageHistory[wageHistory.length - 1];
        setTargetWageHistoryPast(wageHistory.slice(0, -1));
        setTargetWageFrom(latestWage.from);
        setTargetWage(latestWage.amount);
        setTargetCommuteType(s.commute_type);
        setTargetCommuteAmount(s.commute_amount);
        setTargetCommuteSetting(parseCommuteSetting(s.commute_setting));
        setTargetFixedBreakApply(Number(s.fixed_break_apply ?? 1) !== 0);
        setTargetWageType(latestWage.wageType);
        // 0 は「カレンダーを使わない（契約曜日で決める）」。0 を 1 にすると、保存し直したときに会社カレンダーの人に変わってしまう
        setTargetPatternId(Number(s.calendar_pattern_id ?? 1));
        setTargetPayrollGroupId(s.payroll_group_id || 1);
        setTargetScheduledIn(s.scheduled_in || "");
        setTargetIsFlex(Number(s.is_flex) === 1);
        setTargetCoreStart(s.core_start || "");
        setTargetCoreEnd(s.core_end || "");
        // 1日の所定労働時間（入れていなければ空。utils/scheduledHours.ts）と曜日ごとの時間
        const hoursVal = toHours(s.scheduled_work_hours) ?? 0;
        setTargetWeekdayHours(parseWeekdayHours(s.weekday_hours));
        const h = Math.floor(hoursVal);
        const m = Math.round((hoursVal - h) * 60);
        setTargetHours(h);
        setTargetMinutes(m);
        setTargetBranchId(s.branch_id || 1);
        const dependentsHistory = dependentsHistoryOf(s);
        const latestDependents = dependentsHistory[dependentsHistory.length - 1];
        setTargetDependentsHistoryPast(dependentsHistory.slice(0, -1));
        setTargetDependentsFrom(latestDependents.from);
        setTargetDependents(latestDependents.count);
        setTargetFlatTaxReductionPersons(s.flat_tax_reduction_persons || 0);
        setTargetLeavePeriods(parseLeavePeriods(s.leave_periods));
        setTargetInKind(parseInKind(s.in_kind));
        setTargetHealthDependents(parseHealthDependents(s.health_dependents));
        setTargetKoukiDate(s.kouki_date || "");
        setTargetShahoLoss(parseShahoLoss(s.shaho_loss));
        setTargetKoyoInfo(parseKoyoInfo(s.koyo_info));
        setTargetForeignInfo(parseForeignInfo(s.foreign_info));
        setTargetTaxColumn(toTaxColumn(s.tax_column));
        setTargetResidentTax(s.resident_tax || 0);
        setTargetResidentTaxSchedule(residentTaxScheduleOf(s));
        setTargetResidentTaxMunicipality(s.resident_tax_municipality || "");
        setTargetRemunerationHistory(remunerationHistoryOf(s));
        // 社保規定が空（NULL）なら「未加入 / 適用除外」
        setTargetSocialInsGroupId(s.social_insurance_group_id ?? 0);
        setTargetKokuhoPremium(Number(s.kokuho_premium) || 0);
        setTargetJobType(s.job_type || "");
        setTargetDepartment(s.department || "");
        setTargetCareerHistory(s.career_history || "");
        setTargetRetirementReason(s.retirement_reason || "");
        setTargetDeathDate(s.death_date || "");
        setTargetDeathCause(s.death_cause || "");
        setTargetProbationEnd(s.probation_end || "");
        setTargetBasicPensionNumber(s.basic_pension_number || "");
        setTargetMultiOffice(Number(s.multi_office) === 1);
        setTargetEmpInsType(s.employment_insurance_type || "");
        setTargetIsExecutive(s.is_executive || 0);
        setTargetIsEmploymentInsEligible(s.is_employment_ins_eligible ?? 1); // 雇用保険はデフォルト1なので??を使用
        setTargetHealthInsNum(s.health_ins_num || "");
        setTargetPensionNum(s.pension_num || "");
        setTargetEmploymentInsNum(s.employment_ins_num || "");
        setTargetIsOvertimeEligible(s.is_overtime_eligible ?? 1);
        setTargetFixedOvertimeHours(s.fixed_overtime_hours || 0);
        setTargetFixedOvertimeAmount(s.fixed_overtime_allowance || 0);
        // 🆕 曜日データの復元
        const newWorkDays = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
        if (s.work_days) {
            s.work_days.split(',').forEach((day: string) => {
                if (day in newWorkDays) {
                    (newWorkDays as any)[day] = true;
                }
            });
        }
        setTargetWorkDays(newWorkDays);

        setShowForm(true);
    };

    const isIdDuplicated = () => {
        if (editingId || isSaving) return false;
        if (!targetId.trim()) return false;
        return staffList.some(s => String(s.id) === String(targetId).trim());
    };

    const isChanged = () => {
        if (!editingId) return true; 
        const original = staffList.find(s => String(s.id) === String(editingId));
        if (!original) return true;

        const currentWorkDaysStr = Object.entries(targetWorkDays).filter(([_,v])=>v).map(([k])=>k).join(',');
        const originalWorkDaysStr = original.work_days || "";

        return (
            currentWorkDaysStr !== originalWorkDaysStr ||
            String(targetStatus) !== String(original.status || "active") ||
            String(targetRetirementDate) !== String(original.retirement_date || "") ||
            String(targetWageType) !== String(original.wage_type || "hourly") ||
            String(targetName) !== String(original.name) ||
            String(targetFurigana) !== String(original.furigana || "") ||
            Number(targetWage) !== Number(original.base_wage) ||
            String(targetBirthday) !== String(original.birthday || "") ||
            String(targetJoinDate) !== String(original.join_date || "") ||
            String(targetZip) !== String(original.zip_code || "") ||
            String(targetAddress) !== String(original.address || "") ||
            String(targetAddressKana) !== String(original.address_kana || "") ||
            String(targetPhone) !== String(original.phone || "") ||
            String(targetMobile) !== String(original.mobile || "") ||
            String(targetCommuteType) !== String(original.commute_type) ||
            Number(targetCommuteAmount) !== Number(original.commute_amount) ||
            stringifyCommuteSetting(targetCommuteSetting) !== stringifyCommuteSetting(parseCommuteSetting(original.commute_setting)) ||
            targetFixedBreakApply !== (Number(original.fixed_break_apply ?? 1) !== 0) ||
            Number(targetBranchId) !== Number(original.branch_id || 1) ||
            Number(targetDependents) !== Number(original.dependents || 0) ||
            Number(targetFlatTaxReductionPersons) !== Number(original.flat_tax_reduction_persons || 0) ||
            stringifyLeavePeriods(targetLeavePeriods) !== stringifyLeavePeriods(parseLeavePeriods(original.leave_periods)) ||
            JSON.stringify(targetInKind) !== JSON.stringify(parseInKind(original.in_kind)) ||
            stringifyHealthDependents(targetHealthDependents) !== stringifyHealthDependents(parseHealthDependents(original.health_dependents)) ||
            String(targetKoukiDate) !== String(original.kouki_date || "") ||
            stringifyShahoLoss(targetShahoLoss) !== stringifyShahoLoss(parseShahoLoss(original.shaho_loss)) ||
            stringifyKoyoInfo(targetKoyoInfo) !== stringifyKoyoInfo(parseKoyoInfo(original.koyo_info)) ||
            stringifyForeignInfo(targetForeignInfo) !== stringifyForeignInfo(parseForeignInfo(original.foreign_info)) ||
            targetTaxColumn !== toTaxColumn(original.tax_column) ||
            Number(targetResidentTax) !== Number(original.resident_tax || 0) ||
            stringifyResidentTaxSchedule(targetResidentTaxSchedule) !== stringifyResidentTaxSchedule(residentTaxScheduleOf(original)) ||
            String(targetResidentTaxMunicipality) !== String(original.resident_tax_municipality || "") ||
            Math.round(Number(targetDailyHours) * 60) !== Math.round((toHours(original.scheduled_work_hours) ?? 0) * 60) ||
            stringifyWeekdayHours(effectiveWeekdayHours) !== stringifyWeekdayHours(parseWeekdayHours(original.weekday_hours)) ||
            stringifyRemunerationHistory(targetRemunerationHistory) !== stringifyRemunerationHistory(remunerationHistoryOf(original)) ||
            stringifyWageHistory(targetWageHistory) !== stringifyWageHistory(wageHistoryOf(original)) ||
            stringifyDependentsHistory(targetDependentsHistory) !== stringifyDependentsHistory(dependentsHistoryOf(original)) ||
            Number(targetIsExecutive) !== Number(original.is_executive || 0) ||
            Number(targetIsEmploymentInsEligible) !== Number(original.is_employment_ins_eligible ?? 1) ||
            Number(targetIsOvertimeEligible) !== Number(original.is_overtime_eligible ?? 1) ||
            Number(targetFixedOvertimeHours) !== Number(original.fixed_overtime_hours || 0) ||
            Number(targetFixedOvertimeAmount) !== Number(original.fixed_overtime_allowance || 0) ||
            Number(targetPatternId) !== Number(original.calendar_pattern_id || 0) ||
            Number(targetPayrollGroupId) !== Number(original.payroll_group_id || 1) ||
            Number(targetSocialInsGroupId) !== Number(original.social_insurance_group_id ?? 0) ||
            Number(targetKokuhoPremium) !== Number(original.kokuho_premium || 0) ||
            JSON.stringify(targetBankAccounts) !== savedBankAccounts ||
            String(targetJobType) !== String(original.job_type || "") ||
            String(targetDepartment) !== String(original.department || "") ||
            String(targetCareerHistory) !== String(original.career_history || "") ||
            String(targetRetirementReason) !== String(original.retirement_reason || "") ||
            String(targetDeathDate) !== String(original.death_date || "") ||
            String(targetDeathCause) !== String(original.death_cause || "") ||
            String(targetProbationEnd) !== String(original.probation_end || "") ||
            String(targetBasicPensionNumber) !== String(original.basic_pension_number || "") ||
            targetMultiOffice !== (Number(original.multi_office) === 1) ||
            String(targetEmpInsType || "") !== String(original.employment_insurance_type || "") ||
            String(targetHealthInsNum) !== String(original.health_ins_num || "") ||
            String(targetPensionNum) !== String(original.pension_num || "") ||
            String(targetEmploymentInsNum) !== String(original.employment_ins_num || "") ||
            String(targetScheduledIn) !== String(original.scheduled_in || "") ||
            targetIsFlex !== (Number(original.is_flex) === 1) ||
            String(targetCoreStart) !== String(original.core_start || "") ||
            String(targetCoreEnd) !== String(original.core_end || "")
        );
    };

    // 休業・休職の期間に、開始日が空・終了日が開始日より前のものがないか
    const isLeavePeriodsValid = targetLeavePeriods.every(p => !validateLeavePeriod(p));
    // 現物で払う報酬の行に、始めた日が空・やめた日が始めた日より前などのものがないか
    const isInKindValid = targetInKind.every(e => !validateInKindEntry(e));
    // 健康保険の被扶養者に、氏名・生年月日・なった日などが入っていないものがないか
    const isHealthDependentsValid = targetHealthDependents.every(d => dependentProblems(d).length === 0);

    // 振込先口座の入れ方の間違い（口座ごとの間違いと、残りを振り込む口座がちょうど1つか）
    const bankAccountErrors = [
        ...targetBankAccounts.flatMap((a, i) => bankAccountProblems(fromStaffAccountForm(a), a.holderName).map((p) => `口座${i + 1}：${p}`)),
        ...(targetBankAccounts.length > 0 && targetBankAccounts.filter((a) => a.rest).length !== 1 ? ["残りを振り込む口座を1つ選んでください"] : []),
        ...targetBankAccounts.flatMap((a, i) => (!a.rest && !(Number(a.fixedAmount) > 0) ? [`口座${i + 1}：固定額を入れてください`] : [])),
    ];

    const canSave = () => {
        const hasRequiredFields = targetId.trim() !== "" && targetName.trim() !== "";
        return hasRequiredFields && isLeavePeriodsValid && isInKindValid && isHealthDependentsValid && !remunerationHistoryError && !wageHistoryError && !dependentsHistoryError
            && bankAccountErrors.length === 0 && !isIdDuplicated() && isChanged() && !isSaving;
    };

    const saveStaff = async () => {
        if (!db || !targetId || !targetName) return;
        const safeId = String(targetId).trim();
        setIsSaving(true);

        const workDaysString = Object.entries(targetWorkDays)
            .filter(([_, checked]) => checked)
            .map(([day]) => day)
            .join(',');

        try {
            const baseParams = [
                targetName, targetFurigana, targetBirthday, targetGender, targetJoinDate, 
                targetRetirementDate, targetStatus, targetZip, targetAddress, 
                targetPhone, targetMobile, targetWageType, Number(targetWage), 
                targetCommuteType, Number(targetCommuteAmount), Number(targetBranchId), 
                Number(targetDependents), Number(targetResidentTax), 
                Number(targetPatternId),
                // 1日の所定労働時間（入れていなければ NULL。給与を確定できない）
                toHours(targetDailyHours),
                Number(targetStandardRemuneration),
                workDaysString,
                Number(targetIsExecutive), 
                Number(targetIsEmploymentInsEligible), 
                Number(targetIsOvertimeEligible),
                Number(targetFixedOvertimeHours),
                Number(targetFixedOvertimeAmount),
                // 🆕 追加
                // 「未加入 / 適用除外」(0) は NULL で保存する（0 という社保規定は無いので、そのままだと外部キーの制約で保存できない）
                Number(targetSocialInsGroupId) || null, // social_insurance_group_id
                // 国保組合の保険料（月額）。国保組合ではない規定を選んだときは残さない
                socialGroups.find(sg => Number(sg.id) === Number(targetSocialInsGroupId))?.type === "kokuho" ? Math.max(0, Math.floor(Number(targetKokuhoPremium) || 0)) : 0,
                targetEmpInsType || null,     // employment_insurance_type
                Number(targetPayrollGroupId) || 1,
                targetHealthInsNum, targetPensionNum, targetEmploymentInsNum,
                targetScheduledIn, targetIsFlex ? 1 : 0, targetCoreStart, targetCoreEnd,
                Number(targetFlatTaxReductionPersons) || 0,
                stringifyLeavePeriods(targetLeavePeriods) || null,
                targetTaxColumn,
                stringifyRemunerationHistory(targetRemunerationHistory),
                stringifyWageHistory(targetWageHistory),
                stringifyDependentsHistory(targetDependentsHistory),
                stringifyResidentTaxSchedule(targetResidentTaxSchedule),
                targetResidentTaxMunicipality || null,
                stringifyCommuteSetting(targetCommuteSetting),
                targetFixedBreakApply ? 1 : 0,
                // 労働者名簿の項目
                targetJobType.trim() || null, targetCareerHistory.trim() || null, targetRetirementReason.trim() || null,
                targetDeathDate || null, targetDeathCause.trim() || null,
                // 試用期間の終わる日
                targetProbationEnd || null,
                // 基礎年金番号・二以上事業所勤務者（届書に書く）
                targetBasicPensionNumber.trim() || null, targetMultiOffice ? 1 : 0,
                // 住所のフリガナ（資格取得届に書く）
                targetAddressKana.trim() || null,
                // 現物で払う報酬（社宅・食事など。社会保険の報酬に入れる）
                stringifyInKind(targetInKind) || null,
                // 健康保険の被扶養者（被扶養者（異動）届に書く）と、後期高齢者医療の障害認定を受けた日
                stringifyHealthDependents(targetHealthDependents) || null, targetKoukiDate || null,
                // 雇用保険の届書に書くこと（職種・雇用形態・離職の理由・転勤など）
                stringifyKoyoInfo(targetKoyoInfo),
                // 在留資格の情報（外国人の方。雇用保険の届書・外国人雇用状況届出書などがここを読む）
                stringifyForeignInfo(targetForeignInfo),
                // 部門（支給控除一覧表・仕訳を部門ごとにまとめる）
                targetDepartment.trim() || null,
                // 在職中に退職以外で社会保険の資格を失う日（社会保障協定・特定減額特例対象者の任意喪失）
                stringifyShahoLoss(targetShahoLoss),
                // 曜日ごとの所定労働時間（契約曜日にチェックした曜日だけ）
                stringifyWeekdayHours(effectiveWeekdayHours),
            ];

            if (editingId) {
                await db.execute(
                    `UPDATE staff SET
                        name=?, furigana=?, birthday=?, gender=?, join_date=?,
                        retirement_date=?, status=?, zip_code=?, address=?,
                        phone=?, mobile=?, wage_type=?, base_wage=?,
                        commute_type=?, commute_amount=?, branch_id=?,
                        dependents=?, resident_tax=?, calendar_pattern_id=?,
                        scheduled_work_hours=?, standard_remuneration=?,
                        work_days=?, is_executive=?, is_employment_ins_eligible=?,
                        is_overtime_eligible=?, fixed_overtime_hours=?, fixed_overtime_allowance=?,
                        social_insurance_group_id=?, kokuho_premium=?, employment_insurance_type=?, -- 🆕 追加
                        payroll_group_id=?,
                        health_ins_num=?, pension_num=?, employment_ins_num=?,
                        scheduled_in=?, is_flex=?, core_start=?, core_end=?,
                        flat_tax_reduction_persons=?, leave_periods=?, tax_column=?,
                        standard_remuneration_history=?, wage_history=?, dependents_history=?,
                        resident_tax_schedule=?, resident_tax_municipality=?, commute_setting=?, fixed_break_apply=?,
                        job_type=?, career_history=?, retirement_reason=?, death_date=?, death_cause=?,
                        probation_end=?, basic_pension_number=?, multi_office=?, address_kana=?, in_kind=?,
                        health_dependents=?, kouki_date=?, koyo_info=?, foreign_info=?, department=?, shaho_loss=?,
                        weekday_hours=?
                    WHERE id=?`,
                    [...baseParams, safeId]
                );
            } else {
                await db.execute(
                    `INSERT INTO staff (
                        name, furigana, birthday, gender, join_date,
                        retirement_date, status, zip_code, address,
                        phone, mobile, wage_type, base_wage,
                        commute_type, commute_amount, branch_id,
                        dependents, resident_tax, calendar_pattern_id,
                        scheduled_work_hours, standard_remuneration,
                        work_days, is_executive, is_employment_ins_eligible,
                        is_overtime_eligible, fixed_overtime_hours, fixed_overtime_allowance,
                        social_insurance_group_id, kokuho_premium, employment_insurance_type, -- 🆕 追加
                        payroll_group_id,
                        health_ins_num, pension_num, employment_ins_num,
                        scheduled_in, is_flex, core_start, core_end,
                        flat_tax_reduction_persons, leave_periods, tax_column,
                        standard_remuneration_history, wage_history, dependents_history,
                        resident_tax_schedule, resident_tax_municipality, commute_setting, fixed_break_apply,
                        job_type, career_history, retirement_reason, death_date, death_cause,
                        probation_end, basic_pension_number, multi_office, address_kana, in_kind,
                        health_dependents, kouki_date, koyo_info, foreign_info, department, shaho_loss,
                        weekday_hours,
                        id
                    ) VALUES (${Array(baseParams.length + 1).fill("?").join(", ")})`,
                    [...baseParams, safeId]
                );
            }
            // 振込先口座（前の口座を消して入れ直す。まとめて1つのトランザクションで）
            if (JSON.stringify(targetBankAccounts) !== savedBankAccounts) {
                await executeBatch(db, staffBankAccountStatements(safeId, targetBankAccounts.map(fromStaffAccountForm)));
            }
            onDataChange();
            setTimeout(() => {
                setIsSaving(false);
                setShowForm(false);
                clearForm();
            }, 800);
        } catch (e) {
            alert("保存エラー: " + e);
            setIsSaving(false);
        }
    };

    const deleteStaff = async (id: any) => {
        // 🆕 編集中の場合は削除させない
        if (editingId && String(id) === String(editingId)) {
            alert("編集中のため削除できません。一度編集を閉じてください。");
            return;
        }
        
        const staffId = String(id);
        try {
            // 勤怠・給与・賞与・有給の記録がある人は削除しない（法律で保存が必要。削除すると記録も一緒に消える）
            // 削除できるのは、登録を間違えた人など、まだ記録が何もない人だけ
            const found: string[] = [];
            for (const { table, label } of STAFF_RECORD_TABLES) {
                const rows = await db.select<{ id: number }[]>(`SELECT 1 AS id FROM ${table} WHERE staff_id = ? LIMIT 1`, [staffId]);
                if (rows.length > 0) found.push(label);
            }
            if (found.length > 0) {
                setDeletingId(null);
                return dialog.warning(
                    `この従業員には ${found.join("・")} の記録があるため、削除できません。\n` +
                    `記録は法律で保存が必要です。辞めた人は「編集」で状態を「退職」にし、退職日を入れてください。`
                );
            }

            // 個別の給与項目の設定は従業員と一緒に消えないので、先に消しておく（同じIDで登録し直したときに残らないように）
            await db.execute("DELETE FROM staff_salary_values WHERE staff_id = ?", [staffId]);
            await db.execute("DELETE FROM staff WHERE id = ?", [staffId]);
            onDataChange();
            setDeletingId(null); // 削除完了後にリセット
        } catch (e) {
            console.error(e);
            setDeletingId(null);
            dialog.error(`従業員を削除できませんでした。\n${e}`);
        }
    };

    const fetchSocialGroups = async () => {
        try {
            const res = await db.select<any[]>("SELECT id, name, type FROM social_insurance_groups WHERE is_active = 1 ORDER BY id ASC");
            setSocialGroups(res);
            
            // 新規登録時のデフォルト値をセット（リストが空でない場合）
            if (!editingId && res.length > 0 && targetSocialInsGroupId === 1) {
                setTargetSocialInsGroupId(res[0].id);
            }
        } catch (e) {
            console.error("社保規定の取得に失敗:", e);
        }
    };

    // 1. 店舗リストを取得する関数（共通化）
    const fetchBranches = async () => {
        if (!db) return;
        const res = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
        setBranches(res);
        
        // 直接 res (取得した最新データ) から名前の配列を作ってセットする
        const allNames = res.map(b => b.name);
        setBranchFilters(allNames); 
    };

    const fetchPayrollGroups = async () => {
        if (!db) return;
        const res = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        setPayrollGroups(res);
    };


    // 残業代の時給に入れる手当（「給与項目設定」で入れた、この人の支給項目の額。固定残業代の時間の目安に使う。utils/fixedOvertime.ts）
    const [overtimeBaseAllowances, setOvertimeBaseAllowances] = useState(0);
    useEffect(() => {
        if (!db || !editingId) { setOvertimeBaseAllowances(0); return; }
        let cancelled = false;
        loadCustomItems(db, editingId)
            .then(items => {
                if (cancelled) return;
                setOvertimeBaseAllowances(items.filter(i => i.type === 'earning' && i.inOvertimeBase !== false).reduce((sum, i) => sum + i.amount, 0));
            })
            .catch(e => console.error("給与項目の読み込みに失敗しました:", e));
        return () => { cancelled = true; };
    }, [db, editingId]);

    // --- 計算用の変数（レンダリング時に算出） ---
    // 曜日ごとの時間を、契約曜日にチェックした曜日だけにしたもの（保存する値）
    const effectiveWeekdayHours: WeekdayHours = Object.fromEntries(
        WEEKDAY_KEYS.filter(k => targetWorkDays[k] && targetWeekdayHours[k] !== undefined).map(k => [k, targetWeekdayHours[k]])
    );
    // いま画面で入れている所定労働時間（曜日の時間・1日平均・1年間の合計を出す。utils/scheduledHours.ts）
    const hoursStaff = {
        scheduled_work_hours: targetDailyHours, weekday_hours: effectiveWeekdayHours, is_flex: targetIsFlex ? 1 : 0,
        calendar_pattern_id: targetPatternId,
        work_days: WEEKDAY_KEYS.filter(k => targetWorkDays[k]).join(','),
        is_executive: targetIsExecutive,
    };
    // 1日平均所定労働時間（曜日で時間が違う人。日給の時給換算・時間単位の有給の1日に使う）
    const dailyAverageHours = averageDailyHoursOf(hoursStaff) ?? 0;
    // 1年間の所定労働時間（会社カレンダー・契約曜日の所定労働日ごとに、その曜日の時間を足す）
    const annualTotalHours = (annualCtx ? sumScheduledHours(annualCtx.ctx, hoursStaff, `${annualCtx.year}-01-01`, `${annualCtx.year}-12-31`) : null)
        ?? annualWorkDays * targetDailyHours;
    const monthlyAverageHours = annualTotalHours / 12;
    const hourlyConversion = targetWageType === "monthly" ? (targetWage / monthlyAverageHours) : targetWage;
    // 残業代の時給（給与計算と同じ：(月給 ＋ 残業代の時給に入れる手当) ÷ 月平均所定労働時間。月給制の人だけ）
    const overtimeHourlyRate = targetWageType === "monthly" ? overtimeHourlyRateOf(targetWage, overtimeBaseAllowances, monthlyAverageHours) : 0;
    // 選んでいる給与規定グループの残業代の割増率（固定残業代の目安に使う。utils/premiumRates.ts）
    const targetPremiumRates = parsePremiumRates(payrollGroups.find(g => Number(g.id) === (Number(targetPayrollGroupId) || 1))?.premium_rates);

    const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

    // 💡 スタッフが一人もいないかどうかの判定（既存の staffList を使用）
    const isFirstRun = staffList.length === 0;

    // 💡 最初の1人がいない時は、強制的に showForm を true とみなす
    const isFormVisible = isFirstRun || showForm;

    // 標準報酬月額の入れ忘れ（社保規定を選んでいるのに一度も入れていない。見直しの P10。utils/remunerationMissing.ts）。
    // 入力中の値で見る。月は、きょうか入社した月の遅いほう（先に入社する人を入れたときも知らせる）
    const remunerationMissing = (() => {
        const today = todayYmd();
        const on = targetJoinDate && targetJoinDate > today ? targetJoinDate : today;
        return remunerationMissingOf({
            social_insurance_group_id: Number(targetSocialInsGroupId) > 0 ? Number(targetSocialInsGroupId) : null,
            standard_remuneration_history: stringifyRemunerationHistory(targetRemunerationHistory),
            join_date: targetJoinDate, retirement_date: targetRetirementDate || null, birthday: targetBirthday,
            kouki_date: targetKoukiDate || null, shaho_loss: stringifyShahoLoss(targetShahoLoss),
            wage_type: targetWageType, base_wage: Number(targetWage) || 0, fixed_overtime_allowance: Number(targetFixedOvertimeAmount) || 0,
            commute_type: targetCommuteType, commute_amount: Number(targetCommuteAmount) || 0, commute_setting: stringifyCommuteSetting(targetCommuteSetting),
        }, Number(on.slice(0, 4)), Number(on.slice(5, 7)));
    })();

    return {
        db,
        onDataChange,
        remunerationMissing,
        staffList,
        showForm,
        setShowForm,
        editingId,
        setEditingId,
        isSaving,
        setIsSaving,
        deletingId,
        setDeletingId,
        isSearchingZip,
        setIsSearchingZip,
        sortKey,
        setSortKey,
        sortOrder,
        setSortOrder,
        searchKeyword,
        setSearchKeyword,
        filterStatus,
        setFilterStatus,
        targetId,
        setTargetId,
        targetName,
        setTargetName,
        targetFurigana,
        setTargetFurigana,
        targetBirthday,
        setTargetBirthday,
        targetGender,
        setTargetGender,
        targetZip,
        setTargetZip,
        targetAddress,
        setTargetAddress,
        targetAddressKana,
        setTargetAddressKana,
        targetPhone,
        setTargetPhone,
        targetMobile,
        setTargetMobile,
        targetBranchId,
        setTargetBranchId,
        targetStatus,
        setTargetStatus,
        targetJoinDate,
        setTargetJoinDate,
        targetRetirementDate,
        setTargetRetirementDate,
        targetIsExecutive,
        setTargetIsExecutive,
        targetPatternId,
        setTargetPatternId,
        targetWorkDays,
        setTargetWorkDays,
        targetScheduledIn,
        setTargetScheduledIn,
        targetDailyHours,
        setTargetDailyHours,
        targetWeekdayHours,
        setTargetWeekdayHours,
        dailyAverageHours,
        targetHours,
        setTargetHours,
        targetMinutes,
        setTargetMinutes,
        targetIsFlex,
        setTargetIsFlex,
        targetCoreStart,
        setTargetCoreStart,
        targetCoreEnd,
        setTargetCoreEnd,
        targetWageType,
        setTargetWageType,
        targetWage,
        setTargetWage,
        targetIsOvertimeEligible,
        setTargetIsOvertimeEligible,
        targetFixedOvertimeHours,
        setTargetFixedOvertimeHours,
        targetFixedOvertimeAmount,
        setTargetFixedOvertimeAmount,
        targetCommuteType,
        setTargetCommuteType,
        targetCommuteAmount,
        setTargetCommuteAmount,
        targetCommuteSetting,
        setTargetCommuteSetting,
        targetFixedBreakApply,
        setTargetFixedBreakApply,
        targetDependents,
        setTargetDependents,
        targetWageHistoryPast, setTargetWageHistoryPast, targetWageFrom, setTargetWageFrom,
        wageHistoryError, addWageChange, removeWagePast,
        targetDependentsHistoryPast, setTargetDependentsHistoryPast, targetDependentsFrom, setTargetDependentsFrom,
        dependentsHistoryError, addDependentsChange, removeDependentsPast,
        dependentsSuggestion, dependentsRule,
        targetFlatTaxReductionPersons,
        setTargetFlatTaxReductionPersons,
        targetLeavePeriods,
        setTargetLeavePeriods,
        isLeavePeriodsValid,
        targetInKind,
        setTargetInKind,
        isInKindValid,
        targetHealthDependents,
        setTargetHealthDependents,
        isHealthDependentsValid,
        targetKoukiDate,
        setTargetKoukiDate,
        targetShahoLoss,
        setTargetShahoLoss,
        targetKoyoInfo,
        setTargetKoyoInfo,
        targetForeignInfo,
        setTargetForeignInfo,
        targetTaxColumn,
        setTargetTaxColumn,
        targetResidentTax,
        setTargetResidentTax,
        targetResidentTaxSchedule,
        setTargetResidentTaxSchedule,
        targetResidentTaxMunicipality,
        setTargetResidentTaxMunicipality,
        targetStandardRemuneration,
        targetRemunerationHistory,
        setTargetRemunerationHistory,
        remunerationHistoryError,
        targetIsEmploymentInsEligible,
        setTargetIsEmploymentInsEligible,
        targetHealthInsNum,
        setTargetHealthInsNum,
        targetPensionNum,
        setTargetPensionNum,
        targetEmploymentInsNum,
        setTargetEmploymentInsNum,
        targetSocialInsGroupId,
        setTargetSocialInsGroupId,
        targetKokuhoPremium,
        setTargetKokuhoPremium,
        targetBankAccounts,
        setTargetBankAccounts,
        bankAccountErrors,
        targetJobType, setTargetJobType,
        targetDepartment, setTargetDepartment,
        targetCareerHistory, setTargetCareerHistory,
        targetRetirementReason, setTargetRetirementReason,
        targetDeathDate, setTargetDeathDate,
        targetDeathCause, setTargetDeathCause,
        targetProbationEnd, setTargetProbationEnd,
        targetBasicPensionNumber, setTargetBasicPensionNumber,
        targetMultiOffice, setTargetMultiOffice,
        targetEmpInsType,
        setTargetEmpInsType,
        socialGroups,
        setSocialGroups,
        branches,
        setBranches,
        branchFilters,
        setBranchFilters,
        calendarPatterns,
        setCalendarPatterns,
        annualWorkDays,
        setAnnualWorkDays,
        payrollGroups,
        targetPremiumRates,
        setPayrollGroups,
        targetPayrollGroupId,
        setTargetPayrollGroupId,
        handleZipSearch,
        calculateDays,
        filteredList,
        sortedAndFilteredList,
        handleSort,
        clearForm,
        startEdit,
        isIdDuplicated,
        isChanged,
        canSave,
        saveStaff,
        deleteStaff,
        fetchSocialGroups,
        fetchBranches,
        fetchPayrollGroups,
        annualTotalHours,
        monthlyAverageHours,
        hourlyConversion,
        overtimeBaseAllowances,
        overtimeHourlyRate,
        branchMap,
        isFirstRun,
        isFormVisible,
    };
}

export type StaffManagerState = ReturnType<typeof useStaffManager>;
