/**
 * 給与支払報告書（市区町村に出す。令和8年分から）
 * その年に給与・賞与を支払った人を、出す先の市区町村ごとにまとめ、指定番号と、特別徴収・普通徴収を決める。
 * 出す人・出す先のきまりは utils/salaryPaymentReport.ts
 */
import { useState } from "react";
import { createPortal } from "react-dom";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ORDINARY_REASONS, type MunicipalityGroup } from "../../utils/salaryPaymentReport";
import { localGovLabel } from "../../utils/localGov";
import { REPORT_YEARS, reportRemarksOf, useSalaryPaymentReportManager, type PaperSettings, type ReportRow } from "./useSalaryPaymentReportManager";
import SalaryReportSummaryView from "./SalaryReportSummaryView";
import WithholdingSlipView from "./WithholdingSlipView";
import type { MyNumberUser } from "../mynumber/myNumberStore";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
  onDataChange: () => Promise<void> | void;
}

type Z = ReturnType<typeof useSalaryPaymentReportManager>;

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12, color: "#1e293b", padding: "8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };
const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12 };
const button: React.CSSProperties = { padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" };

const yen = (n: number) => n.toLocaleString();
const dateJa = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
};

/** 指定番号の入力（欄を離れたら保存する） */
function DesignationInput({ code, saved, save }: { code: string; saved: string; save: Z["saveDesignation"] }) {
  const [value, setValue] = useState(saved);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
      指定番号
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={async () => { if (!(await save(code, value))) setValue(saved); }}
        placeholder="前年度の通知書の番号"
        maxLength={20}
        style={{ ...input, width: 150, fontFamily: "monospace" }}
      />
    </label>
  );
}

/** 特別徴収・普通徴収（理由）を選ぶ */
function CollectionCell({ row, save }: { row: ReportRow; save: Z["saveSetting"] }) {
  const codes = ORDINARY_REASONS.map((r) => r.code);
  const value = !row.ordinary ? "special" : codes.includes(row.reason) ? row.reason : "other";
  const [other, setOther] = useState(value === "other" ? row.reason : "");
  const disabled = !row.submit;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "special") save(row, { ordinary: false, reason: "" });
          else if (v === "other") save(row, { ordinary: true, reason: other.trim() });
          else save(row, { ordinary: true, reason: v });
        }}
        style={{ ...input, maxWidth: 330 }}
      >
        <option value="special">特別徴収（給与から引く）</option>
        {ORDINARY_REASONS.map((r) => <option key={r.code} value={r.code}>普通徴収：{r.code} {r.label}</option>)}
        <option value="other">普通徴収：そのほかの理由</option>
      </select>
      {value === "other" && !disabled && (
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onBlur={() => save(row, { ordinary: true, reason: other.trim() })}
          placeholder="摘要に書く理由（市区町村の案内にある書き方）"
          style={{ ...input, maxWidth: 330 }}
        />
      )}
      {row.defaultWhy && !disabled && <span style={{ fontSize: 11, color: "#94a3b8" }}>初めの値（{row.defaultWhy}）</span>}
    </div>
  );
}

function GroupCard({ group, z, printNumbers }: { group: MunicipalityGroup<ReportRow>; z: Z; printNumbers: boolean }) {
  const unset = !group.municipality;
  const fillable = group.people.filter((r) => r.suggested);
  const outCount = group.people.filter((r) => r.submit).length;
  return (
    <div style={{ ...card, borderLeft: unset ? "4px solid #f59e0b" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: unset ? "#b45309" : "#1e293b" }}>
          {unset ? "市区町村が未設定" : localGovLabel(group.municipality)}
          {!unset && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: "normal", marginLeft: 8 }}>団体コード {group.code}</span>}
        </div>
        {!unset && <DesignationInput key={`${group.code}:${z.designations[group.code] ?? ""}`} code={group.code} saved={z.designations[group.code] ?? ""} save={z.saveDesignation} />}
        <div style={{ fontSize: 12, color: "#475569", marginLeft: "auto" }}>
          特別徴収 {group.special}人・普通徴収 {group.ordinary}人
          {group.skipped > 0 && <span style={{ color: "#94a3b8" }}>（ほかに出さない退職者 {group.skipped}人）</span>}
        </div>
        {!unset && outCount > 0 && (
          <button type="button" onClick={() => z.printGroup(group, printNumbers && z.myNumberAccess)} style={button}>
            🖨 紙で印刷（総括表と個人別明細書 {outCount}人）
          </button>
        )}
      </div>
      {unset && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "#b45309" }}>従業員の画面の「住民税（特別徴収）」で、市区町村を選んでください。</span>
          {fillable.length > 0 && (
            <button type="button" onClick={() => z.fillFromAddress(fillable)} style={button}>住所から市区町村を入れる（{fillable.length}人）</button>
          )}
        </div>
      )}

      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse", tableLayout: "fixed" }}>
          {/* 市区町村ごとの表で、列の幅をそろえる */}
          <colgroup>
            <col style={{ width: 120 }} />
            <col style={{ width: 190 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 350 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th style={th}>氏名</th>
              <th style={th}>区分</th>
              <th style={{ ...th, textAlign: "right" }}>支払金額</th>
              <th style={{ ...th, textAlign: "right" }}>源泉徴収税額</th>
              <th style={th}>年末調整</th>
              <th style={th}>住民税の徴収</th>
              <th style={th}>注意</th>
            </tr>
          </thead>
          <tbody>
            {group.people.map((r) => (
              <tr key={r.staffId} style={{ opacity: r.submit ? 1 : 0.6 }}>
                <td style={{ ...td, fontWeight: "bold", whiteSpace: "nowrap" }}>{r.name}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.kind === "employed" ? "在職" : `退職（${dateJa(r.retiredOn!)}）`}
                  {!r.required && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: "#64748b" }}>30万円以下なので、出さなくてよい</div>
                      <label style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <input type="checkbox" checked={r.submit} onChange={(e) => z.saveSetting(r, { submit: e.target.checked })} />
                        出す
                      </label>
                    </div>
                  )}
                </td>
                <td style={num}>{yen(r.payment)}</td>
                <td style={num}>{yen(r.withholdingTax)}</td>
                <td style={{ ...td, whiteSpace: "nowrap", color: r.attention ? "#b45309" : "#64748b" }}>{r.status}</td>
                <td style={td}><CollectionCell key={`${r.staffId}:${r.ordinary}:${r.reason}`} row={r} save={z.saveSetting} /></td>
                <td style={{ ...td, fontSize: 11, color: "#b45309", lineHeight: 1.6 }}>
                  {r.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
                  {unset && r.suggested && <div style={{ color: "#64748b" }}>住所から：{localGovLabel(r.suggested)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** eLTAX に取り込む CSV（utils/salaryPaymentReportCsv.ts） */
function CsvCard({ z }: { z: Z }) {
  const c = z.csv;
  const blocked = c.errors.length > 0 || c.count === 0;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: "#1e293b" }}>eLTAX に取り込む CSV</div>
        <button
          type="button"
          onClick={z.exportCsv}
          disabled={blocked}
          style={{
            padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white",
            cursor: blocked ? "not-allowed" : "pointer", backgroundColor: blocked ? "#94a3b8" : "#27ae60",
          }}
        >
          CSV を書き出す（{c.count}人・{c.municipalities}市区町村）
        </button>
      </div>
      {c.errors.map((e) => <p key={e} style={{ fontSize: 12, color: "#b45309", margin: "8px 0 0 0" }}>⚠ {e}</p>)}
      {c.skipped.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#b45309", lineHeight: 1.7 }}>
          <div style={{ fontWeight: "bold" }}>CSV に入らない人（{c.skipped.length}人）：直してから書き出してください</div>
          {c.skipped.map((s) => <div key={s.name}>・{s.name}：{s.reasons.join("／")}</div>)}
        </div>
      )}
      <p style={note}>
        ・eLTAX の PCdesk で「CSV 取込による作成」を選び、このファイルを取り込みます。形式は、地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）」です。
        総括表（会社の情報・人数など）は、PCdesk の画面で入れます。
        <br />・PCdesk では、CSV から作った個人別明細書を後から直せません。地方税共同機構の案内のとおり、初めは1〜2人だけの CSV で取り込みを試すと、誤りを見つけやすくなります。
        <br />・マイナンバー（本人・配偶者・扶養親族）は、「マイナンバー」の画面で登録した番号を書きます。{z.myNumberAccess ? "書き出したことは、マイナンバーの取扱いの記録に残ります。" : "番号を書くのは、事務取扱担当者の印がある人が書き出したときだけです（いまの人が書き出すと、欄は空になります）。"}
        <br />・CSV を Excel で開いて保存すると、先頭の0が消えるなどして取り込めなくなるので、開かずに取り込んでください。マイナンバーを書いた CSV は、持ち運ぶときにパスワードをかけるなどして、なくさないようにします。
        <br />・控除対象配偶者・扶養親族の欄は、年末調整をした人と、年末調整の画面で扶養控除等申告書（乙欄の人は従たる給与についての扶養控除等申告書）の内容を入れた人だけ書きます（源泉徴収票と同じ）。
      </p>
    </div>
  );
}

/** 欄を離れたら保存する入力（紙の総括表の事項） */
function PaperField({ label, value, save, width = 200 }: { label: string; value: string; save: (v: string) => void; width?: number }) {
  const [v, setV] = useState(value);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#64748b" }}>
      {label}
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) save(v); }} style={{ ...input, width }} />
    </label>
  );
}

/** 紙の総括表（地方税法施行規則 第十七号様式）に書く、会社の表にない事項と、印刷のしかた */
function PaperCard({ z, printNumbers, setPrintNumbers }: { z: Z; printNumbers: boolean; setPrintNumbers: (b: boolean) => void }) {
  const p = z.paper;
  const f = (label: string, key: keyof PaperSettings, width?: number) => (
    <PaperField key={`${key}:${p[key]}`} label={label} value={p[key]} save={(v) => z.savePaperSettings({ [key]: v } as Partial<PaperSettings>)} width={width} />
  );
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: "bold", color: "#1e293b" }}>紙の総括表・個人別明細書</div>
      <p style={note}>
        紙で出す市区町村には、市区町村ごとに「給与支払報告書（総括表）」1枚と、出す人ごとの「給与支払報告書（個人別明細書）」を出します（地方税法施行規則 第十七号様式・同別表。用紙 A5）。
        会社名・所在地・法人番号・代表者は「会社設定」の内容を書きます。総括表のほかの事項は、ここで入れておきます（欄を離れると保存します）。
        受給者総人員は{z.year + 1}年1月1日に在籍している人の数、報告人員と給与の支払期間は、その市区町村に出す人から数えます。提出日は、出す日に手で書いてください。
        市区町村によっては、独自の総括表の用紙を送ってくることがあります。その場合は、その用紙に書き写してください。
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {f("給与支払者のフリガナ", "payerKana")}
        {f("源泉徴収をしている事務所の名称（空なら会社名）", "officeName", 240)}
        {f("所在地のフリガナ", "addressKana", 260)}
        {f("事業種目", "businessType", 140)}
        {f("所轄税務署名（「税務署」は付けない）", "taxOffice", 160)}
        {f("給与の支払方法及びその期日", "paymentMethod", 200)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {f("連絡者の所属課", "contactDept", 120)}
        {f("係", "contactSection", 100)}
        {f("氏名", "contactName", 140)}
        {f("電話番号", "contactPhone", 140)}
        {f("関与税理士等の氏名", "accountantName", 140)}
        {f("その電話番号", "accountantPhone", 140)}
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#64748b" }}>
          納入書の送付
          <select value={p.paymentSlip} onChange={(e) => z.savePaperSettings({ paymentSlip: e.target.value as PaperSettings["paymentSlip"] })} style={{ ...input, width: 120 }}>
            <option value="">選ばない（手で丸）</option>
            <option value="need">必要</option>
            <option value="no">不要</option>
          </select>
        </label>
      </div>
      {z.myNumberAccess ? (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", marginTop: 12 }}>
          <input type="checkbox" checked={printNumbers} onChange={(e) => setPrintNumbers(e.target.checked)} />
          個人別明細書にマイナンバーを印刷する（「マイナンバー」の画面で登録した番号。印刷したことは取扱いの記録に残ります）
        </label>
      ) : (
        <p style={{ ...note, color: "#b45309" }}>マイナンバーの欄は空で印刷します（事務取扱担当者の印がある人が印刷すると、登録した番号を書きます）。</p>
      )}
    </div>
  );
}

/** 印刷する中身（市区町村の総括表と、出す人ごとの個人別明細書。1枚ずつ A5 に） */
function PrintArea({ z }: { z: Z }) {
  if (!z.printing) return null;
  const g = z.groups.find((x) => x.code === z.printing!.code);
  if (!g) return null;
  const numbers = z.printing.numbers;
  return createPortal(
    <div id="kyuho-print-root">
      <style>{`
        @media screen { #kyuho-print-root { display: none; } }
        @media print {
          @page { size: A5 portrait; margin: 6mm; }
          #root { display: none !important; }
          .kyuho-page { break-after: page; page-break-after: always; }
          .kyuho-page.report { zoom: 0.8; }
          .kyuho-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="kyuho-page"><SalaryReportSummaryView sheet={z.summarySheetOf(g)} /></div>
      {g.people.filter((r) => r.submit).map((r) => (
        <div key={r.staffId} className="kyuho-page report">
          <WithholdingSlipView
            slip={{ ...r.slip, payer: { address: String(z.company.address ?? ""), name: String(z.company.name ?? ""), phone: String(z.company.phone ?? "") } }}
            report={{
              staffNumber: r.staffId,
              myNumbers: numbers ? numbers[r.staffId] ?? {} : null,
              payerNumber: z.summarySheetOf(g).payerNumber,
              remarks: reportRemarksOf(r),
            }}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const weekdayOf = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return WEEK[new Date(y, m - 1, day).getDay()];
};

export default function SalaryPaymentReportManager({ db, staffList, currentUser, onDataChange }: Props) {
  const z = useSalaryPaymentReportManager(db, staffList, currentUser, onDataChange);
  const [printNumbers, setPrintNumbers] = useState(true);
  const submitting = z.rows.filter((r) => r.submit);
  const special = submitting.filter((r) => !r.ordinary).length;
  const skipped = z.rows.length - submitting.length;
  const unset = submitting.filter((r) => !r.municipality).length;
  const withWarnings = submitting.filter((r) => r.warnings.length > 0).length;
  const notAdjusted = submitting.filter((r) => r.attention).length;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <PrintArea z={z} />
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {REPORT_YEARS.map((y) => <option key={y} value={y}>{y}年分（令和{y - 2018}年分）</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
          <span style={{ fontSize: 13, color: "#1e293b", fontWeight: "bold" }}>出す期限：{dateJa(z.deadline.due)}（{weekdayOf(z.deadline.due)}）</span>
          {z.deadline.due !== z.deadline.statutory && (
            <span style={{ fontSize: 11, color: "#64748b" }}>{dateJa(z.deadline.statutory)}が休日のため（地方税法20条の5第2項）</span>
          )}
        </div>
        <p style={note}>
          市区町村に出す「給与支払報告書（個人別明細書）」の準備をします。{z.year}年に給与・賞与を支払った人を、出す先の市区町村ごとにまとめます（地方税法317条の6）。
          <br />・{z.year + 1}年1月1日に在職している人：その日の住所の市区町村に出します。
          <br />・{z.year}年の途中で退職した人：退職した日の住所の市区町村に出します。{z.year}年の給与が30万円以下の人は、出さなくてもかまいません（出すよう求める市区町村もあります）。
          <br />・出す先は、従業員の画面の「住民税（特別徴収）」で選んだ市区町村です。支払金額・源泉徴収税額は、源泉徴収票と同じです。
          <br />・普通徴収にする人は、理由の符号（普A〜普F）を選びます。符号の基準は市区町村によって少し違うので、出す先の案内を確かめてください。
          指定番号は、市区町村から届いた前年度の「特別徴収税額の決定通知書」に書いてある番号です（初めて出す市区町村は空でかまいません）。
          <br />・令和9年1月からは、給与支払報告書を出せば、税務署に源泉徴収票を出したことになります（従業員に渡す源泉徴収票は、今までどおり要ります）。
          前々年に税務署に出すべきだった源泉徴収票が30枚以上の会社は、eLTAX か光ディスク等で出します（令和9年1月から。令和8年までは100枚以上）。
          <br />・4月1日までに退職した人がいたら、4月15日までに「給与支払報告に係る給与所得者異動届出書」を出します（同条第2項）。
          <br />・紙で出すときは、市区町村ごとの「紙で印刷」で、総括表と個人別明細書を印刷できます（下の「紙の総括表・個人別明細書」で、総括表に書く事項を入れておきます）。
        </p>
      </div>

      {z.rows.length === 0 ? (
        <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>{z.year}年に確定した給与・賞与がありません。</div>
      ) : (
        <>
          <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "#1e293b" }}>
            <div>出す人：<b>{submitting.length}人</b>（特別徴収 {special}人・普通徴収 {submitting.length - special}人）</div>
            <div>市区町村：{z.groups.filter((g) => g.municipality).length}か所</div>
            {skipped > 0 && <div style={{ color: "#64748b" }}>出さない退職者（30万円以下）：{skipped}人</div>}
            {unset > 0 && <div style={{ color: "#b45309" }}>⚠ 市区町村が未設定：{unset}人</div>}
            {withWarnings > 0 && <div style={{ color: "#b45309" }}>⚠ 注意がある人：{withWarnings}人</div>}
            {notAdjusted > 0 && <div style={{ color: "#b45309" }}>⚠ 年末調整が済んでいない人：{notAdjusted}人</div>}
            {special > 0 && special <= 2 && (
              <div style={{ color: "#64748b", flexBasis: "100%", fontSize: 12 }}>
                特別徴収の人が{special}人です。市区町村の基準によっては、「普A（総従業員数が2人以下）」で普通徴収にできます。
              </div>
            )}
          </div>
          <CsvCard z={z} />
          <PaperCard z={z} printNumbers={printNumbers} setPrintNumbers={setPrintNumbers} />
          {z.groups.map((g) => <GroupCard key={g.code || "unset"} group={g} z={z} printNumbers={printNumbers} />)}
        </>
      )}
    </div>
  );
}
