/**
 * 「在留資格の情報（外国人の方）」（staff.foreign_info。utils/foreignInfo.ts）
 * ローマ字の氏名・国籍・地域・在留資格・在留期間（満了日）・資格外活動許可・在留カード番号・派遣・請負就労区分と、在留カードを確かめた日。
 * 雇用保険に入る人も入らない人も、ここに1回入れる。雇用保険の資格取得届・資格喪失届・外国人雇用状況届出書・ローマ字氏名届・
 * 労働者死傷病報告は、ここの値を使う。在留カードの画像は持たない。在留期間の満了日が近い・過ぎたときは知らせる
 */
import { createElement } from 'react';
import dayjs from 'dayjs';
import { Globe } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import {
    emptyForeignInfo, NATIONALITY_OPTIONS, RESIDENCE_ALERT_MONTHS, RESIDENCE_STATUS_OPTIONS, residencePeriodAlert, type ForeignInfo,
} from '../../../utils/foreignInfo';
import { formatWareki } from '../../../utils/wareki';

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

export default function ForeignSection({ cm }: Props) {
    const foreign = cm.targetForeignInfo;
    const set = (patch: Partial<ForeignInfo>) => cm.setTargetForeignInfo({ ...(foreign ?? emptyForeignInfo()), ...patch });
    const alert = residencePeriodAlert(foreign, dayjs().format("YYYY-MM-DD"));
    return (
        <div style={{ marginTop: "10px" }}>
            <h4 style={{ borderLeft: "4px solid #2563eb", paddingLeft: "10px", margin: "0 0 8px 0", fontSize: "14px" }}>
                <Globe size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                在留資格の情報（外国人の方）
            </h4>
            <label style={{ fontSize: "12px", display: "block", marginBottom: "6px" }}>
                <input type="checkbox" checked={!!foreign} onChange={e => cm.setTargetForeignInfo(e.target.checked ? emptyForeignInfo() : null)} />
                {" "}外国人の方（在留資格「外交」「公用」と特別永住者の方を除く）
            </label>
            {foreign && (<>
                <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 6px 0", lineHeight: 1.6 }}>
                    在留カードで確かめて入れます（在留カードを持たない人は、旅券・在留資格証明書など）。雇用保険の資格取得届・資格喪失届、外国人雇用状況届出書（雇用保険に入らない人）、
                    ローマ字氏名届、労働者死傷病報告は、ここの値を使います。在留カードの画像は Q には入れません（写しを残すことは法律で決まっていません）。
                </p>
                {row(
                    field("氏名（ローマ字。在留カードのとおり）", <input value={foreign.romaji} onChange={e => set({ romaji: e.target.value })} style={small} />, 1.5),
                    field("国籍・地域", <select value={foreign.nationality} onChange={e => set({ nationality: e.target.value })} style={small}>
                        <option value="">（選ぶ）</option>
                        {NATIONALITY_OPTIONS.map(([n, c]) => <option key={c + n} value={n}>{n}</option>)}
                    </select>),
                )}
                {row(
                    field("在留資格", <select value={foreign.status} onChange={e => set({ status: e.target.value })} style={small}>
                        <option value="">（選ぶ）</option>
                        {RESIDENCE_STATUS_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.name}{o.abolished ? "（廃止済）" : ""}</option>)}
                    </select>, 1.5),
                    ...(RESIDENCE_STATUS_OPTIONS.find(o => o.code === foreign.status)?.free
                        ? [field("在留資格（または理由。20字まで）", <input value={foreign.statusText} onChange={e => set({ statusText: e.target.value })} style={small} />)]
                        : []),
                    field("在留期間（満了日）", <input type="date" value={foreign.periodEnd} onChange={e => set({ periodEnd: e.target.value })} style={small} />),
                )}
                {row(
                    field("在留カード番号", <input value={foreign.card} onChange={e => set({ card: e.target.value })} placeholder="AB12345678CD" style={small} />),
                    field("資格外活動許可", <select value={foreign.permission} onChange={e => set({ permission: e.target.value as "" | "有" | "無" })} style={small}>
                        <option value="">（選ぶ）</option><option value="有">有</option><option value="無">無</option>
                    </select>, 0.7),
                    field("派遣・請負就労区分", <select value={foreign.dispatch} onChange={e => set({ dispatch: e.target.value as "" | "該当" | "非該当" })} style={small}>
                        <option value="">（選ぶ）</option><option value="該当">該当（主に他の事業所で働く）</option><option value="非該当">非該当</option>
                    </select>),
                    field("在留カードを確かめた日", <input type="date" value={foreign.checkedOn} onChange={e => set({ checkedOn: e.target.value })} style={small} />),
                )}
                {alert && (
                    <div style={{ fontSize: "12px", color: alert.state === "expired" ? "#b91c1c" : "#92400e", marginTop: "4px" }}>
                        {alert.state === "expired"
                            ? `⚠ 在留期間の満了日（${formatWareki(alert.periodEnd)}）が過ぎています。新しい在留カードで確かめて、在留期間を直してください。`
                            : `⚠ 在留期間の満了日（${formatWareki(alert.periodEnd)}）まで ${RESIDENCE_ALERT_MONTHS}か月を切りました（あと${alert.days}日）。更新の予定を本人に確かめてください。`}
                    </div>
                )}
            </>)}
        </div>
    );
}
