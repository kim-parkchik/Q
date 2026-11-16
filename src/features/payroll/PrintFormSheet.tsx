/**
 * 電子申請用ファイルの形がない届書の「書く内容」を出す部品（utils/printForms.ts の PrintForm）
 * 届書の名前・事業所の欄・項目と書く内容の表。直すところと知らせは画面だけに出す（印刷しない）
 */
import type { PrintForm } from "../../utils/printForms";
import { ShahoOfficeTable, small, table, td, th } from "./ShahoFilePanel";

export function PrintFormSheet({ form, office }: { form: PrintForm; office: string[] }) {
  return (
    <div style={{ marginBottom: 16, breakInside: "avoid" }}>
      <div style={{ fontSize: 14, fontWeight: "bold", margin: "0 0 4px" }}>{form.title}（{form.who}）</div>
      <ShahoOfficeTable office={office} />
      <table style={table}>
        <tbody>
          {form.items.map((it) => (
            <tr key={it.label}>
              <th style={{ ...th, width: "36%", whiteSpace: "normal" }}>{it.label}</th>
              <td style={td}>{it.value || <span style={small}>（書く）</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(form.problems.length > 0 || form.notes.length > 0) && (
        <div className="no-print" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
          {form.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
          {form.notes.map((n) => <div key={n} style={{ color: "#475569" }}>・{n}</div>)}
        </div>
      )}
    </div>
  );
}
