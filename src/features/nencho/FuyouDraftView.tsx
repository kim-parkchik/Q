/**
 * 翌年分の「給与所得者の扶養控除等（異動）申告書」の下書き（全員分。1人1枚で印刷する）
 * その年の年末調整で出してもらった申告書の内容から作る（utils/fuyouDeclarationDraft.ts）。従業員に配り、確かめて直してもらい、
 * 翌年分の申告書（国税庁の様式）を出してもらう。マイナンバーは出さない
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { buildFuyouDraft, DISABILITY_LABELS, DRAFT_AGE_KIND_LABELS, type DraftPerson } from "../../utils/fuyouDeclarationDraft";
import { formatWareki } from "../../utils/wareki";
import * as S from "../payroll/reportStyles";
import type { NenchoStaffRow } from "./useNenchoManager";

const PRINT_ID = "fuyou-draft-print";
const yen = (n: number) => `${n.toLocaleString()}円`;

export default function FuyouDraftView({ db, year, rows }: { db: Database; year: number; rows: NenchoStaffRow[] }) {
  const next = year + 1;
  const [payer, setPayer] = useState({ name: "", address: "" });
  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name, address FROM company WHERE id = 1");
        setPayer({ name: String(c?.[0]?.name ?? ""), address: String(c?.[0]?.address ?? "") });
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);
  // 翌年も在籍する人（その年の12月31日までに退職した人は除く）
  const people = useMemo(() => rows.filter((r) => !r.staff.retirement_date || String(r.staff.retirement_date) > `${year}-12-31`), [rows, year]);
  const nextW = formatWareki(`${next}-01-01`).replace(/1月1日$/, "");

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.controls}>
        <h3 style={{ margin: 0, fontSize: 15, alignSelf: "center" }}>{next}年分 扶養控除等（異動）申告書の下書き（{people.length}人）</h3>
        <span style={{ flex: 1 }} />
        <button onClick={() => window.print()} disabled={people.length === 0} style={S.button("#2563eb", people.length === 0)}>🖨 全員分を印刷・PDF保存</button>
      </div>
      <div className="no-print" style={{ ...S.note, marginBottom: 10 }}>
        {year}年の年末調整で出してもらった申告書の内容から、{next}年分の申告書に書く内容の下書きを作ります。従業員に配って確かめてもらい、
        変わったところ（結婚・出産・就職・所得の見積額など）を直して、{next}年分の「給与所得者の扶養控除等（異動）申告書」を、{next}年最初の給与の支払を受ける日の前日までに出してもらいます（所得税法194条）。
        年齢と区分は {next}年12月31日の年齢です。所得の見積額は {next}年の分を本人が書きます（下書きには {year}年の見積額を参考に出します）。マイナンバーは出しません。
      </div>
      <div id={PRINT_ID}>
        {people.map((r) => {
          const d = buildFuyouDraft(r.saved?.declaration ?? null, next);
          const s = r.staff;
          return (
            <div key={s.id} className="page" style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>{nextW}分 給与所得者の扶養控除等（異動）申告書 の下書き</h2>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
                {year}年の申告書から作った下書きです。違っているところ・変わるところを直して、申告書を出してください。
              </div>
              <table style={{ ...S.table, marginBottom: 8 }}>
                <tbody>
                  <tr><td style={{ ...S.td, width: 140 }}>給与の支払者</td><td style={S.td} colSpan={3}>{payer.name}（{payer.address}）</td></tr>
                  <tr>
                    <td style={S.td}>あなたの氏名（フリガナ）</td><td style={S.td}>{s.name}（{s.furigana ?? ""}）</td>
                    <td style={{ ...S.td, width: 90 }}>生年月日</td><td style={S.td}>{formatWareki(s.birthday)}</td>
                  </tr>
                  <tr><td style={S.td}>住所又は居所</td><td style={S.td} colSpan={3}>{s.address ?? ""}</td></tr>
                  <tr><td style={S.td}>世帯主の氏名・続柄</td><td style={S.td} colSpan={3}><span style={{ color: "#94a3b8" }}>（書いてください）</span></td></tr>
                  <tr><td style={S.td}>障害者・寡婦・ひとり親・勤労学生</td><td style={S.td} colSpan={3}>{d.self.length > 0 ? d.self.join("・") : "なし"}</td></tr>
                </tbody>
              </table>
              <Section title="配偶者" empty="なし（配偶者がいる人は、源泉控除対象配偶者になるかを確かめます）">
                {d.spouse && <PersonRow p={d.spouse} next={next} year={year} extra={d.spouse.elderly ? "老人控除対象配偶者（70歳以上）" : ""} />}
              </Section>
              <Section title="控除対象扶養親族（16歳以上）" empty="なし">
                {d.dependents.map((p, i) => <PersonRow key={i} p={p} next={next} year={year} extra={p.kind ? DRAFT_AGE_KIND_LABELS[p.kind] : "生年月日がありません"} />)}
              </Section>
              <Section title="16歳未満の扶養親族（住民税に関する事項）" empty="なし">
                {d.young.map((p, i) => <PersonRow key={i} p={p} next={next} year={year} extra="" />)}
              </Section>
              {d.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 6 }}>{d.notes.map((n, i) => <div key={i}>・{n}</div>)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: "bold", margin: "4px 0" }}>{title}</div>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: "#64748b" }}>{empty}</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>{["氏名（フリガナ）", "続柄", "生年月日", "年齢", "区分", "障害者", "同居", "所得の見積額"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>{list}</tbody>
        </table>
      )}
    </div>
  );
}

function PersonRow({ p, next, year, extra }: { p: DraftPerson; next: number; year: number; extra: string }) {
  return (
    <tr>
      <td style={S.td}>{p.name}{p.furigana ? `（${p.furigana}）` : ""}</td>
      <td style={S.td}>{p.relation}</td>
      <td style={S.td}>{formatWareki(p.birthday)}</td>
      <td style={S.tdNum}>{p.age === null ? "" : `${p.age}歳`}</td>
      <td style={S.td}>{extra}</td>
      <td style={S.td}>{DISABILITY_LABELS[p.disability]}</td>
      <td style={S.td}>{p.livingTogether ? "同居" : "別居"}</td>
      <td style={S.td}>{next}年：<span style={{ color: "#94a3b8" }}>（書く）</span><div style={{ fontSize: 10, color: "#64748b" }}>{year}年：{yen(p.incomeThisYear)}</div></td>
    </tr>
  );
}
