/**
 * 「保険料の集計表」の画面：社会保険料（保険料の月ごと）・労働保険料（支給した月ごと）の、納入告知額の見込み・本人負担・会社負担を出す
 * （作り方は utils/premiumSummary.ts）。年金事務所から届く納入告知書（保険料納入告知額通知書）と照らし合わせ、会社負担分の会計に使う
 * ・会社負担の見込みを、借方 法定福利費・貸方 未払費用の仕訳データ（会計ソフトに取り込む CSV。明細書・一覧表の画面の仕訳データと同じ形と科目の設定）にできる
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { kenpoPrefectureOf, type BranchLike } from "../../utils/branchPrefecture";
import { saveBinaryFile, saveCsvFile } from "../../utils/fileSaveUtils";
import { csvField } from "../../utils/csvText";
import { buildWelfareJournal, journalBytes, parseJournalSettings, type JournalSettings } from "../../utils/payJournal";
import { loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import { salaryClosingDate, type PayrollGroupForPeriod } from "../../utils/payrollPeriod";
import { rousaiRateOf } from "../../utils/nendoKoshin";
import { premiumSummary, type PremiumBonus, type PremiumSalary } from "../../utils/premiumSummary";
import * as S from "./reportStyles";

interface Props {
  db: Database;
  staffList: any[];
}

interface Ctx {
  insurers: Map<number, HealthInsurer>;
  branches: (BranchLike & { rousai_business?: string | null; rousai_rate?: number | null })[];
  company: { rousai_business?: string | null; rousai_rate?: number | null };
  collection: Map<number, string>;
  /** 給与規定グループの締日（賃金締切日を決める。内訳に残していない給与のため） */
  groups: Map<number, PayrollGroupForPeriod>;
}

const today = new Date();
const PRINT_ID = "premium-summary-print";

export default function PremiumSummaryManager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [salaries, setSalaries] = useState<PremiumSalary[] | null>(null);
  const [bonuses, setBonuses] = useState<PremiumBonus[]>([]);
  const [journalSettings, setJournalSettings] = useState<JournalSettings>(parseJournalSettings(null));
  /** 法定福利費の仕訳の日付（初めはその月の末日） */
  const [welfareDate, setWelfareDate] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const insurers = await loadHealthInsurers(db);
        const branches = await db.select<any[]>("SELECT id, name, prefecture, health_ins_num, rousai_business, rousai_rate FROM branches ORDER BY id");
        const c = await db.select<any[]>("SELECT rousai_business, rousai_rate, journal_settings FROM company WHERE id = 1");
        setJournalSettings(parseJournalSettings(c?.[0]?.journal_settings));
        const g = await db.select<{ id: number; social_ins_collection: string | null; closing_day: number; is_next_month: number }[]>(
          "SELECT id, social_ins_collection, closing_day, is_next_month FROM payroll_groups",
        );
        setCtx({
          insurers, branches: branches ?? [], company: c?.[0] ?? {},
          collection: new Map((g ?? []).map((x) => [Number(x.id), String(x.social_ins_collection || "current")])),
          groups: new Map((g ?? []).map((x) => [Number(x.id), { closing_day: Number(x.closing_day), is_next_month: Number(x.is_next_month) }])),
        });
      } catch (e) {
        console.error("保険料の集計表の読み込みエラー:", e);
      }
    })();
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    setSalaries(null);
    (async () => {
      try {
        const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
        const rows = await db.select<PremiumSalary[]>(
          `SELECT staff_id, target_year, target_month, health_insurance, nursing_insurance, child_support, welfare_pension, kokuho_premium,
                  emp_insurance, total_earnings, non_remuneration, in_kind_emp, ledger
           FROM salary_results WHERE (target_year * 100 + target_month) IN (?, ?)`,
          [year * 100 + month, next.y * 100 + next.m],
        );
        const fy = month >= 4 ? year : year - 1;
        const bons = await db.select<PremiumBonus[]>(
          `SELECT r.staff_id, b.payment_date, r.hyojun_bonus, r.health_insurance, r.nursing_insurance, r.child_support, r.welfare_pension, r.emp_insurance, r.total_earnings
           FROM bonus_results r JOIN bonus_settings b ON b.id = r.bonus_setting_id
           WHERE b.payment_date BETWEEN ? AND ?`,
          [`${fy}-04-01`, `${fy + 1}-03-31`],
        );
        if (cancelled) return;
        setSalaries(rows ?? []);
        setBonuses((bons ?? []).filter((b) => !!b.payment_date));
      } catch (e) {
        console.error("確定した給与・賞与の読み込みエラー:", e);
        if (!cancelled) setSalaries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, year, month]);

  const summary = useMemo(() => {
    if (!ctx || !salaries) return null;
    const fy = month >= 4 ? year : year - 1;
    const rateOf = (business: unknown, rate: unknown): number | null => {
      if (rate !== null && rate !== undefined && rate !== "") return Number(rate);
      const row = business ? rousaiRateOf(fy, String(business)) : null;
      return row ? row.rate : null;
    };
    return premiumSummary({
      year, month, staffList, salaries, bonuses, insurers: ctx.insurers,
      // 協会けんぽの料率は、その人が入っている適用事業所の都道府県（支店が本店にまとめて入っていれば本店。utils/branchPrefecture.ts）
      prefectureOf: (id) => kenpoPrefectureOf(ctx.branches, id).prefecture,
      collectionOf: (g) => ctx.collection.get(Number(g || 1)) ?? "current",
      // 雇用保険料の率を選ぶ賃金締切日（内訳に残した日。なければ給与規定グループの締日から）
      closingOf: (x, s) => salaryClosingDate(x.ledger, ctx.groups.get(Number(s?.payroll_group_id || 1)), Number(x.target_year), Number(x.target_month)),
      rousaiRateOf: (s) => {
        const b = ctx.branches.find((x) => Number(x.id) === (Number(s.branch_id) || 1));
        return rateOf(b?.rousai_business, b?.rousai_rate) ?? rateOf(ctx.company.rousai_business, ctx.company.rousai_rate);
      },
    });
  }, [ctx, salaries, bonuses, staffList, year, month]);

  const total = (k: "total" | "employee" | "company") => summary?.social.reduce((t, l) => t + (l[k] ?? 0), 0) ?? 0;
  const saveCsv = async () => {
    if (!summary) return;
    const lines = [
      [`${year}年${month}月分 社会保険料・労働保険料の集計表`],
      ["区分", "項目", "納入告知額の見込み・賃金", "本人負担", "会社負担"],
      ...summary.social.map((l) => ["社会保険料（保険料の月）", l.label, l.total === null ? "" : String(l.total), String(l.employee), l.company === null ? "" : String(l.company)]),
      ...summary.labor.map((l) => ["労働保険料（支給した月）", l.label, String(l.wages), String(l.employee), l.company === null ? "" : String(l.company)]),
    ];
    try {
      const saved = await saveCsvFile(lines.map((c) => c.map(csvField).join(",")).join("\r\n") + "\r\n", `保険料の集計表_${year}年${month}月分.csv`);
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  // 法定福利費の仕訳（会社負担の見込み。社会保険は保険料の月、労働保険は支給した月の分）
  const monthEnd = new Date(year, month, 0);
  const defaultWelfareDate = `${year}-${String(month).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;
  const welfareLines = summary
    ? buildWelfareJournal(welfareDate || defaultWelfareDate, `${year}年${month}月分`, [
      ...summary.social.map((l) => ({ sub: l.label.replace(/（.*$/, ""), amount: l.company ?? 0 })),
      ...summary.labor.map((l) => ({ sub: l.label.replace(/（.*$/, ""), amount: l.company ?? 0 })),
    ], journalSettings)
    : [];
  const saveWelfare = async () => {
    if (welfareLines.length === 0) return;
    try {
      const { bytes, unknown } = journalBytes(welfareLines, journalSettings);
      if (unknown.length > 0) await dialog.warning(`シフトJIS にない字（${unknown.join("・")}）を「?」にしました。`);
      const saved = await saveBinaryFile(bytes, `法定福利費の仕訳_${year}年${month}月分.csv`, { name: "CSV", extensions: ["csv"] });
      if (saved) toast.success(`「${saved.name}」を保存しました`);
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() + 1 - i);
  const yen = (v: number | null) => (v === null ? "—" : `${v.toLocaleString()} 円`);
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>社会保険料・労働保険料の集計表</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          社会保険料は、保険料の月ごとに、年金事務所の納入告知額の見込み（標準報酬月額・標準賞与額 × 料率を全員分足して1円未満を切り捨てた額）と、
          給与・賞与から引いた本人負担、その差の会社負担を出します（日本年金機構「保険料の計算方法について」）。届いた納入告知書の額と照らし合わせてください。
          労働保険料は、その月に支給した給与・賞与の賃金から、雇用保険料と労災保険料の会社負担の見込みを出します（年度の保険料は年度更新で精算します）。
        </div>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>年</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>月（社会保険料は保険料の月、労働保険料は支給した月）</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={S.input}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={!summary} style={S.button("#2563eb", !summary)}>🖨 印刷・PDF保存</button>
          <button onClick={saveCsv} disabled={!summary} style={S.button("#16a085", !summary)}>CSV に保存</button>
        </div>
      </div>
      {!summary ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>読み込んでいます…</div>
      ) : (
        <div style={S.card}>
          <div id={PRINT_ID}>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>{year}年{month}月分 社会保険料・労働保険料の集計表</h2>
            <div style={{ fontSize: 13, fontWeight: "bold", margin: "4px 0" }}>社会保険料（{year}年{month}月分。保険料がかかる人 {summary.socialPersons}人）</div>
            <table style={S.table}>
              <thead><tr>{["項目", "納入告知額の見込み", "本人負担（給与・賞与から引いた額）", "会社負担"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {summary.social.map((l) => (
                  <tr key={l.label}><td style={S.td}>{l.label}</td><td style={S.tdNum}>{yen(l.total)}</td><td style={S.tdNum}>{yen(l.employee)}</td><td style={S.tdNum}>{yen(l.company)}</td></tr>
                ))}
                <tr style={{ fontWeight: "bold", backgroundColor: "#e0f2fe" }}>
                  <td style={S.td}>合計</td><td style={S.tdNum}>{yen(total("total"))}</td><td style={S.tdNum}>{yen(total("employee"))}</td><td style={S.tdNum}>{yen(total("company"))}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 13, fontWeight: "bold", margin: "14px 0 4px" }}>労働保険料（{year}年{month}月に支給した給与・賞与）</div>
            <table style={S.table}>
              <thead><tr>{["項目", "賃金", "本人負担", "会社負担の見込み"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {summary.labor.map((l) => (
                  <tr key={l.label}><td style={S.td}>{l.label}</td><td style={S.tdNum}>{yen(l.wages)}</td><td style={S.tdNum}>{yen(l.employee)}</td><td style={S.tdNum}>{yen(l.company)}</td></tr>
                ))}
              </tbody>
            </table>
            {summary.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 10 }}>{summary.notes.map((x, i) => <div key={i}>・{x}</div>)}</div>}
            <div className="no-print" style={{ marginTop: 14, padding: 10, backgroundColor: "#f8fafc", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 6 }}>会社負担の法定福利費の仕訳データ</div>
              <div style={S.controls}>
                <label style={S.field}>
                  <span style={S.label}>仕訳の日付</span>
                  <input type="date" value={welfareDate || defaultWelfareDate} onChange={(e) => setWelfareDate(e.target.value)} style={S.input} />
                </label>
                <button onClick={saveWelfare} disabled={welfareLines.length === 0} style={S.button("#16a085", welfareLines.length === 0)}>仕訳データを保存</button>
              </div>
              <div style={S.small}>
                借方「{journalSettings.welfare}」（補助科目に保険の名前）・貸方「{journalSettings.accrued}」で、上の会社負担の見込みの仕訳を作ります
                （{welfareLines.filter((l) => l.side === "debit").map((l) => `${l.sub} ${l.amount.toLocaleString()}円`).join("・") || "会社負担がありません"}）。
                科目の名前と CSV の形は、「明細書・一覧表」の画面の仕訳データの設定と同じです。健康保険組合の人の会社負担は、組合の会社負担の料率を入れたときだけ入ります。
              </div>
            </div>
            <div style={{ ...S.small, marginTop: 8, lineHeight: 1.7 }}>
              納入告知額は、年金事務所が月末に知らせる額（その月の分を翌月末に納める）です。この見込みと違うときは、入社・退職・標準報酬月額の変更・賞与の届けが年金事務所に届いているかを確かめてください。
              協会けんぽの料率は、拠点の都道府県で決めます。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
