/**
 * 「健康保険の被扶養者」：配偶者・子・父母などの、被扶養者になった日・でなくなった日・住所・職業・年間収入の見込みなど
 * （staff.health_dependents。utils/healthDependents.ts）。被扶養者（異動）届・国民年金第3号被保険者関係届の画面で届書を作る。
 * 届け出た内容（該当・非該当・変更）は、届書のファイルを保存したときに残る。Q を使う前に届けた人は「届け出ている」にする
 */
import { HeartHandshake, Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import {
    dependentProblems, emptyDependent, endReasonOptions, incomeLimitOf, isSango, jobOptions, markedReported, reasonOptions, relationOptions,
    suggestFuyouKind, type HealthDependent,
} from '../../../utils/healthDependents';
import { SHAHO_FUYOU_CODES } from '../../../constants/shahoTodoke';

interface Props {
    cm: StaffManagerState;
}

const small = { ...inputStyle, fontSize: "12px", padding: "6px" };
const field = (label: string, child: React.ReactNode, flex = 1, minWidth = 110) => (
    <div style={{ flex, minWidth }}>
        <label style={{ ...labelStyle, fontSize: "11px" }}>{label}</label>
        {child}
    </div>
);

export default function HealthDependentsSection({ cm }: Props) {
    const { targetHealthDependents: list, setTargetHealthDependents: setList, targetZip, targetAddress } = cm;
    const update = (index: number, patch: Partial<HealthDependent>) => setList(list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
    const remove = (index: number) => setList(list.filter((_, i) => i !== index));
    const add = (spouse: boolean) => setList([...list, { ...emptyDependent(spouse), zip: targetZip, address: targetAddress }]);

    return (
        <div style={{ marginTop: "10px" }}>
            <h4 style={{ borderLeft: "4px solid #0d9488", paddingLeft: "10px", margin: "0 0 8px 0", fontSize: "14px" }}>
                <HeartHandshake size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                健康保険の被扶養者（配偶者・子・父母など）
            </h4>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 8px 0", lineHeight: 1.6 }}>
                被扶養者になったとき・外れたとき・氏名などが変わったときは、「被扶養者（異動）届」の画面で届書を作ります（事実発生から5日以内）。
                年間収入の見込みが130万円未満（60歳以上・障害者は180万円未満、19歳以上23歳未満の子などは150万円未満）で、同居なら被保険者の収入の半分未満、
                別居なら仕送り額より少ない人が被扶養者になれます。Q を使う前に届けた人は、「届け出ている」に印を付けてください。
            </p>

            {list.map((d, i) => {
                const problems = dependentProblems(d);
                const next = suggestFuyouKind(d);
                const limit = incomeLimitOf(d, d.from || new Date().toISOString().slice(0, 10));
                const over = d.income !== null && d.income >= limit;
                const sango = d.spouse && isSango(d, d.from || d.reported?.on || new Date().toISOString().slice(0, 10));
                return (
                    <div key={d.id} style={{ marginBottom: "8px", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "6px", backgroundColor: d.until ? "#f8fafc" : "#f0fdfa" }}>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end" }}>
                            {field("続柄", (
                                <select value={d.relation} onChange={e => update(i, { relation: e.target.value })} style={small}>
                                    {relationOptions(d.spouse).map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            ), 1, 100)}
                            {!d.spouse && d.relation === "その他" && field("続柄（具体的に）", <input value={d.relationNote} placeholder="伯父・甥など" onChange={e => update(i, { relationNote: e.target.value })} style={small} />, 1, 90)}
                            {field("氏名", <input value={d.name} placeholder="姓 名" onChange={e => update(i, { name: e.target.value })} style={small} />, 2)}
                            {field("フリガナ", <input value={d.kana} placeholder="セイ メイ" onChange={e => update(i, { kana: e.target.value })} style={small} />, 2)}
                            {field("生年月日", <input type="date" value={d.birthday} onChange={e => update(i, { birthday: e.target.value })} style={small} />, 1, 120)}
                            {field("性別", (
                                <select value={d.gender} onChange={e => update(i, { gender: e.target.value as HealthDependent["gender"] })} style={small}>
                                    <option value="">—</option><option value="male">男</option><option value="female">女</option>
                                </select>
                            ), 1, 60)}
                            <button type="button" onClick={() => remove(i)} title="この人を消す（届け出たあとで外れたときは、消さずに「被扶養者でなくなった日」を入れます）"
                                style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", paddingBottom: "6px" }}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "4px" }}>
                            {field("同居・別居", (
                                <select value={d.together ? "1" : "0"} onChange={e => update(i, { together: e.target.value === "1" })} style={small}>
                                    <option value="1">同居</option><option value="0">別居（仕送りの書類を添える）</option>
                                </select>
                            ), 1, 100)}
                            {field("郵便番号", <input value={d.zip} placeholder="123-4567" onChange={e => update(i, { zip: e.target.value })} style={small} />, 1, 90)}
                            {field("住所（都道府県から）", <input value={d.address} onChange={e => update(i, { address: e.target.value })} style={small} />, 3, 180)}
                            <button type="button" onClick={() => update(i, { zip: targetZip, address: targetAddress })} style={{ fontSize: "11px", padding: "6px 8px", marginBottom: "1px", cursor: "pointer" }}>
                                本人と同じ
                            </button>
                        </div>
                        {d.spouse && (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "4px" }}>
                                {field("電話番号（3号の届けに書く）", <input value={d.phone} placeholder="03-1234-5678" onChange={e => update(i, { phone: e.target.value })} style={small} />, 2)}
                                {field("電話の種別", (
                                    <select value={d.phoneKind} onChange={e => update(i, { phoneKind: e.target.value })} style={small}>
                                        <option value="">—</option>
                                        {Object.keys(SHAHO_FUYOU_CODES.phone).map(k => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                ), 1, 80)}
                                {field("基礎年金番号（マイナンバーを書かないとき）", <input value={d.basicPensionNumber} placeholder="1234-567890" onChange={e => update(i, { basicPensionNumber: e.target.value })} style={small} />, 2)}
                                {field("第3号被保険者", (
                                    <select value={d.sango === null ? "" : d.sango ? "1" : "0"} onChange={e => update(i, { sango: e.target.value === "" ? null : e.target.value === "1" })} style={small}>
                                        <option value="">年齢で決める（いまは{sango ? "なる" : "ならない"}）</option>
                                        <option value="1">なる</option><option value="0">ならない（被保険者が65歳以上など）</option>
                                    </select>
                                ), 2, 150)}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "4px" }}>
                            {field("職業", (
                                <select value={d.job} onChange={e => update(i, { job: e.target.value })} style={small}>
                                    {jobOptions(d.spouse).map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            ), 1, 110)}
                            {field("年間収入の見込み（円）", (
                                <input type="number" min={0} value={d.income ?? ""} onChange={e => update(i, { income: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                                    style={{ ...small, borderColor: over ? "#f59e0b" : undefined }} />
                            ), 1, 110)}
                            {field("被扶養者になった日", <input type="date" value={d.from} onChange={e => update(i, { from: e.target.value })} style={small} />, 1, 120)}
                            {field("なった理由", (
                                <select value={d.reason} onChange={e => update(i, { reason: e.target.value })} style={small}>
                                    {reasonOptions(d.spouse).map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            ), 1, 100)}
                            {d.reason === "その他" && field("理由（具体的に）", <input value={d.reasonNote} onChange={e => update(i, { reasonNote: e.target.value })} style={small} />, 1, 100)}
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "4px" }}>
                            {field("被扶養者でなくなった日", <input type="date" value={d.until} onChange={e => update(i, { until: e.target.value })} style={small} />, 1, 120)}
                            {d.until && field("でなくなった理由", (
                                <select value={d.endReason} onChange={e => update(i, { endReason: e.target.value })} style={small}>
                                    <option value="">—</option>
                                    {endReasonOptions(d.spouse).map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            ), 1, 110)}
                            {d.until && d.endReason === "その他" && field("理由（具体的に）", <input value={d.endReasonNote} onChange={e => update(i, { endReasonNote: e.target.value })} style={small} />, 1, 100)}
                            {d.until && d.endReason === "死亡" && field("死亡した日", <input type="date" value={d.deathDate} onChange={e => update(i, { deathDate: e.target.value })} style={small} />, 1, 120)}
                            {field("備考（変更前の内容など）", <input value={d.remarks} onChange={e => update(i, { remarks: e.target.value })} style={small} />, 3, 160)}
                        </div>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "6px", fontSize: "11px", color: "#334155" }}>
                            <label><input type="checkbox" checked={d.certificate} onChange={e => update(i, { certificate: e.target.checked })} /> 資格確認書の発行が要る</label>
                            <label><input type="checkbox" checked={d.relationChecked} onChange={e => update(i, { relationChecked: e.target.checked })} /> 事業主が戸籍謄本・住民票で続柄を確かめた</label>
                            <label><input type="checkbox" checked={d.overseas} onChange={e => update(i, { overseas: e.target.checked, overseasReason: e.target.checked ? d.overseasReason || "留学" : "" })} /> 海外に住んでいる（留学・同行家族など。海外特例要件）</label>
                            {d.overseas && (
                                <>
                                    <select value={d.overseasReason} onChange={e => update(i, { overseasReason: e.target.value })} style={{ ...small, width: "auto" }}>
                                        {Object.keys(SHAHO_FUYOU_CODES.overseasReason).map(k => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                    {d.overseasReason === "その他" && <input value={d.overseasReasonNote} placeholder="理由" onChange={e => update(i, { overseasReasonNote: e.target.value })} style={{ ...small, width: "120px" }} />}
                                    {d.spouse && <span>該当した日 <input type="date" value={d.overseasFrom} onChange={e => update(i, { overseasFrom: e.target.value })} style={{ ...small, width: "140px" }} /></span>}
                                    {d.reported && (
                                        <span title="被扶養者のまま日本に住むようになったときなど。「変更」の届けで出します（被扶養者でなくなるときは、非該当の届けを出します）">
                                            海外特例要件に非該当となった日 <input type="date" value={d.overseasUntil} onChange={e => update(i, { overseasUntil: e.target.value, overseasEndReason: e.target.value ? d.overseasEndReason || "国内転入" : "" })} style={{ ...small, width: "140px" }} />
                                        </span>
                                    )}
                                    {d.overseasUntil && (
                                        <>
                                            <select value={d.overseasEndReason} onChange={e => update(i, { overseasEndReason: e.target.value })} style={{ ...small, width: "auto" }}>
                                                {Object.keys(SHAHO_FUYOU_CODES.overseasEndReason).map(k => <option key={k} value={k}>{k}</option>)}
                                            </select>
                                            {d.overseasEndReason === "国内転入" && <span>国内転入日 <input type="date" value={d.returnedOn} onChange={e => update(i, { returnedOn: e.target.value })} style={{ ...small, width: "140px" }} /></span>}
                                            {d.overseasEndReason === "その他" && <input value={d.overseasEndReasonNote} placeholder="理由" onChange={e => update(i, { overseasEndReasonNote: e.target.value })} style={{ ...small, width: "120px" }} />}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        <div style={{ fontSize: "11px", marginTop: "6px", lineHeight: 1.6 }}>
                            {d.reported
                                ? <span style={{ color: "#0f766e" }}>届け出た内容：{d.reported.kind}{d.reported.on ? `（${d.reported.on}）` : "（Q を使う前に届けた）"}</span>
                                : (
                                    <label style={{ color: "#475569" }}>
                                        <input type="checkbox" checked={false} onChange={() => update(i, { reported: markedReported(d) })} /> 届け出ている（Q を使う前に届けた）
                                    </label>
                                )}
                            {next && <span style={{ color: "#b45309", marginLeft: "8px" }}>次に出す届け：{next}（「被扶養者（異動）届」の画面）</span>}
                            {d.reported && !d.reported.on && (
                                <button type="button" onClick={() => update(i, { reported: undefined })} style={{ marginLeft: "8px", fontSize: "11px", cursor: "pointer" }}>届け出ていないことにする</button>
                            )}
                            {over && <div style={{ color: "#b45309" }}>年間収入の見込みが{(limit / 10000).toLocaleString()}万円以上なので、被扶養者になれないかもしれません</div>}
                            {problems.map(p => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
                        </div>
                    </div>
                );
            })}

            <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => add(true)} style={{ fontSize: "12px", padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Plus size={14} /> 配偶者を足す
                </button>
                <button type="button" onClick={() => add(false)} style={{ fontSize: "12px", padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Plus size={14} /> 子・父母などを足す
                </button>
            </div>
        </div>
    );
}
