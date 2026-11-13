/**
 * 有給休暇管理の画面の、年次有給休暇の付与の知らせと、年5日の取得（くわしくは utils/annualLeaveGrant.ts）
 *
 * ・AnnualGrantDueBanner：付与日が来て、まだ登録していない付与（会社全体）。付与する・付与しない（出勤率が8割未満）を選ぶ
 * ・FiveDayOverview：年5日が足りない人（期間中・期間が過ぎた人。会社全体）
 * ・StaffAnnualInfo：選んだ人の、次の付与と、年5日の取得
 */
import { useState, type CSSProperties } from "react";
import { describeAnnualLeaveRule, describeFiveDay, otherLeaveRuleOf, stageLabel, type AnnualLeaveRule, type FiveDayStatus } from "../../utils/annualLeaveGrant";
import { fiveDayAlerts, type DueAnnualGrantInfo, type StaffAnnualLeave } from "../../utils/annualLeaveOverview";
import { ATTENDANCE_RATE_REQUIRED, OBLIGATION_DAYS } from "../../constants/annualLeave";

const pct = (rate: number | null) => (rate === null ? "-" : `${Math.floor(rate * 1000) / 10}%`);
const daysLabel = (n: number) => `${Math.round(n * 2) / 2}日`;

/** 出勤率の書き方 */
const rateText = (d: DueAnnualGrantInfo) => {
  const r = d.rate;
  if (r.ok === null) return `確かめられません（確定した勤怠がない所定労働日が ${r.missingDays}日）`;
  const notes = [
    ...(r.deemedDays > 0 ? [`前倒しで ${r.deemedDays}日を出勤とみなす`] : []),
    ...(r.leaveDays > 0 ? [`休業の ${r.leaveDays}日を出勤とみなす`] : []),
    ...(r.otherLeaveDays > 0 ? [`その他の休職の ${r.otherLeaveDays}日を${r.otherLeaveRule === "absent" ? "欠勤と同じに数える" : "全労働日から除く"}`] : []),
  ];
  const base = `${pct(r.rate)}（${r.presentDays}日 ÷ ${r.allDays}日${notes.map((n) => `。${n}`).join("")}）`;
  return r.ok ? base : `${base}：8割未満`;
};

export function AnnualGrantDueBanner(props: {
  items: StaffAnnualLeave[];
  rule: AnnualLeaveRule;
  busy: boolean;
  onGrant: (staffId: string, info: DueAnnualGrantInfo) => void;
  onSkip: (staffId: string, info: DueAnnualGrantInfo) => void;
}) {
  const rows = props.items.flatMap((s) => s.due.map((d) => ({ s, d })));
  if (rows.length === 0) return null;
  return (
    <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #68d391", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
      <div style={{ fontWeight: "bold", color: "#22543d", marginBottom: "4px" }}>🔔 年次有給休暇の付与日が来た人がいます（まだ登録していません）</div>
      <div style={{ fontSize: "12px", color: "#2f855a", marginBottom: "8px" }}>
        付与日の決まり：{describeAnnualLeaveRule(props.rule)}（会社設定の「休暇の種類」で変えられます）。日数は労働基準法39条の表（パートなどは比例付与の表）です。
      </div>
      <table style={table}>
        <thead>
          <tr style={{ backgroundColor: "#f8fafc" }}>
            <th style={th}>名前</th><th style={th}>付与日</th><th style={th}>継続勤務</th><th style={th}>日数</th>
            <th style={th}>出勤率（{Math.round(ATTENDANCE_RATE_REQUIRED * 100)}%以上で付与）</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, d }) => (
            <tr key={`${s.staffId}-${d.grant.date}`}>
              <td style={td}>{s.name}（{s.staffId}）</td>
              <td style={td}>
                {d.grant.date}
                {d.grant.date < d.grant.legalDate && <div style={{ fontSize: "11px", color: "#64748b" }}>法定の基準日 {d.grant.legalDate} を前倒し</div>}
              </td>
              <td style={td}>{stageLabel(d.grant.stage)}</td>
              <td style={td}>{d.days}日{d.proportional && <span style={{ fontSize: "11px", color: "#64748b" }}>（比例付与）</span>}</td>
              <td style={{ ...td, color: d.rate.ok === false ? "#c53030" : d.rate.ok === null ? "#b45309" : "#2d3748" }}>
                {rateText(d)}
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>{d.grant.periodFrom}〜{d.grant.periodTo}</div>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <button style={btn("#38a169")} disabled={props.busy || d.days <= 0} onClick={() => props.onGrant(s.staffId, d)}>付与する</button>{" "}
                <button style={btn("#718096", true)} disabled={props.busy} onClick={() => props.onSkip(s.staffId, d)}
                  title="出勤率が8割未満のときなど。0日の付与として残し、この知らせを出さないようにします">付与しない</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={hint}>
        出勤率は、Q で確定した勤怠から数えます（年休・特別休暇の日と、従業員の画面で入れた産休・育休・介護休業・業務上の負傷や疾病による休業の期間は
        出勤したものとみなし、公休にした日は全労働日に入れません。私傷病の休職などの「その他の休職」の日は、
        {otherLeaveRuleOf(props.rule) === "absent" ? "欠勤と同じに数えます" : "全労働日から除きます"}。会社設定の「休暇の種類」で変えられます）。
        Q を使う前の期間などで「確かめられません」のときは、出勤簿などで8割以上かを確かめてから付与してください。
        付与しない人（8割未満）は、0日の付与として残します（あとで取り消せます）。有効期限は付与日から2年です。
      </p>
    </div>
  );
}

export function FiveDayOverview(props: { items: StaffAnnualLeave[]; today: string }) {
  const [open, setOpen] = useState(true);
  const rows = props.items.flatMap((s) => fiveDayAlerts(s.fiveDays, props.today).map((f) => ({ s, f })))
    .sort((a, b) => (a.f.state === b.f.state ? a.f.to.localeCompare(b.f.to) : a.f.state === "overdue" ? -1 : 1));
  if (rows.length === 0) return null;
  const overdue = rows.filter((r) => r.f.state === "overdue").length;
  return (
    <div style={{ backgroundColor: overdue > 0 ? "#fff5f5" : "#fffbeb", border: `1px solid ${overdue > 0 ? "#fc8181" : "#f6ad55"}`, borderRadius: "10px", padding: "12px 18px", marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <b style={{ color: overdue > 0 ? "#9b2c2c" : "#9c4221" }}>
          年5日の取得：取らせる日数に足りない人が {rows.length}人{overdue > 0 && `（期間が過ぎた人 ${overdue}人）`}
        </b>
        <button style={{ ...btn("#718096", true), marginLeft: "auto" }} onClick={() => setOpen(!open)}>{open ? "閉じる" : "見る"}</button>
      </div>
      {open && (
        <>
          <table style={table}>
            <thead>
              <tr style={{ backgroundColor: "#f8fafc" }}>
                <th style={th}>名前</th><th style={th}>期間（付与日から1年）</th><th style={th}>取った日数 ／ 取らせる日数</th><th style={th}>あと</th><th style={th}>状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, f }) => (
                <tr key={`${s.staffId}-${f.from}`}>
                  <td style={td}>{s.name}（{s.staffId}）</td>
                  <td style={td}>
                    {f.from}〜{f.to}
                    {f.merged && <div style={small}>1年の期間が重なったので、まとめて按分（{f.months}か月{f.extraDays > 0 ? `と${f.extraDays}日` : ""}）</div>}
                  </td>
                  <td style={td}>{daysLabel(f.takenDays)} ／ {daysLabel(f.requiredDays)}</td>
                  <td style={td}>{daysLabel(f.remainingDays)}</td>
                  <td style={{ ...td, color: f.state === "overdue" ? "#c53030" : "#b45309", fontWeight: "bold" }}>
                    {f.state === "overdue" ? "期間が過ぎました" : `${f.to} まで（あと${daysUntil(props.today, f.to)}日）`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={hint}>
            年10日以上付与した人には、付与日（基準日）から1年以内に{OBLIGATION_DAYS}日を取らせます（労働基準法39条7項。会社の年度や1〜12月ではなく人ごと）。
            本人が取った年休（全休は1日、半休は0.5日）で足りないときは、会社が時季を決めて取らせます。時間単位の年休と特別休暇は、本人が取っても数えません。
            付与日をそろえて1年の期間が重なるときは、重なった期間をまとめて、その長さに応じた日数（月数 ÷ 12 × 5。例：18か月なら7.5日）にしています。
            日数は、半日単位（会社設定で半休を使わない会社は1日単位）に切り上げます（労働基準法施行規則24条の5第2項。比例按分）。
            10日を分けて付与したときは、合わせて10日になった日から1年で数えます（同4項）。
          </p>
        </>
      )}
    </div>
  );
}

const daysUntil = (today: string, to: string) => Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000));

export function StaffAnnualInfo(props: { info: StaffAnnualLeave | null; today: string }) {
  const { info } = props;
  if (!info) return null;
  return (
    <div style={{ backgroundColor: "white", padding: "14px 18px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px", fontSize: "13px" }}>
      <div style={{ marginBottom: "6px" }}>
        <b>次の付与：</b>
        {info.noJoinDate
          ? <span style={{ color: "#b45309" }}>入社日が入っていないので、付与日を出せません（従業員の画面で入社日を入れてください）。</span>
          : info.next
            ? <>{info.next.date} に {info.next.days}日（{stageLabel(info.next.stage)}{info.next.proportional ? "・比例付与" : ""}{info.next.date < info.next.legalDate ? `・法定の基準日 ${info.next.legalDate} を前倒し` : ""}。出勤率が8割以上のとき）</>
            : "なし（退職日まで）"}
      </div>
      <div>
        <b>年5日の取得：</b>
        {info.fiveDays.length === 0 && <span style={{ color: "#64748b" }}>10日以上の付与がまだないので、対象ではありません。</span>}
      </div>
      {info.fiveDays.length > 0 && (
        <table style={table}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc" }}>
              <th style={th}>付与</th><th style={th}>期間（付与日から1年）</th><th style={th}>取った日数 ／ 取らせる日数</th><th style={th}>状態</th>
            </tr>
          </thead>
          <tbody>
            {[...info.fiveDays].reverse().map((f) => (
              <tr key={f.from}>
                <td style={td}>{f.grants.map((g) => <div key={g.date}>{g.date}（{g.days}日）</div>)}</td>
                <td style={td}>
                  {f.from}〜{f.to}
                  {describeFiveDay(f).map((note) => <div key={note} style={small}>{note}</div>)}
                </td>
                <td style={td}>{daysLabel(f.takenDays)} ／ {daysLabel(f.requiredDays)}</td>
                <td style={{ ...td, fontWeight: "bold", color: stateColor(f) }}>{stateText(f, props.today)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {info.fiveDays.length > 0 && (
        <p style={hint}>取った日数は、Q で確定した勤怠（全休1日・半休0.5日）と、前に有給の画面で記録した取得から数えます。Q を使う前の期間は数えられません。</p>
      )}
    </div>
  );
}

const stateColor = (f: FiveDayStatus) => (f.state === "done" ? "#2f855a" : f.state === "overdue" ? "#c53030" : f.state === "ongoing" ? "#b45309" : "#94a3b8");
const stateText = (f: FiveDayStatus, today: string) =>
  f.state === "done" ? "取れました"
    : f.state === "overdue" ? `期間が過ぎました（${daysLabel(f.remainingDays)}足りません）`
      : f.state === "ongoing" ? `あと${daysLabel(f.remainingDays)}（${f.to} まで、あと${daysUntil(today, f.to)}日）`
        : "これから";

const hint: CSSProperties = { fontSize: "11px", color: "#64748b", margin: "8px 0 0", lineHeight: 1.6 };
const small: CSSProperties = { fontSize: "11px", color: "#64748b", lineHeight: 1.5, marginTop: "2px" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: "8px", backgroundColor: "white" };
const th: CSSProperties = { padding: "7px 10px", textAlign: "left", fontSize: "12px", color: "#64748b", borderBottom: "2px solid #e2e8f0" };
const td: CSSProperties = { padding: "7px 10px", fontSize: "13px", borderBottom: "1px solid #f1f5f9" };
const btn = (color: string, outline = false): CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px", border: `1px solid ${color}`, backgroundColor: outline ? "white" : color,
  color: outline ? color : "white", fontWeight: "bold", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap",
});
