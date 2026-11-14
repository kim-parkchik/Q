/**
 * 「平均賃金」の画面（労働基準法12条）
 * 従業員・何に使うか・できごとの日を選ぶと、直前の締日から3か月の確定した給与で平均賃金を計算し、内訳と、
 * それを使う額（休業手当・休業補償・解雇予告手当）を出す。印刷できる。Q で計算できないときは、平均賃金を手で入れられる
 * （手で入れた額は、給与明細の休業手当・休業補償にも使う）。計算は utils/averageWage.ts
 */
import { useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import {
  averageWageAmount, dismissalAllowanceDays, dismissalNoticeDays, formatSen, INJURY_COMPENSATION_RATE, INJURY_WAITING_DAYS,
  mdJa, perDayOf, roundYen, ymdJa, yenText, type AverageWageResult,
} from "../../utils/averageWage";
import {
  AVERAGE_WAGE_EVENT_LABELS, AVERAGE_WAGE_PURPOSE_LABELS, useAverageWageManager, type AverageWagePurpose,
} from "./useAverageWageManager";

interface Props {
  db: Database;
  staffList: any[];
}

const yen = (n: number) => `${Math.round(n).toLocaleString()}円`;

export default function AverageWageManager({ db, staffList }: Props) {
  const z = useAverageWageManager(db, staffList);
  const r = z.result;
  const sorted = [...staffList].sort((a, b) => String(a.id).localeCompare(String(b.id), "ja", { numeric: true }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{PRINT_STYLE}</style>
      <div style={card} className="no-print">
        <h3 style={title}>平均賃金（労働基準法12条）</h3>
        <p style={note}>
          休業手当・休業補償・解雇予告手当などに使う、1日あたりの賃金です。できごとの日の前の締日から3か月に払った賃金の総額を、その3か月の暦日数で割ります（1銭未満切り捨て）。
          日給・時給の人は、賃金の総額を働いた日数で割った額の60%（最低保障）とも比べて、高いほうにします。
          Q は、確定した給与（賃金台帳の内訳）と勤怠から計算します。賞与と、給与項目設定で「入れない」にした臨時の賃金は入れません。
          業務上のけが・病気の休業・産休・育休・介護休業・会社都合の休業・試用期間（従業員の画面で入れた期間）は、日数からも賃金からも除きます。
        </p>
        <div style={controls}>
          <label style={field}>
            <span style={label}>従業員</span>
            <select value={z.staffId} onChange={(e) => z.setStaffId(e.target.value)} style={{ ...input, minWidth: 200 }}>
              <option value="">（選んでください）</option>
              {sorted.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.id} {s.name}{s.status === "retired" ? "（退職）" : ""}</option>
              ))}
            </select>
          </label>
          <label style={field}>
            <span style={label}>何に使うか</span>
            <select value={z.purpose} onChange={(e) => z.setPurpose(e.target.value as AverageWagePurpose)} style={input}>
              {(Object.keys(AVERAGE_WAGE_PURPOSE_LABELS) as AverageWagePurpose[]).map((p) => (
                <option key={p} value={p}>{AVERAGE_WAGE_PURPOSE_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label style={field}>
            <span style={label}>{AVERAGE_WAGE_EVENT_LABELS[z.purpose]}</span>
            <input type="date" value={z.eventDate} onChange={(e) => z.setEventDate(e.target.value)} style={input} />
          </label>
          {z.purpose === "dismissal" && (
            <label style={field}>
              <span style={label}>解雇の日</span>
              <input type="date" value={z.dismissalDate} onChange={(e) => z.setDismissalDate(e.target.value)} style={input} />
            </label>
          )}
          {z.purpose === "shutdown" && (
            <label style={field}>
              <span style={label}>休ませた日数</span>
              <input type="number" min={1} value={z.shutdownDays} onChange={(e) => z.setShutdownDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ ...input, width: 80 }} />
            </label>
          )}
          {r && <button onClick={() => window.print()} style={button("#2563eb")}>印刷する</button>}
        </div>
        {z.purpose === "shutdown" && (
          <p style={small}>
            給与明細では、勤怠の区分を「休業（会社都合）」にした日に、休業手当を自動で入れます（続けて休ませたときは、その初めの日の平均賃金）。この画面は、額を前もって確かめるときに使います。
          </p>
        )}
        {z.purpose === "injury" && (
          <p style={small}>
            給与明細では、従業員の画面の「休業・休職」で「業務上の負傷・疾病による休業」を入れると、最初の3日の休業補償を自動で入れます。4日目からは、労災保険に休業補償給付を請求します。
          </p>
        )}
      </div>

      {!z.staff || !z.eventDate ? (
        <div style={{ ...card, color: "#94a3b8", fontSize: 13 }} className="no-print">従業員と、{AVERAGE_WAGE_EVENT_LABELS[z.purpose]}を選んでください。</div>
      ) : z.loading && !r ? (
        <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>計算しています…</div>
      ) : r ? (
        <div id="average-wage-print" style={card}>
          <h3 style={title}>平均賃金の計算（{z.staff.id} {z.staff.name}さん）</h3>
          <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 8 }}>
            {AVERAGE_WAGE_PURPOSE_LABELS[z.purpose]}・{AVERAGE_WAGE_EVENT_LABELS[z.purpose]}：{ymdJa(r.eventDate)}
            {r.from && r.to && <>　算定期間：{ymdJa(r.from)}〜{ymdJa(r.to)}（直前の締日 {ymdJa(r.closingDate)} から3か月）</>}
          </div>
          {r.periods.length > 0 && <PeriodTable r={r} />}
          <Formulas r={r} />
          <Amounts r={r} purpose={z.purpose} shutdownRate={z.shutdownRate} shutdownDays={z.shutdownDays} dismissalDate={z.dismissalDate} />
          <p style={{ ...small, marginTop: 10 }}>
            賞与（3か月を超える期間ごとに払う賃金）は入れていません。年4回以上払う賞与があるときや、通達などで扱いが違うときは、労働基準監督署に確かめて、下で平均賃金を手で入れてください。
            出典：労働基準法12条・神奈川労働局「平均賃金について」。
          </p>
        </div>
      ) : null}

      {r && z.staff && <ManualCard key={`${z.staff.id}:${r.eventDate}`} r={r} busy={z.busy} onSave={z.saveManual} onDelete={z.deleteManual} />}
    </div>
  );
}

/** 3か月の賃金計算期間ごとの内訳 */
function PeriodTable({ r }: { r: AverageWageResult }) {
  const totalCalendar = r.periods.reduce((s, p) => s + p.days, 0);
  const totalExcluded = r.periods.reduce((s, p) => s + p.excludedDays, 0);
  const totalNot = r.periods.reduce((s, p) => s + p.notIncluded, 0);
  const notes = r.periods.flatMap((p) => p.notes.map((n) => `${mdJa(p.from)}〜${mdJa(p.to)}：${n}`));
  return (
    <>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>賃金計算期間</th><th style={th}>給与</th><th style={th}>暦日数</th><th style={th}>除いた日</th>
            <th style={th}>月で決まる賃金</th><th style={th}>日・時間・出来高で決まる賃金</th><th style={th}>入れなかった賃金</th><th style={th}>働いた日</th>
          </tr>
        </thead>
        <tbody>
          {r.periods.map((p) => (
            <tr key={p.start}>
              <td style={tdNowrap}>{mdJa(p.from)}〜{mdJa(p.to)}{p.from !== p.start && <div style={small}>（入社した日から）</div>}</td>
              <td style={tdNowrap}>{p.payYear}年{p.payMonth}月支給{!p.confirmed && <span style={{ color: "#dc2626" }}>（未確定）</span>}</td>
              <td style={tdRight}>{p.days}日</td>
              <td style={td}>{p.excludedDays > 0 ? <>{p.excludedDays}日<div style={small}>{p.excludedReasons.join("・")}</div></> : "—"}</td>
              <td style={tdRight}>{yen(p.monthWages)}</td>
              <td style={tdRight}>{yen(p.timeWages)}</td>
              <td style={tdRight}>{p.notIncluded ? yen(p.notIncluded) : "—"}</td>
              <td style={tdRight}>{p.workedDays}日</td>
            </tr>
          ))}
          <tr style={{ backgroundColor: "#f8fafc", fontWeight: "bold" }}>
            <td style={td} colSpan={2}>合計</td>
            <td style={tdRight}>{totalCalendar}日</td>
            <td style={tdRight}>{totalExcluded > 0 ? `${totalExcluded}日` : "—"}</td>
            <td style={tdRight}>{yen(r.monthWages)}</td>
            <td style={tdRight}>{yen(r.timeWages)}</td>
            <td style={tdRight}>{totalNot ? yen(totalNot) : "—"}</td>
            <td style={tdRight}>{r.workedDays}日</td>
          </tr>
        </tbody>
      </table>
      {notes.length > 0 && <div style={{ ...small, marginTop: 4 }}>{notes.map((n) => <div key={n}>※ {n}</div>)}</div>}
      <div style={{ ...small, marginTop: 4 }}>
        入れなかった賃金：休業手当・休業補償・給与項目設定で「入れない」にした項目（臨時の賃金など）と、除いた日の分の賃金。
        働いた日：働いた時間がある日（最低保障に使う。除いた日は数えない）。
      </div>
    </>
  );
}

/** 原則と最低保障の計算式 */
function Formulas({ r }: { r: AverageWageResult }) {
  const total = r.monthWages + r.timeWages;
  return (
    <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
      {r.principleSen !== null && (
        <div>原則：賃金の総額 {yen(total)} ÷ 暦日数 {r.totalDays}日 ＝ {formatSen(r.principleSen)}</div>
      )}
      {r.minimumSen !== null && (
        <div>
          最低保障：月で決まる賃金 {yen(r.monthWages)} ÷ {r.totalDays}日 ＋ 日・時間・出来高で決まる賃金 {yen(r.timeWages)} ÷ 働いた日 {r.workedDays}日 × 60% ＝ {formatSen(r.minimumSen)}
        </div>
      )}
      {r.notes.map((n) => <div key={n} style={small}>※ {n}</div>)}
      {r.error && !r.manual && (
        <div style={{ color: "#b91c1c", fontWeight: "bold", marginTop: 4 }}>⚠ {r.error}</div>
      )}
      {r.amountSen !== null && (
        <div style={{ fontSize: 16, fontWeight: "bold", marginTop: 6 }}>
          平均賃金：{formatSen(r.amountSen)}
          {r.manual
            ? <span style={{ fontSize: 12, fontWeight: "normal", color: "#7c3aed" }}>（手で入れた額。{r.manual.note}）</span>
            : r.minimumSen !== null && <span style={{ fontSize: 12, fontWeight: "normal", color: "#64748b" }}>（{r.minimumSen > (r.principleSen ?? 0) ? "最低保障" : "原則"}のほうが高い）</span>}
        </div>
      )}
    </div>
  );
}

/** 平均賃金を使う額 */
function Amounts({ r, purpose, shutdownRate, shutdownDays, dismissalDate }: {
  r: AverageWageResult; purpose: AverageWagePurpose; shutdownRate: number; shutdownDays: number; dismissalDate: string;
}) {
  if (r.amountSen === null) return null;
  const sen = r.amountSen;
  const box: CSSProperties = { marginTop: 12, padding: "10px 12px", backgroundColor: "#f5f3ff", borderRadius: 8, fontSize: 13, lineHeight: 1.8 };
  if (purpose === "shutdown") {
    const amount = averageWageAmount(sen, shutdownRate, shutdownDays);
    return (
      <div style={box}>
        <b>休業手当（労働基準法26条）</b>：平均賃金 {formatSen(sen)} × {shutdownRate}%（給与規定グループの設定）＝ 1日 {yenText(perDayOf(sen, shutdownRate))}
        {" "}× {shutdownDays}日 ＝ <b>{amount.toLocaleString()}円</b>（1円未満四捨五入）
        <div style={small}>賃金なので、所得税・社会保険料・雇用保険料がかかります。少し働いた日は、働いた分の賃金との差額を払います。所定休日は払いません。</div>
      </div>
    );
  }
  if (purpose === "injury") {
    const amount = averageWageAmount(sen, INJURY_COMPENSATION_RATE, INJURY_WAITING_DAYS);
    return (
      <div style={box}>
        <b>休業補償（労働基準法76条）</b>：平均賃金 {formatSen(sen)} × {INJURY_COMPENSATION_RATE}% ＝ 1日 {yenText(perDayOf(sen, INJURY_COMPENSATION_RATE))}
        {" "}× 最初の{INJURY_WAITING_DAYS}日 ＝ <b>{amount.toLocaleString()}円</b>（1円未満四捨五入）
        <div style={small}>
          休日も数えます。賃金ではないので、所得税・社会保険料・雇用保険料はかかりません。4日目からは労災保険の休業補償給付（給付基礎日額は、ふつうこの平均賃金）を請求します。
        </div>
      </div>
    );
  }
  if (purpose === "dismissal") {
    const notice = dismissalNoticeDays(r.eventDate, dismissalDate);
    if (!dismissalDate || notice === null) {
      return <div style={box}>解雇の日を入れると、解雇予告手当を出します{dismissalDate && notice === null ? "（解雇の日が、解雇を伝えた日より前です）" : ""}。</div>;
    }
    const days = dismissalAllowanceDays(notice);
    return (
      <div style={box}>
        <b>解雇予告手当（労働基準法20条）</b>：予告の日数 {notice}日（{mdJa(r.eventDate)}の翌日から{mdJa(dismissalDate)}まで）→ 足りない日数 30日 − {notice}日 ＝ {days}日
        {days > 0
          ? <> → 平均賃金 {formatSen(sen)} × {days}日 ＝ <b>{roundYen((sen * days) / 100).toLocaleString()}円</b>（1円未満四捨五入。この額以上を払います）</>
          : <>（30日以上前に伝えているので、解雇予告手当は要りません）</>}
        <div style={small}>
          解雇予告手当は退職所得になるので、Q の給与には入れません（「退職所得の受給に関する申告書」を出してもらい、退職所得として源泉徴収します。社会保険料・雇用保険料はかかりません）。
          天災事変などで事業を続けられないときや、本人の責めに帰すべき理由で解雇するときは、労働基準監督署の認定を受ければ払わなくてよいことがあります。
        </div>
      </div>
    );
  }
  return (
    <div style={box}>
      平均賃金 {formatSen(sen)} を使って計算してください（年次有給休暇の賃金を平均賃金で払う会社は1日分、減給の制裁は1回の額が1日分の半額まで）。
    </div>
  );
}

/** 平均賃金を手で入れる（Q で計算できないとき・労働基準監督署などが決めた額を使うとき） */
function ManualCard({ r, busy, onSave, onDelete }: {
  r: AverageWageResult; busy: boolean; onSave: (amountSen: number, note: string) => void; onDelete: () => void;
}) {
  const [yenPart, setYenPart] = useState(r.manual ? String(Math.floor(r.manual.amountSen / 100)) : "");
  const [senPart, setSenPart] = useState(r.manual ? String(r.manual.amountSen % 100) : "");
  const [memo, setMemo] = useState(r.manual?.note ?? "");
  const amountSen = (Math.max(0, Math.floor(Number(yenPart) || 0)) * 100) + Math.min(99, Math.max(0, Math.floor(Number(senPart) || 0)));
  return (
    <div style={{ ...card, borderLeft: r.manual ? "4px solid #7c3aed" : undefined }} className="no-print">
      <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 6 }}>平均賃金を手で入れる</div>
      <p style={note}>
        入社して間もない人・3か月がすべて休業の人（都道府県労働局長が決めます）など、Q で計算できないときや、労働基準監督署などで決めた額を使うときに入れます。
        入れた額は、この人のこの日のできごとの平均賃金として、給与明細の休業手当・休業補償にも使います（入れたこと・消したことは記録に残します）。
      </p>
      <div style={controls}>
        <label style={field}>
          <span style={label}>平均賃金</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input type="number" min={0} value={yenPart} onChange={(e) => setYenPart(e.target.value)} style={{ ...input, width: 110 }} />円
            <input type="number" min={0} max={99} value={senPart} onChange={(e) => setSenPart(e.target.value)} style={{ ...input, width: 60 }} />銭
          </span>
        </label>
        <label style={{ ...field, flex: 1, minWidth: 220 }}>
          <span style={label}>なぜ手で入れるか（メモ）</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例：労働基準監督署に確かめた額" style={input} />
        </label>
        <button disabled={busy} onClick={() => onSave(amountSen, memo)} style={button("#7c3aed", busy)}>{r.manual ? "入れ直す" : "手で入れる"}</button>
        {r.manual && <button disabled={busy} onClick={onDelete} style={button("#64748b", busy)}>消して Q の計算に戻す</button>}
      </div>
    </div>
  );
}

/** 印刷するときは、計算の部分だけを出す（A4 縦） */
const PRINT_STYLE = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  #average-wage-print, #average-wage-print * { visibility: visible !important; }
  #average-wage-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
  .no-print { display: none !important; }
}
`;

const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 8 };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: CSSProperties = { fontSize: 12, color: "#64748b" };
const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
const title: CSSProperties = { fontSize: 16, margin: "0 0 8px" };
const note: CSSProperties = { fontSize: 12, color: "#475569", lineHeight: 1.7, margin: "0 0 10px" };
const small: CSSProperties = { fontSize: 11, color: "#64748b" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: CSSProperties = { textAlign: "left", padding: "5px 6px", border: "1px solid #cbd5e1", backgroundColor: "#f1f5f9", fontSize: 11, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "4px 6px", border: "1px solid #e2e8f0", verticalAlign: "top" };
const tdNowrap: CSSProperties = { ...td, whiteSpace: "nowrap" };
const tdRight: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const button = (color: string, disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: color, color: "white", fontWeight: "bold", fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
});
