/**
 * 「明細書・一覧表」の画面：確定した給与（支給した月ごと）・賞与（1回ごと）の
 * ・明細書を全員分まとめて印刷する（給与明細書・賞与明細書。1人1枚）
 * ・支給控除一覧表を出す（行に人・列に項目。拠点ごと・部門ごとの小計と合計。印刷と CSV）
 * ・月ごとの推移表（給与。1年分の項目の合計）・前の月と変わった人（給与。変動確認表）
 * ・仕訳データ（会計ソフトに取り込む CSV。勘定科目は会社ごとに変えられる。utils/payJournal.ts）
 * どれも、確定したときに残した内訳から作る（utils/payReports.ts）。まだ確定していない人は入らない
 * ・標準報酬月額の決定・改定の通知書（従業員に渡すもの。RemunerationNoticeView.tsx）
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { parseLedger } from "../../utils/legalBooks";
import {
  payChanges, payListCell, payListColumns, payListCsv, payListRows, payTrendRows, type PayDocPerson, type PayListGroupBy,
} from "../../utils/payReports";
import { buildPayJournal, journalCsv, journalTotals, parseJournalSettings, type JournalSettings } from "../../utils/payJournal";
import { payDateOf } from "../../utils/koyoBenefits";
import PaySlipSheet from "./PaySlipSheet";
import RemunerationNoticeView from "./RemunerationNoticeView";
import * as S from "./reportStyles";

interface Props {
  db: Database;
  staffList: any[];
}

type Kind = "salary" | "bonus" | "notice";
type Tab = "slips" | "list" | "trend" | "changes" | "journal";
type Person = PayDocPerson & { payDate: string; executive: boolean; department: string };

interface BonusSettingRow { id: number; name: string; target_year: number; target_month: number; payment_date: string | null; n: number }

const today = new Date();
const PRINT_ID = "pay-report-print";
const ORDER = "ORDER BY s.branch_id, CASE WHEN s.id GLOB '[0-9]*' THEN CAST(s.id AS INTEGER) END, s.id";

/** その月に支給した、確定した給与 */
const loadSalaryPeople = async (db: Database, year: number, month: number): Promise<Person[]> => {
  const branches = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM branches ORDER BY id");
  const groups = await db.select<{ id: number; payment_day: number }[]>("SELECT id, payment_day FROM payroll_groups ORDER BY id");
  const rows = await db.select<any[]>(
    `SELECT r.staff_id, r.total_earnings, r.net_pay, r.year_end_adjustment, r.ledger, s.name, s.branch_id, s.payroll_group_id, s.department, s.is_executive
     FROM salary_results r JOIN staff s ON s.id = r.staff_id
     WHERE r.target_year = ? AND r.target_month = ? ${ORDER}`,
    [year, month],
  );
  return (rows ?? []).map((r) => {
    const total = Number(r.total_earnings) || 0;
    const net = Number(r.net_pay) || 0;
    const group = groups?.find((g) => g.id === Number(r.payroll_group_id)) ?? groups?.[0] ?? { payment_day: 25 };
    return {
      staffId: String(r.staff_id), name: String(r.name ?? ""), branchName: branches?.find((b) => b.id === Number(r.branch_id))?.name ?? "",
      department: String(r.department ?? ""), executive: Number(r.is_executive) === 1, ledger: parseLedger(r.ledger),
      totalEarnings: total, totalDeductions: total + (Number(r.year_end_adjustment) || 0) - net, netPay: net, payDate: payDateOf(group, year, month),
    };
  });
};

/** 1回の、確定した賞与 */
const loadBonusPeople = async (db: Database, bonusId: number, payDate: string): Promise<Person[]> => {
  const branches = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM branches ORDER BY id");
  const rows = await db.select<any[]>(
    `SELECT r.staff_id, r.total_earnings, r.in_kind, r.net_pay, r.ledger, s.name, s.branch_id, s.department, s.is_executive
     FROM bonus_results r JOIN staff s ON s.id = r.staff_id
     WHERE r.bonus_setting_id = ? ${ORDER}`,
    [bonusId],
  );
  return (rows ?? []).map((r) => {
    const total = (Number(r.total_earnings) || 0) - (Number(r.in_kind) || 0);
    const net = Number(r.net_pay) || 0;
    return {
      staffId: String(r.staff_id), name: String(r.name ?? ""), branchName: branches?.find((b) => b.id === Number(r.branch_id))?.name ?? "",
      department: String(r.department ?? ""), executive: Number(r.is_executive) === 1, ledger: parseLedger(r.ledger),
      totalEarnings: total, totalDeductions: total - net, netPay: net, payDate,
    };
  });
};

export default function PayReportManager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [kind, setKind] = useState<Kind>("salary");
  const [tab, setTab] = useState<Tab>("slips");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [bonusId, setBonusId] = useState<number | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [groupBy, setGroupBy] = useState<PayListGroupBy>("branch");
  const [companyName, setCompanyName] = useState("");
  const [journalSettings, setJournalSettings] = useState<JournalSettings>(parseJournalSettings(null));
  const [bonusSettings, setBonusSettings] = useState<BonusSettingRow[]>([]);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [previous, setPrevious] = useState<Person[] | null>(null);
  const [yearPeople, setYearPeople] = useState<{ month: number; people: Person[] }[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name, journal_settings FROM company WHERE id = 1");
        setCompanyName(String(c?.[0]?.name ?? ""));
        setJournalSettings(parseJournalSettings(c?.[0]?.journal_settings));
        const b = await db.select<BonusSettingRow[]>(
          `SELECT s.id, s.name, s.target_year, s.target_month, s.payment_date, COUNT(r.staff_id) AS n
           FROM bonus_settings s LEFT JOIN bonus_results r ON r.bonus_setting_id = s.id
           GROUP BY s.id ORDER BY s.target_year DESC, s.target_month DESC, s.id DESC`,
        );
        const list = (b ?? []).filter((x) => Number(x.n) > 0);
        setBonusSettings(list);
        setBonusId((cur) => cur ?? list[0]?.id ?? null);
      } catch (e) {
        console.error("明細書・一覧表の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const setting = bonusSettings.find((b) => b.id === bonusId) ?? null;

  // その月（その賞与）の確定した結果
  useEffect(() => {
    if (kind === "notice") return;
    let cancelled = false;
    setPeople(null);
    (async () => {
      try {
        const list = kind === "salary" ? await loadSalaryPeople(db, year, month)
          : bonusId === null ? [] : await loadBonusPeople(db, bonusId, setting?.payment_date ?? "");
        if (!cancelled) setPeople(list);
      } catch (e) {
        console.error("確定した給与・賞与の読み込みエラー:", e);
        if (!cancelled) setPeople([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, kind, year, month, bonusId, setting]);

  // 前の月の給与（変動確認表）と、1年分の給与（推移表）
  useEffect(() => {
    if (kind !== "salary" || (tab !== "changes" && tab !== "trend")) return;
    let cancelled = false;
    (async () => {
      try {
        if (tab === "changes") {
          setPrevious(null);
          const p = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
          const list = await loadSalaryPeople(db, p.y, p.m);
          if (!cancelled) setPrevious(list);
        } else {
          setYearPeople(null);
          const out: { month: number; people: Person[] }[] = [];
          for (let m = 1; m <= 12; m++) out.push({ month: m, people: await loadSalaryPeople(db, year, m) });
          if (!cancelled) setYearPeople(out);
        }
      } catch (e) {
        console.error("給与の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, kind, tab, year, month]);

  const branches = useMemo(() => [...new Set((people ?? []).map((p) => p.branchName))], [people]);
  const hasDepartment = useMemo(() => (people ?? []).some((p) => (p.department ?? "").trim()), [people]);
  const shown = useMemo(() => (people ?? []).filter((p) => !branch || p.branchName === branch), [people, branch]);
  const columns = useMemo(() => payListColumns(shown, kind === "salary"), [shown, kind]);
  const rows = useMemo(() => payListRows(shown, groupBy), [shown, groupBy]);
  const heading = kind === "salary" ? `${year}年${month}月支給分` : setting ? `${setting.name}（${setting.target_year}年${setting.target_month}月）` : "";
  const TAB_NAMES: Record<Tab, string> = {
    slips: kind === "salary" ? "給与明細書（全員分）" : "賞与明細書（全員分）", list: "支給控除一覧表", trend: "月ごとの推移表", changes: "前の月と変わった人", journal: "仕訳データ",
  };
  const tabs: Tab[] = kind === "salary" ? ["slips", "list", "trend", "changes", "journal"] : ["slips", "list", "journal"];
  const title = `${tab === "trend" ? `${year}年` : heading} ${TAB_NAMES[tab].replace("（全員分）", "")}${branch && tab !== "trend" ? `（${branch}）` : ""}`;
  const noLedger = shown.filter((p) => !p.ledger).map((p) => p.name);
  const journal = useMemo(
    () => buildPayJournal(kind === "bonus" ? "bonus" : "salary", `${heading} ${kind === "bonus" ? "賞与" : "給与"}`, shown, journalSettings),
    [kind, heading, shown, journalSettings],
  );
  const journalSum = journalTotals(journal.lines);

  const save = async (content: string, fileName: string) => {
    try {
      const saved = await saveCsvFile(content, fileName.replace(/[\\/:*?"<>|\s]/g, "_"));
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };
  const saveJournalSettings = async (next: JournalSettings) => {
    setJournalSettings(next);
    try {
      await db.execute("UPDATE company SET journal_settings = ? WHERE id = 1", [JSON.stringify(next)]);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() + 1 - i);
  const csvOfTab = () => {
    if (tab === "list") return payListCsv(title, columns, rows);
    if (tab === "journal") return journalCsv(journal.lines);
    return "";
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, tab === "list" || tab === "trend")}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>明細書・一覧表</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          確定した給与（支給した月ごと）と賞与（1回ごと）の、明細書を全員分まとめて印刷し、支給控除一覧表・月ごとの推移表・前の月と変わった人・仕訳データを出します。
          どれも確定したときに残した内訳から作るので、まだ確定していない人は入りません（給与は「勤怠・月次給与」の給与明細、賞与は「賞与計算」で確定します）。
          給与明細書は、給与を支払うときに渡す支払明細書です（所得税法231条）。印刷すると PDF にも保存できます。
        </div>
        <div style={S.controls}>
          <div style={{ display: "flex", gap: 6 }}>
            {([["salary", "給与"], ["bonus", "賞与"], ["notice", "標準報酬月額の通知書"]] as [Kind, string][]).map(([k, name]) => (
              <button key={k} onClick={() => { setKind(k); setBranch(""); if (k === "bonus" && (tab === "trend" || tab === "changes")) setTab("slips"); }} style={S.tabButton(kind === k)}>{name}</button>
            ))}
          </div>
          {kind === "notice" ? null : kind === "salary" ? (
            <>
              <label style={S.field}>
                <span style={S.label}>支給した年</span>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
                  {years.map((y) => <option key={y} value={y}>{y}年</option>)}
                </select>
              </label>
              {tab !== "trend" && (
                <label style={S.field}>
                  <span style={S.label}>支給した月</span>
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={S.input}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <label style={S.field}>
              <span style={S.label}>賞与（確定したもの）</span>
              <select value={bonusId ?? ""} onChange={(e) => setBonusId(e.target.value ? Number(e.target.value) : null)} style={S.input}>
                {bonusSettings.length === 0 && <option value="">確定した賞与がありません</option>}
                {bonusSettings.map((b) => <option key={b.id} value={b.id}>{b.target_year}年{b.target_month}月 {b.name}（{b.n}人）</option>)}
              </select>
            </label>
          )}
          {kind !== "notice" && tab !== "trend" && branches.length > 1 && (
            <label style={S.field}>
              <span style={S.label}>拠点</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} style={S.input}>
                <option value="">すべて</option>
                {branches.map((b) => <option key={b} value={b}>{b || "拠点なし"}</option>)}
              </select>
            </label>
          )}
          {kind !== "notice" && tab === "list" && (
            <label style={S.field}>
              <span style={S.label}>小計</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as PayListGroupBy)} style={S.input}>
                <option value="branch">拠点ごと</option>
                <option value="department">部門ごと{hasDepartment ? "" : "（部門が入っていません）"}</option>
                <option value="none">小計なし</option>
              </select>
            </label>
          )}
        </div>
        {kind !== "notice" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {tabs.map((k) => <button key={k} onClick={() => setTab(k)} style={S.tabButton(tab === k)}>{TAB_NAMES[k]}</button>)}
            <span style={{ flex: 1 }} />
            {tab !== "journal" && <button onClick={() => window.print()} disabled={shown.length === 0 && tab !== "trend"} style={S.button("#2563eb", shown.length === 0 && tab !== "trend")}>🖨 印刷・PDF保存</button>}
            {(tab === "list" || tab === "journal") && (
              <button onClick={() => save(csvOfTab(), `${title}.csv`)} disabled={shown.length === 0 || (tab === "journal" && journalSum.debit !== journalSum.credit)}
                style={S.button("#16a085", shown.length === 0 || (tab === "journal" && journalSum.debit !== journalSum.credit))}>CSV に保存</button>
            )}
          </div>
        )}
        {kind !== "notice" && noLedger.length > 0 && (
          <div style={{ ...S.warnBox, marginTop: 10 }}>
            ⚠ 内訳を残す前に確定した人がいます（{noLedger.join("・")}）。明細書・一覧表には合計だけを出しています。確定し直すと内訳が残ります。
          </div>
        )}
      </div>

      {kind === "notice" ? (
        <RemunerationNoticeView db={db} staffList={staffList} companyName={companyName} />
      ) : tab === "trend" ? (
        <TrendView year={year} data={yearPeople} companyName={companyName} onCsv={(csv) => save(csv, `${year}年 月ごとの推移表.csv`)} />
      ) : people === null ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>読み込んでいます…</div>
      ) : shown.length === 0 ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>
          {kind === "salary" ? `${year}年${month}月に支給した、確定した給与がありません。` : "確定した賞与がありません。"}
        </div>
      ) : tab === "slips" ? (
        <div id={PRINT_ID}>
          {shown.map((p) => (
            <PaySlipSheet key={p.staffId} kind={kind === "bonus" ? "bonus" : "salary"} companyName={companyName} person={p} heading={heading} payDate={p.payDate} />
          ))}
        </div>
      ) : tab === "list" ? (
        <div style={S.card}>
          <div id={PRINT_ID}>
            <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>{title}</h2>
            <div style={{ ...S.small, marginBottom: 6 }}>{companyName}　{shown.length}人</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...S.table, fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={S.th}>社員番号</th>
                    <th style={S.th}>氏名</th>
                    {columns.map((c) => (
                      <th key={c.key} style={{ ...S.th, textAlign: "right", color: c.group === "deduction" ? "#b91c1c" : c.group === "earning" ? "#1d4ed8" : undefined }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.kind}-${r.staffId}-${i}`} style={{ backgroundColor: r.kind === "total" ? "#e0f2fe" : r.kind === "subtotal" ? "#f1f5f9" : undefined, fontWeight: r.kind === "person" ? undefined : "bold" }}>
                      <td style={S.td}>{r.staffId}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.kind === "person" ? r.label : `${r.label}（${r.count}人）`}{r.noLedger ? "※" : ""}</td>
                      {columns.map((c) => <td key={c.key} style={S.tdNum}>{payListCell(c, r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {noLedger.length > 0 && <div style={{ ...S.small, marginTop: 4 }}>※ 内訳を残す前に確定したので、合計だけです。</div>}
          </div>
        </div>
      ) : tab === "changes" ? (
        <ChangesView title={title} before={previous} after={shown} />
      ) : (
        <JournalView settings={journalSettings} onSettings={saveJournalSettings} lines={journal.lines} notes={journal.notes} totals={journalSum} />
      )}
    </div>
  );
}

/** 月ごとの推移表（行に項目・列に支給した月） */
function TrendView({ year, data, companyName, onCsv }: { year: number; data: { month: number; people: PayDocPerson[] }[] | null; companyName: string; onCsv: (csv: string) => void }) {
  if (!data) return <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>1年分の給与を読み込んでいます…</div>;
  const { rows, persons } = payTrendRows(data);
  const cell = (hours: boolean | undefined, v: number) => (v === 0 ? "" : hours ? String(Math.round(v * 100) / 100) : v.toLocaleString());
  const csv = () => {
    const head = ["項目", ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), "合計"];
    const lines = [[`${year}年 月ごとの推移表（支給した月）`], head, ["人数", ...persons.map(String), ""],
      ...rows.map((r) => [r.column.label, ...r.months.map((v) => String(r.column.hours ? Math.round(v * 100) / 100 : v)), String(r.total)])];
    onCsv(lines.map((c) => c.map((x) => (/[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\r\n") + "\r\n");
  };
  return (
    <div style={S.card}>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <button onClick={csv} style={S.button("#16a085")}>CSV に保存</button>
      </div>
      <div id={PRINT_ID}>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>{year}年 月ごとの推移表（支給した月）</h2>
        <div style={{ ...S.small, marginBottom: 6 }}>{companyName}　確定した給与の全員分の合計</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...S.table, fontSize: 11 }}>
            <thead><tr><th style={S.th}>項目</th>{Array.from({ length: 12 }, (_, i) => <th key={i} style={{ ...S.th, textAlign: "right" }}>{i + 1}月</th>)}<th style={{ ...S.th, textAlign: "right" }}>合計</th></tr></thead>
            <tbody>
              <tr><td style={S.td}>人数</td>{persons.map((n, i) => <td key={i} style={S.tdNum}>{n || ""}</td>)}<td style={S.tdNum} /></tr>
              {rows.map((r) => (
                <tr key={r.column.key} style={{ fontWeight: r.column.group === "summary" ? "bold" : undefined, backgroundColor: r.column.group === "summary" ? "#f8fafc" : undefined }}>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.column.label}</td>
                  {r.months.map((v, i) => <td key={i} style={S.tdNum}>{cell(r.column.hours, v)}</td>)}
                  <td style={S.tdNum}>{cell(r.column.hours, r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** 前の月と変わった人（変動確認表） */
function ChangesView({ title, before, after }: { title: string; before: PayDocPerson[] | null; after: PayDocPerson[] }) {
  if (!before) return <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>前の月の給与を読み込んでいます…</div>;
  const list = payChanges(before, after);
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  return (
    <div style={S.card}>
      <div id={PRINT_ID}>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>{title}</h2>
        <div style={{ ...S.small, marginBottom: 6 }}>前の月に支給した給与と比べて、支給・控除・合計の額が変わった人と項目です（{new Set(list.map((c) => c.staffId)).size}人）。</div>
        {list.length === 0 ? <div style={S.small}>変わった人はいません。</div> : (
          <table style={S.table}>
            <thead><tr>{["社員番号", "氏名", "項目", "前の月", "この月", "差"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={i} style={{ fontWeight: c.group === "summary" ? "bold" : undefined }}>
                  <td style={S.td}>{c.staffId}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{c.name}</td>
                  <td style={S.td}>{c.label}</td>
                  <td style={S.tdNum}>{n(c.before)}</td>
                  <td style={S.tdNum}>{n(c.after)}</td>
                  <td style={{ ...S.tdNum, color: c.diff < 0 ? "#b91c1c" : "#1d4ed8" }}>{c.diff > 0 ? `＋${c.diff.toLocaleString()}` : `－${(-c.diff).toLocaleString()}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 仕訳データ（勘定科目の設定と、仕訳の中身） */
function JournalView({ settings, onSettings, lines, notes, totals }: {
  settings: JournalSettings; onSettings: (s: JournalSettings) => void; lines: ReturnType<typeof buildPayJournal>["lines"]; notes: string[]; totals: { debit: number; credit: number };
}) {
  const text = (labelText: string, key: Exclude<keyof JournalSettings, "byDepartment">, w = 130) => (
    <label style={S.field} key={key}>
      <span style={S.label}>{labelText}</span>
      <input defaultValue={settings[key]} onBlur={(e) => e.target.value !== settings[key] && onSettings({ ...settings, [key]: e.target.value.trim() })} style={{ ...S.input, width: w }} />
    </label>
  );
  return (
    <div style={S.card}>
      <details style={{ marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>勘定科目の設定（会社ごと。使っている会計ソフトの科目の名前に合わせます）</summary>
        <div style={{ ...S.controls, marginTop: 8 }}>
          {text("給与", "salary")}{text("役員の給与", "executiveSalary")}{text("賞与", "bonus")}{text("役員の賞与", "executiveBonus")}
          {text("通勤手当（空なら給与に含める）", "commute", 160)}{text("控除の勘定科目", "deposit")}
          {text("社会保険料の補助科目", "socialInsuranceSub")}{text("雇用保険料の補助科目", "employmentInsuranceSub")}
          {text("所得税の補助科目", "incomeTaxSub")}{text("住民税の補助科目", "residentTaxSub")}{text("差引支給額を払った科目", "payment")}
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={settings.byDepartment} onChange={(e) => onSettings({ ...settings, byDepartment: e.target.checked })} />
            部門ごとに分ける（従業員の画面の「部門」）
          </label>
        </div>
        <div style={S.small}>そのほかの控除（社宅家賃など）は、控除の勘定科目に、項目の名前を補助科目にして書きます。年末調整の還付・徴収は、所得税の補助科目で書きます。</div>
      </details>
      {totals.debit !== totals.credit && <div style={S.errorBox}>借方（{totals.debit.toLocaleString()}円）と貸方（{totals.credit.toLocaleString()}円）が合いません。確定し直してください。</div>}
      {notes.length > 0 && <div style={{ ...S.warnBox, marginBottom: 8 }}>{notes.map((x, i) => <div key={i}>・{x}</div>)}</div>}
      <table style={S.table}>
        <thead><tr>{["日付", "伝票", "借方勘定科目", "補助科目", "部門", "借方金額", "貸方勘定科目", "補助科目", "部門", "貸方金額", "摘要"].map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ ...S.td, whiteSpace: "nowrap" }}>{l.date}</td>
              <td style={S.td}>{l.voucher}</td>
              {l.side === "debit"
                ? <><td style={S.td}>{l.account}</td><td style={S.td}>{l.sub}</td><td style={S.td}>{l.department}</td><td style={S.tdNum}>{l.amount.toLocaleString()}</td><td style={S.td} /><td style={S.td} /><td style={S.td} /><td style={S.td} /></>
                : <><td style={S.td} /><td style={S.td} /><td style={S.td} /><td style={S.td} /><td style={S.td}>{l.account}</td><td style={S.td}>{l.sub}</td><td style={S.td}>{l.department}</td><td style={S.tdNum}>{l.amount.toLocaleString()}</td></>}
              <td style={S.td}>{l.memo}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f8fafc" }}>
            <td style={S.td} colSpan={5}>合計</td><td style={S.tdNum}>{totals.debit.toLocaleString()}</td>
            <td style={S.td} colSpan={3} /><td style={S.tdNum}>{totals.credit.toLocaleString()}</td><td style={S.td} />
          </tr>
        </tbody>
      </table>
      <div style={{ ...S.small, marginTop: 6 }}>
        多くの会計ソフトが取り込める一般的な形の CSV です（1行に借方か貸方の一方。同じ伝票番号で1つの仕訳）。取り込むときは、会計ソフトの取り込みの設定で列を合わせてください。
        会社が負担する社会保険料・労働保険料（法定福利費）は入れていません。
      </div>
    </div>
  );
}
