/**
 * 「労働保険の年度更新」の画面：確定保険料・一般拠出金算定基礎賃金集計表と、労働保険概算・確定保険料申告書に書く金額
 * ・労働保険の事業（労働保険番号）ごと。支店に別の労働保険番号があれば、その支店は別の申告書
 * ・申告済概算保険料・概算保険料の見込み・延納・充当意思は、この画面で入れて会社に残す（company.nendo_koshin）
 * ・労災保険の特別加入（第1種。中小事業主・家族従事者・役員など）をしているときは、特別加入者ごとの給付基礎日額と適用月数から、
 *   労働保険事務組合に出す「労働保険料算定基礎賃金等の報告」の特別加入者の欄と特別加入保険料（確定・概算）を出す
 * 計算は utils/nendoKoshin.ts
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useToast } from "../../components/Toast";
import { loadKoyoBase, type KoyoBase } from "../../utils/koyoData";
import { laborUnits } from "../../utils/koyoPlaces";
import {
  buildNendoTable, calcNendoDeclaration, koyoPartsOf, koyoRateOf, nendoDueDates, NENDO_CATEGORY_LABELS, rousaiRateOf, specialPremiumOf,
  type NendoBonus, type NendoCategory, type NendoRow, type NendoSalary, type SpecialMember,
} from "../../utils/nendoKoshin";
import { TOKUBETSU_TABLE } from "../../constants/tokubetsuKanyu";
import { formatWareki } from "../../utils/wareki";
import type { EmpInsType } from "../../constants/insurance/laborInsuranceRates";
import { button, card, controls, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title } from "./ShahoFilePanel";

const PRINT_ID = "nendo-print";
const yen = (n: number) => n.toLocaleString();
const reiwa = (fy: number) => `令和${fy - 2018}年度`;

interface Saved {
  declared: number;
  estimateRousai: number | null;
  estimateKoyo: number | null;
  installments: boolean;
  allocation: "1" | "2" | "3";
  /** 労災保険の特別加入者（第1種） */
  special?: SpecialMember[];
}
const EMPTY: Saved = { declared: 0, estimateRousai: null, estimateKoyo: null, installments: true, allocation: "3", special: [] };

export default function NendoKoshinManager({ db, staffList }: { db: any; staffList: any[] }) {
  const toast = useToast();
  const now = dayjs();
  const [fiscalYear, setFiscalYear] = useState(now.month() + 1 >= 4 ? now.year() - 1 : now.year() - 2);
  const [base, setBase] = useState<KoyoBase | null>(null);
  const [unitKey, setUnitKey] = useState("company");
  const [salaries, setSalaries] = useState<NendoSalary[]>([]);
  const [bonuses, setBonuses] = useState<NendoBonus[]>([]);
  const [inputs, setInputs] = useState<Saved>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [printRequest, setPrintRequest] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const b = await loadKoyoBase(db);
        // 4月分〜翌年3月分の給与（翌月払いなら5月払い〜翌年4月払い）が入るように、前後1か月も読む
        const s = await db.select(
          `SELECT staff_id, target_year, target_month, total_earnings, non_remuneration, in_kind_emp, emp_insurance, ledger
           FROM salary_results WHERE (target_year * 100 + target_month) BETWEEN ? AND ?`,
          [fiscalYear * 100 + 3, (fiscalYear + 1) * 100 + 5],
        ) as NendoSalary[];
        const bs = await db.select(
          `SELECT r.staff_id, r.total_earnings, r.emp_insurance, s.payment_date, s.target_year, s.target_month
           FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id`,
        ) as any[];
        if (cancelled) return;
        setBase(b);
        setSalaries(s ?? []);
        setBonuses((bs ?? []).map((x) => ({
          staff_id: String(x.staff_id), total_earnings: Number(x.total_earnings) || 0, emp_insurance: Number(x.emp_insurance) || 0,
          payDate: /^\d{4}-\d{2}-\d{2}$/.test(String(x.payment_date ?? "")) ? String(x.payment_date) : `${x.target_year}-${String(x.target_month).padStart(2, "0")}-01`,
        })));
        setError(null);
      } catch (e) {
        console.error("年度更新の読み込みエラー:", e);
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, fiscalYear, reloadKey]);

  const units = useMemo(() => (base ? laborUnits(base.company, base.branches) : []), [base]);
  const unit = units.find((u) => u.key === unitKey) ?? units[0];
  const savedAll = useMemo(() => {
    try {
      return JSON.parse(String(base?.company.nendo_koshin ?? "")) as Record<string, Saved>;
    } catch {
      return {} as Record<string, Saved>;
    }
  }, [base]);
  const saveKey = `${fiscalYear}:${unit?.key ?? "company"}`;
  useEffect(() => { setInputs({ ...EMPTY, ...(savedAll[saveKey] ?? {}) }); }, [saveKey, savedAll]);

  const empType = (String(base?.company.default_emp_ins_type || "general")) as EmpInsType;
  const table1 = useMemo(() => {
    if (!base || !unit) return null;
    const staff = staffList.filter((s) => unit.branchIds.includes(Number(s.branch_id || 1)));
    const ids = new Set(staff.map((s) => String(s.id)));
    return buildNendoTable({
      fiscalYear, staff, groups: base.groups.map((g) => ({ ...g, id: Number(g.id) })), empInsType: empType,
      salaries: salaries.filter((s) => ids.has(String(s.staff_id))), bonuses: bonuses.filter((b) => ids.has(String(b.staff_id))),
    });
  }, [base, unit, staffList, fiscalYear, salaries, bonuses, empType]);

  const rousaiRow = unit ? rousaiRateOf(fiscalYear, unit.rousaiBusiness) : null;
  const rousaiRate = unit?.rousaiRate ?? rousaiRow?.rate ?? null;
  const nextRousai = unit?.rousaiRate ?? rousaiRateOf(fiscalYear + 1, unit?.rousaiBusiness)?.rate ?? null;
  let nextKoyo: number | null = null;
  try {
    nextKoyo = koyoRateOf(fiscalYear + 1, 4, empType);
  } catch {
    nextKoyo = null;
  }
  const decl = table1 && rousaiRate !== null && nextRousai !== null && nextKoyo !== null ? calcNendoDeclaration({
    rousaiWages: table1.totals.total.wages, rousaiRate, koyoParts: koyoPartsOf(table1),
    estimateRousaiWages: inputs.estimateRousai, estimateKoyoWages: inputs.estimateKoyo, estimateRousaiRate: nextRousai, estimateKoyoRate: nextKoyo,
    declared: inputs.declared, installments: inputs.installments, allocation: inputs.allocation,
  }) : null;
  const dues = nendoDueDates(fiscalYear + 1);
  const special = inputs.special ?? [];
  const specialConfirmed = rousaiRate !== null && special.length > 0 ? specialPremiumOf(special, rousaiRate) : null;
  const specialEstimate = nextRousai !== null && special.length > 0 ? specialPremiumOf(special.map((m) => ({ daily: m.nextDaily, months: m.nextMonths })), nextRousai) : null;
  const setMember = (i: number, patch: Partial<SpecialMember>) => setInputs({ ...inputs, special: special.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const dailySelect = (value: number, onChange: (v: number) => void, allowZero = false) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...input, width: 110 }}>
      {allowZero && <option value={0}>0（脱退）</option>}
      {TOKUBETSU_TABLE.map((r) => <option key={r.daily} value={r.daily}>{yen(r.daily)}円</option>)}
    </select>
  );
  const problems: string[] = [];
  if (rousaiRate === null) problems.push("労災保険の事業の種類を、会社設定の「雇用保険・労働保険」で選んでください");
  if (!unit?.laborNumber) problems.push("労働保険番号を、会社設定の「基本情報」に入れてください");

  const save = async () => {
    const all = { ...savedAll, [saveKey]: inputs };
    await db.execute("UPDATE company SET nendo_koshin = ? WHERE id = 1", [JSON.stringify(all)]);
    toast.success("年度更新で入れたものを保存しました");
    setReloadKey((k) => k + 1);
  };
  const numInput = (value: number | null, onChange: (v: number | null) => void, placeholder = "") => (
    <input type="number" min={0} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} style={{ ...input, width: 150 }} />
  );
  const cells = (r: NendoRow, cat: NendoCategory | "total", koyo = false) => {
    const c = koyo ? (cat === "temporary" ? null : (r.koyo as any)[cat]) : (r.rousai as any)[cat];
    return c ? <><td style={{ ...td, textAlign: "right" }}>{c.count || ""}</td><td style={{ ...td, textAlign: "right" }}>{c.wages ? yen(c.wages) : ""}</td></> : null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h2 style={title}>労働保険の年度更新</h2>
        <p style={note}>
          毎年6月1日〜7月10日に、前の年度（4月〜翌年3月）の賃金で確定保険料を、今年度の見込みで概算保険料を申告します。
          確定した給与・賞与から「確定保険料・一般拠出金算定基礎賃金集計表」を作り、申告書に書く金額を出します。
          月は賃金締切日の月（3月末締め・4月払いの給与は3月の分）、賞与は支払った月です。
        </p>
        <div style={controls}>
          <label style={fieldStyle}>
            <span style={labelStyle}>確定する年度（申告は翌年の6〜7月）</span>
            <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} style={input}>
              {Array.from({ length: 6 }, (_, i) => now.year() - i).map((y) => <option key={y} value={y}>{reiwa(y)}（{y}年4月〜{y + 1}年3月）</option>)}
            </select>
          </label>
          {units.length > 1 && (
            <label style={fieldStyle}>
              <span style={labelStyle}>労働保険番号</span>
              <select value={unitKey} onChange={(e) => setUnitKey(e.target.value)} style={input}>
                {units.map((u) => <option key={u.key} value={u.key}>{u.name}（{u.laborNumber || "番号なし"}）</option>)}
              </select>
            </label>
          )}
        </div>
        {error && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{error}</div>}
        {problems.map((p) => <div key={p} style={{ color: "#b91c1c", fontSize: 12 }}>・{p}</div>)}
        <div style={{ ...controls, marginTop: 8 }}>
          <label style={fieldStyle}><span style={labelStyle}>申告済概算保険料（前の年度に申告した概算保険料）</span>{numInput(inputs.declared, (v) => setInputs({ ...inputs, declared: v ?? 0 }))}</label>
          <label style={fieldStyle}><span style={labelStyle}>今年度の賃金総額の見込み：労災（空なら前の年度と同じ）</span>{numInput(inputs.estimateRousai, (v) => setInputs({ ...inputs, estimateRousai: v }))}</label>
          <label style={fieldStyle}><span style={labelStyle}>雇用保険（空なら前の年度と同じ）</span>{numInput(inputs.estimateKoyo, (v) => setInputs({ ...inputs, estimateKoyo: v }))}</label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={inputs.installments} onChange={(e) => setInputs({ ...inputs, installments: e.target.checked })} /> 延納する（3回に分ける。40万円以上）
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>充当意思（払い過ぎのとき）</span>
            <select value={inputs.allocation} onChange={(e) => setInputs({ ...inputs, allocation: e.target.value as Saved["allocation"] })} style={input}>
              <option value="1">1 労働保険料のみ充当</option><option value="2">2 一般拠出金のみ充当</option><option value="3">3 労働保険料及び一般拠出金に充当</option>
            </select>
          </label>
          <button onClick={save} style={button("#16a34a")}>入れたものを保存</button>
          <button onClick={() => setPrintRequest((k) => k + 1)} style={button("#2563eb")}>印刷する</button>
        </div>
        <div style={small}>
          概算保険料の見込みは、今年度の賃金総額の見込みが前の年度の半分未満か2倍を超えるときだけ入れます（それ以外は前の年度と同じ額）。
        </div>
      </div>

      {table1 && (
        <div style={card} id={PRINT_ID}>
          <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 4 }}>
            確定保険料・一般拠出金算定基礎賃金集計表（{reiwa(fiscalYear)}・{unit?.name}・労働保険番号 {unit?.laborNumber}）
          </div>
          <table style={{ ...table, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={th} rowSpan={2}>月</th>
                <th style={th} colSpan={8}>労災保険および一般拠出金（人数・賃金）</th>
                <th style={th} colSpan={6}>雇用保険（被保険者の人数・賃金）</th>
              </tr>
              <tr>
                {(["regular", "officer", "temporary"] as NendoCategory[]).map((c) => <th key={c} style={th} colSpan={2}>{NENDO_CATEGORY_LABELS[c]}</th>)}
                <th style={th} colSpan={2}>合計</th>
                <th style={th} colSpan={2}>常用労働者</th>
                <th style={th} colSpan={2}>役員で労働者扱いの人</th>
                <th style={th} colSpan={2}>合計</th>
              </tr>
            </thead>
            <tbody>
              {table1.rows.map((r) => (
                <tr key={`${r.kind}${r.year}${r.month}`}>
                  <td style={td}>{r.kind === "bonus" ? "賞与 " : ""}{r.year}年{r.month}月</td>
                  {cells(r, "regular")}{cells(r, "officer")}{cells(r, "temporary")}{cells(r, "total")}
                  {cells(r, "regular", true)}{cells(r, "officer", true)}{cells(r, "total", true)}
                </tr>
              ))}
              <tr style={{ fontWeight: "bold" }}>
                <td style={td}>合計</td>
                {(["regular", "officer", "temporary", "total"] as const).map((c) => (
                  <Fragment key={c}><td style={{ ...td, textAlign: "right" }}>{table1.totals[c].count}</td><td style={{ ...td, textAlign: "right" }}>{yen(table1.totals[c].wages)}</td></Fragment>
                ))}
                {(["regular", "officer", "total"] as const).map((c) => (
                  <Fragment key={`k${c}`}><td style={{ ...td, textAlign: "right" }}>{table1.totals.koyo[c].count}</td><td style={{ ...td, textAlign: "right" }}>{yen(table1.totals.koyo[c].wages)}</td></Fragment>
                ))}
              </tr>
            </tbody>
          </table>
          <div style={{ ...small, marginTop: 4 }}>
            常時使用労働者数 {table1.workers}人・雇用保険被保険者数 {table1.insured}人（各月の人数の合計 ÷ 12。1人未満は1人）
          </div>
          {table1.notes.map((n) => <div key={n} style={{ ...small }} className="no-print">・{n}</div>)}

          {decl && (
            <>
              <div style={{ fontSize: 14, fontWeight: "bold", margin: "14px 0 4px" }}>労働保険概算・確定保険料申告書に書く金額</div>
              <table style={table}>
                <tbody>
                  <tr><th style={{ ...th, width: "36%" }}>確定保険料 算定基礎額（労災保険分）</th><td style={td}>{yen(decl.confirmed.rousaiBase)}千円 × {rousaiRate}/1000 ＝ {yen(decl.confirmed.rousaiPremium)}円</td></tr>
                  {decl.confirmed.koyoBases.map((k) => (
                    <tr key={k.ratePerMille}><th style={th}>確定保険料 算定基礎額（雇用保険分）</th><td style={td}>{yen(k.base)}千円 × {k.ratePerMille}/1000 ＝ {yen(k.premium)}円</td></tr>
                  ))}
                  <tr><th style={th}>確定保険料額</th><td style={td}><b>{yen(decl.confirmed.total)}円</b>{decl.confirmed.combined ? `（算定基礎額が同じなので、${yen(decl.confirmed.rousaiBase)}千円 × ${(rousaiRate ?? 0) + decl.confirmed.koyoBases[0].ratePerMille}/1000）` : ""}</td></tr>
                  <tr><th style={th}>一般拠出金</th><td style={td}>{yen(decl.general.base)}千円 × {decl.general.rate}/1000 ＝ <b>{yen(decl.general.amount)}円</b></td></tr>
                  <tr><th style={th}>概算保険料（{reiwa(fiscalYear + 1)}）</th><td style={td}>労災 {yen(decl.estimate.rousaiBase)}千円 × {nextRousai}/1000、雇用 {yen(decl.estimate.koyoBase)}千円 × {nextKoyo}/1000 ＝ <b>{yen(decl.estimate.total)}円</b></td></tr>
                  <tr><th style={th}>申告済概算保険料</th><td style={td}>{yen(inputs.declared)}円（{decl.shortage > 0 ? `不足額 ${yen(decl.shortage)}円` : decl.surplus > 0 ? `充当できる額 ${yen(decl.surplus)}円` : "差なし"}）</td></tr>
                  {decl.periods.map((p, i) => (
                    <tr key={i}>
                      <th style={th}>{decl.periods.length > 1 ? `第${i + 1}期（納期限 ${formatWareki(dues[i])}）` : `納付額（納期限 ${formatWareki(dues[0])}）`}</th>
                      <td style={td}>
                        概算保険料 {yen(p.premium)}円{p.shortage ? `＋不足額 ${yen(p.shortage)}円` : ""}{p.general ? `＋一般拠出金 ${yen(p.general)}円` : ""}
                        {p.applied || p.appliedGeneral ? `－充当 ${yen(p.applied + p.appliedGeneral)}円` : ""} ＝ <b>{yen(p.pay)}円</b>
                      </td>
                    </tr>
                  ))}
                  {decl.refund > 0 && <tr><th style={th}>還付額</th><td style={td}>{yen(decl.refund)}円（還付請求書を出します）</td></tr>}
                  <tr><th style={th}>常時使用労働者数・雇用保険被保険者数</th><td style={td}>{table1.workers}人・{table1.insured}人</td></tr>
                </tbody>
              </table>
              {decl.notes.map((n) => <div key={n} style={{ ...small, marginTop: 2 }}>・{n}</div>)}
            </>
          )}
          <div style={{ fontSize: 14, fontWeight: "bold", margin: "14px 0 4px" }}>労災保険の特別加入（第1種。中小事業主・家族従事者・役員など）</div>
          <div style={{ ...small, marginBottom: 6 }} className="no-print">
            特別加入をしている会社だけ入れます（中小事業主等の特別加入は、労働保険事務組合に事務を任せている事業です）。特別加入保険料は、
            給付基礎日額の保険料算定基礎額（1年加入は日額 × 365日、年度の途中で加入・脱退した人は 1/12 の額 × 月数）の合計を千円未満切り捨てにして、
            労災保険率をかけます。事務組合に出す「労働保険料算定基礎賃金等の報告」の特別加入者の欄に書きます。
          </div>
          {special.length > 0 && (
            <table style={table}>
              <thead>
                <tr>{["特別加入者の氏名", "承認された給付基礎日額", "適用月数（確定）", "算定基礎額", "希望する給付基礎日額（来年度）", "適用月数（概算）", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {special.map((m, i) => (
                  <tr key={i}>
                    <td style={td}><input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} style={{ ...input, width: 140 }} /></td>
                    <td style={td}>{dailySelect(m.daily, (v) => setMember(i, { daily: v }))}</td>
                    <td style={td}><input type="number" min={0} max={12} value={m.months} onChange={(e) => setMember(i, { months: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })} style={{ ...input, width: 60 }} /> か月</td>
                    <td style={{ ...td, textAlign: "right" }}>{specialConfirmed?.bases[i] === null ? "表にない日額" : yen(specialConfirmed?.bases[i] ?? 0)}円</td>
                    <td style={td}>{dailySelect(m.nextDaily, (v) => setMember(i, { nextDaily: v, nextMonths: v === 0 ? 0 : m.nextMonths || 12 }), true)}</td>
                    <td style={td}><input type="number" min={0} max={12} value={m.nextMonths} onChange={(e) => setMember(i, { nextMonths: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })} style={{ ...input, width: 60 }} /> か月</td>
                    <td style={td} className="no-print"><button onClick={() => setInputs({ ...inputs, special: special.filter((_, j) => j !== i) })} style={button("#94a3b8")}>消す</button></td>
                  </tr>
                ))}
                {specialConfirmed && (
                  <tr>
                    <th style={th} colSpan={3}>特別加入保険料（確定。{reiwa(fiscalYear)}）</th>
                    <td style={td} colSpan={4}>算定基礎額の計 {yen(specialConfirmed.total)}円 → {yen(specialConfirmed.kilo)}千円 × {rousaiRate}/1000 ＝ <b>{yen(specialConfirmed.premium)}円</b></td>
                  </tr>
                )}
                {specialEstimate && (
                  <tr>
                    <th style={th} colSpan={3}>特別加入保険料（概算。{reiwa(fiscalYear + 1)}）</th>
                    <td style={td} colSpan={4}>算定基礎額の計 {yen(specialEstimate.total)}円 → {yen(specialEstimate.kilo)}千円 × {nextRousai}/1000 ＝ <b>{yen(specialEstimate.premium)}円</b></td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <button
            className="no-print"
            onClick={() => setInputs({ ...inputs, special: [...special, { name: "", daily: TOKUBETSU_TABLE[TOKUBETSU_TABLE.length - 1].daily, months: 12, nextDaily: TOKUBETSU_TABLE[TOKUBETSU_TABLE.length - 1].daily, nextMonths: 12 }] })}
            style={{ ...button("#64748b"), marginTop: 6 }}
          >
            ＋ 特別加入者を足す
          </button>

          <div style={{ ...small, marginTop: 8 }}>
            計算のしかたは、厚生労働省「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」による。労災保険率は「労災保険率表（令和６年度～）」
            {rousaiRow ? `（${rousaiRow.codes.join("・")} ${rousaiRow.name}）` : ""}、雇用保険率は厚生労働省の発表の率。
          </div>
        </div>
      )}
    </div>
  );
}
