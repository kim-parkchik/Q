/**
 * 年末調整一覧表：その年の全員の年末調整の結果（給与の総額・控除・年税額・源泉徴収税額・過不足額・精算）を1つの表にする。
 * 一般的な給与ソフトの「年末調整一覧表」「過不足税額一覧表」と同じ。印刷（PDF 保存）と CSV ができる
 * 結果は年末調整の画面で保存したもの（year_end_adjustments.result）。保存していない人・対象外の人も、理由を出す
 */
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import type { NenchoStaffRow } from "./useNenchoManager";
import * as S from "../payroll/reportStyles";

interface Props {
  year: number;
  rows: NenchoStaffRow[];
  statusLabel: (r: NenchoStaffRow) => string;
}

const PRINT_ID = "nencho-list-print";

interface ListRow {
  staffId: string;
  name: string;
  state: string;
  salary: number;
  social: number;
  employmentIncome: number | null;
  deductions: number | null;
  taxable: number | null;
  annualTax: number | null;
  withheld: number;
  refund: number;
  collect: number;
  settle: string;
}

const listRowsOf = (rows: NenchoStaffRow[], statusLabel: (r: NenchoStaffRow) => string): ListRow[] =>
  rows.map((r) => {
    const res = r.saved?.result ?? null;
    const diff = res && !r.exclusion ? res.difference : 0;
    return {
      staffId: String(r.staff.id),
      name: String(r.staff.name ?? ""),
      state: r.exclusion ? `対象外（${r.exclusion}）` : !res ? "未入力" : statusLabel(r),
      salary: r.totals.salary,
      social: r.totals.socialInsurance,
      employmentIncome: res && !r.exclusion ? res.employmentIncomeAdjusted : null,
      deductions: res && !r.exclusion ? res.deductions.total : null,
      taxable: res && !r.exclusion ? res.taxableIncome : null,
      annualTax: res && !r.exclusion ? res.annualTax : null,
      withheld: res && !r.exclusion ? res.withheldTax : r.totals.withheldTax,
      refund: Math.max(0, diff),
      collect: Math.max(0, -diff),
      settle: res && !r.exclusion && r.saved ? `${r.saved.settleYear}年${r.saved.settleMonth}月` : "",
    };
  });

const HEAD = ["社員番号", "氏名", "状況", "給与・賞与の総額", "社会保険料等", "給与所得控除後の金額", "所得控除の合計", "課税給与所得金額", "年調年税額", "源泉徴収税額", "還付する額", "徴収する額", "精算する給与"];

const csvEscape = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export default function NenchoListView({ year, rows, statusLabel }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const list = listRowsOf(rows, statusLabel);
  const sum = (k: "salary" | "social" | "withheld" | "refund" | "collect") => list.reduce((t, r) => t + r[k], 0);
  const sumN = (k: "employmentIncome" | "deductions" | "taxable" | "annualTax") => list.reduce((t, r) => t + (r[k] ?? 0), 0);
  const adjusted = list.filter((r) => r.annualTax !== null).length;
  const n = (v: number | null) => (v === null ? "" : v.toLocaleString());

  const saveCsv = async () => {
    const lines = [
      [`${year}年分 年末調整一覧表`],
      HEAD,
      ...list.map((r) => [r.staffId, r.name, r.state, ...[r.salary, r.social, r.employmentIncome, r.deductions, r.taxable, r.annualTax, r.withheld, r.refund, r.collect].map((v) => (v === null ? "" : String(v))), r.settle]),
      ["", "合計", `${list.length}人（年末調整 ${adjusted}人）`, ...[sum("salary"), sum("social"), sumN("employmentIncome"), sumN("deductions"), sumN("taxable"), sumN("annualTax"), sum("withheld"), sum("refund"), sum("collect")].map(String), ""],
    ];
    try {
      const saved = await saveCsvFile(lines.map((c) => c.map(csvEscape).join(",")).join("\r\n") + "\r\n", `年末調整一覧表_${year}年分.csv`);
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <style>{S.printStyle(PRINT_ID, true)}</style>
      <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={S.note}>保存した年末調整の結果を、全員分並べます。対象外の人・まだ入れていない人も出します。</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={S.button("#2563eb")}>🖨 印刷・PDF保存</button>
        <button onClick={saveCsv} style={S.button("#16a085")}>CSV に保存</button>
      </div>
      <div id={PRINT_ID}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>{year}年分 年末調整一覧表</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...S.table, fontSize: 11 }}>
            <thead><tr>{HEAD.map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.staffId}>
                  <td style={S.td}>{r.staffId}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.name}</td>
                  <td style={S.td}>{r.state}</td>
                  <td style={S.tdNum}>{n(r.salary)}</td>
                  <td style={S.tdNum}>{n(r.social)}</td>
                  <td style={S.tdNum}>{n(r.employmentIncome)}</td>
                  <td style={S.tdNum}>{n(r.deductions)}</td>
                  <td style={S.tdNum}>{n(r.taxable)}</td>
                  <td style={S.tdNum}>{n(r.annualTax)}</td>
                  <td style={S.tdNum}>{n(r.withheld)}</td>
                  <td style={S.tdNum}>{r.refund ? r.refund.toLocaleString() : ""}</td>
                  <td style={S.tdNum}>{r.collect ? r.collect.toLocaleString() : ""}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.settle}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: "bold", backgroundColor: "#e0f2fe" }}>
                <td style={S.td} colSpan={3}>合計（{list.length}人。年末調整 {adjusted}人）</td>
                <td style={S.tdNum}>{n(sum("salary"))}</td>
                <td style={S.tdNum}>{n(sum("social"))}</td>
                <td style={S.tdNum}>{n(sumN("employmentIncome"))}</td>
                <td style={S.tdNum}>{n(sumN("deductions"))}</td>
                <td style={S.tdNum}>{n(sumN("taxable"))}</td>
                <td style={S.tdNum}>{n(sumN("annualTax"))}</td>
                <td style={S.tdNum}>{n(sum("withheld"))}</td>
                <td style={S.tdNum}>{n(sum("refund"))}</td>
                <td style={S.tdNum}>{n(sum("collect"))}</td>
                <td style={S.td} />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ ...S.small, marginTop: 4 }}>
          還付する額・徴収する額は、精算する給与の明細に載せる過不足額です（差し引いた後の還付の額は、所得税の納付書の「年末調整による超過税額」に入ります）。
        </div>
      </div>
    </div>
  );
}
