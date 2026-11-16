/**
 * 算定基礎届・月額変更届の内容の表（画面と印刷。紙の届書と同じく、1人を3か月の3行で出す）
 * 備考欄（その他）と、月額変更届の昇給・降給の理由は、ここで直せる（印刷では、直した文を出す）
 * 作り方は utils/remunerationReport.ts
 */
import type { CSSProperties } from "react";
import type { GeppenReportRow, SanteiReportRow } from "../../utils/remunerationReport";
import { warekiMonth } from "../../utils/remunerationReport";
import { formatWareki } from "../../utils/wareki";
import { small, table, td, th } from "./ShahoFilePanel";

type Row = SanteiReportRow | GeppenReportRow;
const isGeppen = (r: Row): r is GeppenReportRow => "revisionFrom" in r;
const yen = (n: number | null) => (n === null ? "" : `${n.toLocaleString()}円`);
const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const textInput: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "2px 4px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11 };

/** 算定基礎届の備考（印を付ける項目） */
const santeiFlags = (r: SanteiReportRow): string[] => [
  r.over70 ? `1. 70歳以上被用者算定${r.over70Months.length > 0 ? `（算定基礎月：${r.over70Months.join("・")}月）` : ""}` : "",
  r.multiOffice ? "2. 二以上勤務" : "",
  r.partialJoin ? "4. 途中入社" : "",
  r.leave ? "5. 病休・育休・休職等" : "",
  r.kind === "short" ? "6. 短時間労働者（特定適用事業所等）" : "",
  r.kind === "part" ? "7. パート" : "",
  r.annual ? "8. 年間平均" : "",
  r.over70Only ? "（70歳以上被用者算定基礎届のみ）" : "",
].filter(Boolean);

/** 月額変更届の備考（印を付ける項目） */
const geppenFlags = (r: GeppenReportRow): string[] => [
  r.over70 ? "1. 70歳以上被用者月額変更" : "",
  r.multiOffice ? "2. 二以上勤務" : "",
  r.short ? "3. 短時間労働者（特定適用事業所等）" : "",
  r.over70Only ? "（70歳以上被用者月額変更届のみ）" : "",
].filter(Boolean);

/** 直せる文（印刷では文だけを出す） */
function EditableText({ value, auto, onChange, placeholder }: {
  value: string;
  auto: string;
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  return (
    <>
      <span className="print-only">{value}</span>
      <span className="no-print" style={{ display: "block" }}>
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={textInput} />
        {value !== auto && (
          <button type="button" onClick={() => onChange(null)} style={{ padding: 0, border: "none", background: "none", color: "#2563eb", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
            初めの文に戻す
          </button>
        )}
      </span>
    </>
  );
}

export function RemunerationReportTable({ rows, rowKey, onRemarks, onReason }: {
  rows: Row[];
  rowKey: (row: Row) => string;
  /** 備考欄（その他）を直す（null は初めの文に戻す） */
  onRemarks: (key: string, value: string | null) => void;
  /** 昇給・降給の理由を直す（月額変更届） */
  onReason?: (key: string, value: string | null) => void;
}) {
  if (rows.length === 0) return <div style={small}>届け出る人がいません。</div>;
  const geppen = isGeppen(rows[0]);
  return (
    <table style={{ ...table, fontSize: 11 }}>
      <thead>
        <tr>
          <th style={th}>①被保険者<br />整理番号</th>
          <th style={th}>②被保険者氏名</th>
          <th style={th}>③生年月日</th>
          <th style={th}>{geppen ? "④改定年月" : "④適用年月"}</th>
          <th style={th}>⑤従前の<br />標準報酬月額</th>
          <th style={th}>⑥従前<br />改定月</th>
          <th style={th}>⑦昇（降）給</th>
          <th style={th}>⑧遡及<br />支払額</th>
          <th style={th}>⑨給与<br />支給月</th>
          <th style={th}>⑩基礎<br />日数</th>
          <th style={th}>⑪通貨</th>
          <th style={th}>⑫現物</th>
          <th style={th}>⑬合計</th>
          <th style={th}>⑭総計・⑮平均額・<br />⑯修正平均額</th>
          <th style={th}>⑰個人番号・基礎年金番号<br />（70歳以上被用者）</th>
          <th style={{ ...th, minWidth: 180 }}>⑱備考</th>
          <th style={{ ...th, minWidth: 200 }} className="no-print">確かめること</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const key = rowKey(r);
          const bg = r.problems.length > 0 ? { backgroundColor: "#fef2f2" } : undefined;
          const span = { rowSpan: r.months.length };
          return r.months.map((m, i) => (
            <tr key={`${key}-${i}`} style={bg}>
              {i === 0 && (
                <>
                  <td style={num} {...span}>{r.pensionNumber || (r.over70Only ? "（書かない）" : "")}</td>
                  <td style={td} {...span}>{r.name}<div style={small}>{r.kana}</div></td>
                  <td style={td} {...span}>{r.values[7] && `${r.values[7]}-${r.values[8]}`}<div style={small}>{formatWareki(r.birthday)}</div></td>
                  <td style={td} {...span}>{warekiMonth(isGeppen(r) ? r.revisionFrom : r.applyFrom)}</td>
                  <td style={td} {...span}>
                    健 {r.previousHealth !== null ? `${r.previousHealth / 1000}千円` : "—"}<br />
                    厚 {r.previousPension !== null ? `${r.previousPension / 1000}千円` : "—"}
                  </td>
                  <td style={td} {...span}>{warekiMonth(r.previousFrom)}</td>
                  <td style={td} {...span}>{r.wageChange ? `${r.wageChange.month}月 ${r.wageChange.direction === "up" ? "1. 昇給" : "2. 降給"}` : ""}</td>
                  <td style={td} {...span}>{r.retro ? `${r.retro.month}月 ${yen(r.retro.amount)}` : ""}</td>
                </>
              )}
              <td style={num}>{m.month}月</td>
              <td style={{ ...num, color: m.counted ? undefined : "#94a3b8" }}>{m.days}日</td>
              <td style={num}>{yen(m.currency)}</td>
              <td style={num}>{yen(m.inKind)}</td>
              <td style={{ ...num, color: m.counted ? undefined : "#94a3b8" }}>{yen(m.total)}</td>
              <td style={num}>
                {i === 0 && <>⑭ {yen(r.sum)}</>}
                {i === 1 && <>⑮ {yen(r.average)}</>}
                {i === 2 && <>⑯ {yen(r.modifiedAverage)}</>}
              </td>
              {i === 0 && (
                <>
                  <td style={td} {...span}>{r.myNumber ? "マイナンバー" : r.basicPensionNumber}</td>
                  <td style={td} {...span}>
                    {(isGeppen(r) ? geppenFlags(r) : santeiFlags(r)).map((t) => <div key={t}>{t}</div>)}
                    {isGeppen(r) && (
                      <div>
                        4. 昇給・降給の理由
                        <EditableText value={r.reason} auto={r.autoReason} placeholder="基本給の変更など" onChange={(v) => onReason?.(key, v)} />
                      </div>
                    )}
                    <div>
                      {isGeppen(r) ? "6." : "9."} その他
                      <EditableText value={r.remarks} auto={r.autoRemarks} placeholder="現物給与の名前など" onChange={(v) => onRemarks(key, v)} />
                    </div>
                  </td>
                  <td style={td} {...span} className="no-print">
                    {r.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>⚠ {p}</div>)}
                    {r.notes.map((n) => <div key={n} style={{ color: "#475569" }}>{n}</div>)}
                  </td>
                </>
              )}
            </tr>
          ));
        })}
      </tbody>
    </table>
  );
}
