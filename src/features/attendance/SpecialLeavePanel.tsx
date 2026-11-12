/**
 * 有給休暇管理の画面の、会社独自の休暇（特別休暇。夏季休暇など）の部分（くわしくは utils/specialLeave.ts）
 *
 * ・DueGrantBanner：発生の日が来て、まだ付与していない休暇の知らせ（会社全体）。チェックした人に付与するか、
 *   この回は付与しない（0日の付与として残す）
 * ・SpecialLeaveSection：選んだ人の、休暇の種類ごとの付与・取った日・残り・期限で消えた日数と、付与の登録
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  describeExpiryRule, describeGrantRule, expiryDateOf, formatLeaveDays, isValidLeaveDays, leaveTypeLabel,
  summarizeSpecialLeave, type DueGrant, type LeaveType, type SpecialLeaveDay, type SpecialLeaveGrantRow,
} from "../../utils/specialLeave";
import { formatLeaveMinutes, formatTakenAmount } from "../../utils/paidLeave";
const dueKey = (d: DueGrant) => `${d.type.id}:${d.grantDate}`;

// ── 発生の日が来た付与の知らせ ───────────────────────────────

export function DueGrantBanner(props: {
  dues: DueGrant[];
  busy: boolean;
  /** days が 0 なら「この回は付与しない」。登録したら true（チェックを初めに戻す） */
  onGrant: (due: DueGrant, staffIds: string[], days: number) => Promise<boolean> | boolean;
}) {
  // チェックを外した人（初めは全員にチェック）
  const [unchecked, setUnchecked] = useState<Record<string, string[]>>({});
  if (props.dues.length === 0) return null;
  return (
    <div style={{ backgroundColor: "#fffbeb", border: "1px solid #f6ad55", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
      <div style={{ fontWeight: "bold", color: "#9c4221", marginBottom: "8px" }}>🔔 発生の日が来た休暇があります（まだ付与していない人がいます）</div>
      {props.dues.map((due) => {
        const key = dueKey(due);
        const off = new Set(unchecked[key] ?? []);
        const selected = due.staff.filter((s) => !off.has(String(s.id))).map((s) => String(s.id));
        const toggle = (id: string) => setUnchecked((prev) => {
          const cur = new Set(prev[key] ?? []);
          if (cur.has(id)) cur.delete(id); else cur.add(id);
          return { ...prev, [key]: [...cur] };
        });
        const grant = async (days: number) => {
          if (await props.onGrant(due, selected, days)) setUnchecked((prev) => ({ ...prev, [key]: [] }));
        };
        return (
          <div key={key} style={{ backgroundColor: "white", borderRadius: "8px", padding: "10px 14px", marginBottom: "8px", border: "1px solid #fbd38d" }}>
            <div style={{ fontSize: "14px", color: "#2d3748" }}>
              <b>{leaveTypeLabel(due.type)}</b>：{due.grantDate} の付与（{formatLeaveDays(due.days)}・有効期限 {due.expiryDate}）
              <span style={{ fontSize: "12px", color: "#718096", marginLeft: "8px" }}>
                （{describeGrantRule(due.type.grantRule)}・{describeExpiryRule(due.type.expiryRule)}）
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: "120px", overflowY: "auto", margin: "8px 0", fontSize: "13px" }}>
              {due.staff.map((s) => (
                <label key={String(s.id)} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                  <input type="checkbox" checked={!off.has(String(s.id))} onChange={() => toggle(String(s.id))} />
                  {s.name}（{s.id}）
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <button style={btn("#38a169")} disabled={props.busy || selected.length === 0} onClick={() => grant(due.days)}>
                チェックした人（{selected.length}人）に付与する
              </button>
              <button style={btn("#718096", true)} disabled={props.busy || selected.length === 0} onClick={() => grant(0)}>
                チェックした人には、この回は付与しない
              </button>
            </div>
            <p style={hint}>
              付与しない人は、0日の付与として残します（この知らせを出さないため。あとで取り消せます）。
              日数を変える人は、ここで付与せずに、その人を選んで、付与日を {due.grantDate} にして日数を入れて登録してください。
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── 人ごとの特別休暇 ───────────────────────────────────────

export function SpecialLeaveSection(props: {
  types: LeaveType[];
  grants: SpecialLeaveGrantRow[];
  days: SpecialLeaveDay[];
  today: string;
  /** 時間単位の休暇の1日分の時間数（1日の所定労働時間を、1時間に満たない端数を切り上げた時間） */
  hoursPerDay: number;
  busy: boolean;
  onAddGrant: (input: { type: LeaveType; grantDate: string; expiryDate: string; days: number }) => void;
  /** usedText：その付与から引いていた日数・時間（「1日と3時間」。なければ ""） */
  onDeleteGrant: (type: LeaveType, grant: SpecialLeaveGrantRow, usedText: string) => void;
}) {
  const { types, grants, days, today, hoursPerDay } = props;
  const fmt = (minutes: number) => formatLeaveMinutes(minutes, hoursPerDay);
  const summaries = useMemo(
    () => types
      .map((t) => summarizeSpecialLeave(t, grants, days, today, hoursPerDay))
      .filter((s) => s.type.active || s.grants.length > 0 || s.taken.length > 0),
    [types, grants, days, today, hoursPerDay],
  );
  // 付与の登録（残りを数える種類だけ）
  const grantable = types.filter((t) => t.active && t.trackBalance);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [grantDate, setGrantDate] = useState(today);
  const [amount, setAmount] = useState("1");
  const [expiryDate, setExpiryDate] = useState("");
  const selectedType = grantable.find((t) => t.id === typeId) ?? grantable[0];
  useEffect(() => {
    if (!selectedType) return;
    setAmount(String(selectedType.grantRule?.days ?? 1));
  }, [selectedType?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedType) setExpiryDate(expiryDateOf(selectedType.expiryRule, grantDate));
  }, [selectedType?.id, grantDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!selectedType) return;
    props.onAddGrant({ type: selectedType, grantDate, expiryDate, days: Number(amount) });
  };
  const amountOk = isValidLeaveDays(amount);
  const datesOk = !!grantDate && !!expiryDate && expiryDate >= grantDate;

  return (
    <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "10px", border: "1px solid #e2e8f0", marginTop: "20px" }}>
      <h3 style={{ marginTop: 0, fontSize: "15px", borderLeft: "4px solid #dd6b20", paddingLeft: "10px", marginBottom: "10px" }}>
        会社独自の休暇（特別休暇）
      </h3>
      <p style={{ ...hint, marginTop: 0 }}>
        夏季休暇など、法定の年次有給休暇とは別の休暇です。休暇の種類は「会社設定」の「休暇の種類」で作ります。
        取った日は、勤怠の画面の区分で休暇を選んで確定してください（時間単位で取れる休暇は「時間休」に時間を入れます。確定した日をここで数えます）。
        時間単位の休暇は、1日の所定労働時間（1時間に満たない端数は切り上げ）を1日として数えます（この人は1日＝{hoursPerDay}時間）。年次有給休暇の年5日には数えません。
      </p>

      {types.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>
          休暇の種類がまだありません。「会社設定」の「休暇の種類」で作ると、ここで付与と残りを見られます。
        </div>
      ) : (
        <>
          {grantable.length > 0 && selectedType && (
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "8px", padding: "12px 14px", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: "#2f855a", marginBottom: "8px" }}>➕ 特別休暇の付与を登録</div>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 1fr auto", gap: "10px", alignItems: "end" }}>
                <div>
                  <label style={label}>休暇の種類</label>
                  <select style={input} value={selectedType.id} onChange={(e) => setTypeId(Number(e.target.value))}>
                    {grantable.map((t) => <option key={t.id} value={t.id}>{leaveTypeLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>付与日</label>
                  <input type="date" style={input} value={grantDate} onChange={(e) => setGrantDate(e.target.value)} />
                </div>
                <div>
                  <label style={label}>日数</label>
                  <input type="number" min="0.5" step="0.5" style={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <label style={label}>有効期限</label>
                  <input type="date" style={input} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                </div>
                <button style={btn("#38a169")} disabled={props.busy || !amountOk || !datesOk} onClick={submit}>登録する</button>
              </div>
              <p style={hint}>
                有効期限の初めの値は、休暇の種類の決まり（{describeExpiryRule(selectedType.expiryRule)}）から出します。
                {!amountOk && " 日数は、0.5日きざみの、0より大きい数で入れてください。"}
                {amountOk && !datesOk && " 有効期限は、付与日より前にできません。"}
              </p>
            </div>
          )}

          {summaries.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: "13px" }}>この人の特別休暇の付与・取った日は、まだありません。</div>
          )}
          {summaries.map((s) => (
            <div key={s.type.id} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                <b style={{ fontSize: "14px" }}>{leaveTypeLabel(s.type)}</b>
                {s.type.trackBalance ? (
                  <span style={{ fontSize: "13px" }}>今日の残り <b style={{ fontSize: "16px" }}>{s.hasGrants ? fmt(s.remainingMinutes) : "付与なし"}</b></span>
                ) : (
                  <span style={{ fontSize: "12px", color: "#64748b" }}>そのつど取る休暇（残りは数えません）</span>
                )}
                {s.type.trackBalance && (
                  <span style={{ fontSize: "12px", color: "#64748b" }}>発生：{describeGrantRule(s.type.grantRule)}・消滅：{describeExpiryRule(s.type.expiryRule)}</span>
                )}
                {!s.type.active && <span style={{ fontSize: "12px", color: "#94a3b8" }}>（使わない種類）</span>}
              </div>

              {s.shortages.length > 0 && (
                <div style={{ backgroundColor: "#fde8e8", color: "#9b1c1c", padding: "8px 12px", borderRadius: "6px", fontSize: "13px", marginTop: "8px" }}>
                  ⚠ 残りが足りない日があります（付与の前に取った日か、付与した日数より多く取った日）。付与を登録するか、勤怠を直してください：
                  {s.shortages.map((t) => `${t.date}（${fmt(t.shortageMinutes)}）`).join("、")}
                </div>
              )}

              {s.type.trackBalance && (
                <table style={table}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={th}>付与日</th><th style={th}>有効期限</th><th style={th}>付与日数</th><th style={th}>使った</th>
                      <th style={th}>期限で消えた</th><th style={th}>今日の残り</th><th style={th}>状態</th><th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.grants.length > 0 ? s.grants.map((g) => {
                      const row = grants.find((r) => r.id === g.grant.id)!;
                      const skipped = Number(g.grant.days_granted) === 0;
                      return (
                        <tr key={g.grant.id}>
                          <td style={td}>{g.grant.grant_date}</td>
                          <td style={td}>{g.grant.expiry_date}</td>
                          <td style={td}>{skipped ? <span style={{ color: "#94a3b8" }}>0日（付与しない）</span> : fmt(g.grantedMinutes)}</td>
                          <td style={td}>
                            {fmt(g.usedMinutes)}
                            {g.laterMinutes > 0 && <div style={{ fontSize: "11px", color: "#64748b" }}>このあと {fmt(g.laterMinutes)} 使う予定</div>}
                          </td>
                          <td style={{ ...td, color: g.expiredMinutes > 0 ? "#b45309" : "#cbd5e1" }}>{g.expiredMinutes > 0 ? fmt(g.expiredMinutes) : "-"}</td>
                          <td style={{ ...td, fontWeight: "bold", color: g.state === "active" ? "#2c3e50" : "#cbd5e1" }}>
                            {g.state === "active" ? fmt(g.remainingMinutes) : g.state === "upcoming" ? "（付与日から）" : "-"}
                          </td>
                          <td style={td}><span style={state(g.state)}>{g.state === "active" ? "使える" : g.state === "upcoming" ? "これから" : "期限切れ"}</span></td>
                          <td style={td}>
                            <button style={smallBtn("#e53e3e")} disabled={props.busy}
                              onClick={() => props.onDeleteGrant(s.type, row, g.usedMinutes + g.laterMinutes > 0 ? fmt(g.usedMinutes + g.laterMinutes) : "")}>取り消す</button>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>この休暇の付与は、まだありません</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {s.taken.length > 0 && (
                <table style={table}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={th}>取った日</th><th style={th}>日数・時間</th>{s.type.trackBalance && <th style={th}>引いた付与</th>}<th style={th}>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.taken].reverse().map((t) => (
                      <tr key={t.date}>
                        <td style={td}>{t.date}</td>
                        <td style={td}>{formatTakenAmount(t)}</td>
                        {s.type.trackBalance && (
                          <td style={td}>
                            {t.allocations.length > 0
                              ? t.allocations.map((a) => `${s.grants.find((g) => g.grant.id === a.grantId)?.grant.grant_date}の付与から${fmt(a.minutes)}`).join("、")
                              : "-"}
                          </td>
                        )}
                        <td style={td}>
                          {t.shortageMinutes > 0 && <div style={{ color: "#c53030", fontWeight: "bold" }}>残りが足りません（{fmt(t.shortageMinutes)}）</div>}
                          {t.afterAsOf && <div style={{ color: "#64748b" }}>今日より後の日（予定）</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const hint: CSSProperties = { fontSize: "11px", color: "#64748b", margin: "8px 0 0", lineHeight: 1.6 };
const label: CSSProperties = { fontSize: "11px", color: "#64748b", fontWeight: "bold", display: "block", marginBottom: "4px" };
const input: CSSProperties = { width: "100%", padding: "7px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: "10px" };
const th: CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: "12px", color: "#64748b", borderBottom: "2px solid #e2e8f0" };
const td: CSSProperties = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f5f9" };
const btn = (color: string, outline = false): CSSProperties => ({
  padding: "7px 14px", borderRadius: "6px", border: `1px solid ${color}`, backgroundColor: outline ? "white" : color,
  color: outline ? color : "white", fontWeight: "bold", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap",
});
const smallBtn = (color: string): CSSProperties => ({
  padding: "3px 10px", fontSize: "12px", borderRadius: "4px", border: `1px solid ${color}`, backgroundColor: "white", color, cursor: "pointer",
});
const state = (s: "upcoming" | "active" | "expired"): CSSProperties => {
  const color = s === "active" ? "#2f855a" : s === "upcoming" ? "#2b6cb0" : "#94a3b8";
  return { fontSize: "12px", fontWeight: "bold", color, border: `1px solid ${color}`, borderRadius: "10px", padding: "1px 8px" };
};
