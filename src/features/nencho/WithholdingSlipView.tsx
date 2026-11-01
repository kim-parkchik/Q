/**
 * 給与所得の源泉徴収票（受給者交付用）の見た目
 * 欄の並びは、国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」の様式に合わせる。
 * 受給者交付用なので、マイナンバー・法人番号の欄は作らない。
 */
import type { SlipPerson, WithholdingSlip } from "../../utils/withholdingSlip";
import type { Wareki } from "../../utils/wareki";

const line = "1px solid #000";
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: -1 };
const th: React.CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 2px", textAlign: "center", lineHeight: 1.2, backgroundColor: "#f5f5f5" };
const td: React.CSSProperties = { border: line, fontSize: 11, padding: "2px 4px", height: 18, lineHeight: 1.3 };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const ctr: React.CSSProperties = { ...td, textAlign: "center" };
const inner: React.CSSProperties = { fontSize: 8, color: "#333", float: "left" };

const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString());
const mark = (b: boolean) => (b ? "○" : "");

/** 「内」書きのある金額の欄 */
function Amount({ value, within }: { value: number | null; within?: number | null }) {
  return (
    <td style={num}>
      <span style={inner}>{within !== undefined ? `内 ${n(within)}` : ""}</span>
      {n(value)}
    </td>
  );
}

function PersonCell({ p, rowSpan }: { p: SlipPerson | undefined; rowSpan?: number }) {
  return (
    <td style={{ ...td, height: 30 }} rowSpan={rowSpan}>
      <div style={{ fontSize: 8 }}>{p?.furigana ?? ""}</div>
      <div>{p?.name ?? ""}</div>
    </td>
  );
}

const ymd = (w: Wareki | null) => (w ? [w.era, String(w.year), String(w.month), String(w.day)] : ["", "", "", ""]);

export default function WithholdingSlipView({ slip }: { slip: WithholdingSlip }) {
  const s = slip;
  const c = s.dependentCounts;
  const loan = (i: number) => s.housingLoan.entries[i];
  const loanDate = (i: number) => ymd(loan(i)?.residenceStart ?? null);
  const [jEra, jY, jM, jD] = ymd(s.joinRetire.date);
  const [bEra, bY, bM, bD] = ymd(s.birthday);

  return (
    <div style={{ color: "#000", backgroundColor: "white", fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 24, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>令和 {s.year - 2018} 年分</span>
        <span style={{ fontSize: 17, fontWeight: "bold", letterSpacing: 4 }}>給与所得の源泉徴収票</span>
      </div>

      {/* 支払を受ける者 */}
      <table style={table}>
        <colgroup><col style={{ width: "8%" }} /><col style={{ width: "12%" }} /><col style={{ width: "50%" }} /><col style={{ width: "10%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={3}>支払を受ける者</th>
            <th style={th}>住所又は居所</th>
            <td style={td} colSpan={3}>{s.recipient.address}</td>
          </tr>
          <tr>
            <th style={th}>（フリガナ）</th>
            <td style={{ ...td, fontSize: 9 }}>{s.recipient.furigana}</td>
            <th style={th}>（受給者番号）</th>
            <td style={td}></td>
          </tr>
          <tr>
            <th style={th}>氏名</th>
            <td style={{ ...td, fontSize: 13 }}>{s.recipient.name}</td>
            <th style={th}>（役職名）</th>
            <td style={td}></td>
          </tr>
        </tbody>
      </table>

      {/* 支払金額など */}
      <table style={table}>
        <tbody>
          <tr>
            <th style={th}>種別</th>
            <th style={th}>支払金額</th>
            <th style={th}>給与所得控除後の金額<br />（調整控除後）</th>
            <th style={th}>所得控除の額の合計額</th>
            <th style={th}>源泉徴収税額</th>
          </tr>
          <tr>
            <td style={ctr}>{s.kind}</td>
            <Amount value={s.payment} within={null} />
            <Amount value={s.employmentIncome} />
            <Amount value={s.deductionTotal} />
            <Amount value={s.withholdingTax} within={null} />
          </tr>
        </tbody>
      </table>

      {/* 配偶者・扶養親族の数・障害者の数 */}
      <table style={table}>
        <colgroup>
          {[5, 5, 5, 11].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
          {Array.from({ length: 14 }, (_, i) => <col key={`n${i}`} style={{ width: `${74 / 14}%` }} />)}
        </colgroup>
        <tbody>
          <tr>
            <th style={th} colSpan={3}>（源泉）控除対象配偶者<br />の有無等</th>
            <th style={th} rowSpan={2}>配偶者（特別）<br />控除の額</th>
            <th style={th} colSpan={9}>控除対象扶養親族の数（配偶者を除く。）</th>
            <th style={th} rowSpan={2}>16歳未満<br />扶養親族<br />の数</th>
            <th style={th} colSpan={3}>障害者の数（本人を除く。）</th>
            <th style={th} rowSpan={2}>非居住者<br />である<br />親族の数</th>
          </tr>
          <tr>
            <th style={th}>有</th><th style={th}>従有</th><th style={th}>老人</th>
            <th style={th} colSpan={2}>特定</th>
            <th style={th} colSpan={3}>老人</th>
            <th style={th} colSpan={2}>その他</th>
            <th style={th} colSpan={2}>特親</th>
            <th style={th} colSpan={2}>特別</th>
            <th style={th}>その他</th>
          </tr>
          <tr>
            <td style={ctr}>{mark(s.spouseMark.has)}</td>
            <td style={ctr}></td>
            <td style={ctr}>{mark(s.spouseMark.elderly)}</td>
            <Amount value={s.spouseDeduction} />
            <td style={ctr}>{n(c.specific)}</td><td style={ctr}></td>
            <td style={ctr}><span style={inner}>内</span>{n(c.elderlyTogether)}</td><td style={ctr}>{n(c.elderly)}</td><td style={ctr}></td>
            <td style={ctr}>{n(c.other)}</td><td style={ctr}></td>
            <td style={ctr}>{n(c.specificRelative)}</td><td style={ctr}></td>
            <td style={ctr}>{n(s.youngCount)}</td>
            <td style={ctr}><span style={inner}>内</span>{n(s.disabledCounts.specialTogether)}</td>
            <td style={ctr}>{n(s.disabledCounts.special)}</td>
            <td style={ctr}>{n(s.disabledCounts.other)}</td>
            <td style={ctr}></td>
          </tr>
          <tr>
            <td style={{ ...th, backgroundColor: "white" }} colSpan={3}></td>
            <td style={{ ...th, backgroundColor: "white" }}>円</td>
            <td style={{ ...th, backgroundColor: "white" }}>人</td><td style={{ ...th, backgroundColor: "white" }}>従人</td>
            <td style={{ ...th, backgroundColor: "white" }}>内</td><td style={{ ...th, backgroundColor: "white" }}>人</td><td style={{ ...th, backgroundColor: "white" }}>従人</td>
            <td style={{ ...th, backgroundColor: "white" }}>人</td><td style={{ ...th, backgroundColor: "white" }}>従人</td>
            <td style={{ ...th, backgroundColor: "white" }}>人</td><td style={{ ...th, backgroundColor: "white" }}>従人</td>
            <td style={{ ...th, backgroundColor: "white" }}>人</td>
            <td style={{ ...th, backgroundColor: "white" }}>内</td><td style={{ ...th, backgroundColor: "white" }}>人</td><td style={{ ...th, backgroundColor: "white" }}>人</td>
            <td style={{ ...th, backgroundColor: "white" }}>人</td>
          </tr>
        </tbody>
      </table>

      {/* 控除額 */}
      <table style={table}>
        <tbody>
          <tr>
            <th style={th}>特定親族特別控除の額</th>
            <th style={th}>社会保険料等の金額</th>
            <th style={th}>生命保険料の控除額</th>
            <th style={th}>地震保険料の控除額</th>
            <th style={th}>住宅借入金等特別控除の額</th>
          </tr>
          <tr>
            <Amount value={s.specificRelativeDeduction} />
            <Amount value={s.socialInsurance} within={s.smallBusinessMutualAid} />
            <Amount value={s.lifeInsuranceDeduction} />
            <Amount value={s.earthquakeDeduction} />
            <Amount value={s.housingLoanCredit} />
          </tr>
        </tbody>
      </table>

      {/* 摘要 */}
      <table style={table}>
        <tbody>
          <tr><th style={{ ...th, textAlign: "left" }}>（摘要）</th></tr>
          <tr><td style={{ ...td, height: 42, fontSize: 10, verticalAlign: "top" }}>{s.remarks.join("　")}</td></tr>
        </tbody>
      </table>

      {/* 生命保険料の金額の内訳 */}
      <table style={table}>
        <colgroup><col style={{ width: "10%" }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>生命保険料<br />の金額の<br />内訳</th>
            <th style={th}>新生命保険料の金額</th>
            <th style={th}>旧生命保険料の金額</th>
            <th style={th}>介護医療保険料の金額</th>
            <th style={th}>新個人年金保険料の金額</th>
            <th style={th}>旧個人年金保険料の金額</th>
          </tr>
          <tr>
            <Amount value={s.lifeInsurancePaid.generalNew} />
            <Amount value={s.lifeInsurancePaid.generalOld} />
            <Amount value={s.lifeInsurancePaid.medical} />
            <Amount value={s.lifeInsurancePaid.pensionNew} />
            <Amount value={s.lifeInsurancePaid.pensionOld} />
          </tr>
        </tbody>
      </table>

      {/* 住宅借入金等特別控除の額の内訳 */}
      <table style={table}>
        <colgroup>
          <col style={{ width: "9%" }} /><col style={{ width: "10%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} />
          <col style={{ width: "6%" }} /><col style={{ width: "4%" }} /><col style={{ width: "4%" }} /><col style={{ width: "4%" }} />
          <col style={{ width: "10%" }} /><col style={{ width: "8%" }} /><col style={{ width: "10%" }} /><col style={{ width: "14%" }} />
        </colgroup>
        <tbody>
          {[0, 1].map((i) => (
            <tr key={i}>
              {i === 0 && <th style={th} rowSpan={2}>住宅借入金<br />等特別控除<br />の額の内訳</th>}
              <th style={th}>{i === 0 ? <>住宅借入金等<br />特別控除適用数</> : <>住宅借入金等<br />特別控除可能額</>}</th>
              {i === 0 ? <td style={ctr}>{n(s.housingLoan.count)}</td> : <Amount value={s.housingLoan.available} />}
              <th style={th}>居住開始年月日<br />（{i + 1}回目）</th>
              {loanDate(i).map((v, k) => <td key={k} style={{ ...ctr, fontSize: k === 0 ? 9 : 11 }}>{v}</td>)}
              <th style={th}>住宅借入金等特別<br />控除区分（{i + 1}回目）</th>
              <td style={{ ...ctr, fontSize: 10 }}>{loan(i)?.kindLabel ?? ""}</td>
              <th style={th}>住宅借入金等<br />年末残高（{i + 1}回目）</th>
              <Amount value={loan(i)?.yearEndBalance ?? null} />
            </tr>
          ))}
        </tbody>
      </table>

      {/* 控除対象配偶者・配偶者の合計所得など */}
      <table style={table}>
        <colgroup>
          <col style={{ width: "11%" }} /><col style={{ width: "22%" }} /><col style={{ width: "6%" }} />
          <col style={{ width: "12.2%" }} /><col style={{ width: "12.2%" }} /><col style={{ width: "12.2%" }} /><col style={{ width: "12.2%" }} /><col style={{ width: "12.2%" }} />
        </colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>（源泉・特別）<br />控除対象<br />配偶者</th>
            <PersonCell p={s.spouse ?? undefined} rowSpan={2} />
            <td style={ctr} rowSpan={2}><span style={inner}>区分</span>{s.spouse?.code ?? ""}</td>
            <th style={th}>配偶者の合計所得</th>
            <th style={th}>国民年金保険料等<br />の金額</th>
            <th style={th}>旧長期損害保険料<br />の金額</th>
            <th style={th}>基礎控除の額</th>
            <th style={th}>所得金額調整<br />控除額</th>
          </tr>
          <tr>
            <Amount value={s.spouseTotalIncome} />
            <Amount value={s.nationalPension} />
            <Amount value={s.oldLongTerm} />
            <Amount value={s.basicDeduction} />
            <Amount value={s.incomeAdjustment} />
          </tr>
        </tbody>
      </table>

      {/* 控除対象扶養親族・16歳未満の扶養親族 */}
      <table style={table}>
        <colgroup>
          <col style={{ width: "7%" }} /><col style={{ width: "3%" }} /><col style={{ width: "27%" }} /><col style={{ width: "6%" }} />
          <col style={{ width: "7%" }} /><col style={{ width: "3%" }} /><col style={{ width: "27%" }} /><col style={{ width: "6%" }} /><col style={{ width: "14%" }} />
        </colgroup>
        <tbody>
          {[0, 1, 2, 3].map((i) => (
            <tr key={i}>
              {i === 0 && <th style={th} rowSpan={4}>控除対象<br />扶養親族</th>}
              <td style={{ ...ctr, fontSize: 9 }}>{i + 1}</td>
              <PersonCell p={s.dependents[i]} />
              <td style={ctr}><span style={inner}>区分</span>{s.dependents[i]?.code ?? ""}</td>
              {i === 0 && <th style={th} rowSpan={4}>16歳未満<br />の扶養<br />親族</th>}
              <td style={{ ...ctr, fontSize: 9 }}>{i + 1}</td>
              <PersonCell p={s.youngDependents[i]} />
              <td style={ctr}><span style={inner}>区分</span>{s.youngDependents[i]?.code ?? ""}</td>
              {i === 0 && <td style={{ ...td, verticalAlign: "top", fontSize: 8 }} rowSpan={4}>（備考）</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 未成年者〜受給者生年月日 */}
      <table style={table}>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>未成年者</th>
            <th style={th} rowSpan={2}>外国人</th>
            <th style={th} rowSpan={2}>死亡退職</th>
            <th style={th} rowSpan={2}>災害者</th>
            <th style={th} rowSpan={2}>乙欄</th>
            <th style={th} colSpan={2}>本人が障害者</th>
            <th style={th} rowSpan={2}>寡婦</th>
            <th style={th} rowSpan={2}>ひとり親</th>
            <th style={th} rowSpan={2}>勤労学生</th>
            <th style={th} colSpan={6}>中途就・退職</th>
            <th style={th} colSpan={4}>受給者生年月日</th>
          </tr>
          <tr>
            <th style={th}>特別</th><th style={th}>その他</th>
            <th style={th}>就職</th><th style={th}>退職</th><th style={th}>元号</th><th style={th}>年</th><th style={th}>月</th><th style={th}>日</th>
            <th style={th}>元号</th><th style={th}>年</th><th style={th}>月</th><th style={th}>日</th>
          </tr>
          <tr>
            <td style={ctr}>{mark(s.marks.minor)}</td>
            <td style={ctr}></td>
            <td style={ctr}></td>
            <td style={ctr}></td>
            <td style={ctr}>{mark(s.marks.otsu)}</td>
            <td style={ctr}>{mark(s.marks.selfSpecialDisabled)}</td>
            <td style={ctr}>{mark(s.marks.selfDisabled)}</td>
            <td style={ctr}>{mark(s.marks.widow)}</td>
            <td style={ctr}>{mark(s.marks.singleParent)}</td>
            <td style={ctr}>{mark(s.marks.workingStudent)}</td>
            <td style={ctr}>{mark(s.joinRetire.joined)}</td>
            <td style={ctr}>{mark(s.joinRetire.retired)}</td>
            <td style={{ ...ctr, fontSize: 9 }}>{jEra}</td><td style={ctr}>{jY}</td><td style={ctr}>{jM}</td><td style={ctr}>{jD}</td>
            <td style={{ ...ctr, fontSize: 9 }}>{bEra}</td><td style={ctr}>{bY}</td><td style={ctr}>{bM}</td><td style={ctr}>{bD}</td>
          </tr>
        </tbody>
      </table>

      {/* 支払者 */}
      <table style={table}>
        <colgroup><col style={{ width: "8%" }} /><col style={{ width: "16%" }} /><col style={{ width: "76%" }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={3}>支払者</th>
            <th style={th}>住所（居所）<br />又は所在地</th>
            <td style={td}>{s.payer.address}</td>
          </tr>
          <tr>
            <th style={th}>氏名又は名称</th>
            <td style={td}>{s.payer.name}</td>
          </tr>
          <tr>
            <th style={th}>電話番号</th>
            <td style={td}>{s.payer.phone}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 9, textAlign: "right", marginTop: 2 }}>（受給者交付用）</div>
    </div>
  );
}
