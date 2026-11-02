/**
 * 養育期間の標準報酬月額の特例（養育期間の従前標準報酬月額のみなし措置。厚生年金保険法26条）
 * 3歳未満の子を養育する人の申出を登録し、どの月の標準報酬月額が、年金額の計算で従前標準報酬月額とみなされるかを出す。
 * 判定のきまりは utils/youikuTokurei.ts
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { Plus, Trash2 } from "lucide-react";
import { useYouikuTokureiManager } from "./useYouikuTokureiManager";
import { YOUIKU_END_REASON_LABELS, type YouikuEntry, type YouikuJudgement, type YouikuMonth } from "../../utils/youikuTokurei";
import { parseLeavePeriods } from "../../utils/leaveExemption";
import { LEAVE_TYPE_LABELS } from "../../utils/leaveEndRevision";

interface Props {
  db: Database;
  staffList: any[];
  onDataChange: () => void;
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const h3: React.CSSProperties = { margin: "0 0 10px 0", fontSize: 15 };
const th: React.CSSProperties = { padding: "8px 6px", fontSize: 12, color: "#64748b", borderBottom: "2px solid #eee", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 13, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "8px 0 0 0", lineHeight: 1.7 };
const label: React.CSSProperties = { display: "block", fontSize: 11, color: "#64748b", marginBottom: 2 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
const select: React.CSSProperties = { padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
const smallButton: React.CSSProperties = { padding: "3px 8px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", fontSize: 11, color: "#475569", cursor: "pointer" };
const primaryButton: React.CSSProperties = { padding: "6px 12px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", fontSize: 12, backgroundColor: "#2563eb", cursor: "pointer", whiteSpace: "nowrap" };

const yen = (n: number | null) => (n === null ? "—" : `${n.toLocaleString()}円`);
const ymLabel = (m: { year: number; month: number } | null) => (m ? `${m.year}年${m.month}月` : "—");
const dateLabel = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${y}年${m}月${d}日`; };

export default function YouikuTokureiManager({ db, staffList, onDataChange }: Props) {
  const z = useYouikuTokureiManager(db, staffList, onDataChange);

  return (
    <div style={{ maxWidth: 1250, margin: "0 auto" }}>
      <div style={card}>
        <p style={{ ...note, marginTop: 0, color: "#334155" }}>
          3歳未満の子を養育する人の標準報酬月額が、短時間勤務などで養育を始める前より下がったとき、本人が申し出れば、
          将来の年金額は下がる前の標準報酬月額（従前標準報酬月額）で計算されます（厚生年金保険法26条）。
          保険料は下がった標準報酬月額のまま計算するので、給与から引く額は変わりません。健康保険には関係しません。男性も対象です。
        </p>
        <p style={note}>
          申出は、本人から事業主を経由して「厚生年金保険 養育期間標準報酬月額特例申出書」を年金事務所（事務センター）に出します（退職した人は本人が直接出せます）。
          申出をした月より前の月は、申出をした月の前月までの2年間しかさかのぼれません。
          産休・育休で保険料が免除される間は特例を受けられないので、休業が終わった人は、休業の終了日の翌日を「養育特例開始年月日」にして、終わった後に申出書を出します
          （子の生年月日を書く誤りが多いと、日本年金機構が注意しています）。
          比べるのは厚生年金の標準報酬月額です（健康保険の額を、その月の厚生年金の上限・下限に合わせます）。
        </p>
      </div>

      <div style={card}>
        <h3 style={h3}>申出ができそうな人</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>氏名</th>
                <th style={th}>休業</th>
                <th style={th}>養育特例開始年月日</th>
                <th style={th}>基準月の標準報酬月額</th>
                <th style={th}>今の標準報酬月額</th>
                <th style={th}>下回る月</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {z.candidates.length === 0 && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>いません</td></tr>
              )}
              {z.candidates.map((c) => (
                <tr key={`${c.staff.id}-${c.nextDay}`}>
                  <td style={{ ...td, fontWeight: "bold" }}>{c.staff.name}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {LEAVE_TYPE_LABELS[c.leave.type]}
                    <div style={{ fontSize: 11, color: "#64748b" }}>{dateLabel(c.leave.start)}〜{dateLabel(c.leave.end)}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{dateLabel(c.nextDay)}<div style={{ fontSize: 11, color: "#64748b" }}>休業の終了日の翌日</div></td>
                  <td style={td}>{yen(c.basis)}</td>
                  <td style={td}>{yen(c.current)}</td>
                  <td style={td}>{c.lowerCount}か月</td>
                  <td style={td}><button onClick={() => z.registerCandidate(c)} style={primaryButton}>特例を登録する</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={note}>
          従業員画面に入れた産休・育休（保険料が免除されるもの）が3年以内に終わり、その後の厚生年金の標準報酬月額が、休業が終わった月の前月より下がっている人を出します。
          申出をするかは本人が決めるので、本人に知らせてください。休業を取らずに養育を始めて給与が下がった人（父親など）は出ないので、下の「特例を登録・確認する」で登録してください。
        </p>
      </div>

      <div style={card}>
        <h3 style={h3}>登録した特例</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>氏名</th>
                <th style={th}>子</th>
                <th style={th}>期間</th>
                <th style={th}>基準月の標準報酬月額</th>
                <th style={th}>みなされる月</th>
                <th style={th}>申出</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {z.overview.length === 0 && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>まだ登録していません</td></tr>
              )}
              {z.overview.map(({ staff, judgement: j }) => (
                <tr key={`${staff.id}-${j.index}`}>
                  <td style={{ ...td, fontWeight: "bold" }}>{staff.name}</td>
                  <td style={td}>{j.entry.childName || "（氏名なし）"}{j.entry.childBirthday && <div style={{ fontSize: 11, color: "#64748b" }}>{dateLabel(j.entry.childBirthday)}生</div>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {j.error ? <span style={{ color: "#dc2626" }}>{j.error}</span> : <>
                      {ymLabel(j.startYm)}分〜{ymLabel(j.lastYm)}分
                      <div style={{ fontSize: 11, color: "#64748b" }}>{j.ended ? "終わりました：" : ""}{j.endReason && YOUIKU_END_REASON_LABELS[j.endReason]}</div>
                    </>}
                  </td>
                  <td style={td}>{yen(j.basis)}</td>
                  <td style={td}>{j.deemedCount}か月{j.tooOldCount > 0 && <div style={{ fontSize: 11, color: "#b45309" }}>2年より前の{j.tooOldCount}か月はみなされない</div>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {j.entry.appliedOn ? dateLabel(j.entry.appliedOn) : <span style={{ color: "#b45309" }}>まだ</span>}
                    {j.needsEndReport && <div style={{ fontSize: 11, color: "#dc2626" }}>終了届が要る</div>}
                  </td>
                  <td style={td}><button onClick={() => z.selectStaff(String(staff.id))} style={smallButton}>開く</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>特例を登録・確認する</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select value={z.selectedId} onChange={(e) => z.selectStaff(e.target.value)} style={select}>
            <option value="">従業員を選んでください</option>
            {staffList.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.id} {s.name}{s.retirement_date && s.retirement_date < z.today ? "（退職）" : ""}</option>
            ))}
          </select>
          {z.selectedStaff && (
            <>
              <button onClick={z.addEntry} style={{ ...smallButton, display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", fontSize: 12 }}>
                <Plus size={14} /> 子を追加
              </button>
              <button onClick={z.save} disabled={!z.isDirty || z.isSaving} style={{ ...primaryButton, opacity: !z.isDirty || z.isSaving ? 0.5 : 1 }}>保存</button>
              {z.isDirty && <button onClick={z.cancel} style={{ ...smallButton, padding: "6px 10px", fontSize: 12 }}>変更を取り消す</button>}
              {z.isDirty && <span style={{ fontSize: 12, color: "#b45309" }}>保存していない変更があります</span>}
            </>
          )}
        </div>
        {z.selectedStaff && z.draft.length === 0 && (
          <p style={note}>まだ登録していません。「子を追加」から、申出書の内容を入れてください。</p>
        )}
        {z.selectedStaff && z.judgements.map((j) => (
          <EntryEditor key={j.index} staff={z.selectedStaff} j={j} z={z} />
        ))}
      </div>
    </div>
  );
}

function EntryEditor({ staff, j, z }: { staff: any; j: YouikuJudgement; z: ReturnType<typeof useYouikuTokureiManager> }) {
  const e = j.entry;
  const set = (patch: Partial<YouikuEntry>) => z.updateEntry(j.index, patch);
  // 養育特例開始年月日の候補：子の生年月日・入社日・保険料が免除される休業の終了日の翌日
  const leaveEnds = parseLeavePeriods(staff.leave_periods)
    .filter((l) => l.end && (!e.childBirthday || l.end >= e.childBirthday))
    .map((l) => ({ label: `${LEAVE_TYPE_LABELS[l.type]}の終了日の翌日`, date: nextDay(l.end) }));
  const hasExempt = j.months.some((m) => m.exempt);

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
        <div><label style={label}>子の氏名</label><input value={e.childName} onChange={(ev) => set({ childName: ev.target.value })} style={input} /></div>
        <div><label style={label}>子の生年月日</label><input type="date" value={e.childBirthday} onChange={(ev) => set({ childBirthday: ev.target.value })} style={input} /></div>
        <div><label style={label}>養育特例開始年月日</label><input type="date" value={e.start} onChange={(ev) => set({ start: ev.target.value })} style={input} /></div>
        <div><label style={label}>申出日（まだなら空）</label><input type="date" value={e.appliedOn} onChange={(ev) => set({ appliedOn: ev.target.value })} style={input} /></div>
        <div><label style={label}>子が死亡した・養育しなくなった日</label><input type="date" value={e.endDate} onChange={(ev) => set({ endDate: ev.target.value })} style={input} /></div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={label}>入社前の会社の基準月の額</label>
            <input type="number" min={0} value={e.basisOverride ?? ""} placeholder="使わなければ空"
              onChange={(ev) => set({ basisOverride: Number(ev.target.value) > 0 ? Math.floor(Number(ev.target.value)) : null })} style={input} />
          </div>
          <button type="button" onClick={() => z.removeEntry(j.index)} title="この子の特例を消す"
            style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: 7, cursor: "pointer", color: "#94a3b8" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, fontSize: 11, color: "#64748b", alignItems: "center" }}>
        養育特例開始年月日を：
        {e.childBirthday && <button style={smallButton} onClick={() => set({ start: e.childBirthday })}>子の生年月日（{dateLabel(e.childBirthday)}）</button>}
        {staff.join_date && <button style={smallButton} onClick={() => set({ start: staff.join_date })}>入社日（{dateLabel(staff.join_date)}）</button>}
        {leaveEnds.map((l) => <button key={l.date} style={smallButton} onClick={() => set({ start: l.date })}>{l.label}（{dateLabel(l.date)}）</button>)}
      </div>

      {j.error ? (
        <p style={{ ...note, color: "#dc2626" }}>{j.error}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
            <div>
              <div style={label}>基準月・従前標準報酬月額</div>
              {j.basis === null ? (
                <span style={{ color: "#dc2626" }}>基準月がありません</span>
              ) : (
                <><b>{yen(j.basis)}</b>（{basisText(j)}）</>
              )}
            </div>
            <div>
              <div style={label}>特例の期間</div>
              {ymLabel(j.startYm)}分〜{ymLabel(j.lastYm)}分（{j.endReason && YOUIKU_END_REASON_LABELS[j.endReason]}{j.ended ? "。終わりました" : ""}）
            </div>
            <div>
              <div style={label}>みなされる月（今月まで）</div>
              <b>{j.deemedCount}か月</b>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
            {j.months.map((m) => <MonthCell key={`${m.year}-${m.month}`} m={m} />)}
          </div>

          <ul style={{ ...note, paddingLeft: 18 }}>
            {j.basis === null && (
              <li style={{ color: "#dc2626" }}>
                養育開始月の前月と、その前1年以内に、この会社で厚生年金に入っていた月がありません。入社前の会社で入っていたときは、その会社での基準月の標準報酬月額を入れてください
                （1年以内に厚生年金に入っていた月がなければ、特例は受けられません）。
              </li>
            )}
            {!e.appliedOn && j.deemedCount > 0 && <li style={{ color: "#b45309" }}>まだ申し出ていません。申出書を出したら、申出日を入れてください。</li>}
            {j.tooOldCount > 0 && (
              <li style={{ color: "#b45309" }}>
                {e.appliedOn ? "申出をした月" : "今月に申し出ても、申出をする月"}の前月までの2年間より前の{j.tooOldCount}か月は、下回っていてもみなされません。
              </li>
            )}
            {hasExempt && <li>産休・育休で保険料が免除される月（「免除」）は、特例を受けられません。休業が終わった後に申し出るときは、休業の終了日の翌日を養育特例開始年月日にします。</li>}
            {j.needsEndReport && <li style={{ color: "#dc2626" }}>子が死亡した・子を養育しなくなったので、「養育期間標準報酬月額特例終了届」を速やかに出してください。</li>}
            {j.endReason === "childcare_leave" || j.endReason === "maternity_leave" ? (
              <li>休業を始めたので、特例は終わります（終了届は要りません）。休業が終わった後も特例を受けるときは、改めて申出書を出します。</li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}

const basisText = (j: YouikuJudgement) => {
  switch (j.basisSource) {
    case "prev_month": return `${ymLabel(j.basisYm)}分。養育開始月の前月`;
    case "within_year": return `${ymLabel(j.basisYm)}分。前月は厚生年金に入っていないので、その前1年以内の直近の月`;
    case "override": return "入社前の会社の基準月の額（手で入れた額）";
    case "other_child": return `${ymLabel(j.basisYm)}分。${j.basisFromChild}さんの特例でみなされている額`;
    default: return "";
  }
};

function MonthCell({ m }: { m: YouikuMonth }) {
  const [text, color, bg] =
    m.actual === null ? ["未加入", "#94a3b8", "#f8fafc"]
      : m.exempt ? ["免除", "#64748b", "#f1f5f9"]
        : m.deemed ? ["みなし", "#1d4ed8", "#dbeafe"]
          : m.lower && m.tooOld ? ["2年より前", "#b45309", "#fef3c7"]
            : ["下回らない", "#64748b", "#ffffff"];
  return (
    <div style={{ width: 78, border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 4px", backgroundColor: bg, fontSize: 10, lineHeight: 1.4 }}>
      <div style={{ color: "#475569" }}>{m.year}年{m.month}月</div>
      <div style={{ fontSize: 11 }}>{m.actual === null ? "—" : `${(m.actual / 10000).toLocaleString()}万円`}</div>
      <div style={{ color, fontWeight: m.deemed ? "bold" : "normal" }}>{text}</div>
    </div>
  );
}

const nextDay = (date: string) => dayjs(date).add(1, "day").format("YYYY-MM-DD");
