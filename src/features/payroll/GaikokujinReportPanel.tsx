/**
 * 「雇用保険の届書」の画面の「外国人雇用状況届出書」：雇用保険に入らない外国人の方を、選んだ月に雇い入れた・離職したときの
 * 外国人雇用状況届出書（様式第3号）に書く内容を、1人1枚で印刷する（作り方は utils/gaikokujinReport.ts）
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { gaikokujinEventsIn, gaikokujinForm } from "../../utils/gaikokujinReport";
import { koyoPlaceOf } from "../../utils/koyoPlaces";
import { formatWareki } from "../../utils/wareki";
import { PrintFormSheet } from "./PrintFormSheet";
import { button, card, fieldStyle, input, labelStyle, note, small, title } from "./ShahoFilePanel";

export default function GaikokujinReportPanel({ db, staffList }: { db: Database; staffList: any[] }) {
  const today = dayjs().format("YYYY-MM-DD");
  const [month, setMonth] = useState(dayjs().subtract(1, "month").format("YYYY-MM"));
  const [submittedOn, setSubmittedOn] = useState(today);
  const [base, setBase] = useState<{ company: any; branches: any[] } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
        const b = await db.select<any[]>("SELECT * FROM branches ORDER BY id");
        setBase({ company: c?.[0] ?? {}, branches: b ?? [] });
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const forms = useMemo(() => {
    if (!base) return [];
    const corporation = String(base.company.corporate_number ?? "").replace(/\D/g, "").length === 13;
    return staffList.flatMap((s) => {
      const events = gaikokujinEventsIn(s, month);
      if (events.length === 0) return [];
      return [gaikokujinForm({ staff: s, events, place: koyoPlaceOf(base.company, base.branches, s.branch_id), company: base.company, corporation, submittedOn })];
    });
  }, [base, staffList, month, submittedOn]);

  return (
    <>
      <div style={card} className="no-print">
        <h3 style={{ ...title, fontSize: 15 }}>外国人雇用状況届出書（雇用保険に入らない外国人の方）</h3>
        <p style={note}>
          雇用保険に入らない外国人の方（在留資格「外交」「公用」と特別永住者を除く）を雇い入れたとき・離職したときは、外国人雇用状況届出書（様式第3号）を、
          雇い入れた日・離職した日の翌月の末日までに、事業所のハローワークに出します。雇用保険に入る人は、資格取得届・資格喪失届に在留資格などを書けば届け出たことになります。
          在留資格などは、従業員の画面の「在留資格の情報（外国人の方）」に入れます。
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>雇い入れた・離職した月</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>提出日</span>
            <input type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} style={input} />
          </label>
          <button onClick={() => window.print()} disabled={forms.length === 0} style={{ ...button("#2563eb"), opacity: forms.length === 0 ? 0.5 : 1 }}>🖨 届書の内容を印刷</button>
        </div>
      </div>
      <div style={card}>
        {forms.length === 0 ? (
          <div style={small}>この月に雇い入れた・離職した、雇用保険に入らない外国人の方はいません。</div>
        ) : forms.map((f) => (
          <div key={f.key} className="page">
            <div className="no-print" style={{ ...small, marginBottom: 4 }}>提出期限：{formatWareki(f.due)}</div>
            <PrintFormSheet form={f} office={[]} />
          </div>
        ))}
      </div>
    </>
  );
}
