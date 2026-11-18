/**
 * 「雇用保険の届書に書くこと」（staff.koyo_info。utils/koyoInfo.ts）
 * ・資格取得届：取得区分・被保険者となったことの原因・雇用形態・職種・就職経路・1週間の所定労働時間・賃金月額・契約期間・備考
 * 外国人の方の在留資格の情報は、別の欄（staff/ForeignSection.tsx。staff.foreign_info）に入れ、届書はそこから読む
 * ・ハローワークに届けている氏名（いまの氏名と違うとき。資格喪失届・転勤届で新しい氏名を届ける）
 * ・離職（退職日・死亡日を入れた人）：喪失原因・離職票の交付・補充採用予定・離職理由（離職証明書の⑦欄）・具体的事情記載欄など
 * ・退職のほかに資格を失うできごと（週20時間未満・取締役への就任・出向など）と離職等年月日
 * ・短期雇用特例被保険者か（離職証明書の⑧を暦月で書く）、通勤手当をまとめて払った給与（離職証明書で月ごとに割る）
 * ・転勤（雇用保険適用事業所の違う拠点に移った日）
 * 届書は「雇用保険の届書」の画面で作る
 */
import { createElement, Fragment } from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import {
    ACQUIRE_KIND_OPTIONS, CAUSE_OPTIONS, certificateRequired, EMPLOYMENT_FORM_OPTIONS, employmentFormOf, estimatedKoyoWage, KOYO_LOSS_EVENTS,
    LOSS_CAUSE_OPTIONS, OCCUPATION_OPTIONS, REASON_DETAILS, REASON_GROUP_TITLES, REASON_OPTIONS, reasonCodeOptions,
    ROUTE_OPTIONS, weeklyMinutesOf, type KoyoInfo, type KoyoLoss,
} from '../../../utils/koyoInfo';

interface Props {
    cm: StaffManagerState;
}

const small = { ...inputStyle, fontSize: "12px", padding: "6px" };
const field = (label: string, child: React.ReactNode, flex = 1, minWidth = 120) => (
    <div style={{ flex, minWidth }}>
        <label style={{ ...labelStyle, fontSize: "11px" }}>{label}</label>
        {child}
    </div>
);
/** 横に並べる行（子は1つずつ渡す。配列にしないので key は要らない） */
const row = (...children: React.ReactNode[]) => createElement("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" } }, ...children);
const sub = (title: string) => <div style={{ fontSize: "12px", fontWeight: "bold", color: "#334155", margin: "10px 0 4px" }}>{title}</div>;

export default function KoyoSection({ cm }: Props) {
    const info = cm.targetKoyoInfo;
    const set = (patch: Partial<KoyoInfo>) => cm.setTargetKoyoInfo({ ...info, ...patch });
    const setLoss = (patch: Partial<KoyoLoss>) => set({ loss: { ...info.loss, ...patch } });
    // 加入の印を外していても、退職のほかのできごとで資格を失う人は出す（資格喪失届を作るため）
    if (cm.targetIsEmploymentInsEligible !== 1 && !info.lossEvent) return null;
    // 初めの値（入れていないとき）を出すための、いま入っている従業員の値
    const staffNow: any = {
        wage_type: cm.targetWageType, base_wage: Number(cm.targetWage) || 0, scheduled_work_hours: Number(cm.targetDailyHours) || 0,
        work_days: cm.targetWorkDays, calendar_pattern_id: cm.targetPatternId, commute_type: cm.targetCommuteType,
        commute_amount: cm.targetCommuteAmount, koyo_info: info,
    };
    const autoMinutes = weeklyMinutesOf({ ...staffNow, koyo_info: { ...info, weeklyMinutes: null } }, { ...info, weeklyMinutes: null });
    const autoWage = estimatedKoyoWage(staffNow, 0, { ...info, wageMonthly: null });
    const autoForm = employmentFormOf(staffNow, { ...info, employmentForm: "" });
    const endDate = cm.targetDeathDate && (!cm.targetRetirementDate || cm.targetDeathDate <= cm.targetRetirementDate) ? cm.targetDeathDate : cm.targetRetirementDate;
    const lossDate = info.lossEvent && (!endDate || info.lossEvent.date < endDate) ? info.lossEvent.date : endDate;
    const seasonal = autoForm === "5" || info.employmentForm === "5";
    const required = !!lossDate && certificateRequired({ birthday: cm.targetBirthday }, lossDate);
    const details = REASON_DETAILS[info.loss.reason] ?? [];
    const branches: any[] = cm.branches ?? [];

    return (
        <div style={{ marginTop: "10px" }}>
            <h4 style={{ borderLeft: "4px solid #2563eb", paddingLeft: "10px", margin: "0 0 8px 0", fontSize: "14px" }}>
                <Briefcase size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                雇用保険の届書に書くこと
            </h4>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 6px 0", lineHeight: 1.6 }}>
                「雇用保険の届書」の画面で、資格取得届・資格喪失届（離職証明書）・転勤届・個人番号登録届を作るときに使います。空の欄は、ほかの設定からの初めの値を使います。
            </p>
            {sub("入社したとき（資格取得届）")}
            {row(
                field("資格取得日（入社日と違うとき）", <input type="date" value={info.acquiredOn} onChange={e => set({ acquiredOn: e.target.value })} style={small} />),
                field("取得区分", <select value={info.acquireKind} onChange={e => set({ acquireKind: e.target.value as KoyoInfo["acquireKind"] })} style={small}>
                    <option value="">自動（被保険者番号があれば再取得）</option>
                    {ACQUIRE_KIND_OPTIONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>),
                field("被保険者となったことの原因", <select value={info.cause} onChange={e => set({ cause: e.target.value })} style={small}>
                    <option value="">新規雇用（その他）</option>
                    {CAUSE_OPTIONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
                </select>, 1.4),
            )}
            {row(
                field("雇用形態", <select value={info.employmentForm} onChange={e => set({ employmentForm: e.target.value })} style={small}>
                    <option value="">自動（{EMPLOYMENT_FORM_OPTIONS.find(([c]) => c === autoForm)?.[1] ?? ""}）</option>
                    {EMPLOYMENT_FORM_OPTIONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
                </select>),
                field("職種", <select value={info.occupation} onChange={e => set({ occupation: e.target.value })} style={small}>
                    <option value="">（選ぶ）</option>
                    {OCCUPATION_OPTIONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
                </select>, 1.3),
                field("就職経路", <select value={info.route} onChange={e => set({ route: e.target.value })} style={small}>
                    <option value="">（選ぶ）</option>
                    {ROUTE_OPTIONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
                </select>),
            )}
            {row(
                field("1週間の所定労働時間（分。空なら勤務の設定から）", <input type="number" min={0} value={info.weeklyMinutes ?? ""} placeholder={`${Math.floor(autoMinutes / 60)}時間${autoMinutes % 60}分 = ${autoMinutes}`}
                    onChange={e => set({ weeklyMinutes: e.target.value === "" ? null : Number(e.target.value) })} style={small} />, 1.3),
                field("賃金月額（円。空なら給与の設定から。残業代は除く）", <input type="number" min={0} value={info.wageMonthly ?? ""} placeholder={`${autoWage.toLocaleString()}`}
                    onChange={e => set({ wageMonthly: e.target.value === "" ? null : Number(e.target.value) })} style={small} />, 1.3),
            )}
            {row(
                field("契約期間の定め", <label style={{ fontSize: "12px" }}><input type="checkbox" checked={info.contract.has} onChange={e => set({ contract: { ...info.contract, has: e.target.checked } })} /> 有期契約（期間の定めがある）</label>),
                ...(info.contract.has ? [
                    field("契約期間の初め", <input type="date" value={info.contract.start} onChange={e => set({ contract: { ...info.contract, start: e.target.value } })} style={small} />),
                    field("契約期間の終わり", <input type="date" value={info.contract.end} onChange={e => set({ contract: { ...info.contract, end: e.target.value } })} style={small} />),
                    field("契約更新条項", <select value={info.contract.renewal} onChange={e => set({ contract: { ...info.contract, renewal: e.target.value as "" | "有" | "無" } })} style={small}>
                        <option value="">（選ぶ）</option><option value="有">有</option><option value="無">無</option>
                    </select>, 0.7, 90),
                ] : []),
            )}
            {row(field("資格取得届の備考（原因が「その他」のときは具体的に）", <input value={info.remarks} onChange={e => set({ remarks: e.target.value })} style={small} />))}

            {sub("氏名・個人番号")}
            {row(
                field("ハローワークに届けている氏名（いまと違うとき）", <input value={info.registeredName} onChange={e => set({ registeredName: e.target.value })} placeholder="例：山田　花子" style={small} />),
                field("そのフリガナ", <input value={info.registeredKana} onChange={e => set({ registeredKana: e.target.value })} style={small} />),
                field("氏名を変えた日", <input type="date" value={info.nameChangedOn} onChange={e => set({ nameChangedOn: e.target.value })} style={small} />),
            )}
            <label style={{ fontSize: "12px", display: "block", marginBottom: "6px" }}>
                <input type="checkbox" checked={info.numberReported} onChange={e => set({ numberReported: e.target.checked })} /> マイナンバーをハローワークに届けている（Q を使う前に届けた人・資格取得届に書いた人）
            </label>


            {sub("退職のほかに雇用保険の資格を失うとき（資格喪失届を出す）")}
            {row(
                field("できごと", <select value={info.lossEvent?.kind ?? ""} onChange={e => set({ lossEvent: e.target.value ? { kind: e.target.value, date: info.lossEvent?.date ?? "" } : null })} style={small}>
                    <option value="">なし</option>
                    {Object.keys(KOYO_LOSS_EVENTS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>, 2, 220),
                info.lossEvent && field("離職等年月日（被保険者でなくなった日の前日）", <input type="date" value={info.lossEvent.date} onChange={e => set({ lossEvent: { ...info.lossEvent!, date: e.target.value } })} style={small} />, 1.5),
            )}
            {info.lossEvent && (
                <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px", lineHeight: 1.6 }}>
                    週の所定労働時間が20時間未満になった・取締役になった・出向したときなどは、在籍のまま資格喪失届を出します（雇用保険事務手続きの手引き 第2編）。
                    {!info.lossEvent.date && <span style={{ color: "#b45309" }}>　離職等年月日を入れてください（入れないと届書に出ません）。</span>}
                </div>
            )}
            {row(
                field("短期雇用特例被保険者（季節的に雇用される人）", <select value={info.shortTerm === null ? "" : String(info.shortTerm)} onChange={e => set({ shortTerm: e.target.value === "" ? null : e.target.value === "true" })} style={small}>
                    <option value="">自動（雇用形態が季節的雇用なら はい：いまは{seasonal ? "はい" : "いいえ"}）</option>
                    <option value="true">はい（離職証明書の⑧を暦月で書く）</option>
                    <option value="false">いいえ</option>
                </select>, 2, 240),
            )}
            {sub("通勤手当を何か月分かまとめて払った給与（離職証明書の賃金の欄で、月数で割ってそれぞれの月に入れる）")}
            {info.commuteLumps.map((c, i) => <Fragment key={i}>{row(
                field("支給した年月", <input type="month" value={c.pay} onChange={e => set({ commuteLumps: info.commuteLumps.map((x, j) => (j === i ? { ...x, pay: e.target.value } : x)) })} style={small} />),
                field("何か月分", <input type="number" min={2} max={12} value={c.months} onChange={e => set({ commuteLumps: info.commuteLumps.map((x, j) => (j === i ? { ...x, months: Math.max(2, Math.min(12, Number(e.target.value) || 2)) } : x)) })} style={small} />),
                <div key="del" style={{ alignSelf: "flex-end" }}>
                    <button type="button" onClick={() => set({ commuteLumps: info.commuteLumps.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", cursor: "pointer", color: "#b91c1c" }}><Trash2 size={14} /></button>
                </div>,
            )}</Fragment>)}
            <button type="button" onClick={() => set({ commuteLumps: [...info.commuteLumps, { pay: "", months: 6 }] })}
                style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "6px", border: "1px solid #94a3b8", background: "white", cursor: "pointer", marginBottom: "6px" }}>
                <Plus size={12} style={{ verticalAlign: "middle" }} /> まとめて払った通勤手当を足す
            </button>

            {lossDate && (<>
                {sub(`${info.lossEvent && lossDate === info.lossEvent.date ? `資格を失うとき（${info.lossEvent.kind}。離職等年月日 ${lossDate}）` : `離職したとき（資格喪失届・離職証明書。離職日 ${lossDate}）`}`)}
                {row(
                    field("喪失原因", <select value={info.loss.cause} onChange={e => setLoss({ cause: e.target.value as KoyoLoss["cause"] })} style={small}>
                        <option value="">自動（離職理由から）</option>
                        {LOSS_CAUSE_OPTIONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
                    </select>, 1.3),
                    field("離職票", <select value={required ? "true" : info.loss.certificate === null ? "" : String(info.loss.certificate)}
                        disabled={required} onChange={e => setLoss({ certificate: e.target.value === "" ? null : e.target.value === "true" })} style={small}>
                        <option value="">（本人に聞く）</option><option value="true">交付を希望する</option><option value="false">希望しない</option>
                    </select>),
                    field("補充採用予定", <select value={info.loss.replacement || "無"} onChange={e => setLoss({ replacement: e.target.value as KoyoLoss["replacement"] })} style={small}>
                        <option value="無">無</option><option value="有">有</option>
                    </select>, 0.6, 80),
                )}
                {required && <div style={{ fontSize: "11px", color: "#b45309", marginBottom: "4px" }}>離職日に59歳以上なので、希望にかかわらず離職票を交付します（離職証明書を作ります）。</div>}
                {row(field("被保険者でなくなったことの原因（喪失届。空なら退職の事由）", <input value={info.loss.causeText} onChange={e => setLoss({ causeText: e.target.value })} placeholder={cm.targetRetirementReason || "例：一身上の都合による退職"} style={small} />))}
                {row(field("離職理由（離職証明書の⑦欄）", <select value={info.loss.reason} onChange={e => setLoss({ reason: e.target.value, details: {} })} style={small}>
                    <option value="">（選ぶ）</option>
                    {Object.entries(REASON_GROUP_TITLES).map(([g, title]) => (
                        <optgroup key={g} label={title}>
                            {REASON_OPTIONS.filter(r => r.group === g).map(r => <option key={r.key} value={r.key}>{r.key} {r.title}</option>)}
                        </optgroup>
                    ))}
                </select>))}
                {details.filter(d => !d.when || (info.loss.details[d.when[0]] ?? "") === d.when[1]).map(d => <Fragment key={d.name}>{row(
                    field(d.label, d.input === "code"
                        ? <select value={info.loss.details[d.name] ?? ""} onChange={e => setLoss({ details: { ...info.loss.details, [d.name]: e.target.value } })} style={small}>
                            <option value="">（選ぶ）</option>
                            {reasonCodeOptions(d.name).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                        </select>
                        : <input type={d.input === "number" ? "number" : "text"} maxLength={d.max} value={info.loss.details[d.name] ?? ""}
                            onChange={e => setLoss({ details: { ...info.loss.details, [d.name]: e.target.value } })} style={small} />),
                )}</Fragment>)}
                {row(field("具体的事情記載欄（離職に至った原因と経緯。110字まで）", <textarea value={info.loss.circumstances} maxLength={110} onChange={e => setLoss({ circumstances: e.target.value })} style={{ ...small, height: "48px" }} />))}
                {row(field("賃金に関する特記事項（3か月以内ごとに払う賃金があれば。140字まで）", <input value={info.loss.wageNote} maxLength={140} onChange={e => setLoss({ wageNote: e.target.value })} style={small} />))}
                {row(
                    field("離職者の判断（離職理由への異議）", <select value={info.loss.objection} onChange={e => setLoss({ objection: e.target.value as KoyoLoss["objection"] })} style={small}>
                        <option value="">（まだ確かめていない）</option><option value="1">無し</option><option value="0">有り</option>
                    </select>),
                    field("離職者の氏名（確かめてもらった人）", <input value={info.loss.signature} onChange={e => setLoss({ signature: e.target.value })} style={small} />),
                )}
            </>)}

            {branches.length > 1 && (<>
                {sub("転勤（雇用保険適用事業所の違う支店に移ったとき。転勤届）")}
                {info.transfers.map((t, i) => <Fragment key={i}>{row(
                    field("転勤した日", <input type="date" value={t.on} onChange={e => set({ transfers: info.transfers.map((x, j) => (j === i ? { ...x, on: e.target.value } : x)) })} style={small} />),
                    field("移る前", <select value={t.from} onChange={e => set({ transfers: info.transfers.map((x, j) => (j === i ? { ...x, from: Number(e.target.value) } : x)) })} style={small}>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>),
                    field("移った先", <select value={t.to} onChange={e => set({ transfers: info.transfers.map((x, j) => (j === i ? { ...x, to: Number(e.target.value) } : x)) })} style={small}>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>),
                    <div key="del" style={{ alignSelf: "flex-end", fontSize: "11px", color: "#64748b" }}>
                        {t.reported ? `届け出た（${t.reported}）` : ""}
                        <button type="button" onClick={() => set({ transfers: info.transfers.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", cursor: "pointer", color: "#b91c1c" }}><Trash2 size={14} /></button>
                    </div>,
                )}</Fragment>)}
                <button type="button" onClick={() => set({ transfers: [...info.transfers, { on: "", from: Number(cm.targetBranchId) || 1, to: Number(cm.targetBranchId) || 1 }] })}
                    style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "6px", border: "1px solid #94a3b8", background: "white", cursor: "pointer" }}>
                    <Plus size={12} style={{ verticalAlign: "middle" }} /> 転勤を足す
                </button>
            </>)}
        </div>
    );
}
