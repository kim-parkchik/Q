/**
 * 「給与規定グループ」タブ：締め日・支払日のグループ管理
 * （CompanyManager.tsx から分割）
 */
import {
    Trash2,
    AlertTriangle,
    Pencil,
    PlusCircle,
    CheckCircle2,
    X,
    Clock
} from 'lucide-react';
import {
    tabContentStyle,
    inputStyle,
    btnStyle,
    branchCardStyle,
    headBadgeStyle,
    deleteBtnStyle,
    editBtnStyle,
    addBoxStyle,
    miniLabelStyle,
    editingBadgeStyle
} from '../CompanyManager.styles';
import type { CompanyManagerState } from '../useCompanyManager';
import { TAX_CALC_METHOD_LABELS, type TaxCalcMethod } from '../../../utils/incomeTax';
import {
    ABSENCE_DEDUCTION_METHOD_LABELS, PRORATION_METHOD_LABELS, SOCIAL_INS_COLLECTION_LABELS, toAbsenceDeductionMethod, toProrationMethod, toSocialInsCollection,
    type AbsenceDeductionMethod, type ProrationMethod, type SocialInsCollection,
} from '../../../utils/calcSalary';
import { DEFAULT_LENGTH_RULES, describeFixedBreak, parseFixedBreak, type LengthRule } from '../../../utils/fixedBreak';

interface Props {
    cm: CompanyManagerState;
}

export default function PayrollGroupTab({ cm }: Props) {
    const {
        payrollGroups,
        pgName,
        setPgName,
        pgClosingDay,
        setPgClosingDay,
        pgIsNextMonth,
        setPgIsNextMonth,
        pgPaymentDay,
        setPgPaymentDay,
        pgTaxMethod,
        setPgTaxMethod,
        pgSocialInsCollection,
        setPgSocialInsCollection,
        pgProrationMethod,
        setPgProrationMethod,
        pgAbsenceDeductionMethod,
        setPgAbsenceDeductionMethod,
        pgFixedBreak,
        setPgFixedBreak,
        editingPgId,
        deletingPgId,
        setDeletingPgId,
        startEditPg,
        resetPgForm,
        savePayrollGroup,
        deletePayrollGroup,
    } = cm;

    return (
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
                                    <span style={{ marginLeft: "6px", color: "#94a3b8" }}>
                                        / 所得税: {TAX_CALC_METHOD_LABELS[(pg.tax_calc_method === "densanki" ? "densanki" : "table") as TaxCalcMethod]}
                                        / 社会保険料: {SOCIAL_INS_COLLECTION_LABELS[toSocialInsCollection(pg.social_ins_collection)]}
                                        / 途中入社・退職: {PRORATION_METHOD_LABELS[toProrationMethod(pg.proration_method)]}
                                        / 欠勤控除: {ABSENCE_DEDUCTION_METHOD_LABELS[toAbsenceDeductionMethod(pg.absence_deduction_method)]}
                                        / 決まった休憩: {describeFixedBreak(parseFixedBreak(pg.fixed_break))}
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
                        style={{ ...inputStyle, marginBottom: "15px" }}
                    >
                        {[...Array(28)].map((_, i) => (
                            <option key={i+1} value={i+1}>{i+1}日</option>
                        ))}
                        <option value={99}>末日</option>
                    </select>

                    <label style={miniLabelStyle}>源泉所得税の計算方法</label>
                    <select
                        value={pgTaxMethod}
                        onChange={e => setPgTaxMethod(e.target.value as TaxCalcMethod)}
                        style={{ ...inputStyle, marginBottom: "6px" }}
                    >
                        <option value="table">{TAX_CALC_METHOD_LABELS.table}（おすすめ）</option>
                        <option value="densanki">{TAX_CALC_METHOD_LABELS.densanki}</option>
                    </select>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                        税額表は国税庁の月額表どおりの金額になります。電算機計算の特例はその月の給与から式で計算するため、
                        数十円〜百円ほど差が出ることがあります（年末調整で精算されます）。
                    </p>

                    <label style={miniLabelStyle}>社会保険料の徴収</label>
                    <select
                        value={pgSocialInsCollection}
                        onChange={e => setPgSocialInsCollection(e.target.value as SocialInsCollection)}
                        style={{ ...inputStyle, marginBottom: "6px" }}
                    >
                        <option value="current">{SOCIAL_INS_COLLECTION_LABELS.current}（その月の分を、その月に支払う給与から引く）</option>
                        <option value="next">{SOCIAL_INS_COLLECTION_LABELS.next}（前月の分を、その月に支払う給与から引く）</option>
                    </select>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                        健康保険・介護保険・子ども・子育て支援金・厚生年金の保険料を、どの月の給与から引くか。
                        法律（健康保険法167条・厚生年金保険法84条）では、前月の分を引くことになっています（翌月徴収）。
                        翌月徴収にすると、料率の切り替え・入社した月・退職した月・産休育休の免除は、前月の分で決まります。
                        退職するときは、最後の給与から前月と退職した月の2か月分を引けます。雇用保険料と賞与の保険料は、どちらでも支払ったときに引きます。
                        途中で切り替えると、1か月分を引かない（2か月分を引く）月が出るので、切り替える月に気をつけてください。
                    </p>

                    <label style={miniLabelStyle}>計算期間の途中で入社・退職した人の月給</label>
                    <select
                        value={pgProrationMethod}
                        onChange={e => setPgProrationMethod(e.target.value as ProrationMethod)}
                        style={{ ...inputStyle, marginBottom: "6px" }}
                    >
                        <option value="none">{PRORATION_METHOD_LABELS.none}（満額を払う）</option>
                        <option value="workdays">{PRORATION_METHOD_LABELS.workdays}（月額 × 在籍した日の所定労働日数 ÷ 計算期間の所定労働日数）</option>
                        <option value="calendar">{PRORATION_METHOD_LABELS.calendar}（月額 × 在籍した暦日数 ÷ 計算期間の暦日数）</option>
                    </select>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                        日割りのしかたは法律では決まっていないので、会社の賃金規程（就業規則）に合わせて選んでください。
                        厚生労働省のモデル就業規則（第46条第2項）は「当該計算期間の所定労働日数を基準に日割計算」です。
                        月給制の人の基本給と、給与項目のうち「固定（毎月同額）」の支給項目を日割りします（1円未満は切り上げ）。
                        固定残業代・通勤手当・「変動」の項目は日割りしないので、規程で日割りするなら金額を直してください。
                        所定労働日数は、会社カレンダー（従業員の出勤曜日）から数えます。
                    </p>

                    <label style={miniLabelStyle}>月給制の人の欠勤控除</label>
                    <select
                        value={pgAbsenceDeductionMethod}
                        onChange={e => setPgAbsenceDeductionMethod(e.target.value as AbsenceDeductionMethod)}
                        style={{ ...inputStyle, marginBottom: "6px" }}
                    >
                        <option value="workdays">{ABSENCE_DEDUCTION_METHOD_LABELS.workdays}（月給 × 欠勤日数 ÷ 計算期間の所定労働日数）</option>
                        <option value="annual">{ABSENCE_DEDUCTION_METHOD_LABELS.annual}（月給 × 欠勤日数 ÷（1年間の所定労働日数 ÷ 12））</option>
                        <option value="none">{ABSENCE_DEDUCTION_METHOD_LABELS.none}（欠勤があっても月給を満額払う）</option>
                    </select>
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                        勤怠で「欠勤」にした日の分を月給から引くしかたです。法律では決まっていないので、会社の賃金規程（就業規則）に合わせて選んでください。
                        「計算期間の所定労働日数」は、1日分の額が月ごとに変わり、所定労働日をすべて休むと月給をちょうど全額引きます。
                        「1年間の月平均」は、1日分の額が1年を通して同じで、残業代の時給と同じ日数で割ります
                        （厚生労働省のモデル就業規則（第45条第2項）は、月給の場合「基本給 ÷ 1か月平均所定労働時間数」で1時間あたりの額を出す形です）。
                        どちらも1円未満は切り捨て、引く額はその月の基本給までにします。所定労働日数は会社カレンダー（従業員の出勤曜日）から数えます。
                        引くのは基本給の分だけです（手当の分も引く規程なら、その額を給与項目の控除で入れてください）。
                        欠勤控除をした月の算定・月変の支払基礎日数は、計算期間の所定労働日数から欠勤日数を引いた日数になります（完全月給制は暦日数）。
                    </p>

                    <label style={miniLabelStyle}>決まった休憩（休憩の時刻が入っていない日に引く）</label>
                    <select
                        value={pgFixedBreak?.mode ?? "none"}
                        onChange={e => {
                            const v = e.target.value;
                            setPgFixedBreak(
                                v === "time" ? { mode: "time", start: "12:00", end: "13:00" }
                                : v === "length" ? { mode: "length", rules: DEFAULT_LENGTH_RULES.map(r => ({ ...r })) }
                                : null
                            );
                        }}
                        style={{ ...inputStyle, marginBottom: "6px" }}
                    >
                        <option value="none">使わない（休憩の時刻を入れた日だけ引く）</option>
                        <option value="time">時刻で決める（例：12:00〜13:00）</option>
                        <option value="length">長さで決める（例：6時間を超えたら45分、8時間を超えたら60分）</option>
                    </select>
                    {pgFixedBreak?.mode === "time" && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                            <input type="time" value={pgFixedBreak.start} onChange={e => setPgFixedBreak({ ...pgFixedBreak, start: e.target.value })}
                                style={{ ...inputStyle, width: "120px", marginBottom: 0 }} />
                            <span>〜</span>
                            <input type="time" value={pgFixedBreak.end} onChange={e => setPgFixedBreak({ ...pgFixedBreak, end: e.target.value })}
                                style={{ ...inputStyle, width: "120px", marginBottom: 0 }} />
                        </div>
                    )}
                    {pgFixedBreak?.mode === "length" && pgFixedBreak.rules.map((r, i) => {
                        const setRule = (patch: Partial<LengthRule>) =>
                            setPgFixedBreak({ mode: "length", rules: pgFixedBreak.rules.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                        const num = (v: string, max: number) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
                        const small = { ...inputStyle, width: "56px", marginBottom: 0, textAlign: "right" as const };
                        return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px", fontSize: "12px", flexWrap: "wrap" }}>
                                <span>出勤から退勤まで（外出を除く）が</span>
                                <input type="number" min={0} max={23} value={Math.floor(r.overMinutes / 60)} style={small}
                                    onChange={e => setRule({ overMinutes: num(e.target.value, 23) * 60 + (r.overMinutes % 60) })} />
                                <span>時間</span>
                                <input type="number" min={0} max={59} value={r.overMinutes % 60} style={small}
                                    onChange={e => setRule({ overMinutes: Math.floor(r.overMinutes / 60) * 60 + num(e.target.value, 59) })} />
                                <span>分を超えたら、休憩</span>
                                <input type="number" min={1} max={600} value={r.breakMinutes} style={small}
                                    onChange={e => setRule({ breakMinutes: num(e.target.value, 600) })} />
                                <span>分</span>
                            </div>
                        );
                    })}
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                        休憩を打刻しない会社や、打刻を忘れた日のために、休憩の時刻が入っていない日は、勤怠を確定するときにこの休憩を引きます。
                        休憩の時刻を入れた日（手入力・打刻）は、その時刻を使います。休憩を取らなかった日は、勤怠の画面で「休憩なし」に印を付けます。
                        時刻で決めると、出勤から退勤までの中にまるごと入る日だけ引きます（遅刻・早退などで途中にかかる日や、外出と重なる日は、引かずに知らせます）。
                        長さで決めると、時刻がわからないので、深夜（22時〜5時）の時間はできるだけ減らしません（深夜の割増を少なく数えないため）。
                        労働基準法34条では、労働時間が6時間を超えるときは45分以上、8時間を超えるときは1時間以上の休憩を、労働時間の途中に与えます。
                        就業規則の休憩時間に合わせてください。従業員ごとに、この休憩を使わないようにもできます（従業員の画面）。
                        確定済みの日の勤怠は変わりません（確定を解除して確定し直すと、新しい決まりで計算します）。
                    </p>

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
    );
}
