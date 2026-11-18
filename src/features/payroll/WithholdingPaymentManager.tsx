/**
 * 「所得税の納付書」の画面：給与所得・退職所得等の所得税徴収高計算書（源泉所得税の納付書）に書き写す中身を、
 * 確定した給与・賞与から出す（作り方は utils/withholdingPayment.ts）
 * ・退職手当等は、退職金の画面で保存したもの（retirement_allowances）を入れる（死亡退職と、非居住者に払ったものは入れない。
 *   非居住者の分は「非居住者・外国法人の所得についての所得税徴収高計算書（納付書）」で納める）
 * ・納期の特例の承認を受けているか（会社ごと）と、Q で計算しない退職手当等・税理士等の報酬（期間ごと）は、会社の gensen_nofu（JSON）に残す
 * ・納付書は税務署から届いた用紙に書く（用紙の代わりに印刷したものは使えない）。e-Tax で納めるときも、この中身を入れる
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useMessageDialog } from "../../components/MessageDialog";
import { parseLedger } from "../../utils/legalBooks";
import { payDateOf } from "../../utils/koyoBenefits";
import { parseRetirementInput } from "../../utils/retirementIncome";
import {
  buildNofuSlips, payDateCode, type NofuBonusInput, type NofuExtra, type NofuExtras, type NofuLine, type NofuRetirementInput, type NofuSalaryInput, type NofuSlip,
} from "../../utils/withholdingPayment";
import * as S from "./reportStyles";

interface Props {
  db: Database;
}

interface NofuSettings {
  /** 源泉所得税の納期の特例の承認を受けている */
  specialDue?: boolean;
  /** 期間の印ごとの、手で入れた欄 */
  extras?: Record<string, NofuExtras>;
}

const parseSettings = (v: unknown): NofuSettings => {
  if (typeof v !== "string" || !v.trim()) return {};
  try {
    const x = JSON.parse(v);
    return x && typeof x === "object" ? x : {};
  } catch {
    return {};
  }
};

const today = new Date();
const PRINT_ID = "nofu-print";
const dateLabel = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

export default function WithholdingPaymentManager({ db }: Props) {
  const dialog = useMessageDialog();
  const [year, setYear] = useState(today.getFullYear());
  const [settings, setSettings] = useState<NofuSettings>({});
  const [salaries, setSalaries] = useState<NofuSalaryInput[] | null>(null);
  const [bonuses, setBonuses] = useState<NofuBonusInput[]>([]);
  const [retirements, setRetirements] = useState<NofuRetirementInput[]>([]);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT gensen_nofu FROM company WHERE id = 1");
        setSettings(parseSettings(c?.[0]?.gensen_nofu));
        const h = await db.select<{ holiday_date: string }[]>("SELECT holiday_date FROM holiday_master");
        setHolidays(new Set((h ?? []).map((x) => x.holiday_date)));
      } catch (e) {
        console.error("所得税の納付書の設定の読み込みエラー:", e);
      }
    })();
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const groups = await db.select<{ id: number; payment_day: number }[]>("SELECT id, payment_day FROM payroll_groups ORDER BY id");
        const rows = await db.select<any[]>(
          `SELECT r.staff_id, r.target_year, r.target_month, r.taxable_amount, r.income_tax, r.year_end_adjustment, r.ledger,
                  s.is_executive, s.tax_column, s.payroll_group_id
           FROM salary_results r JOIN staff s ON s.id = r.staff_id
           WHERE r.target_year IN (?, ?)`,
          [year - 1, year],
        );
        const bons = await db.select<any[]>(
          `SELECT r.staff_id, r.total_earnings, r.income_tax, s.is_executive, b.payment_date, b.target_year, b.target_month
           FROM bonus_results r JOIN bonus_settings b ON b.id = r.bonus_setting_id JOIN staff s ON s.id = r.staff_id
           WHERE b.target_year IN (?, ?)`,
          [year - 1, year],
        );
        // 退職金の画面で保存した退職手当等（死亡退職は源泉徴収しないので除く。非居住者の分は別の納付書なので除く）
        const rets = await db.select<any[]>(
          "SELECT staff_id, pay_date, amount, income_tax, detail FROM retirement_allowances WHERE pay_date BETWEEN ? AND ?",
          [`${year - 1}-01-01`, `${year}-12-31`],
        );
        if (cancelled) return;
        setRetirements((rets ?? []).filter((r) => { const d = parseRetirementInput(r.detail); return !d.death && !d.nonResident; }).map((r) => ({
          staffId: String(r.staff_id), payDate: String(r.pay_date), amount: Number(r.amount) || 0, tax: Number(r.income_tax) || 0,
        })));
        setSalaries((rows ?? []).map((r): NofuSalaryInput => {
          const group = groups?.find((g) => g.id === Number(r.payroll_group_id)) ?? groups?.[0] ?? { payment_day: 25 };
          return {
            staffId: String(r.staff_id), executive: Number(r.is_executive) === 1, taxColumn: String(r.tax_column || "kou"),
            payDate: payDateOf(group, Number(r.target_year), Number(r.target_month)),
            taxable: Number(r.taxable_amount) || 0, tax: Number(r.income_tax) || 0, yearEnd: Number(r.year_end_adjustment) || 0,
            workDays: parseLedger(r.ledger)?.workDays ?? 0,
          };
        }));
        setBonuses((bons ?? []).map((b): NofuBonusInput => ({
          staffId: String(b.staff_id), executive: Number(b.is_executive) === 1,
          payDate: b.payment_date || `${b.target_year}-${String(b.target_month).padStart(2, "0")}-01`,
          amount: Number(b.total_earnings) || 0, tax: Number(b.income_tax) || 0,
        })));
      } catch (e) {
        console.error("確定した給与・賞与の読み込みエラー:", e);
        if (!cancelled) setSalaries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, year]);

  const mode = settings.specialDue ? "special" : "general";
  const slips = useMemo(
    () => salaries === null ? [] : buildNofuSlips({ year, mode, salaries, bonuses, retirements, extras: settings.extras, isHoliday: (d) => holidays.has(d) }),
    [year, mode, salaries, bonuses, retirements, settings.extras, holidays],
  );
  const shown = slips.filter((s) => showEmpty || !s.empty);

  const save = async (next: NofuSettings) => {
    setSettings(next);
    try {
      await db.execute("UPDATE company SET gensen_nofu = ? WHERE id = 1", [JSON.stringify(next)]);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const saveExtra = (key: string, which: keyof NofuExtras, value: NofuExtra | null) => {
    const extras = { ...(settings.extras ?? {}) };
    const cur = { ...(extras[key] ?? {}) };
    if (value && (value.persons > 0 || value.amount > 0 || value.tax > 0 || value.payDate)) cur[which] = value;
    else delete cur[which];
    if (Object.keys(cur).length > 0) extras[key] = cur;
    else delete extras[key];
    save({ ...settings, extras });
  };

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() + 1 - i);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>所得税の納付書（所得税徴収高計算書）</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          確定した給与・賞与から、源泉所得税の納付書（給与所得・退職所得等の所得税徴収高計算書）に書き写す中身を出します。
          納付書は、税務署から届いた用紙に書きます（用紙の代わりに印刷したものは使えません。e-Tax で納めるときも、この中身を入れます）。
          書き方は、国税庁「所得税徴収高計算書（納付書）の記載のしかた」によります。支給額は、所得税がかかる額（非課税の通勤手当を除く。源泉徴収簿の総支給金額と同じ）です。
          退職手当等の欄は、退職金の画面で保存した退職金です（Q で計算しない退職手当等があれば「手で入れる」で足します）。
          非居住者に払った退職金の所得税は、この納付書ではなく「非居住者・外国法人の所得についての所得税徴収高計算書（納付書）」で納めるので、入れていません。
          納期限：納期の特例を受けていなければ支払った月の翌月10日、受けていれば1月〜6月分は7月10日・7月〜12月分は翌年1月20日（土日祝日なら次の日）。
        </div>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>支払った年</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={!!settings.specialDue} onChange={(e) => save({ ...settings, specialDue: e.target.checked })} />
            源泉所得税の納期の特例の承認を受けている（常時10人未満の事業所。半年ごとに納める）
          </label>
          {mode === "general" && (
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
              支払がない月も出す
            </label>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={shown.length === 0} style={S.button("#2563eb", shown.length === 0)}>🖨 印刷・PDF保存</button>
        </div>
      </div>

      {salaries === null ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>読み込んでいます…</div>
      ) : shown.length === 0 ? (
        <div className="no-print" style={{ ...S.card, color: "#94a3b8" }}>{year}年に支払った、確定した給与・賞与・退職金がありません。</div>
      ) : (
        <div id={PRINT_ID}>
          {shown.map((s) => <SlipCard key={s.key} slip={s} onExtra={(which, v) => saveExtra(s.key, which, v)} extras={settings.extras?.[s.key] ?? {}} />)}
        </div>
      )}
    </div>
  );
}

function SlipCard({ slip, extras, onExtra }: { slip: NofuSlip; extras: NofuExtras; onExtra: (which: keyof NofuExtras, v: NofuExtra | null) => void }) {
  const taxName = slip.withDefense ? "所得税、復興特別所得税及び防衛特別所得税" : "所得税及び復興特別所得税";
  const row = (label: string, line: NofuLine, opts: { noDate?: boolean; officer?: boolean; extra?: keyof NofuExtras } = {}) => (
    <tr>
      <td style={S.td}>{label}</td>
      <td style={{ ...S.td, whiteSpace: "nowrap" }}>{opts.noDate ? "—" : payDateCode(line, slip.mode)}</td>
      {opts.officer && <td style={{ ...S.td, color: "#92400e" }}>{line.persons > 0 ? "（手で書く）" : ""}</td>}
      {!opts.officer && <td style={S.td} />}
      <td style={S.tdNum}>{line.persons ? `${line.persons} 人` : ""}</td>
      <td style={S.tdNum}>{line.amount ? S.yen(line.amount) : ""}</td>
      <td style={S.tdNum}>{line.persons || line.tax ? S.yen(line.tax) : ""}</td>
      {opts.extra ? <td className="no-print" style={S.td}><ExtraInput value={extras[opts.extra] ?? null} onChange={(v) => onExtra(opts.extra!, v)} /></td> : <td className="no-print" style={S.td} />}
    </tr>
  );
  return (
    <div className="page" style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          {slip.label}　<span style={{ fontSize: 12, fontWeight: "normal" }}>給与所得・退職所得等の所得税徴収高計算書（{slip.mode === "special" ? "納期特例分" : "一般"}）</span>
        </h3>
        <div style={{ fontSize: 13 }}>納期限 <b>{dateLabel(slip.dueDate)}</b></div>
      </div>
      {slip.empty ? (
        <div style={{ ...S.small, marginTop: 8 }}>この期間に支払った給与・賞与・退職金はありません（納付書は要りません）。</div>
      ) : (
        <>
          <table style={{ ...S.table, marginTop: 8, maxWidth: 520 }}>
            <tbody>
              <tr><td style={{ ...S.td, width: 140 }}>年度</td><td style={S.td}><b>{slip.fiscalYearCode}</b>　<span style={S.small}>（会計年度。納期限に納める場合）</span></td></tr>
              <tr>
                <td style={S.td}>納期等の区分</td>
                <td style={S.td}><b>{slip.mode === "special" ? `自 ${slip.periodCodes.from}　至 ${slip.periodCodes.to}` : slip.periodCodes.from}</b>　<span style={S.small}>（元号・年・月）</span></td>
              </tr>
            </tbody>
          </table>
          <table style={{ ...S.table, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={S.th}>区分</th><th style={S.th}>支払年月日</th><th style={S.th}>同上の支払確定年月日</th>
                <th style={{ ...S.th, textAlign: "right" }}>人員</th><th style={{ ...S.th, textAlign: "right" }}>支給額</th><th style={{ ...S.th, textAlign: "right" }}>税額</th>
                <th className="no-print" style={S.th}>手で入れる</th>
              </tr>
            </thead>
            <tbody>
              {row("俸給、給料等", slip.salary)}
              {row("賞与（役員賞与を除く）", slip.bonus)}
              {row("日雇労務者の賃金", slip.daily, { noDate: true })}
              {row("退職手当等", slip.retirement, { extra: "retirement" })}
              {row("税理士等の報酬", slip.professional, { extra: "professional" })}
              {row("役員賞与", slip.officerBonus, { officer: true })}
              <tr><td style={S.td} colSpan={5}>年末調整による不足税額</td><td style={S.tdNum}>{slip.shortage ? S.yen(slip.shortage) : ""}</td><td className="no-print" style={S.td} /></tr>
              <tr><td style={S.td} colSpan={5}>年末調整による超過税額</td><td style={S.tdNum}>{slip.excess ? S.yen(slip.excess) : ""}</td><td className="no-print" style={S.td} /></tr>
              <tr style={{ fontWeight: "bold" }}><td style={S.td} colSpan={5}>本税</td><td style={S.tdNum}>{S.yen(slip.principal)}</td><td className="no-print" style={S.td} /></tr>
              <tr><td style={S.td} colSpan={5}>延滞税・不納付加算税</td><td style={{ ...S.tdNum, color: "#94a3b8" }}>（あるときだけ手で書く）</td><td className="no-print" style={S.td} /></tr>
              <tr style={{ fontWeight: "bold", backgroundColor: "#e0f2fe" }}><td style={S.td} colSpan={5}>合計額</td><td style={S.tdNum}>¥{S.yen(slip.total)}</td><td className="no-print" style={S.td} /></tr>
            </tbody>
          </table>
          <div style={{ ...S.small, marginTop: 6 }}>
            税額は「{taxName}」の額です。{slip.principal === 0 ? "納める税額が0円でも、納付書は出します（金融機関か税務署に）。" : ""}
          </div>
          {slip.notes.length > 0 && (
            <ul style={{ ...S.note, margin: "8px 0 0", paddingLeft: 18 }}>
              {slip.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** 退職手当等（Q で計算しない分）・税理士等の報酬（Q で計算しないので、手で入れる） */
function ExtraInput({ value, onChange }: { value: NofuExtra | null; onChange: (v: NofuExtra | null) => void }) {
  const [draft, setDraft] = useState<NofuExtra>(value ?? { payDate: "", persons: 0, amount: 0, tax: 0 });
  useEffect(() => { setDraft(value ?? { payDate: "", persons: 0, amount: 0, tax: 0 }); }, [value]);
  const commit = (next: NofuExtra) => { setDraft(next); onChange(next); };
  const num = (k: "persons" | "amount" | "tax", w: number) => (
    <input type="number" min={0} value={draft[k] || ""} placeholder={k === "persons" ? "人" : k === "amount" ? "支給額" : "税額"}
      onChange={(e) => setDraft({ ...draft, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
      onBlur={() => commit(draft)} style={{ ...S.input, width: w, padding: "3px 4px", fontSize: 12 }} />
  );
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" } as CSSProperties}>
      <input type="date" value={draft.payDate ?? ""} onChange={(e) => commit({ ...draft, payDate: e.target.value })} style={{ ...S.input, padding: "3px 4px", fontSize: 12 }} />
      {num("persons", 50)}{num("amount", 90)}{num("tax", 80)}
    </div>
  );
}
