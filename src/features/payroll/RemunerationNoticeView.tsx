/**
 * 「明細書・一覧表」の画面の「標準報酬月額の通知書」：ある月から標準報酬月額が決定・改定された人に渡す通知書を、1人1枚で印刷する
 * （健康保険法49条2項・厚生年金保険法29条2項。作り方は utils/remunerationNotice.ts）
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import { kenpoPrefectureOf, type BranchLike } from "../../utils/branchPrefecture";
import { noticeMonths, remunerationNotices, type RemunerationNotice } from "../../utils/remunerationNotice";
import { formatWareki } from "../../utils/wareki";
import * as S from "./reportStyles";

interface Props {
  db: Database;
  staffList: any[];
  companyName: string;
}

const PRINT_ID = "remuneration-notice-print";
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ymLabel = (ym: string) => formatWareki(`${ym}-01`).replace(/1日$/, "");
const nextYm = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export default function RemunerationNoticeView({ db, staffList, companyName }: Props) {
  const months = useMemo(() => noticeMonths(staffList), [staffList]);
  const [ym, setYm] = useState<string>("");
  const [ctx, setCtx] = useState<{ insurers: Map<number, HealthInsurer>; branches: BranchLike[]; rounding: string; collection: Map<number, string> } | null>(null);

  useEffect(() => {
    if (!ym && months.length > 0) setYm(months[0]);
  }, [months, ym]);

  useEffect(() => {
    (async () => {
      try {
        const insurers = await loadHealthInsurers(db);
        const b = await db.select<BranchLike[]>("SELECT id, name, prefecture, health_ins_num FROM branches");
        const c = await db.select<{ round_social_ins: string | null }[]>("SELECT round_social_ins FROM company WHERE id = 1");
        const g = await db.select<{ id: number; social_ins_collection: string | null }[]>("SELECT id, social_ins_collection FROM payroll_groups");
        setCtx({
          insurers,
          branches: b ?? [],
          rounding: String(c?.[0]?.round_social_ins || "currency_law"),
          collection: new Map((g ?? []).map((x) => [Number(x.id), String(x.social_ins_collection || "current")])),
        });
      } catch (e) {
        console.error("標準報酬月額の通知書の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const notices: RemunerationNotice[] = useMemo(() => {
    if (!ctx || !ym) return [];
    return remunerationNotices(staffList, ym, {
      insurers: ctx.insurers, rounding: ctx.rounding,
      // 協会けんぽの料率は、その人が入っている適用事業所の都道府県（支店が本店にまとめて入っていれば本店。utils/branchPrefecture.ts）
      prefectureOf: (id) => kenpoPrefectureOf(ctx.branches, id).prefecture,
    });
  }, [ctx, ym, staffList]);

  return (
    <>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>適用する月（何年何月分から）</span>
            <select value={ym} onChange={(e) => setYm(e.target.value)} style={S.input}>
              {months.length === 0 && <option value="">標準報酬月額の履歴がありません</option>}
              {months.map((m) => <option key={m} value={m}>{ymLabel(m)}分から（{m}）</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={notices.length === 0} style={S.button("#2563eb", notices.length === 0)}>🖨 印刷・PDF保存</button>
        </div>
        <div style={S.note}>
          年金事務所・健康保険組合から標準報酬月額の決定・改定の通知を受けたら、速やかに本人に知らせます（健康保険法49条2項・厚生年金保険法29条2項）。
          従業員の画面の標準報酬月額の履歴で、選んだ月から変わる人の通知書を作ります（{notices.length}人）。保険料は、その月の分の本人負担の額です。
        </div>
      </div>
      <div id={PRINT_ID}>
        {notices.map((n) => {
          const s = staffList.find((x) => String(x.id) === n.staffId);
          const firstPay = ctx?.collection.get(Number(s?.payroll_group_id || 1)) === "next" ? nextYm(n.from) : n.from;
          return (
            <div key={n.staffId} className="page" style={{ ...S.card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <div>社員番号 {n.staffId}</div>
                <div>{formatWareki(todayStr())}</div>
              </div>
              <div style={{ fontSize: 17, borderBottom: "1.5px solid #000", display: "inline-block", paddingRight: 40, marginTop: 8 }}>{n.name} 様</div>
              <div style={{ textAlign: "right", fontWeight: "bold", fontSize: 13 }}>{companyName}</div>
              <h2 style={{ textAlign: "center", fontSize: 17, margin: "12px 0" }}>標準報酬月額の{n.reason === "shutoku" ? "決定" : n.reason === "teiji" ? "決定" : "改定"}のお知らせ</h2>
              <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 10 }}>
                {ymLabel(n.from)}分から、健康保険・厚生年金保険の標準報酬月額が次のとおり{n.reason === "zuiji" || n.reason === "kyugyo" ? "改定" : "決定"}されました（{n.reasonLabel}）。
              </div>
              <table style={S.table}>
                <thead><tr><th style={S.th} /><th style={S.th}>健康保険</th><th style={S.th}>厚生年金保険</th></tr></thead>
                <tbody>
                  <tr>
                    <td style={S.td}>{n.reason === "zuiji" || n.reason === "kyugyo" ? "改定後" : "決定後"}の標準報酬月額</td>
                    <td style={S.tdNum}><b>{S.yen(n.health)} 円</b>{n.healthGrade ? `（${n.healthGrade}等級）` : ""}</td>
                    <td style={S.tdNum}>{n.pension === null ? "—" : <><b>{S.yen(n.pension)} 円</b>{n.pensionGrade ? `（${n.pensionGrade}等級）` : ""}</>}</td>
                  </tr>
                  <tr>
                    <td style={S.td}>従前の標準報酬月額</td>
                    <td style={S.tdNum}>{n.previousHealth === null ? "—" : `${S.yen(n.previousHealth)} 円`}</td>
                    <td style={S.tdNum}>{n.previousPension === null ? "—" : `${S.yen(n.previousPension)} 円`}</td>
                  </tr>
                </tbody>
              </table>
              {n.premiums && (
                <table style={{ ...S.table, marginTop: 10 }}>
                  <thead><tr><th style={S.th} colSpan={2}>{ymLabel(n.from)}分の保険料（本人負担・月額）</th></tr></thead>
                  <tbody>
                    <tr><td style={S.td}>健康保険料</td><td style={S.tdNum}>{S.yen(n.premiums.health)} 円</td></tr>
                    {n.premiums.nursing > 0 && <tr><td style={S.td}>介護保険料</td><td style={S.tdNum}>{S.yen(n.premiums.nursing)} 円</td></tr>}
                    {n.premiums.childSupport > 0 && <tr><td style={S.td}>子ども・子育て支援金</td><td style={S.tdNum}>{S.yen(n.premiums.childSupport)} 円</td></tr>}
                    {n.pension !== null && <tr><td style={S.td}>厚生年金保険料</td><td style={S.tdNum}>{S.yen(n.premiums.pension)} 円</td></tr>}
                    <tr style={{ fontWeight: "bold" }}><td style={S.td}>合計</td><td style={S.tdNum}>{S.yen(n.premiums.total)} 円</td></tr>
                  </tbody>
                </table>
              )}
              <div style={{ ...S.small, marginTop: 8, lineHeight: 1.7 }}>
                {ymLabel(firstPay)}に支給する給与から、この保険料を差し引きます。
                {n.notes.map((x, i) => <div key={i}>・{x}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
