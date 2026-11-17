/**
 * 「雇用保険・労働保険」タブ：雇用保険の届書と、労働保険の年度更新に使う会社・拠点の設定
 * ・雇用保険適用事業所番号（雇用保険適用事業所設置届の事業主控に書いてある「1301-123456-7」の番号）と、届書を出すハローワーク
 *   （安定所の名前。届書の「あて先」に書く）。拠点が別の適用事業所なら、その拠点の番号とハローワークも入れる
 * ・労災保険の事業の種類（労災保険率表の番号。年度更新の申告書に印字されている事業の種類）と、率がメリット制などで表と違うときの率。
 *   拠点が別の労働保険番号（別の事業）なら、その拠点の事業の種類も入れる
 * 労働保険番号は「基本情報」「支店リスト」で入れる
 */
import { useCallback, useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../../components/Toast";
import { useMessageDialog } from "../../../components/MessageDialog";
import { writeLog } from "../../../utils/logUtils";
import { formatKoyoNumber, splitKoyoNumber } from "../../../utils/koyoCsv";
import { helloWorkName } from "../../../utils/koyoReport";
import { rousaiTableOf } from "../../../utils/nendoKoshin";
import { btnStyle, inputStyle, miniLabelStyle, tabContentStyle } from "../CompanyManager.styles";

interface Props {
  db: Database;
}

interface Row {
  koyoNumber: string;
  helloWork: string;
  rousaiBusiness: string;
  rousaiRate: string;
}

const EMPTY: Row = { koyoNumber: "", helloWork: "", rousaiBusiness: "", rousaiRate: "" };
const rowOf = (r: any): Row => ({
  koyoNumber: String(r?.koyo_office_number ?? ""), helloWork: String(r?.koyo_hello_work ?? ""),
  rousaiBusiness: String(r?.rousai_business ?? ""), rousaiRate: r?.rousai_rate === null || r?.rousai_rate === undefined ? "" : String(r.rousai_rate),
});

export default function LaborInsuranceTab({ db }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [company, setCompany] = useState<Row>(EMPTY);
  const [laborNumber, setLaborNumber] = useState("");
  const [branches, setBranches] = useState<{ id: number; name: string; labor: string; row: Row }[]>([]);
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const fiscalYear = new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const table = useMemo(() => rousaiTableOf(fiscalYear), [fiscalYear]);

  const reload = useCallback(async () => {
    try {
      const [c] = await db.select("SELECT * FROM company WHERE id = 1") as any[];
      const bs = await db.select("SELECT * FROM branches ORDER BY id ASC") as any[];
      setCompany(rowOf(c));
      setLaborNumber(String(c?.labor_ins_num ?? ""));
      const list = (bs ?? []).map((b) => ({ id: Number(b.id), name: String(b.name ?? ""), labor: String(b.labor_ins_num ?? ""), row: rowOf(b) }));
      setBranches(list);
      setSaved(JSON.stringify({ c: rowOf(c), b: list.map((x) => x.row) }));
    } catch (e) {
      console.error(e);
      dialog.error(`雇用保険・労働保険の設定を読み込めませんでした。\n${e}`);
    }
  }, [db]);
  useEffect(() => { reload(); }, [reload]);

  const dirty = JSON.stringify({ c: company, b: branches.map((x) => x.row) }) !== saved;
  const problems: string[] = [];
  if (company.koyoNumber && !splitKoyoNumber(company.koyoNumber)) problems.push("会社の雇用保険適用事業所番号は11けたです（「1301-123456-7」の形）");
  for (const b of branches) {
    if (b.row.koyoNumber && !splitKoyoNumber(b.row.koyoNumber)) problems.push(`${b.name}の雇用保険適用事業所番号は11けたです`);
  }
  const rateOk = (v: string) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 200);
  if (!rateOk(company.rousaiRate)) problems.push("労災保険率は、1,000分のいくつかを数で入れます（例：3）");
  for (const b of branches) if (!rateOk(b.row.rousaiRate)) problems.push(`${b.name}の労災保険率は、1,000分のいくつかを数で入れます`);

  const save = async () => {
    if (problems.length > 0) {
      dialog.warning(problems.join("\n"));
      return;
    }
    setSaving(true);
    try {
      const num = (v: string) => (v === "" ? null : Number(v));
      const koyo = (v: string) => (v.trim() ? formatKoyoNumber(v) : null);
      await db.execute("UPDATE company SET koyo_office_number = ?, koyo_hello_work = ?, rousai_business = ?, rousai_rate = ? WHERE id = 1",
        [koyo(company.koyoNumber), helloWorkName(company.helloWork) || null, company.rousaiBusiness || null, num(company.rousaiRate)]);
      for (const b of branches) {
        await db.execute("UPDATE branches SET koyo_office_number = ?, koyo_hello_work = ?, rousai_business = ?, rousai_rate = ? WHERE id = ?",
          [koyo(b.row.koyoNumber), helloWorkName(b.row.helloWork) || null, b.row.rousaiBusiness || null, num(b.row.rousaiRate), b.id]);
      }
      await writeLog(db, "INFO", "system", "雇用保険・労働保険の設定（雇用保険適用事業所番号・ハローワーク・労災保険の事業の種類）を保存しました");
      toast.success("雇用保険・労働保険の設定を保存しました");
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    } finally {
      setSaving(false);
    }
  };

  const businessSelect = (value: string, onChange: (v: string) => void, allowInherit = false) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
      <option value="">{allowInherit ? "（会社と同じ）" : "（選ぶ）"}</option>
      {table.map((r) => <option key={r.codes.join(",")} value={r.codes[0]}>{r.codes.join("・")} {r.name}（{r.rate}/1000）</option>)}
    </select>
  );
  const rateOf = (code: string) => table.find((r) => r.codes.includes(code))?.rate;

  return (
    <div style={tabContentStyle}>
      <h3 style={{ margin: "0 0 6px" }}>雇用保険・労働保険</h3>
      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7, marginBottom: 12 }}>
        雇用保険の届書（資格取得届・資格喪失届・離職証明書など）と、労働保険の年度更新に使います。
        雇用保険適用事業所番号は、ハローワークから受け取った「雇用保険適用事業所設置届 事業主控」に書いてある番号です。
        労働保険番号（{laborNumber || "未入力"}）は「基本情報」で入れます。
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: 14, backgroundColor: "#f0f9ff", borderRadius: 8 }}>
        <label>
          <span style={miniLabelStyle}>雇用保険適用事業所番号</span>
          <input value={company.koyoNumber} onChange={(e) => setCompany({ ...company, koyoNumber: e.target.value })} placeholder="例: 1301-123456-7" style={{ ...inputStyle, width: "100%" }} />
        </label>
        <label>
          <span style={miniLabelStyle}>届書を出すハローワーク（安定所の名前）</span>
          <input value={company.helloWork} onChange={(e) => setCompany({ ...company, helloWork: e.target.value })} placeholder="例: 飯田橋" style={{ ...inputStyle, width: "100%" }} />
        </label>
        <label>
          <span style={miniLabelStyle}>労災保険の事業の種類（年度更新の申告書に書いてある事業の種類）</span>
          {businessSelect(company.rousaiBusiness, (v) => setCompany({ ...company, rousaiBusiness: v }))}
        </label>
        <label>
          <span style={miniLabelStyle}>労災保険率（1,000分の。メリット制などで表の率と違うときだけ）</span>
          <input value={company.rousaiRate} onChange={(e) => setCompany({ ...company, rousaiRate: e.target.value })}
            placeholder={rateOf(company.rousaiBusiness) !== undefined ? `表の率 ${rateOf(company.rousaiBusiness)}` : "例: 3"} style={{ ...inputStyle, width: "100%" }} />
        </label>
      </div>
      {branches.filter((b) => b.id !== 1).length > 0 && (
        <>
          <h4 style={{ margin: "18px 0 6px" }}>支店（別の適用事業所・別の労働保険番号のときだけ入れる）</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: "#f1f5f9" }}>
                <th style={{ padding: 6, textAlign: "left" }}>支店</th>
                <th style={{ padding: 6, textAlign: "left" }}>雇用保険適用事業所番号</th>
                <th style={{ padding: 6, textAlign: "left" }}>ハローワーク</th>
                <th style={{ padding: 6, textAlign: "left" }}>労災保険の事業の種類</th>
                <th style={{ padding: 6, textAlign: "left" }}>労災保険率</th>
              </tr>
            </thead>
            <tbody>
              {branches.filter((b) => b.id !== 1).map((b) => {
                const set = (patch: Partial<Row>) => setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, row: { ...x.row, ...patch } } : x)));
                return (
                  <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{b.name}<div style={{ fontSize: 10, color: "#64748b" }}>労働保険番号 {b.labor || "（会社と同じ）"}</div></td>
                    <td style={{ padding: 6 }}><input value={b.row.koyoNumber} onChange={(e) => set({ koyoNumber: e.target.value })} placeholder="（会社と同じ）" style={{ ...inputStyle, width: "100%" }} /></td>
                    <td style={{ padding: 6 }}><input value={b.row.helloWork} onChange={(e) => set({ helloWork: e.target.value })} placeholder="（会社と同じ）" style={{ ...inputStyle, width: "100%" }} /></td>
                    <td style={{ padding: 6 }}>{businessSelect(b.row.rousaiBusiness, (v) => set({ rousaiBusiness: v }), true)}</td>
                    <td style={{ padding: 6 }}><input value={b.row.rousaiRate} onChange={(e) => set({ rousaiRate: e.target.value })} placeholder="（表の率）" style={{ ...inputStyle, width: 80 }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {problems.length > 0 && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{problems.map((p) => <div key={p}>・{p}</div>)}</div>}
      <button onClick={save} disabled={!dirty || saving} style={{ ...btnStyle, width: "100%", marginTop: 14, backgroundColor: !dirty ? "#bdc3c7" : "#34495e", cursor: !dirty ? "not-allowed" : "pointer" }}>
        {saving ? "保存しています…" : "保存する"}
      </button>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, lineHeight: 1.6 }}>
        労災保険率の表は、厚生労働省「労災保険率表（令和６年度～）」による（令和8年度も同じ率）。
      </div>
    </div>
  );
}
