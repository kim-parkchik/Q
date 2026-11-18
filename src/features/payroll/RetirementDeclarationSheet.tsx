/**
 * 「退職所得の受給に関する申告書（退職所得申告書）」の下書きの見た目（utils/retirementDeclaration.ts の内容）
 * 欄の並びは、国税庁の様式（令和8年1月1日以後。taishoku-tables/source/shinkokusho-2026.pdf）の A〜E 欄に合わせる。
 * 本人が確かめ、生活扶助の有無・個人番号などを書いて出すもの（Q は個人番号を書かない）
 */
import type { CSSProperties, ReactNode } from "react";
import { RETIREMENT_KIND_LABELS } from "../../utils/retirementIncome";
import type { DeclPeriod, RetirementDeclaration } from "../../utils/retirementDeclaration";
import { formatWareki } from "../../utils/wareki";
import type { SlipPayer } from "./RetirementSlipSheet";

const line = "1px solid #000";
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: -1 };
const th: CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 3px", textAlign: "left", lineHeight: 1.25, backgroundColor: "#f5f5f5" };
const td: CSSProperties = { border: line, fontSize: 10, padding: "2px 4px", height: 18, lineHeight: 1.3 };
const num: CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const mark: CSSProperties = { ...td, textAlign: "center", width: 28, fontSize: 9 };
const head: CSSProperties = { fontSize: 10, fontWeight: "bold", margin: "8px 0 2px" };

/** 期間の行（有・無と、期間・年数） */
function PeriodRow({ label, p, indent = 0, hasMark = true }: { label: string; p: DeclPeriod | null; indent?: number; hasMark?: boolean }) {
  return (
    <tr>
      <th style={{ ...th, paddingLeft: 3 + indent * 12 }}>{label}</th>
      <td style={mark}>{hasMark ? (p ? "有" : "無") : ""}</td>
      <td style={td}>{p?.label ?? ""}</td>
      <td style={{ ...num, width: 44 }}>{p && p.years !== null ? `${p.years} 年` : ""}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div style={head}>{title}</div>
      <table style={table}>
        <colgroup><col style={{ width: 230 }} /><col style={{ width: 28 }} /><col /><col style={{ width: 44 }} /></colgroup>
        <tbody>{children}</tbody>
      </table>
    </>
  );
}

export interface DeclarationParty {
  name: string;
  address: string;
  januaryAddress: string;
  /** 住民税の市区町村（1月1日の住所の市区町村） */
  municipality: string;
}

export default function RetirementDeclarationSheet({ data, payer, person }: { data: RetirementDeclaration; payer: SlipPayer; person: DeclarationParty }) {
  const w = (d: string) => (d ? formatWareki(d) : "");
  return (
    <div className="page" style={{ width: "100%", maxWidth: 720, margin: "0 auto 16px", fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", color: "#000" }}>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: "bold" }}>
        {formatWareki(`${data.year}-12-31`).replace(/12月31日$/, "")}分　退職所得の受給に関する申告書（退職所得申告書）
      </div>
      <div style={{ textAlign: "center", fontSize: 9, marginBottom: 4 }}>（下書き：内容を確かめ、生活扶助の有無と個人番号を書いて、支払者に出してください）</div>
      <div style={{ fontSize: 10, marginBottom: 2 }}>
        （　　　　　）税務署長　／　{person.municipality ? `${person.municipality}長` : "（　　　　　）市町村長"}　殿
      </div>
      <table style={table}>
        <colgroup><col style={{ width: 44 }} /><col style={{ width: 90 }} /><col /><col style={{ width: 90 }} /><col /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={3}>退職手当の支払者</th><th style={th}>所在地（住所）</th><td style={td}>{payer.address}</td>
            <th style={th} rowSpan={3}>あなた</th><td style={td}><span style={{ fontSize: 8 }}>現住所</span> {person.address}</td>
          </tr>
          <tr><th style={th}>名称（氏名）</th><td style={td}>{payer.name}</td><td style={td}><span style={{ fontSize: 8 }}>氏名</span> {person.name}</td></tr>
          <tr>
            <th style={th}>法人番号（※支払者が記載）</th><td style={{ ...td, fontFamily: "monospace" }}>{payer.corporateNumber}</td>
            <td style={td}><span style={{ fontSize: 8 }}>個人番号</span></td>
          </tr>
          <tr>
            <td style={{ ...td, borderRight: "none" }} colSpan={3} />
            <th style={th}>その年1月1日現在の住所</th><td style={td}>{person.januaryAddress}</td>
          </tr>
        </tbody>
      </table>

      <div style={head}>A　全ての人が書きます</div>
      <table style={table}>
        <colgroup><col style={{ width: 230 }} /><col /></colgroup>
        <tbody>
          <tr><th style={th}>① 退職手当等の支払を受けることとなった年月日</th><td style={td}>{w(data.fixedDate)}</td></tr>
          <tr>
            <th style={th}>② 退職の区分等</th>
            <td style={td}>
              〈一般・障害の区分〉 {data.disability ? "一般 ・ 〔障害〕（障害の状態・手帳の交付年月日など：　　　　　　　　）" : "〔一般〕 ・ 障害"}
              　〈生活扶助の有無〉 有 ・ 無
            </td>
          </tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 230 }} /><col style={{ width: 28 }} /><col /><col style={{ width: 44 }} /></colgroup>
        <tbody>
          <tr>
            <th style={th}>③ この申告書の提出先から受ける退職手当等についての勤続期間</th>
            <td style={mark} /><td style={td}>{data.a.service?.label ?? ""}</td><td style={{ ...num, width: 44 }}>{data.a.service ? `${data.a.service.years} 年` : ""}</td>
          </tr>
          <PeriodRow label="うち 特定役員等勤続期間" p={data.a.officer} indent={1} />
          <PeriodRow label="うち 一般勤続期間との重複勤続期間" p={data.a.officerGeneral} indent={2} />
          <PeriodRow label="うち 短期勤続期間との重複勤続期間" p={data.a.officerShort} indent={2} />
          <PeriodRow label="うち 短期勤続期間" p={data.a.short} indent={1} />
        </tbody>
      </table>

      <Section title="B　本年中に他にも退職手当等の支払を受けたことがある場合">
        <PeriodRow label="④ 本年中に支払を受けた他の退職手当等についての勤続期間" p={data.b?.other ?? null} hasMark={false} />
        <PeriodRow label="うち 特定役員等勤続期間" p={data.b?.otherOfficer ?? null} indent={1} />
        <PeriodRow label="うち 短期勤続期間" p={data.b?.otherShort ?? null} indent={1} />
        <PeriodRow label="⑤ ③と④の通算勤続期間" p={data.b?.total ?? null} hasMark={false} />
        <PeriodRow label="うち 特定役員等勤続期間" p={data.b?.officer ?? null} indent={1} />
        <PeriodRow label="うち 一般勤続期間との重複勤続期間" p={data.b?.officerGeneral ?? null} indent={2} />
        <PeriodRow label="うち 短期勤続期間との重複勤続期間" p={data.b?.officerShort ?? null} indent={2} />
        <PeriodRow label="うち 全重複勤続期間" p={data.b?.full ?? null} indent={2} />
        <PeriodRow label="うち 短期勤続期間" p={data.b?.short ?? null} indent={1} />
        <PeriodRow label="うち 一般勤続期間との重複勤続期間" p={data.b?.shortGeneral ?? null} indent={2} />
      </Section>

      <Section title="C　前年以前4年内（確定拠出年金の一時金は9年内・19年内）に退職手当等の支払を受けた場合">
        <PeriodRow label="⑥ 前年以前に支払を受けた退職手当等についての勤続期間" p={data.c?.prior ?? null} hasMark={false} />
        <PeriodRow label="⑦ ③又は⑤の勤続期間のうち、⑥の勤続期間と重複している期間" p={data.c?.overlap ?? null} hasMark={false} />
        <PeriodRow label="㋑ うち 特定役員等勤続期間との重複勤続期間" p={data.c?.officer ?? null} indent={1} />
        <PeriodRow label="㋺ うち 短期勤続期間との重複勤続期間" p={data.c?.short ?? null} indent={1} />
      </Section>

      <Section title="D　前に支払を受けた退職手当等の勤続期間が通算されている場合">
        <PeriodRow label="⑧ ③に通算された前の退職手当等についての勤続期間" p={data.d?.included ?? null} hasMark={false} />
        <PeriodRow label="うち 特定役員等勤続期間" p={data.d?.includedOfficer ?? null} indent={1} />
        <PeriodRow label="うち 短期勤続期間" p={data.d?.includedShort ?? null} indent={1} />
        <PeriodRow label="⑨ ④に通算された前の退職手当等についての勤続期間" p={null} hasMark={false} />
        <PeriodRow label="⑩ ③又は⑤のうち、⑧又は⑨の勤続期間だけからなる部分の期間" p={data.d?.only ?? null} hasMark={false} />
        <PeriodRow label="㋩ うち 特定役員等勤続期間" p={data.d?.onlyOfficer ?? null} indent={1} />
        <PeriodRow label="㋥ うち 短期勤続期間" p={data.d?.onlyShort ?? null} indent={1} />
        <PeriodRow label="⑪ ⑦と⑩の通算期間" p={data.d?.total ?? null} hasMark={false} />
        <PeriodRow label="㋭ ㋑と㋩の通算期間" p={data.d?.totalOfficer ?? null} indent={1} />
        <PeriodRow label="㋬ ㋺と㋥の通算期間" p={data.d?.totalShort ?? null} indent={1} />
      </Section>

      <div style={head}>E　B又はCの退職手当等がある場合</div>
      <table style={table}>
        <colgroup>
          <col style={{ width: 24 }} /><col style={{ width: 70 }} /><col style={{ width: 92 }} /><col style={{ width: 82 }} /><col style={{ width: 70 }} />
          <col style={{ width: 62 }} /><col style={{ width: 62 }} /><col /><col style={{ width: 40 }} />
        </colgroup>
        <tbody>
          <tr>
            <th style={th}>区分</th><th style={th}>退職手当等の区分</th><th style={th}>支払を受けることとなった年月日</th><th style={th}>収入金額（円）</th>
            <th style={th}>源泉徴収税額（円）</th><th style={th}>特別徴収税額 市町村民税</th><th style={th}>特別徴収税額 道府県民税</th>
            <th style={th}>支払者の所在地（住所）・名称（氏名）</th><th style={th}>老齢給付金</th>
          </tr>
          {(data.e.length ? data.e : [null, null]).map((x, i) => (
            <tr key={i}>
              <td style={{ ...td, textAlign: "center" }}>{x?.section ?? ""}</td>
              <td style={{ ...td, fontSize: 8 }}>{x ? RETIREMENT_KIND_LABELS[x.kind] : ""}</td>
              <td style={{ ...td, fontSize: 9 }}>{x ? w(x.paidOn) : ""}</td>
              <td style={num}>{x ? x.amount.toLocaleString() : ""}</td>
              <td style={num}>{x && x.incomeTax !== null ? x.incomeTax.toLocaleString() : ""}</td>
              <td style={num}>{x && x.cityTax !== null ? x.cityTax.toLocaleString() : ""}</td>
              <td style={num}>{x && x.prefTax !== null ? x.prefTax.toLocaleString() : ""}</td>
              <td style={{ ...td, fontSize: 8 }}>{x ? [x.payerAddress, x.payer].filter(Boolean).join("　") : ""}</td>
              <td style={{ ...td, textAlign: "center" }}>{x?.dc ? "○" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 8, marginTop: 4, lineHeight: 1.5 }}>
        Bの退職手当等がある人は、その退職所得の源泉徴収票（特別徴収票）又はその写しをこの申告書に添付してください。
      </div>
    </div>
  );
}
