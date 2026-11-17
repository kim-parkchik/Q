/**
 * 「明細書・一覧表」の画面：確定した給与（支給した月ごと）・賞与（1回ごと）の
 * ・明細書を全員分まとめて印刷する（給与明細書・賞与明細書。1人1枚）
 * ・支給控除一覧表を出す（行に人・列に項目。拠点ごとの小計と合計。印刷と CSV）
 * どちらも、確定したときに残した内訳から作る（utils/payReports.ts）。まだ確定していない人は入らない
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { parseLedger } from "../../utils/legalBooks";
import { payListCell, payListColumns, payListCsv, payListRows, type PayDocPerson } from "../../utils/payReports";
import { payDateOf } from "../../utils/koyoBenefits";
import PaySlipSheet from "./PaySlipSheet";
import * as S from "./reportStyles";

interface Props {
  db: Database;
}

type Kind = "salary" | "bonus";
type Tab = "slips" | "list";

interface BonusSettingRow { id: number; name: string; target_year: number; target_month: number; payment_date: string | null; n: number }

const today = new Date();
const PRINT_ID = "pay-report-print";

export default function PayReportManager({ db }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [kind, setKind] = useState<Kind>("salary");
  const [tab, setTab] = useState<Tab>("slips");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [bonusId, setBonusId] = useState<number | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [bonusSettings, setBonusSettings] = useState<BonusSettingRow[]>([]);
  const [people, setPeople] = useState<(PayDocPerson & { payDate: string })[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name FROM company WHERE id = 1");
        setCompanyName(String(c?.[0]?.name ?? ""));
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const branches = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM branches ORDER BY id");
        const branchName = (id: unknown) => branches?.find((b) => b.id === Number(id))?.name ?? "";
        const order = "ORDER BY s.branch_id, CASE WHEN s.id GLOB '[0-9]*' THEN CAST(s.id AS INTEGER) END, s.id";
        if (kind === "salary") {
          const groups = await db.select<{ id: number; payment_day: number }[]>("SELECT id, payment_day FROM payroll_groups ORDER BY id");
          const rows = await db.select<any[]>(
            `SELECT r.staff_id, r.total_earnings, r.net_pay, r.year_end_adjustment, r.ledger, s.name, s.branch_id, s.payroll_group_id
             FROM salary_results r JOIN staff s ON s.id = r.staff_id
             WHERE r.target_year = ? AND r.target_month = ? ${order}`,
            [year, month],
          );
          if (cancelled) return;
          setPeople((rows ?? []).map((r) => {
            const total = Number(r.total_earnings) || 0;
            const net = Number(r.net_pay) || 0;
            const group = groups?.find((g) => g.id === Number(r.payroll_group_id)) ?? groups?.[0] ?? { payment_day: 25 };
            return {
              staffId: String(r.staff_id), name: String(r.name ?? ""), branchName: branchName(r.branch_id), ledger: parseLedger(r.ledger),
              totalEarnings: total, totalDeductions: total + (Number(r.year_end_adjustment) || 0) - net, netPay: net,
              payDate: payDateOf(group, year, month),
            };
          }));
        } else {
          if (bonusId === null) { setPeople([]); return; }
          const setting = bonusSettings.find((b) => b.id === bonusId);
          const rows = await db.select<any[]>(
            `SELECT r.staff_id, r.total_earnings, r.in_kind, r.net_pay, r.ledger, s.name, s.branch_id
             FROM bonus_results r JOIN staff s ON s.id = r.staff_id
             WHERE r.bonus_setting_id = ? ${order}`,
            [bonusId],
          );
          if (cancelled) return;
          setPeople((rows ?? []).map((r) => {
            const total = (Number(r.total_earnings) || 0) - (Number(r.in_kind) || 0);
            const net = Number(r.net_pay) || 0;
            return {
              staffId: String(r.staff_id), name: String(r.name ?? ""), branchName: branchName(r.branch_id), ledger: parseLedger(r.ledger),
              totalEarnings: total, totalDeductions: total - net, netPay: net, payDate: setting?.payment_date ?? "",
            };
          }));
        }
      } catch (e) {
        console.error("確定した給与・賞与の読み込みエラー:", e);
        if (!cancelled) setPeople([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, kind, year, month, bonusId, bonusSettings]);

  const branches = useMemo(() => [...new Set((people ?? []).map((p) => p.branchName))], [people]);
  const shown = useMemo(() => (people ?? []).filter((p) => !branch || p.branchName === branch), [people, branch]);
  const columns = useMemo(() => payListColumns(shown, kind === "salary"), [shown, kind]);
  const rows = useMemo(() => payListRows(shown), [shown]);
  const setting = bonusSettings.find((b) => b.id === bonusId) ?? null;
  const heading = kind === "salary" ? `${year}年${month}月支給分` : setting ? `${setting.name}（${setting.target_year}年${setting.target_month}月）` : "";
  const title = `${heading} ${tab === "slips" ? (kind === "salary" ? "給与明細書" : "賞与明細書") : "支給控除一覧表"}${branch ? `（${branch}）` : ""}`;
  const noLedger = shown.filter((p) => !p.ledger).map((p) => p.name);

  const saveCsv = async () => {
    try {
      const saved = await saveCsvFile(payListCsv(title, columns, rows), `${title.replace(/[\\/:*?"<>|\s]/g, "_")}.csv`);
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() + 1 - i);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, tab === "list")}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>明細書・一覧表</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          確定した給与（支給した月ごと）と賞与（1回ごと）の、明細書を全員分まとめて印刷し、支給控除一覧表を出します。
          どちらも確定したときに残した内訳から作るので、まだ確定していない人は入りません（給与は「勤怠・月次給与」の給与明細、賞与は「賞与計算」で確定します）。
          給与明細書は、給与を支払うときに渡す支払明細書です（所得税法231条）。印刷すると PDF にも保存できます。
        </div>
        <div style={S.controls}>
          <div style={{ display: "flex", gap: 6 }}>
            {([["salary", "給与"], ["bonus", "賞与"]] as [Kind, string][]).map(([k, name]) => (
              <button key={k} onClick={() => { setKind(k); setBranch(""); }} style={S.tabButton(kind === k)}>{name}</button>
            ))}
          </div>
          {kind === "salary" ? (
            <>
              <label style={S.field}>
                <span style={S.label}>支給した年</span>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
                  {years.map((y) => <option key={y} value={y}>{y}年</option>)}
                </select>
              </label>
              <label style={S.field}>
                <span style={S.label}>支給した月</span>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={S.input}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
                </select>
              </label>
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
          {branches.length > 1 && (
            <label style={S.field}>
              <span style={S.label}>拠点</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} style={S.input}>
                <option value="">すべて</option>
                {branches.map((b) => <option key={b} value={b}>{b || "拠点なし"}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {([["slips", kind === "salary" ? "給与明細書（全員分）" : "賞与明細書（全員分）"], ["list", "支給控除一覧表"]] as [Tab, string][]).map(([k, name]) => (
            <button key={k} onClick={() => setTab(k)} style={S.tabButton(tab === k)}>{name}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={shown.length === 0} style={S.button("#2563eb", shown.length === 0)}>🖨 印刷・PDF保存</button>
          {tab === "list" && <button onClick={saveCsv} disabled={shown.length === 0} style={S.button("#16a085", shown.length === 0)}>CSV に保存</button>}
        </div>
        {noLedger.length > 0 && (
          <div style={{ ...S.warnBox, marginTop: 10 }}>
            ⚠ 内訳を残す前に確定した人がいます（{noLedger.join("・")}）。明細書・一覧表には合計だけを出しています。確定し直すと内訳が残ります。
          </div>
        )}
      </div>

      {people === null ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>読み込んでいます…</div>
      ) : shown.length === 0 ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>
          {kind === "salary" ? `${year}年${month}月に支給した、確定した給与がありません。` : "確定した賞与がありません。"}
        </div>
      ) : tab === "slips" ? (
        <div id={PRINT_ID}>
          {shown.map((p) => (
            <PaySlipSheet key={p.staffId} kind={kind} companyName={companyName} person={p} heading={heading} payDate={p.payDate} />
          ))}
        </div>
      ) : (
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
      )}
    </div>
  );
}
