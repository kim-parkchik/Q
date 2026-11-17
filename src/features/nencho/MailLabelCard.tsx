/**
 * 給与支払報告書を紙で送る市区町村の送付先（郵便番号・住所・あて名）と、封筒に貼るあて名ラベルの印刷
 * ・送付先は、市区町村ごとに resident_tax_municipalities の mail_zip・mail_address・mail_name に残す（欄を離れると保存）。
 *   給与支払報告書の送付先は、市区町村の案内（ホームページ・前年度の通知書に同封の案内など）で確かめて入れる
 * ・ラベルは A4 の12面（2列 × 6段。1面 86.4mm × 42.3mm）。差出人（会社の郵便番号・所在地・名称）と「給与支払報告書在中」を入れる
 *   （一般的な給与ソフトの「送付状・あて名ラベル」と同じ形）
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import type { LocalGov } from "../../utils/localGov";

interface Mail { zip: string; address: string; name: string }
interface Target { code: string; municipality: LocalGov; count: number }

/** あて名の初めの値（市・区は「役所」、町・村は「役場」） */
export const defaultMailName = (g: LocalGov) => `${g.name}${/[町村]$/.test(g.name) ? "役場" : "役所"} 御中`;

/** 郵便番号を「123-4567」にする（7けたでなければそのまま） */
export const formatZip = (v: string) => {
  const d = v.normalize("NFKC").replace(/[^0-9]/g, "");
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : v.trim();
};

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" };
const td: React.CSSProperties = { fontSize: 12, padding: "5px 8px", borderBottom: "1px solid #f1f5f9" };
const input: React.CSSProperties = { padding: "5px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, width: "100%", boxSizing: "border-box" };

export default function MailLabelCard({ db, targets, company }: { db: Database; targets: Target[]; company: { name?: string; zip?: string; address?: string } }) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [mails, setMails] = useState<Record<string, Mail>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [printing, setPrinting] = useState<Target[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.select<any[]>("SELECT code, mail_zip, mail_address, mail_name FROM resident_tax_municipalities");
        setMails(Object.fromEntries((rows ?? []).map((r) => [String(r.code), { zip: String(r.mail_zip ?? ""), address: String(r.mail_address ?? ""), name: String(r.mail_name ?? "") }])));
      } catch (e) {
        console.error("送付先の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const mailOf = (t: Target): Mail => {
    const m = mails[t.code];
    return { zip: m?.zip ?? "", address: m?.address ?? "", name: m?.name || defaultMailName(t.municipality) };
  };
  const save = async (code: string, patch: Partial<Mail>) => {
    const cur: Mail = mails[code] ?? { zip: "", address: "", name: "" };
    const next = { ...cur, ...patch };
    next.zip = formatZip(next.zip);
    if (next.zip === cur.zip && next.address === cur.address && next.name === cur.name) return;
    try {
      await db.execute(
        `INSERT INTO resident_tax_municipalities (code, mail_zip, mail_address, mail_name, updated_at)
         VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(code) DO UPDATE SET mail_zip = excluded.mail_zip, mail_address = excluded.mail_address, mail_name = excluded.mail_name, updated_at = excluded.updated_at`,
        [code, next.zip || null, next.address.trim() || null, next.name.trim() || null],
      );
      setMails({ ...mails, [code]: next });
      toast.success("送付先を保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const chosen = targets.filter((t) => checked[t.code] ?? true);
  const print = () => {
    const missing = chosen.filter((t) => !mailOf(t).address.trim());
    if (chosen.length === 0) return dialog.warning("ラベルを作る市区町村に印を付けてください。");
    if (missing.length > 0) return dialog.warning(`送付先の住所が入っていない市区町村があります：${missing.map((t) => t.municipality.name).join("・")}`);
    setPrinting(chosen);
  };
  useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(null); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  if (targets.length === 0) return null;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: "#1e293b" }}>送付先とあて名ラベル（紙で送る市区町村）</div>
        <button type="button" onClick={print} style={{ marginLeft: "auto", padding: "8px 14px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: "pointer", backgroundColor: "#2563eb" }}>
          🖨 あて名ラベルを印刷（{chosen.length}枚。A4 12面）
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, margin: "8px 0" }}>
        給与支払報告書を郵送するときの送付先です。送付先（担当の課の住所など）は市区町村によって違うので、市区町村の案内で確かめて入れてください（欄を離れると保存します。次の年も使います）。
        ラベルには、差出人（会社設定の郵便番号・所在地・会社名）と「給与支払報告書在中」を入れます。
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={{ ...th, width: 40 }}>作る</th><th style={{ ...th, width: 150 }}>市区町村（人数）</th><th style={{ ...th, width: 110 }}>郵便番号</th><th style={th}>住所</th><th style={{ ...th, width: 260 }}>あて名</th></tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const m = mailOf(t);
            return (
              <tr key={t.code}>
                <td style={td}><input type="checkbox" checked={checked[t.code] ?? true} onChange={(e) => setChecked({ ...checked, [t.code]: e.target.checked })} /></td>
                <td style={td}>{t.municipality.prefecture}{t.municipality.name}（{t.count}人）</td>
                <td style={td}><input key={`z:${t.code}:${m.zip}`} defaultValue={m.zip} placeholder="102-8688" onBlur={(e) => save(t.code, { zip: e.target.value })} style={input} /></td>
                <td style={td}><input key={`a:${t.code}:${m.address}`} defaultValue={m.address} placeholder="送付先の住所" onBlur={(e) => save(t.code, { address: e.target.value })} style={input} /></td>
                <td style={td}><input key={`n:${t.code}:${m.name}`} defaultValue={m.name} onBlur={(e) => save(t.code, { name: e.target.value })} style={input} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {printing && createPortal(
        <div id="mail-label-root">
          <style>{`
            @media screen { #mail-label-root { display: none; } }
            @media print {
              @page { size: A4 portrait; margin: 21.5mm 18.6mm 21.5mm 18.6mm; }
              #root { display: none !important; }
              #mail-label-root .sheet { display: grid; grid-template-columns: 86.4mm 86.4mm; grid-auto-rows: 42.3mm; break-after: page; }
              #mail-label-root .sheet:last-child { break-after: auto; }
            }
          `}</style>
          {Array.from({ length: Math.ceil(printing.length / 12) }, (_, p) => (
            <div key={p} className="sheet">
              {printing.slice(p * 12, p * 12 + 12).map((t) => {
                const m = mailOf(t);
                return (
                  <div key={t.code} style={{ padding: "4mm 5mm", boxSizing: "border-box", fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", position: "relative" }}>
                    <div style={{ fontSize: "10pt" }}>〒{m.zip}</div>
                    <div style={{ fontSize: "10pt", marginTop: "1mm" }}>{m.address}</div>
                    <div style={{ fontSize: "12pt", fontWeight: "bold", marginTop: "2mm" }}>{m.name}</div>
                    <div style={{ position: "absolute", right: "5mm", top: "4mm", border: "1px solid #c00", color: "#c00", fontSize: "8pt", padding: "0.5mm 1.5mm" }}>給与支払報告書在中</div>
                    <div style={{ position: "absolute", left: "5mm", bottom: "3mm", fontSize: "7pt", color: "#333" }}>
                      差出人：〒{formatZip(String(company.zip ?? ""))} {company.address ?? ""} {company.name ?? ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
