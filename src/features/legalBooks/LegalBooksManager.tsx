/**
 * 「法定三帳簿」の画面：労働者名簿・賃金台帳・出勤簿を、画面に出して印刷（PDF 保存）・CSV で保存する（作り方は utils/legalBooks.ts）
 * ・労働者名簿：従業員の画面の値（労働者名簿の項目：業務の種類・履歴・退職の事由・死亡も）。退職した人も入れられる（退職から5年（当分の間3年）保存）
 * ・賃金台帳：1人の1年分。確定した給与（支給月ごと）と賞与を横に並べる（確定したときに残した内訳。前に確定した月は額だけ）
 * ・出勤簿：1人の1か月分（給与の計算期間）。勤怠の記録から、日ごとの区分・出勤・退勤・休憩・労働時間
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import { parseLeavePeriods } from "../../utils/leaveExemption";
import {
  GENDER_LABELS, ROSTER_COLUMNS, attendanceBookCsv, attendanceBookRows, attendanceBookTotals, hoursText, parseLedger, rosterCsv, rosterMissing,
  rosterRowOf, wageLedgerCsv, wageLedgerRows, type AttendanceBookRow, type WageLedgerColumn, type WageLedgerRow,
} from "../../utils/legalBooks";

interface Props {
  db: Database;
  staffList: any[];
}

type Tab = "roster" | "wage" | "attendance";
const today = new Date();
const yen = (n: number) => n.toLocaleString();

export default function LegalBooksManager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [tab, setTab] = useState<Tab>("roster");
  const [includeRetired, setIncludeRetired] = useState(true);
  const [staffId, setStaffId] = useState<string>(String(staffList[0]?.id ?? ""));
  const [year, setYear] = useState(today.getFullYear());
  const [payMonth, setPayMonth] = useState(today.getMonth() + 1);
  const [wageColumns, setWageColumns] = useState<WageLedgerColumn[] | null>(null);
  const [bookRows, setBookRows] = useState<AttendanceBookRow[] | null>(null);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [groups, setGroups] = useState<{ id: number; closing_day: number; is_next_month: number }[]>([]);

  const staff = staffList.find((s) => String(s.id) === staffId) ?? null;

  // 従業員の一覧があとから読み込まれたとき・選んだ人がいなくなったときは、いちばん上の人にする
  useEffect(() => {
    if (staffList.length > 0 && !staffList.some((s) => String(s.id) === staffId)) setStaffId(String(staffList[0].id));
  }, [staffList, staffId]);

  useEffect(() => {
    db.select("SELECT id, closing_day, is_next_month FROM payroll_groups ORDER BY id")
      .then((g: any) => setGroups(g ?? []))
      .catch((e: unknown) => console.error("給与規定グループの読み込みエラー:", e));
  }, [db]);

  // ── 労働者名簿 ──
  const roster = useMemo(
    () => staffList.filter((s) => includeRetired || (s.status || "active") !== "retired").map((s) => rosterRowOf(s)),
    [staffList, includeRetired],
  );

  // ── 賃金台帳（その人のその年の確定した給与・賞与） ──
  useEffect(() => {
    if (tab !== "wage" || !staffId) return;
    let cancelled = false;
    setWageColumns(null);
    (async () => {
      try {
        const salaries = (await db.select(
          `SELECT CAST(target_month AS INTEGER) AS month, total_earnings, net_pay, year_end_adjustment, ledger FROM salary_results
           WHERE staff_id = ? AND CAST(target_year AS INTEGER) = ? ORDER BY CAST(target_month AS INTEGER)`,
          [staffId, year],
        )) as { month: number; total_earnings: number; net_pay: number; year_end_adjustment: number; ledger: string | null }[];
        const bonuses = (await db.select(
          `SELECT s.name, s.payment_date, CAST(s.target_month AS INTEGER) AS month, b.total_earnings, b.net_pay, b.ledger FROM bonus_results b
           JOIN bonus_settings s ON s.id = b.bonus_setting_id
           WHERE b.staff_id = ? AND CAST(s.target_year AS INTEGER) = ? ORDER BY s.payment_date`,
          [staffId, year],
        )) as { name: string; payment_date: string | null; month: number; total_earnings: number; net_pay: number; ledger: string | null }[];
        // 様式第20号と同じく、給与（支給月の順）のあとに賞与（支給日の順）を並べる
        // 差引支給額は年末調整の過不足額を含むので、控除合計 = 総支給額 − 差引支給額 ＋ 年末調整の過不足額
        const columns: WageLedgerColumn[] = [
          ...(salaries ?? []).map((r) => ({
            label: `${r.month}月支給`, kind: "salary" as const, ledger: parseLedger(r.ledger),
            fallback: { totalEarnings: Number(r.total_earnings) || 0, netPay: Number(r.net_pay) || 0,
              totalDeductions: (Number(r.total_earnings) || 0) - (Number(r.net_pay) || 0) + (Number(r.year_end_adjustment) || 0) },
          })),
          ...(bonuses ?? []).map((b) => ({
            label: b.name, kind: "bonus" as const, ledger: parseLedger(b.ledger),
            fallback: { totalEarnings: Number(b.total_earnings) || 0, netPay: Number(b.net_pay) || 0, totalDeductions: (Number(b.total_earnings) || 0) - (Number(b.net_pay) || 0) },
          })),
        ];
        if (!cancelled) setWageColumns(columns);
      } catch (e) {
        console.error(e);
        if (!cancelled) setWageColumns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, tab, staffId, year]);

  // ── 出勤簿（その人の、支給月の給与の計算期間） ──
  useEffect(() => {
    if (tab !== "attendance" || !staff) return;
    let cancelled = false;
    setBookRows(null);
    // 給与明細と同じく、その人の給与規定グループ（なければ全社共通の規定）の締日で期間を決める
    const group = groups.find((g) => Number(g.id) === Number(staff.payroll_group_id || 1)) ?? groups.find((g) => Number(g.id) === 1)
      ?? { closing_day: 99, is_next_month: 0 };
    const p = getPeriodForPayMonth(group, year, payMonth);
    const range = { start: p.startStr, end: p.endStr };
    setPeriod(range);
    (async () => {
      try {
        const records = await db.select(
          `SELECT a.*, lt.name AS leave_name FROM attendance a LEFT JOIN leave_types lt ON lt.id = a.leave_type_id
           WHERE a.staff_id = ? AND a.work_date BETWEEN ? AND ? ORDER BY a.work_date`,
          [String(staff.id), range.start, range.end],
        ) as any[];
        // 休業・休職の日は、区分に「育児休業」などと書く（従業員の画面で入れた期間）
        if (!cancelled) setBookRows(attendanceBookRows(range, records ?? [], parseLeavePeriods(staff.leave_periods)));
      } catch (e) {
        console.error(e);
        if (!cancelled) setBookRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, tab, staff, year, payMonth, groups]);

  const saveCsv = async (content: string, fileName: string) => {
    try {
      const saved = await saveCsvFile(content, fileName);
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const staffName = String(staff?.name ?? "");
  const gender = GENDER_LABELS[String(staff?.gender ?? "")] ?? "";

  const staffSelect = (
    <label style={field}>
      <span style={label}>従業員</span>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={input}>
        {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}{(s.status || "active") === "retired" ? "（退職）" : ""}</option>)}
      </select>
    </label>
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{PRINT_STYLE}</style>
      <div className="no-print" style={card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>法定三帳簿</h3>
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 10 }}>
          労働者名簿・賃金台帳・出勤簿を出します。書く項目は法令で決まっていますが、様式（労働者名簿は様式第19号、賃金台帳は様式第20号）は
          項目の最少限度を決めたもので、ほかの形でもかまいません（労働基準法施行規則59条の2）。印刷すると PDF にも保存できます。
          保存期間は5年（当分の間は3年。労働者名簿は退職・死亡の日から、賃金台帳は最後に書いた日から）です。
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {([["roster", "労働者名簿"], ["wage", "賃金台帳"], ["attendance", "出勤簿"]] as [Tab, string][]).map(([key, name]) => (
            <button key={key} onClick={() => setTab(key)} style={tabButton(tab === key)}>{name}</button>
          ))}
        </div>
      </div>

      {tab === "roster" && (
        <div style={card}>
          <div className="no-print" style={controls}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} /> 退職した人も入れる
            </label>
            <button onClick={() => window.print()} style={button("#2563eb")}>印刷する</button>
            <button onClick={() => saveCsv(rosterCsv(roster), `労働者名簿_${stamp}.csv`)} style={button("#16a085")}>CSV に保存</button>
          </div>
          <div id="legal-book-print">
            <h2 style={title}>労働者名簿</h2>
            <table style={table}>
              <thead>
                <tr>{ROSTER_COLUMNS.filter(([, k]) => k !== "furigana").map(([name]) => <th key={name} style={th}>{name}</th>)}</tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.id}>
                    <td style={tdNowrap}>{r.id}</td>
                    <td style={tdNowrap}>{r.name}{r.furigana && <div style={small}>{r.furigana}</div>}</td>
                    <td style={tdNowrap}>{r.birthday}</td>
                    <td style={tdNowrap}>{r.gender}</td>
                    <td style={{ ...td, minWidth: 140 }}>{r.address}</td>
                    <td style={td}>{r.jobType}</td>
                    <td style={tdNowrap}>{r.joinDate}</td>
                    <td style={tdNowrap}>{r.retirementDate}</td>
                    <td style={td}>{r.retirementReason}</td>
                    <td style={tdNowrap}>{r.deathDate}</td>
                    <td style={td}>{r.deathCause}</td>
                    <td style={{ ...td, whiteSpace: "pre-wrap", minWidth: 160 }}>
                      {r.careerHistory}
                      {rosterMissing(r).length > 0 && <div className="no-print" style={{ ...small, color: "#b45309" }}>⚠ 入っていない：{rosterMissing(r).join("・")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="no-print" style={{ ...small, marginTop: 6 }}>
              履歴・従事する業務の種類・退職の事由・死亡は、従業員の画面の「労働者名簿の項目」で入れます（業務の種類は、常時30人未満の会社は書かなくてかまいません）。
            </div>
          </div>
        </div>
      )}

      {tab === "wage" && (
        <div style={card}>
          <div className="no-print" style={controls}>
            {staffSelect}
            <label style={field}>
              <span style={label}>年（支給した年）</span>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ ...input, width: 90 }} />
            </label>
            <button onClick={() => window.print()} style={button("#2563eb")}>印刷する</button>
            <button disabled={!wageColumns || wageColumns.length === 0}
              onClick={() => wageColumns && saveCsv(wageLedgerCsv({ name: staffName, gender, year }, wageColumns), `賃金台帳_${year}年_${staffId}.csv`)}
              style={button("#16a085", !wageColumns || wageColumns.length === 0)}>CSV に保存</button>
          </div>
          <div id="legal-book-print">
            <h2 style={title}>賃金台帳（{year}年）</h2>
            <div style={{ fontSize: 13, marginBottom: 6 }}>氏名：{staffName}　性別：{gender}</div>
            {wageColumns === null ? <div style={small}>読み込んでいます…</div>
              : wageColumns.length === 0 ? <div style={small}>この年に確定した給与・賞与はありません。</div>
              : <WageTable columns={wageColumns} />}
            {wageColumns?.some((c) => !c.ledger) && (
              <div className="no-print" style={{ ...small, color: "#b45309", marginTop: 6 }}>
                ⚠ 内訳を残す前に確定した給与・賞与があります（{wageColumns.filter((c) => !c.ledger).map((c) => c.label).join("・")}）。総支給額・控除合計・差引支給額だけを出しています。
                給与明細・賞与の画面で確定し直すと、項目ごとの額と労働日数・時間数が入ります。
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "attendance" && (
        <div style={card}>
          <div className="no-print" style={controls}>
            {staffSelect}
            <label style={field}>
              <span style={label}>支給年月（給与の計算期間）</span>
              <div style={{ display: "flex", gap: 4 }}>
                <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ ...input, width: 80 }} />
                <select value={payMonth} onChange={(e) => setPayMonth(Number(e.target.value))} style={{ ...input, width: 70 }}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
                </select>
              </div>
            </label>
            <button onClick={() => window.print()} style={button("#2563eb")}>印刷する</button>
            <button disabled={!bookRows || !period}
              onClick={() => bookRows && period && saveCsv(attendanceBookCsv({ name: staffName, period }, bookRows), `出勤簿_${year}年${payMonth}月支給_${staffId}.csv`)}
              style={button("#16a085", !bookRows || !period)}>CSV に保存</button>
          </div>
          <div id="legal-book-print">
            <h2 style={title}>出勤簿（{period ? `${period.start}〜${period.end}` : ""}）</h2>
            <div style={{ fontSize: 13, marginBottom: 6 }}>氏名：{staffName}</div>
            {bookRows === null ? <div style={small}>読み込んでいます…</div> : <AttendanceTable rows={bookRows} />}
          </div>
        </div>
      )}
    </div>
  );
}

function WageTable({ columns }: { columns: WageLedgerColumn[] }) {
  const rows = wageLedgerRows(columns);
  const cell = (row: WageLedgerRow, v: number | string | null) =>
    v === null ? "" : typeof v === "string" ? v : row.kind === "hours" ? (row.label === "労働日数" ? String(v) : hoursText(v)) : yen(v);
  const strong = (row: WageLedgerRow) => row.kind === "earningTotal" || row.kind === "deductionTotal" || row.kind === "net";
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={th}>項目</th>
          {columns.map((c, i) => <th key={i} style={{ ...th, textAlign: "right" }}>{c.label}</th>)}
          <th style={{ ...th, textAlign: "right" }}>合計</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.kind}:${row.label}`} style={{ backgroundColor: strong(row) ? "#f8fafc" : undefined, fontWeight: strong(row) ? "bold" : undefined }}>
            <td style={td}>{row.label}</td>
            {row.cells.map((v, i) => <td key={i} style={{ ...td, textAlign: "right" }}>{cell(row, v)}</td>)}
            <td style={{ ...td, textAlign: "right" }}>{cell(row, row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttendanceTable({ rows }: { rows: AttendanceBookRow[] }) {
  const t = attendanceBookTotals(rows);
  return (
    <table style={table}>
      <thead>
        <tr>{["日付", "曜日", "区分", "出勤", "退勤", "休憩", "労働時間", "深夜", "時間有給", "備考"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.date} style={{ color: r.weekday === "日" ? "#b91c1c" : r.weekday === "土" ? "#1d4ed8" : undefined }}>
            <td style={td}>{r.date.slice(5).replace("-", "/")}</td>
            <td style={td}>{r.weekday}</td>
            <td style={td}>{r.type}{r.finalized === false && <span className="no-print" style={{ ...small, color: "#b45309" }}>（未確定）</span>}</td>
            <td style={td}>{r.entry}</td>
            <td style={td}>{r.exit}</td>
            <td style={td}>{r.breaks}</td>
            <td style={{ ...td, textAlign: "right" }}>{r.workHours ? hoursText(r.workHours) : ""}</td>
            <td style={{ ...td, textAlign: "right" }}>{r.nightHours ? hoursText(r.nightHours) : ""}</td>
            <td style={{ ...td, textAlign: "right" }}>{r.paidLeaveHours ? hoursText(r.paidLeaveHours) : ""}</td>
            <td style={td}>{r.memo}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: "bold", backgroundColor: "#f8fafc" }}>
          <td style={td} colSpan={3}>合計（出勤 {t.workDays}日）</td>
          <td style={td} colSpan={3}></td>
          <td style={{ ...td, textAlign: "right" }}>{hoursText(t.workHours)}</td>
          <td style={{ ...td, textAlign: "right" }}>{hoursText(t.nightHours)}</td>
          <td style={{ ...td, textAlign: "right" }}>{t.paidLeaveHours ? hoursText(t.paidLeaveHours) : ""}</td>
          <td style={td}></td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * 印刷するときは、帳簿の部分だけを出す（A4 横）。源泉徴収簿の画面と同じやり方だが、出勤簿・労働者名簿は2枚以上になることがあるので、
 * position: fixed（1枚目だけになる）ではなく absolute にして、次の紙に続ける（表の見出しは、紙ごとにくり返す）
 */
const PRINT_STYLE = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  #legal-book-print, #legal-book-print * { visibility: visible !important; }
  #legal-book-print { position: absolute; left: 0; top: 0; width: 100%; }
  #legal-book-print thead { display: table-header-group; }
  #legal-book-print tr { break-inside: avoid; }
  .no-print { display: none !important; }
}
`;

const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: CSSProperties = { fontSize: 12, color: "#64748b" };
const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
const title: CSSProperties = { fontSize: 16, margin: "0 0 8px" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: CSSProperties = { textAlign: "left", padding: "5px 6px", border: "1px solid #cbd5e1", backgroundColor: "#f1f5f9", fontSize: 11, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "4px 6px", border: "1px solid #e2e8f0", verticalAlign: "top" };
const tdNowrap: CSSProperties = { ...td, whiteSpace: "nowrap" };
const small: CSSProperties = { fontSize: 11, color: "#64748b" };
const button = (color: string, disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: color, color: "white", fontWeight: "bold", fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
});
const tabButton = (active: boolean): CSSProperties => ({
  padding: "8px 16px", borderRadius: 6, border: active ? "2px solid #2563eb" : "1px solid #cbd5e1", backgroundColor: active ? "#eff6ff" : "white",
  color: active ? "#1d4ed8" : "#475569", fontWeight: "bold", fontSize: 13, cursor: "pointer",
});
