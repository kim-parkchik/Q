/**
 * 社会保険の届書の画面で使う部品（賞与支払届・算定基礎届・月額変更届・賞与不支給報告書・資格取得届・資格喪失届・産休と育休の申出書）
 * ・ShahoFilePanel：電子申請用のファイル（SHFD0006.CSV）の欄（媒体通番・作成年月日・保存・印刷・中身を見る・直すところ）
 * ・UnionFilePanel：健康保険組合に出すファイル（KPFD0006.CSV）の欄（組合ごとに、媒体通番・保存・中身を見る・直すところ）
 * ・ShahoOfficeTable：届書の事業所の欄（事業所整理記号・事業所番号・所在地・名称・事業主氏名・電話番号）
 * ・MyNumberToggle：届書にマイナンバーを書くか（事務取扱担当者だけ。useShahoMyNumbers）
 * ・shahoPrintStyle：印刷するときに、届書の内容だけを出す
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { SHAHO_SPEC_VERSION, SHAHO_UNION_FILE_NAME } from "../../constants/shahoTodoke";
import type { HealthInsurer } from "../../utils/healthInsurer";
import { nextMediaNumber } from "../../utils/shahoCsv";
import { groupByUnion, type UnionRecord } from "../../utils/unionReport";
import type { ShahoFile } from "./useShahoFile";
import type { ShahoMyNumbers } from "./useShahoMyNumbers";

export function ShahoFilePanel({ file, dataLines, blocked, label, count, onPrint, canPrint, onSave, children }: {
  file: ShahoFile;
  /** データレコードの行（作れないときは null） */
  dataLines: string[] | null;
  /** ファイルを作れない理由（事業所の情報のものは、この部品で足す） */
  blocked: string[];
  /** 記録に書く届書の名前 */
  label: string;
  count: number;
  onPrint: () => void;
  canPrint: boolean;
  /** 保存のしかたを変えるとき（マイナンバーを入れてから保存するなど）。なければ dataLines をそのまま保存する */
  onSave?: () => void;
  /** ボタンの左に置く欄（届書を選ぶ欄など） */
  children?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const all = [...blocked, ...file.fileProblems];
  const lines = useMemo(
    () => (dataLines && all.length === 0 ? file.linesFor(dataLines) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataLines, all.length, file.linesFor],
  );
  return (
    <>
      <div style={controls}>
        {children}
        <label style={fieldStyle}>
          <span style={labelStyle}>媒体通番（前の番号の次。999 の次は 1）</span>
          <input type="number" min={1} max={999} value={file.mediaNumber} onChange={(e) => file.setMediaNumber(Number(e.target.value) || 0)} style={{ ...input, width: 90 }} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>作成年月日</span>
          <input type="date" value={file.createdOn} onChange={(e) => file.setCreatedOn(e.target.value)} style={input} />
        </label>
        <button onClick={() => (onSave ? onSave() : dataLines && file.exportFile(dataLines, label, count))} disabled={!lines} style={button(lines ? "#16a34a" : "#94a3b8")}>
          電子申請用のファイルを保存（SHFD0006.CSV）
        </button>
        <button onClick={onPrint} disabled={!canPrint} style={button(canPrint ? "#2563eb" : "#94a3b8")}>印刷する</button>
        <button onClick={() => setShow((v) => !v)} disabled={!lines} style={button(lines ? "#475569" : "#94a3b8")}>
          {show ? "中身を閉じる" : "中身を見る"}
        </button>
      </div>
      {show && lines && (
        <pre style={{ fontSize: 12, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, overflowX: "auto", margin: "0 0 8px" }}>
          {lines.join("\n")}
        </pre>
      )}
      {file.loadError && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{file.loadError}</div>}
      {file.separateOffices.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b45309", lineHeight: 1.6 }}>
          ⚠ このファイルは、本店の事業所（会社設定の事業所整理記号）の届書です。
          {file.separateOffices.map((b) => `「${b.name || `拠点 ${b.id}`}」`).join("・")}は、社会保険番号が入っている本店とは別の適用事業所なので、
          そこで働く人の届書は、その事業所の事業所整理記号で別に出してください（Q は、拠点ごとの事業所のファイルをまだ作れません。
          入れた人がいれば、このファイルから外すか、e-Gov の画面で入れ直してください）。
        </div>
      )}
      {all.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>
          <b>電子申請用のファイルを作る前に、直すところがあります：</b>
          {all.map((b) => <div key={b}>・{b}</div>)}
        </div>
      )}
      <div style={{ ...small, marginTop: 6 }}>電子申請用のファイルの形は、厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」{SHAHO_SPEC_VERSION}による。</div>
    </>
  );
}

/**
 * 届書にマイナンバー（個人番号）を書くかの欄。事務取扱担当者だけが選べ、ほかの人には基礎年金番号で届けることを出す
 * @param who 書く人（「70歳以上被用者」など。なければ、登録してある人）
 */
export function MyNumberToggle({ my, who }: { my: ShahoMyNumbers; who?: string }) {
  if (!my.access) {
    return <div style={{ ...small, marginTop: 4 }}>マイナンバーは、事務取扱担当者だけが届書に書けます。いまは基礎年金番号で届けます。</div>;
  }
  return (
    <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
      <input type="checkbox" checked={my.use} onChange={(e) => my.setUse(e.target.checked)} />
      マイナンバーを書く（{who ? `${who}で、` : ""}登録してある人。保存するときだけ番号を読みます）
    </label>
  );
}

/**
 * 健康保険組合に出すファイル（KPFD0006.CSV）の欄。届書の行のうち、組合に出す行（union）がある人を、組合ごとにまとめる
 * 組合の人がいなければ何も出さない
 */
export function UnionFilePanel({ file, insurers, rows, label, blocked, resolve, onSaved }: {
  file: ShahoFile;
  insurers: Map<number, HealthInsurer>;
  /** 届書の行（problems は年金事務所に出す行の直すところ。組合に出すファイルも、直してから作る） */
  rows: { staffId: string; name: string; union: UnionRecord | null; problems?: string[] }[];
  label: string;
  /** 届書全体の、ファイルを作れない理由（年金事務所のファイルと同じもの） */
  blocked?: string[];
  /** 保存するときに、行の項目をファイルに書く値にする（マイナンバーを入れる。鍵を開けなかった・番号を読めなかったら null） */
  resolve?: (rows: { staffId: string; name?: string; values: string[] }[]) => Promise<{ lines: string[][]; count: number } | null>;
  /** 保存したあと（組合の媒体通番を読み直す） */
  onSaved: (myNumbers: number) => void;
}) {
  const groups = groupByUnion(rows);
  if (groups.length === 0) return null;
  return (
    <div style={{ marginTop: 14, borderTop: "1px dashed #cbd5e1", paddingTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4 }}>健康保険組合に出すファイル（{SHAHO_UNION_FILE_NAME}）</div>
      <div style={{ ...small, marginBottom: 8, lineHeight: 1.6 }}>
        健康保険組合の人の届書は、年金事務所（厚生年金。上のファイル）と健康保険組合（健康保険）の両方に出します。
        組合の電子申請・電子媒体での出し方は、組合に確かめてください（健保固有項目は書きません）。75歳以上の人は、組合には出しません。
      </div>
      {groups.map((g) => {
        const insurer = insurers.get(g.insurerId);
        return insurer ? (
          <UnionGroup key={g.insurerId} file={file} insurer={insurer} rows={g.rows} label={label} blocked={blocked ?? []} resolve={resolve} onSaved={onSaved} />
        ) : null;
      })}
    </div>
  );
}

function UnionGroup({ file, insurer, rows, label, blocked, resolve, onSaved }: {
  file: ShahoFile;
  insurer: HealthInsurer;
  rows: { staffId: string; name: string; union: UnionRecord | null; problems?: string[] }[];
  label: string;
  blocked: string[];
  resolve?: (rows: { staffId: string; name?: string; values: string[] }[]) => Promise<{ lines: string[][]; count: number } | null>;
  onSaved: (myNumbers: number) => void;
}) {
  const [mediaNo, setMediaNo] = useState(nextMediaNumber(insurer.mediaSeq));
  useEffect(() => { setMediaNo(nextMediaNumber(insurer.mediaSeq)); }, [insurer.mediaSeq]);
  const [show, setShow] = useState(false);
  const records = rows.map((r) => ({ staffId: r.staffId, name: r.name, values: r.union!.values }));
  const problems = [
    ...blocked,
    ...file.unionProblems(insurer, mediaNo),
    ...rows.flatMap((r) => [...(r.problems ?? []), ...r.union!.problems].map((p) => `${r.name}：${p}`)),
  ];
  const lines = problems.length === 0 ? file.unionLinesFor(insurer, mediaNo, records.map((r) => r.values.join(","))) : null;
  const save = async () => {
    const resolved = resolve ? await resolve(records) : { lines: records.map((r) => r.values), count: 0 };
    if (!resolved) return;
    const ok = await file.exportUnionFile(insurer, mediaNo, resolved.lines.map((v) => v.join(",")), label, rows.length,
      resolved.count > 0 ? `マイナンバーあり ${resolved.count}人分` : "");
    if (ok) onSaved(resolved.count);
  };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={controls}>
        <div style={{ fontSize: 13, alignSelf: "center" }}>{insurer.name}（{rows.length}人）</div>
        <label style={fieldStyle}>
          <span style={labelStyle}>媒体通番（組合ごとに数える）</span>
          <input type="number" min={1} max={999} value={mediaNo} onChange={(e) => setMediaNo(Number(e.target.value) || 0)} style={{ ...input, width: 90 }} />
        </label>
        <button onClick={save} disabled={!lines} style={button(lines ? "#16a34a" : "#94a3b8")}>組合に出すファイルを保存（{SHAHO_UNION_FILE_NAME}）</button>
        <button onClick={() => setShow((v) => !v)} disabled={!lines} style={button(lines ? "#475569" : "#94a3b8")}>{show ? "中身を閉じる" : "中身を見る"}</button>
      </div>
      {show && lines && (
        <pre style={{ fontSize: 12, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, overflowX: "auto", margin: "0 0 8px" }}>
          {lines.join("\n")}
        </pre>
      )}
      {problems.length > 0 && (
        <div style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>
          <b>{insurer.name}に出すファイルを作る前に、直すところがあります：</b>
          {[...new Set(problems)].map((b) => <div key={b}>・{b}</div>)}
        </div>
      )}
    </div>
  );
}

/** 届書の事業所の欄（office は utils/shahoCsv.ts の shahoOfficeValues の12項目） */
export function ShahoOfficeTable({ office }: { office: string[] }) {
  const o = office;
  const missing = "（会社設定で入れてください）";
  return (
    <table style={{ ...table, marginBottom: 12 }}>
      <tbody>
        <tr>
          <th style={th}>事業所整理記号</th><td style={td}>{o[1] && o[2] ? `${o[1]}-${o[2]}（都道府県コード ${o[0] || "?"}）` : missing}</td>
          <th style={th}>事業所番号</th><td style={td}>{o[3] || missing}</td>
        </tr>
        <tr>
          <th style={th}>事業所所在地</th><td style={td}>〒{o[4]}-{o[5]} {o[6]}</td>
          <th style={th}>電話番号</th><td style={td}>{o[9]}-{o[10]}-{o[11]}</td>
        </tr>
        <tr>
          <th style={th}>事業所名称</th><td style={td}>{o[7]}</td>
          <th style={th}>事業主氏名</th><td style={td}>{o[8]}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** 印刷するときは、id の部分（届書の内容）だけを出す。.no-print は出さず、.print-only は印刷のときだけ出す */
export const shahoPrintStyle = (id: string, landscape: boolean): string => `
.print-only { display: none; }
@media print {
  @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  #${id}, #${id} * { visibility: visible !important; }
  #${id} { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
  .no-print { display: none !important; }
  .print-only { display: inline !important; }
}
`;

export const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
export const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 8 };
export const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
export const labelStyle: CSSProperties = { fontSize: 12, color: "#64748b" };
export const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
export const title: CSSProperties = { fontSize: 16, margin: "0 0 8px" };
export const note: CSSProperties = { fontSize: 12, color: "#475569", lineHeight: 1.7, margin: "0 0 10px" };
export const small: CSSProperties = { fontSize: 11, color: "#64748b" };
export const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
export const th: CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px", backgroundColor: "#f1f5f9", fontWeight: "bold", textAlign: "left", whiteSpace: "nowrap" };
export const td: CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px", verticalAlign: "top" };
export const button = (color: string): CSSProperties => ({ padding: "8px 14px", backgroundColor: color, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 });
