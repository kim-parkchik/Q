/**
 * 「法定三帳簿」の画面の「年次有給休暇管理簿」のタブ（作り方は utils/leaveLedger.ts）
 * 付与（基準日）ごとに、取った日（時季）・日数・基準日を出す（労働基準法施行規則24条の7）。1人ずつ、または全員分を印刷・CSV に保存する
 * 「付与通知書」にすると、いちばん新しい付与の付与日・日数・有効期限・いま使える残り・年5日の期間を、1人1枚で印刷する（utils/leaveLedger.ts の buildGrantNotice）
 */
import { useEffect, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { fiveDaysOf, loadAnnualLeaveSettings } from "../../utils/annualLeaveOverview";
import { buildGrantNotice, buildLeaveLedger, leaveAmountLabel, leaveLedgerCsv, takenKindLabel, type LeaveLedger } from "../../utils/leaveLedger";
import { formatWareki } from "../../utils/wareki";
import { collectLeaveTaken, leaveHoursPerDay, loadPaidLeaveData, summarizePaidLeave } from "../../utils/paidLeave";
import { averageDailyHoursOf } from "../../utils/scheduledHours";

interface Props {
  db: Database;
  staffList: any[];
  saveCsv: (content: string, fileName: string) => Promise<void>;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function LeaveLedgerTab({ db, staffList, saveCsv }: Props) {
  const [who, setWho] = useState<string>("all");
  const [includeRetired, setIncludeRetired] = useState(false);
  const [mode, setMode] = useState<"ledger" | "notice">("ledger");
  const [company, setCompany] = useState<{ name: string; hourlyLeave: boolean }>({ name: "", hourlyLeave: false });
  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name, hourly_leave FROM company WHERE id = 1");
        setCompany({ name: String(c?.[0]?.name ?? ""), hourlyLeave: Number(c?.[0]?.hourly_leave ?? 0) === 1 });
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);
  const [data, setData] = useState<{ staffId: string; name: string; ledger: LeaveLedger; assumed: boolean }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    (async () => {
      try {
        const today = todayStr();
        const settings = await loadAnnualLeaveSettings(db);
        const targets = staffList.filter((s) => (who === "all" ? includeRetired || (s.status || "active") !== "retired" : String(s.id) === who));
        const out: { staffId: string; name: string; ledger: LeaveLedger; assumed: boolean }[] = [];
        for (const s of targets) {
          const { grants, attendance, manual } = await loadPaidLeaveData(db, String(s.id));
          const { taken } = collectLeaveTaken(attendance, manual);
          // 時間単位の有給の1日の時間数（曜日で時間が違う人は1日平均。労基則24条の4）
          const { hours, assumed } = leaveHoursPerDay(averageDailyHoursOf(s));
          const summary = summarizePaidLeave(grants, taken, hours, today);
          const ledger = buildLeaveLedger(summary, fiveDaysOf(s, grants, taken, today, settings));
          if (who === "all" && ledger.grants.length === 0) continue;
          out.push({ staffId: String(s.id), name: String(s.name ?? ""), ledger, assumed });
        }
        if (!cancelled) setData(out);
      } catch (e) {
        console.error("年次有給休暇管理簿の読み込みエラー:", e);
        if (!cancelled) setData([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staffList, who, includeRetired]);

  const stamp = todayStr().replace(/-/g, "");
  return (
    <div style={card}>
      <div className="no-print" style={controls}>
        <label style={field}>
          <span style={labelStyle}>作るもの</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "ledger" | "notice")} style={input}>
            <option value="ledger">年次有給休暇管理簿</option>
            <option value="notice">年次有給休暇 付与通知書（1人1枚）</option>
          </select>
        </label>
        <label style={field}>
          <span style={labelStyle}>従業員</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} style={input}>
            <option value="all">全員（年次有給休暇を付与した人）</option>
            {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}{(s.status || "active") === "retired" ? "（退職）" : ""}</option>)}
          </select>
        </label>
        {who === "all" && (
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
            退職した人も入れる
          </label>
        )}
        <button onClick={() => window.print()} disabled={!data || data.length === 0} style={button("#2563eb", !data || data.length === 0)}>印刷する</button>
        {mode === "ledger" && (
          <button disabled={!data || data.length === 0} onClick={() => data && saveCsv(leaveLedgerCsv(data), `年次有給休暇管理簿_${stamp}.csv`)}
            style={button("#16a085", !data || data.length === 0)}>CSV に保存</button>
        )}
      </div>
      {mode === "notice" ? (
        <>
          <div className="no-print" style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 10 }}>
            いちばん新しい付与（有効期限が切れていないもの）について、付与日・付与日数・有効期限と、今日の時点で使える残り（前の付与から繰り越した分を含む）、
            年5日の取得の期間を、1人1枚で印刷します。従業員に渡して、有給休暇を計画的に取ってもらうためのお知らせです（法律で決まった様式はありません）。
          </div>
          <div id="legal-book-print">
            {data === null ? <div style={small}>読み込んでいます…</div>
              : data.length === 0 ? <div style={small}>年次有給休暇の付与が登録されている人がいません（有給休暇管理の画面で付与を入れます）。</div>
              : data.map((p) => <GrantNoticeSheet key={p.staffId} name={p.name} ledger={p.ledger} company={company.name} hourlyLeave={company.hourlyLeave} />)}
          </div>
        </>
      ) : (<>
      <div className="no-print" style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 10 }}>
        年次有給休暇を与えたときは、時季（取った日）・日数・基準日を労働者ごとに明らかにした年次有給休暇管理簿を作り、
        与えた期間中とその後5年間（当分の間は3年間）保存します（労働基準法施行規則24条の7・附則71条）。労働者名簿・賃金台帳とあわせて作ってもかまいません（同55条の2）。
        取った日は、有給休暇管理の画面と同じく、確定した勤怠の「全休(有給)」「半休(有給)」「時間有給」から数え、期限の早い付与から引きます。
      </div>
      <div id="legal-book-print">
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>年次有給休暇管理簿（{todayStr()} 現在）</h2>
        {data === null ? <div style={small}>読み込んでいます…</div>
          : data.length === 0 ? <div style={small}>年次有給休暇の付与が登録されている人がいません（有給休暇管理の画面で付与を入れます）。</div>
          : data.map((p) => <PersonLedger key={p.staffId} staffId={p.staffId} name={p.name} ledger={p.ledger} assumed={p.assumed} />)}
      </div>
      </>)}
    </div>
  );
}

/** 年次有給休暇の付与通知書（1人1枚） */
function GrantNoticeSheet({ name, ledger, company, hourlyLeave }: { name: string; ledger: LeaveLedger; company: string; hourlyLeave: boolean }) {
  const notice = buildGrantNotice(ledger, hourlyLeave);
  const amount = (m: number) => leaveAmountLabel(m, ledger.dayMinutes);
  if (!notice) {
    return <div className="no-print" style={{ ...small, marginBottom: 8 }}>{name}：有効期限が切れていない付与がありません。</div>;
  }
  const g = notice.grant;
  const row = (label: string, value: string) => (
    <tr><th style={{ ...th, width: 200, whiteSpace: "normal" }}>{label}</th><td style={{ ...td, fontSize: 13 }}>{value}</td></tr>
  );
  return (
    <div style={{ breakAfter: "page", breakInside: "avoid", padding: "8px 4px 24px", borderBottom: "1px dashed #cbd5e1", marginBottom: 16 } as CSSProperties}>
      <div style={{ textAlign: "right", fontSize: 12 }}>{formatWareki(ledger.asOf)}</div>
      <div style={{ fontSize: 14, marginTop: 4 }}>{name} 殿</div>
      <div style={{ textAlign: "right", fontSize: 12 }}>{company}</div>
      <h2 style={{ textAlign: "center", fontSize: 18, letterSpacing: 4, margin: "12px 0" }}>年次有給休暇 付与通知書</h2>
      <p style={{ fontSize: 13, lineHeight: 1.8 }}>
        {g.state === "upcoming" ? "次のとおり年次有給休暇を付与しますので、お知らせします。" : "次のとおり年次有給休暇を付与しましたので、お知らせします。"}
      </p>
      <table style={{ ...table, marginBottom: 10 }}>
        <tbody>
          {row("付与日（基準日）", formatWareki(g.grantDate))}
          {row("付与日数", `${g.grantedDays}日`)}
          {row("有効期限", `${formatWareki(g.expiryDate)}まで（付与日から2年で消えます）`)}
          {row("前の付与から繰り越した残り", amount(notice.carriedMinutes))}
          {row(`使える日数の合計（${formatWareki(ledger.asOf)}現在）`, amount(notice.totalMinutes))}
          {g.state === "active" && g.takenMinutes > 0 && row("今回付与した分から、すでに取った日数", amount(g.takenMinutes))}
        </tbody>
      </table>
      {g.fiveDays && (
        <p style={{ fontSize: 13, lineHeight: 1.8, margin: "6px 0" }}>
          ・{formatWareki(g.fiveDays.from)}から{formatWareki(g.fiveDays.to)}までの間に、{g.fiveDays.requiredDays}日以上の年次有給休暇を取ってください
          （年10日以上付与される人は、1年に5日以上取ることが法律で決まっています。労働基準法39条7項）。
          {g.fiveDays.state !== "upcoming" && `いままでに取った日数は ${g.fiveDays.takenDays}日です。`}
        </p>
      )}
      {notice.hourlyLimitHours !== null && (
        <p style={{ fontSize: 13, lineHeight: 1.8, margin: "6px 0" }}>
          ・時間単位で取れるのは、1年に5日分（{notice.hourlyLimitHours}時間）までです。
        </p>
      )}
      <p style={{ fontSize: 13, lineHeight: 1.8, margin: "6px 0" }}>・取るときは、前もって申し出てください。繰り越した分から先に使います。</p>
    </div>
  );
}

function PersonLedger({ staffId, name, ledger, assumed }: { staffId: string; name: string; ledger: LeaveLedger; assumed: boolean }) {
  const amount = (m: number) => leaveAmountLabel(m, ledger.dayMinutes);
  return (
    <div style={{ marginBottom: 16, breakInside: "avoid" } as CSSProperties}>
      <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4 }}>
        {name}（{staffId}）<span style={{ ...small, fontWeight: "normal", marginLeft: 8 }}>時間単位の有給は {ledger.hoursPerDay}時間を1日として数えます{assumed ? "（1日の所定労働時間が入っていないので8時間）" : ""}</span>
      </div>
      {ledger.grants.length === 0 ? <div style={small}>年次有給休暇の付与がありません。</div> : (
        <div style={{ overflowX: "auto" }}>
        <table style={table}>
          <thead>
            <tr>{["基準日（付与日）", "有効期限", "付与日数", "取った日（時季）と日数", "取った合計", "期限で消えた", "残り", "年5日の取得"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {ledger.grants.map((g) => (
              <tr key={g.grantDate}>
                <td style={tdNowrap}>{g.grantDate}</td>
                <td style={tdNowrap}>{g.expiryDate}</td>
                <td style={{ ...td, textAlign: "right" }}>{g.grantedDays}日</td>
                <td style={td}>
                  {g.taken.length === 0 ? "—" : g.taken.map((t) => `${t.date.slice(5).replace("-", "/")} ${takenKindLabel(t)}${t.split ? `（この付与から${amount(t.minutes)}）` : ""}`).join("、")}
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{amount(g.takenMinutes)}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{g.expiredMinutes > 0 ? amount(g.expiredMinutes) : ""}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{g.state === "active" ? amount(g.remainingMinutes) : g.state === "upcoming" ? "付与日の前" : "期限切れ"}</td>
                <td style={td}>
                  {g.fiveDays ? (
                    <div style={{ color: g.fiveDays.state === "overdue" ? "#b91c1c" : g.fiveDays.state === "done" ? "#15803d" : undefined }}>
                      <div style={{ whiteSpace: "nowrap" }}>{g.fiveDays.from}〜{g.fiveDays.to}</div>
                      <div style={{ whiteSpace: "nowrap" }}>{g.fiveDays.takenDays}日{g.fiveDays.state === "done" ? "（取れた）" : g.fiveDays.state === "overdue" ? "（足りない）" : g.fiveDays.state === "upcoming" ? "" : `（あと${g.fiveDays.remainingDays}日）`}</div>
                    </div>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {ledger.beforeFirstGrant.length > 0 && (
        <div style={{ ...small, marginTop: 4 }}>最初の付与より前に取った日（Q で有給を管理する前の分。どの付与からも引いていません）：{ledger.beforeFirstGrant.map((t) => t.date).join("、")}</div>
      )}
      {ledger.shortage.length > 0 && (
        <div style={{ ...small, marginTop: 4, color: "#b91c1c" }}>残りが足りなくて引けなかった日：{ledger.shortage.map((t) => `${t.date}（${amount(t.minutes)}）`).join("、")}</div>
      )}
    </div>
  );
}

const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelStyle: CSSProperties = { fontSize: 12, color: "#64748b" };
const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: CSSProperties = { textAlign: "left", padding: "5px 6px", border: "1px solid #cbd5e1", backgroundColor: "#f1f5f9", fontSize: 11, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "4px 6px", border: "1px solid #e2e8f0", verticalAlign: "top" };
const tdNowrap: CSSProperties = { ...td, whiteSpace: "nowrap" };
const small: CSSProperties = { fontSize: 11, color: "#64748b" };
const button = (color: string, disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: color, color: "white", fontWeight: "bold", fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
});
