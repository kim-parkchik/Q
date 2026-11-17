/**
 * 「退職金」の画面：退職手当等（退職金）を入れて、源泉徴収する所得税と特別徴収する住民税を計算し（utils/retirementIncome.ts）、
 * 退職所得の源泉徴収票・特別徴収票を印刷する。
 * ・保存した額は、所得税の納付書（退職手当等の欄）と住民税の納入（退職所得分）に入る
 * ・年ごとに、法定調書合計表の「2 退職所得の源泉徴収票合計表」に書く額と、住民税の納入（退職所得分）の納入先・期限・額を出す
 * ・源泉徴収票の税務署提出用・市区町村提出用には、事務取扱担当者が選んだときだけ、鍵を開けて本人のマイナンバーを書く
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { localGovByCode, localGovLabel } from "../../utils/localGov";
import { SELF_KEY } from "../../utils/myNumber";
import { paymentMunicipalityOf } from "../../utils/residentTax";
import { rollForward, statutoryDueOf } from "../../utils/residentTaxPayment";
import {
  calcRetirement, defaultRetirementKind, emptyRetirementInput, parseRetirementInput, RETIREMENT_KIND_LABELS,
  RETIREMENT_SECTION_LABELS, retirementSummaryOf, servicePeriodLabel, servicePeriodOf,
  type OtherRetirement, type RetirementInput, type RetirementKind, type RetirementRecord,
} from "../../utils/retirementIncome";
import { formatWareki } from "../../utils/wareki";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import { LocalGovSelect } from "../settings/staff/ResidentTaxEditor";
import RetirementSlipSheet, { SLIP_COPY_LABELS, type SlipCopy, type SlipPayer } from "./RetirementSlipSheet";
import * as S from "./reportStyles";

interface Props {
  db: Database;
  staffList: any[];
  currentUser?: MyNumberUser | null;
}

interface Draft {
  id: number | null;
  staffId: string;
  payDate: string;
  fixedDate: string;
  amount: number;
  municipality: string;
  input: RetirementInput;
}

const today = new Date();
const PRINT_ID = "retirement-slip-print";
const yen = (v: number) => `${v.toLocaleString()} 円`;
const muniLabel = (code: string) => localGovLabel(localGovByCode(code)) || (code ? code : "（納入先が入っていません）");
const yearOf = (d: string) => Number(d.slice(0, 4)) || today.getFullYear();
const toInt = (v: string) => Math.max(0, Math.floor(Number(v.replace(/[,，\s]/g, "")) || 0));

const recordOf = (r: any): RetirementRecord => ({
  id: Number(r.id), staffId: String(r.staff_id), payDate: String(r.pay_date ?? ""), fixedDate: String(r.fixed_date ?? ""),
  amount: Number(r.amount) || 0, incomeTax: Number(r.income_tax) || 0, cityTax: Number(r.city_tax) || 0, prefTax: Number(r.pref_tax) || 0,
  municipality: String(r.municipality ?? ""), input: parseRetirementInput(r.detail),
});

/** 新しく入れるときの初めの値（従業員の入社日・退職日・住所・住民税の市区町村から） */
const newDraft = (staff: any): Draft => {
  const retire = String(staff?.retirement_date ?? "");
  const fixed = retire || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const death = String(staff?.death_date ?? "");
  return {
    id: null, staffId: String(staff.id), payDate: "", fixedDate: fixed, amount: 0,
    municipality: paymentMunicipalityOf(staff, yearOf(fixed)),
    input: {
      ...emptyRetirementInput(),
      serviceFrom: String(staff?.join_date ?? ""), serviceTo: retire,
      death: !!death && (!retire || death >= retire),
      address: String(staff?.address ?? ""),
    },
  };
};

export default function RetirementManager({ db, staffList, currentUser = null }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const unlock = useMyNumberUnlock();
  const [year, setYear] = useState(today.getFullYear());
  const [records, setRecords] = useState<RetirementRecord[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState("");
  const [payer, setPayer] = useState<SlipPayer>({ name: "", address: "", phone: "", corporateNumber: "" });
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  /** 住民税の納期の特例の承認を受けている市区町村（住民税の納入の画面で入れる。退職所得分にも使う。地方税法328条の5第3項） */
  const [specialDue, setSpecialDue] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copy, setCopy] = useState<SlipCopy>("employee");
  const [myNumberAccess, setMyNumberAccess] = useState(false);
  const [printNumber, setPrintNumber] = useState<string | null>(null);

  const staffById = useMemo(() => new Map(staffList.map((s) => [String(s.id), s])), [staffList]);

  const load = async () => {
    try {
      const rows = await db.select<any[]>("SELECT * FROM retirement_allowances ORDER BY fixed_date, id");
      setRecords((rows ?? []).map(recordOf));
    } catch (e) {
      console.error("退職金の読み込みエラー:", e);
      setRecords([]);
    }
  };

  useEffect(() => {
    load();
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name, address, phone, corporate_number FROM company WHERE id = 1");
        setPayer({
          name: String(c?.[0]?.name ?? ""), address: String(c?.[0]?.address ?? ""), phone: String(c?.[0]?.phone ?? ""),
          corporateNumber: String(c?.[0]?.corporate_number ?? ""),
        });
        const h = await db.select<{ holiday_date: string }[]>("SELECT holiday_date FROM holiday_master");
        setHolidays(new Set((h ?? []).map((x) => x.holiday_date)));
        const m = await db.select<{ code: string; special_due: number | null }[]>("SELECT code, special_due FROM resident_tax_municipalities");
        setSpecialDue(new Set((m ?? []).filter((x) => Number(x.special_due) === 1).map((x) => String(x.code))));
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => {
    hasMyNumberAccess(db, currentUser).then(setMyNumberAccess).catch(() => setMyNumberAccess(false));
  }, [db, currentUser]);

  const inYear = useMemo(() => (records ?? []).filter((r) => r.fixedDate.startsWith(`${year}-`)), [records, year]);
  const resultOf = (r: { staffId: string; fixedDate: string; amount: number; input: RetirementInput }) =>
    calcRetirement(yearOf(r.fixedDate), r.amount, Number(staffById.get(r.staffId)?.is_executive) === 1, r.input);
  const draftResult = useMemo(() => (draft ? resultOf(draft) : null), [draft, staffById]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft || !draftResult) return;
    if (!draft.payDate) return dialog.warning("支払う日を入れてください。");
    if (!draft.fixedDate) return dialog.warning("支払が確定した日を入れてください。");
    if (draft.amount <= 0) return dialog.warning("支払金額を入れてください。");
    if (draftResult.error) return dialog.warning(draftResult.error);
    const r = draftResult;
    const values = [draft.staffId, draft.payDate, draft.fixedDate, draft.amount, r.incomeTax, r.cityTax, r.prefTax, draft.municipality || null, JSON.stringify(draft.input)];
    try {
      if (draft.id === null) {
        await db.execute(
          `INSERT INTO retirement_allowances (staff_id, pay_date, fixed_date, amount, income_tax, city_tax, pref_tax, municipality, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
      } else {
        await db.execute(
          `UPDATE retirement_allowances SET staff_id = ?, pay_date = ?, fixed_date = ?, amount = ?, income_tax = ?, city_tax = ?, pref_tax = ?,
             municipality = ?, detail = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`, [...values, draft.id]);
      }
      toast.success("保存しました");
      setYear(yearOf(draft.fixedDate));
      setDraft(null);
      await load();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const remove = async (rec: RetirementRecord) => {
    const name = staffById.get(rec.staffId)?.name ?? rec.staffId;
    const ok = await ask(`${name}さんの退職金（${formatWareki(rec.payDate)}支払・${rec.amount.toLocaleString()}円）を消しますか？\n所得税の納付書・住民税の納入からも消えます。`, { title: "退職金を消す", kind: "warning" });
    if (!ok) return;
    try {
      await db.execute("DELETE FROM retirement_allowances WHERE id = ?", [rec.id]);
      if (selectedId === rec.id) setSelectedId(null);
      await load();
    } catch (e) {
      console.error(e);
      dialog.error(`消せませんでした。\n${e}`);
    }
  };

  // 印刷（マイナンバーを書くときは、鍵を開けて本人の番号を読む。書いたことを記録に残す。番号は記録に書かない）
  const selected = inYear.find((r) => r.id === selectedId) ?? null;
  const print = async (withNumber: boolean) => {
    if (!selected) return;
    if (withNumber) {
      const numbers = await unlock.readNumbers(db, currentUser, [selected.staffId]);
      if (!numbers) return;
      const v = numbers[selected.staffId]?.[SELF_KEY] ?? "";
      if (!v) {
        await dialog.warning("この人のマイナンバーが登録されていません（マイナンバーの画面で登録するか、個人番号の欄を手で書いてください）。");
        return;
      }
      await logMyNumber(db, currentUser, `退職所得の源泉徴収票（${SLIP_COPY_LABELS[copy]}）を印刷しました（${staffById.get(selected.staffId)?.name ?? ""}。マイナンバー 1人分）`);
      setPrintNumber(v);
    } else {
      setPrintNumber(null);
      setTimeout(() => window.print(), 0);
    }
  };
  useEffect(() => {
    if (printNumber === null) return;
    const done = () => { setPrintNumber(null); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printNumber]);

  const summary = useMemo(() => retirementSummaryOf(records ?? [], year), [records, year]);
  // 住民税の納入（退職所得分）：支払った月と納入先ごと
  const localGroups = useMemo(() => {
    const map = new Map<string, { month: string; code: string; due: string; list: RetirementRecord[] }>();
    for (const r of (records ?? []).filter((x) => x.payDate.startsWith(`${year}-`) && (x.cityTax > 0 || x.prefTax > 0))) {
      const key = `${r.payDate.slice(0, 7)}|${r.municipality}`;
      const due = rollForward(statutoryDueOf(Number(r.payDate.slice(0, 4)), Number(r.payDate.slice(5, 7)), specialDue.has(r.municipality)), holidays);
      const g = map.get(key) ?? { month: r.payDate.slice(0, 7), code: r.municipality, due, list: [] };
      g.list.push(r);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => (a.month + a.code).localeCompare(b.month + b.code));
  }, [records, year, holidays, specialDue]);

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() + 1 - i);
  const retirees = [...staffList].sort((a, b) => String(b.retirement_date ?? "").localeCompare(String(a.retirement_date ?? "")));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>退職金（退職所得）</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          退職金（退職手当等）の所得税と住民税を計算し、退職所得の源泉徴収票・特別徴収票を作ります。退職金は給与とは別に計算します（給与・年末調整には入りません。社会保険料・雇用保険料はかかりません）。
          所得税は「退職所得の受給に関する申告書」を出した人は速算表で、出していない人は支払金額の20.42％を引きます。住民税（市町村民税6％・道府県民税4％）は、その年の1月1日の住所の市区町村に納めます。
          所得税は支払った月の翌月10日まで（納期の特例を受けていれば半年ごと）、住民税は支払った月の翌月10日までに納めます。保存した額は「所得税の納付書」の退職手当等の欄に入ります。
          令和8年分から、退職所得の源泉徴収票は、すべての受給者の分を税務署に出します（退職後1か月以内。1年分をまとめて翌年1月31日までに出してもよい）。受給者には、退職後1か月以内に渡します。
        </div>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>年分（支払が確定した年）</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
              {years.map((y) => <option key={y} value={y}>{y}年分</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>退職金を入れる人</span>
            <select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ ...S.input, minWidth: 220 }}>
              <option value="">選んでください</option>
              {retirees.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}{s.retirement_date ? `（${formatWareki(s.retirement_date)}退職）` : ""}</option>
              ))}
            </select>
          </label>
          <button
            disabled={!adding}
            onClick={() => { const s = staffById.get(adding); if (s) { setDraft(newDraft(s)); setAdding(""); } }}
            style={S.button("#16a085", !adding)}
          >
            ＋ 退職金を入れる
          </button>
        </div>
      </div>

      {draft && draftResult && (
        <Editor draft={draft} setDraft={setDraft} result={draftResult} staff={staffById.get(draft.staffId)} onSave={save} onCancel={() => setDraft(null)} />
      )}

      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{year}年分の退職金</h3>
        {records === null ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>読み込んでいます…</div>
        ) : inYear.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>{year}年分の退職金はありません。</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>{["氏名", "支払が確定した日", "支払う日", "区分", "支払金額", "所得税", "市町村民税", "道府県民税", "差引支給額", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {inYear.map((r) => {
                  const res = resultOf(r);
                  const net = r.amount - r.incomeTax - r.cityTax - r.prefTax;
                  const stale = !res.error && !r.input.death && (res.incomeTax !== r.incomeTax || res.cityTax !== r.cityTax || res.prefTax !== r.prefTax);
                  return (
                    <tr key={r.id} style={{ backgroundColor: r.id === selectedId ? "#eff6ff" : undefined }}>
                      <td style={S.td}>{staffById.get(r.staffId)?.name ?? r.staffId}</td>
                      <td style={S.td}>{formatWareki(r.fixedDate)}</td>
                      <td style={S.td}>{formatWareki(r.payDate)}</td>
                      <td style={S.td}>
                        {r.input.death ? "死亡退職（相続税）" : `${RETIREMENT_KIND_LABELS[res.kind]}・${res.section === "upper" ? "上段" : res.section === "middle" ? "中段" : "下段"}`}
                        {stale && <div style={{ color: "#b45309", fontSize: 11 }}>いまの入力で計算した額と違います（開いて保存し直してください）</div>}
                      </td>
                      <td style={S.tdNum}>{yen(r.amount)}</td>
                      <td style={S.tdNum}>{yen(r.incomeTax)}</td>
                      <td style={S.tdNum}>{yen(r.cityTax)}</td>
                      <td style={S.tdNum}>{yen(r.prefTax)}</td>
                      <td style={S.tdNum}>{yen(net)}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <button onClick={() => setSelectedId(r.id)} disabled={r.input.death} style={{ ...S.button("#2563eb", r.input.death), padding: "4px 8px", fontSize: 12 }}>源泉徴収票</button>{" "}
                        <button onClick={() => setDraft({ id: r.id, staffId: r.staffId, payDate: r.payDate, fixedDate: r.fixedDate, amount: r.amount, municipality: r.municipality, input: r.input })} style={{ ...S.button("#64748b"), padding: "4px 8px", fontSize: 12 }}>直す</button>{" "}
                        <button onClick={() => remove(r)} style={{ ...S.button("#dc2626"), padding: "4px 8px", fontSize: 12 }}>消す</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div style={S.card}>
          <div className="no-print" style={S.controls}>
            <h3 style={{ margin: 0, fontSize: 15, alignSelf: "center" }}>退職所得の源泉徴収票・特別徴収票（{staffById.get(selected.staffId)?.name}）</h3>
            <span style={{ flex: 1 }} />
            <label style={S.field}>
              <span style={S.label}>どれを印刷するか</span>
              <select value={copy} onChange={(e) => setCopy(e.target.value as SlipCopy)} style={S.input}>
                {(Object.keys(SLIP_COPY_LABELS) as SlipCopy[]).map((k) => <option key={k} value={k}>{SLIP_COPY_LABELS[k]}</option>)}
              </select>
            </label>
            <button onClick={() => print(false)} style={S.button("#2563eb")}>🖨 印刷・PDF保存</button>
            {copy !== "employee" && myNumberAccess && <button onClick={() => print(true)} style={S.button("#7c3aed")}>マイナンバーを書いて印刷</button>}
            <button onClick={() => setSelectedId(null)} style={S.button("#94a3b8")}>閉じる</button>
          </div>
          <div className="no-print" style={{ ...S.small, marginBottom: 8, lineHeight: 1.7 }}>
            受給者交付用には、マイナンバー・法人番号を書きません。税務署提出用・市区町村提出用の個人番号の欄は、
            {myNumberAccess ? "「マイナンバーを書いて印刷」で書くか、" : "事務取扱担当者が印刷するか、"}手で書きます。
            市区町村提出用（特別徴収票）は、eLTAX で出せるようになるまで、作らず出さなくてもよいとされています（手引 第3章）。
            ④ 番号は、確定拠出年金の一時金・譲渡制限付株式などのときだけ書きます（Q の退職金では空です）。
          </div>
          <div id={PRINT_ID}>
            <RetirementSlipSheet
              data={{
                name: String(staffById.get(selected.staffId)?.name ?? ""), address: selected.input.address, januaryAddress: selected.input.januaryAddress,
                position: selected.input.position, amount: selected.amount, serviceFrom: selected.input.serviceFrom, serviceTo: selected.input.serviceTo,
                result: { ...resultOf(selected), incomeTax: selected.incomeTax, cityTax: selected.cityTax, prefTax: selected.prefTax },
              }}
              payer={payer} copy={copy} myNumber={printNumber ?? ""}
            />
          </div>
        </div>
      )}

      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>法定調書合計表に書く額（{year}年分）</h3>
        <div style={{ ...S.note, marginBottom: 8 }}>
          法定調書合計表の「2 退職所得の源泉徴収票合計表（316）」の欄です。令和8年分から、Ⓐ（退職手当等の総額）とⒷ（Ⓐのうち源泉徴収票を提出するもの）の両方に、
          すべての受給者の分を書きます（死亡退職の分は入れません）。退職所得の源泉徴収票を税務署に出すときは、合計表も出します。
        </div>
        <table style={{ ...S.table, maxWidth: 640 }}>
          <thead><tr>{["区分", "人員", "支払金額", "源泉徴収税額"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {["Ⓐ 退職手当等の総額", "Ⓑ Ⓐのうち、源泉徴収票を提出するもの"].map((l) => (
              <tr key={l}><td style={S.td}>{l}</td><td style={S.tdNum}>{summary.persons} 人</td><td style={S.tdNum}>{yen(summary.amount)}</td><td style={S.tdNum}>{yen(summary.tax)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>住民税の納入（退職所得分。{year}年に支払った分）</h3>
        <div style={{ ...S.note, marginBottom: 8 }}>
          退職所得の住民税は、支払った月の翌月10日まで（土日祝日なら次の日。その市区町村の納期の特例を受けていれば、給与の分と同じく12月10日・6月10日）に、
          納入申告書を出して、その年の1月1日の住所の市区町村に納めます（地方税法328条の5）。
          納入書の「退職所得分」の欄と、納入申告書（裏面など）に、下の内容を書きます。eLTAX の納付情報の CSV（住民税の納入の画面）には、退職所得分の欄がないので、eLTAX の画面で入れます。
        </div>
        {localGroups.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>{year}年に支払った退職金の住民税はありません。</div>
        ) : localGroups.map((g) => (
          <div key={`${g.month}|${g.code}`} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: "bold", margin: "4px 0" }}>
              {muniLabel(g.code)}　{Number(g.month.slice(5, 7))}月支払分　納入期限 {formatWareki(g.due)}　人員 {g.list.length}人・
              {yen(g.list.reduce((s, r) => s + r.cityTax + r.prefTax, 0))}
            </div>
            <table style={S.table}>
              <thead>
                <tr>{["支払年月日", "氏名", "支払金額", "退職所得控除額", "課税標準額（課税退職所得金額）", "市町村民税", "道府県民税"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {g.list.map((r) => {
                  const res = resultOf(r);
                  return (
                    <tr key={r.id}>
                      <td style={S.td}>{formatWareki(r.payDate)}</td>
                      <td style={S.td}>{staffById.get(r.staffId)?.name ?? r.staffId}</td>
                      <td style={S.tdNum}>{yen(r.amount)}</td>
                      <td style={S.tdNum}>{yen(res.deduction)}</td>
                      <td style={S.tdNum}>{yen(res.taxable)}</td>
                      <td style={S.tdNum}>{yen(r.cityTax)}</td>
                      <td style={S.tdNum}>{yen(r.prefTax)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, alignItems: "start", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ fontSize: 12, color: "#475569", paddingTop: 6 }}>{label}</div>
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{children}</div>
        {note && <div style={{ ...S.small, marginTop: 4, lineHeight: 1.6 }}>{note}</div>}
      </div>
    </div>
  );
}

/** 金額・年数の入力（入れるたびに計算し直す。欄を離れたら 3桁ごとのカンマを付ける） */
function NumberInput({ value, onChange, width = 140, placeholder }: { value: number | null; onChange: (v: number | null) => void; width?: number; placeholder?: string }) {
  const fmt = (v: number | null) => (v === null ? "" : v.toLocaleString());
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(fmt(value));
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  return (
    <input
      value={text} placeholder={placeholder} inputMode="numeric"
      onFocus={() => setFocused(true)}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() === "" ? null : toInt(e.target.value)); }}
      onBlur={() => setFocused(false)}
      style={{ ...S.input, width, textAlign: "right" }}
    />
  );
}

function Editor({ draft, setDraft, result, staff, onSave, onCancel }: {
  draft: Draft; setDraft: (d: Draft) => void; result: ReturnType<typeof calcRetirement>; staff: any; onSave: () => void; onCancel: () => void;
}) {
  const inp = draft.input;
  const set = (patch: Partial<RetirementInput>) => setDraft({ ...draft, input: { ...inp, ...patch } });
  const executive = Number(staff?.is_executive) === 1;
  const period = servicePeriodOf(inp.serviceFrom, inp.serviceTo);
  const autoKind = defaultRetirementKind(inp.yearsOverride ?? period?.counted ?? 0, executive, inp.officerYears);
  const other: OtherRetirement = inp.other ?? { payer: "", amount: 0, years: 0, incomeTax: 0, cityTax: 0, prefTax: 0 };
  const setOther = (patch: Partial<OtherRetirement>) => set({ other: { ...other, ...patch } });
  const fixedYear = Number(draft.fixedDate.slice(0, 4));
  const w = (d: string) => formatWareki(d);
  return (
    <div className="no-print" style={{ ...S.card, border: "2px solid #16a085" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
        {staff?.name ?? draft.staffId}さんの退職金{draft.id === null ? "を入れる" : "を直す"}{executive ? "（役員）" : ""}
      </h3>
      <Row label="支払金額（退職手当等）">
        <NumberInput value={draft.amount || null} onChange={(v) => setDraft({ ...draft, amount: v ?? 0 })} width={160} placeholder="円" /> 円
      </Row>
      <Row label="支払が確定した日（年分）" note="ふつうは退職日です。役員の退職金は、株主総会などで額が決まった日です。この日の年が源泉徴収票の年分です。">
        <input type="date" value={draft.fixedDate} onChange={(e) => setDraft({ ...draft, fixedDate: e.target.value })} style={S.input} />
      </Row>
      <Row label="支払う日" note="所得税は支払った月の翌月10日まで、住民税も翌月10日までに納めます。">
        <input type="date" value={draft.payDate} onChange={(e) => setDraft({ ...draft, payDate: e.target.value })} style={S.input} />
      </Row>
      <Row label="勤続期間（就職年月日〜退職年月日）" note={period ? `${servicePeriodLabel(period)} → 勤続年数 ${period.counted}年（1年未満の端数は1年）` : "入社日と退職日を入れてください。"}>
        <input type="date" value={inp.serviceFrom} onChange={(e) => set({ serviceFrom: e.target.value })} style={S.input} />
        〜
        <input type="date" value={inp.serviceTo} onChange={(e) => set({ serviceTo: e.target.value })} style={S.input} />
      </Row>
      <Row label="勤続年数を手で決める" note="長期の欠勤・休職の期間は勤続期間に入ります。前の勤務先の期間を退職金の計算に含めるとき、前に退職金を受けた期間を除くとき、丙欄の期間を除くときなどは、年数を入れて、その計算の基礎を書きます（摘要に書きます）。">
        <NumberInput value={inp.yearsOverride} onChange={(v) => set({ yearsOverride: v })} width={80} placeholder="年" /> 年
        {inp.yearsOverride !== null && (
          <input value={inp.yearsNote} onChange={(e) => set({ yearsNote: e.target.value })} placeholder="計算の基礎（例：前の勤務先の期間 3年を含む）" style={{ ...S.input, flex: 1, minWidth: 260 }} />
        )}
      </Row>
      <Row label="区分" note={`自動では「${RETIREMENT_KIND_LABELS[autoKind]}」です（役員で、役員としての勤続年数が5年以下なら特定役員退職手当等。役員でなく、勤続年数が5年以下なら短期退職手当等）。`}>
        <select value={inp.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || null) as RetirementKind | null })} style={S.input}>
          <option value="">自動（{RETIREMENT_KIND_LABELS[autoKind]}）</option>
          {(Object.keys(RETIREMENT_KIND_LABELS) as RetirementKind[]).map((k) => <option key={k} value={k}>{RETIREMENT_KIND_LABELS[k]}</option>)}
        </select>
        {executive && (
          <>
            役員としての勤続年数
            <NumberInput value={inp.officerYears} onChange={(v) => set({ officerYears: v })} width={70} placeholder="年" /> 年
            <span style={S.small}>（空なら勤続年数と同じ）</span>
          </>
        )}
      </Row>
      <Row label="退職所得の受給に関する申告書">
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.declared} onChange={(e) => set({ declared: e.target.checked })} /> 出している（出していなければ、所得税は支払金額の20.42％）</label>
      </Row>
      <Row label="そのほか">
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.disability} onChange={(e) => set({ disability: e.target.checked })} /> 障害者になったことが直接の原因で退職した（控除に100万円を加える）</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.death} onChange={(e) => set({ death: e.target.checked })} /> 死亡退職（相続税がかかるので、所得税・住民税を引かない）</label>
      </Row>
      <Row label="退職所得控除額を手で決める" note="前の年以前に退職金を受けていて、勤続期間が重なっている分を引くときなど（国税庁 タックスアンサー No.2732）。障害者の100万円も含めた額を入れます。">
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={inp.deductionOverride !== null} onChange={(e) => set({ deductionOverride: e.target.checked ? result.deduction : null })} /> 手で決める
        </label>
        {inp.deductionOverride !== null && (
          <>
            <NumberInput value={inp.deductionOverride} onChange={(v) => set({ deductionOverride: v ?? 0 })} width={140} /> 円
            <input value={inp.deductionNote} onChange={(e) => set({ deductionNote: e.target.value })} placeholder="計算の基礎（摘要に書きます）" style={{ ...S.input, flex: 1, minWidth: 260 }} />
          </>
        )}
      </Row>
      <Row label="その年に支払済みの他の退職手当等" note="申告書に、同じ年にほかから受けた退職金が書いてあるとき。合わせた額で計算した税額から、ほかで引かれた税額を引きます（源泉徴収票は中段）。">
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={!!inp.other} onChange={(e) => set({ other: e.target.checked ? other : null, combinedYears: null })} /> ある
        </label>
        {inp.other && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6, width: "100%" }}>
            <input value={other.payer} onChange={(e) => setOther({ payer: e.target.value })} placeholder="支払者の名前" style={S.input} />
            <span>支払金額 <NumberInput value={other.amount || null} onChange={(v) => setOther({ amount: v ?? 0 })} width={110} /></span>
            <span>勤続年数 <NumberInput value={other.years || null} onChange={(v) => setOther({ years: v ?? 0 })} width={60} /> 年</span>
            <span>所得税 <NumberInput value={other.incomeTax || null} onChange={(v) => setOther({ incomeTax: v ?? 0 })} width={100} /></span>
            <span>市町村民税 <NumberInput value={other.cityTax || null} onChange={(v) => setOther({ cityTax: v ?? 0 })} width={90} /></span>
            <span>道府県民税 <NumberInput value={other.prefTax || null} onChange={(v) => setOther({ prefTax: v ?? 0 })} width={90} /></span>
            <span>合わせた勤続年数 <NumberInput value={inp.combinedYears} onChange={(v) => set({ combinedYears: v })} width={60} placeholder="自動" /> 年</span>
          </div>
        )}
      </Row>
      <Row label="住民税の納入先" note={`${fixedYear || ""}年1月1日の住所の市区町村です（初めは、従業員の画面の住民税の市区町村）。`}>
        <LocalGovSelect code={draft.municipality} setCode={(c) => setDraft({ ...draft, municipality: c })} />
      </Row>
      <Row label="源泉徴収票に書くこと">
        <input value={inp.address} onChange={(e) => set({ address: e.target.value })} placeholder="住所又は居所（作る日の現況）" style={{ ...S.input, flex: 2, minWidth: 260 }} />
        <input value={inp.januaryAddress} onChange={(e) => set({ januaryAddress: e.target.value })} placeholder={`${fixedYear || ""}年1月1日の住所`} style={{ ...S.input, flex: 2, minWidth: 260 }} />
        <input value={inp.position} onChange={(e) => set({ position: e.target.value })} placeholder="役職名（退職時）" style={{ ...S.input, width: 160 }} />
      </Row>

      <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f8fafc", borderRadius: 8 }}>
        {result.error ? (
          <div style={S.errorBox}>{result.error}</div>
        ) : (
          <>
            <table style={{ ...S.table, maxWidth: 720 }}>
              <tbody>
                <tr><td style={S.td}>源泉徴収票の区分</td><td style={S.td} colSpan={3}>{RETIREMENT_SECTION_LABELS[result.section]}・{RETIREMENT_KIND_LABELS[result.kind]}</td></tr>
                <tr>
                  <td style={S.td}>勤続年数</td><td style={S.tdNum}>{result.years} 年</td>
                  <td style={S.td}>退職所得控除額</td><td style={S.tdNum}>{yen(result.deduction)}</td>
                </tr>
                <tr>
                  <td style={S.td}>課税退職所得金額（1,000円未満切り捨て）</td><td style={S.tdNum}>{yen(result.taxable)}</td>
                  <td style={S.td}>所得税（源泉徴収税額）</td><td style={{ ...S.tdNum, fontWeight: "bold" }}>{yen(result.incomeTax)}</td>
                </tr>
                <tr>
                  <td style={S.td}>市町村民税（6％）</td><td style={S.tdNum}>{yen(result.cityTax)}</td>
                  <td style={S.td}>道府県民税（4％）</td><td style={S.tdNum}>{yen(result.prefTax)}</td>
                </tr>
                <tr style={{ fontWeight: "bold", backgroundColor: "#e0f2fe" }}>
                  <td style={S.td} colSpan={3}>差引支給額（支払金額 − 所得税 − 住民税）</td><td style={S.tdNum}>{yen(result.netPay)}</td>
                </tr>
              </tbody>
            </table>
            {result.remarks.length > 0 && <div style={{ ...S.small, marginTop: 6 }}>摘要：{result.remarks.join("／")}</div>}
          </>
        )}
        {result.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 8 }}>{result.notes.map((x, i) => <div key={i}>・{x}</div>)}</div>}
        {draft.payDate && (
          <div style={{ ...S.small, marginTop: 6 }}>
            支払う日 {w(draft.payDate)}：納期の特例を受けていなければ、所得税・住民税とも {w(statutoryDueOf(Number(draft.payDate.slice(0, 4)), Number(draft.payDate.slice(5, 7)), false))}（土日祝日なら次の日）までに納めます。
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={onSave} disabled={!!result.error} style={S.button("#16a085", !!result.error)}>保存する</button>
        <button onClick={onCancel} style={S.button("#94a3b8")}>やめる</button>
      </div>
    </div>
  );
}
