/**
 * 「毎月勤労統計調査」の画面（作り方は utils/maikin.ts）
 * 調査の対象に指定された事業所が、調査月の調査票（第一種事業所用）に書く数（常用労働者数・出勤日数・実労働時間数・現金給与額）を、
 * 確定した給与と賞与から出して印刷する。
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { maikinPeriod, maikinResult, type MaikinBonus, type MaikinCell, type MaikinSalary } from "../../utils/maikin";
import { formatWareki } from "../../utils/wareki";
import * as S from "./reportStyles";

const PRINT_ID = "maikin-print";

export default function MaikinManager({ db, staffList }: { db: Database; staffList: any[] }) {
  const last = dayjs().subtract(1, "month");
  const [ym, setYm] = useState(last.format("YYYY-MM"));
  const [branches, setBranches] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [branchId, setBranchId] = useState("1");
  const [data, setData] = useState<{ salaries: MaikinSalary[]; bonuses: MaikinBonus[] } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setBranches((await db.select<any[]>("SELECT id, name FROM branches ORDER BY id")) ?? []);
        setGroups((await db.select<any[]>("SELECT id, closing_day, is_next_month FROM payroll_groups")) ?? []);
      } catch (e) {
        console.error("拠点の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const staff = useMemo(() => staffList.filter((s) => String(s.branch_id ?? 1) === branchId), [staffList, branchId]);
  // 給与締切日：その事業所でいちばん多くの人に使う給与規定グループの締め日
  const group = useMemo(() => {
    const count = new Map<number, number>();
    for (const s of staff) count.set(Number(s.payroll_group_id ?? 1), (count.get(Number(s.payroll_group_id ?? 1)) ?? 0) + 1);
    const id = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    return groups.find((g) => Number(g.id) === id) ?? null;
  }, [staff, groups]);
  const closingDay = Number(group?.closing_day ?? 99);
  const [year, month] = ym.split("-").map(Number);
  const period = maikinPeriod(year, month, closingDay);

  useEffect(() => {
    setData(null);
    if (staff.length === 0) { setData({ salaries: [], bonuses: [] }); return; }
    let cancelled = false;
    (async () => {
      try {
        // 調査期間の給与：期間の終わりの月（翌月払いなら、その次の月）に払う給与
        const pay = dayjs(period.to).add(Number(group?.is_next_month) === 1 ? 1 : 0, "month");
        const ids = staff.map((s) => String(s.id));
        const marks = ids.map(() => "?").join(",");
        const rows = await db.select<any[]>(
          `SELECT staff_id, ledger, total_earnings FROM salary_results WHERE target_year = ? AND target_month = ? AND staff_id IN (${marks})`,
          [pay.year(), pay.month() + 1, ...ids],
        );
        const bonus = await db.select<any[]>(
          `SELECT b.staff_id, s.name, b.total_earnings FROM bonus_results b JOIN bonus_settings s ON s.id = b.bonus_setting_id
           WHERE s.payment_date BETWEEN ? AND ? AND b.staff_id IN (${marks})`,
          [period.from, period.to, ...ids],
        );
        if (cancelled) return;
        setData({
          salaries: (rows ?? []).map((r) => ({ staffId: String(r.staff_id), ledger: r.ledger, totalEarnings: Number(r.total_earnings) || 0 })),
          bonuses: (bonus ?? []).map((r) => ({ staffId: String(r.staff_id), name: String(r.name ?? "賞与"), amount: Number(r.total_earnings) || 0 })),
        });
      } catch (e) {
        console.error("毎月勤労統計の読み込みエラー:", e);
        if (!cancelled) setData({ salaries: [], bonuses: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff, period.from, period.to, group]);

  const r = data ? maikinResult(staff, period, data.salaries, data.bonuses) : null;
  const cell: CSSProperties = { border: "1px solid #333", padding: "3px 8px", fontSize: "9.5pt", textAlign: "right" };
  const lab: CSSProperties = { ...cell, textAlign: "left", backgroundColor: "#f8fafc" };
  const row = (label: string, c: MaikinCell, unit: string) => (
    <tr><td style={lab}>{label}</td><td style={cell}>{c.men.toLocaleString()}{unit}</td><td style={cell}>{c.women.toLocaleString()}{unit}</td><td style={cell}>{(c.men + c.women).toLocaleString()}{unit}</td><td style={cell}>{c.part.toLocaleString()}{unit}</td></tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000, margin: "0 auto" }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>毎月勤労統計調査</h3>
        <p style={S.note}>
          調査の対象に指定された事業所が、毎月、調査票（第一種事業所用）を調査月の翌月10日までに出します（オンライン回答か郵送）。確定した給与と賞与から、
          調査票の 5〜8 の欄に書く数を出します。1〜4（事業の内容・調査期間・事業活動を行った日数・企業の全常用労働者数）と 9・10 は、調査票に直接書きます。
        </p>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>事業所（拠点）</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={S.input}>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>調査月</span>
            <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} style={S.input} />
          </label>
          <div style={{ ...S.note, alignSelf: "center" }}>調査期間：{formatWareki(period.from)}〜{formatWareki(period.to)}（給与締切日 {closingDay === 99 ? "末日" : `${closingDay}日`}）</div>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={!r} style={S.button("#2563eb", !r)}>🖨 印刷</button>
        </div>
        {r && r.missing.length > 0 && <div style={S.warnBox}>調査期間の給与を確定していない人がいます：{r.missing.join("・")}</div>}
      </div>
      <div id={PRINT_ID} style={S.card}>
        {!r ? <div style={S.small}>読み込んでいます…</div> : (
          <>
            <h2 style={{ textAlign: "center", fontSize: "14pt", margin: "0 0 4px" }}>毎月勤労統計調査 調査票（{year}年{month}月分）に書く数</h2>
            <div style={{ fontSize: "9.5pt", marginBottom: 6 }}>調査期間：{formatWareki(period.from)}から{formatWareki(period.to)}まで</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={lab} /><th style={lab}>男</th><th style={lab}>女</th><th style={lab}>計</th><th style={lab}>うちパートタイム労働者</th></tr></thead>
              <tbody>
                {row("5(1) 前調査期間の末日の常用労働者数", r.start, "人")}
                {row("5(2) 採用、転勤等による増加", r.increase, "人")}
                {row("5(3) 解雇、退職、転勤等による減少", r.decrease, "人")}
                {row("5(4) 本調査期間の末日の常用労働者数", r.end, "人")}
                {row("6 実際に出勤した日の合計（延べ日数）", r.days, "日")}
                {row("7(1) 所定内労働時間の合計（延べ時間）", r.scheduledHours, "時間")}
                {row("7(2) 所定外労働時間の合計（延べ時間）", r.overtimeHours, "時間")}
                {row("8(1) きまって支給する給与の総額", r.regularPay, "千円")}
                {row("8(2) うち、超過労働給与の総額", r.overtimePay, "千円")}
                {row("8(3) 特別に支払われた給与の総額", r.specialPay, "千円")}
              </tbody>
            </table>
            {r.specialItems.length > 0 && (
              <div style={{ fontSize: "9.5pt", marginTop: 6 }}>8(4) 特別に支払われた給与の名称と金額：{r.specialItems.map((x) => `${x.name} ${Math.floor(x.amount / 1000 + 0.5).toLocaleString()}千円`).join("、")}</div>
            )}
            <div className="no-print" style={{ ...S.small, marginTop: 8 }}>{r.notes.map((n, i) => <div key={i}>・{n}</div>)}</div>
          </>
        )}
      </div>
    </div>
  );
}
