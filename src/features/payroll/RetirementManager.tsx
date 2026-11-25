/**
 * 「退職金」の画面：退職手当等（退職金）を入れて、源泉徴収する所得税と特別徴収する住民税を計算し（utils/retirementIncome.ts）、
 * 退職所得の源泉徴収票・特別徴収票を印刷する。
 * ・保存した額は、所得税の納付書（退職手当等の欄）と住民税の納入（退職所得分）に入る
 * ・年ごとに、法定調書合計表の「2 退職所得の源泉徴収票合計表」に書く額と、住民税の納入（退職所得分）の納入先・期限・額を出す
 * ・源泉徴収票の税務署提出用・市区町村提出用には、事務取扱担当者が選んだときだけ、鍵を開けて本人のマイナンバーを書く
 * ・「退職所得の受給に関する申告書」の下書き（utils/retirementDeclaration.ts）を印刷して本人に渡せる
 * ・非居住者に払った退職手当等は「非居住者等に支払われる給与、報酬、年金及び賞金の支払調書」と合計表に書く額を出す
 * ・e-Tax で出す CSV（316 退職所得の源泉徴収票・325 退職手当金等受給者別支払調書・339 非居住者等の支払調書。utils/retirementReports.ts）を保存する
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
import { TAISHOKU_SLIP_NUMBERS } from "../../constants/taishoku";
import {
  calcRetirement, defaultRetirementKind, emptyOtherRetirement, emptyPriorRetirement, emptyRetirementHeir, emptyRetirementInput, nonResidentSummaryOf,
  parseRetirementInput, RETIREMENT_KIND_LABELS, RETIREMENT_SECTION_LABELS, retirementSummaryOf, servicePeriodLabel, servicePeriodOf,
  type OtherRetirement, type PriorRetirement, type RetirementInput, type RetirementKind, type RetirementPart, type RetirementRecord,
} from "../../utils/retirementIncome";
import { retirementDeclarationOf } from "../../utils/retirementDeclaration";
import { encodeEtaxFile, ETAX_TITLES, etax316Of, etax325Of, etax339Of, etaxMyNumberCount, nonResidentReportOf, type EtaxCode, type EtaxFile } from "../../utils/retirementReports";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { TAISHOKU_BENEFIT_REPORT, TAISHOKU_NONRESIDENT } from "../../constants/taishoku";
import { formatWareki } from "../../utils/wareki";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import { useMyNumberFileGuard } from "../mynumber/useMyNumberFileGuard";
import { LocalGovSelect } from "../settings/staff/ResidentTaxEditor";
import { benefitReportDueDate, benefitReportProblems, benefitSummaryOf, heirKeyOf, heirOmitted, heirsOf, submittedHeirs } from "../../utils/retirementBenefitReport";
import NonResidentReportSheet from "./NonResidentReportSheet";
import RetirementBenefitReportSheet from "./RetirementBenefitReportSheet";
import RetirementDeclarationSheet from "./RetirementDeclarationSheet";
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
  const guard = useMyNumberFileGuard();
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
  /** 支払調書の提出年月日 */
  const [submitDate, setSubmitDate] = useState("");
  /** 居住者の退職金で印刷するもの（源泉徴収票・申告書の下書き） */
  const [doc, setDoc] = useState<"slip" | "declaration">("slip");
  /** e-Tax の CSV：マイナンバーを書くか・死亡退職の支払調書の月 */
  const [etaxWithNumber, setEtaxWithNumber] = useState(false);
  const [etaxMonth, setEtaxMonth] = useState("");

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
      const what = selected.input.death ? "退職手当金等受給者別支払調書（退職者の個人番号）"
        : selected.input.nonResident ? "非居住者等に支払われる給与、報酬、年金及び賞金の支払調書" : `退職所得の源泉徴収票（${SLIP_COPY_LABELS[copy]}）`;
      await logMyNumber(db, currentUser, `${what}を印刷しました（${staffById.get(selected.staffId)?.name ?? ""}。マイナンバー 1人分）`);
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
  const nonResidentSummary = useMemo(() => nonResidentSummaryOf(records ?? [], year), [records, year]);
  const benefitSummary = useMemo(() => benefitSummaryOf(records ?? [], year), [records, year]);
  const deathMonths = useMemo(() => [...new Set((records ?? []).filter((r) => r.input.death && r.payDate.startsWith(`${year}-`)).map((r) => r.payDate.slice(0, 7)))].sort(), [records, year]);

  // e-Tax の CSV を保存する（直すところがあれば保存しない。マイナンバーは書くときだけ鍵を開けて読み、記録には人数だけ残す）
  const saveEtax = async (code: EtaxCode) => {
    if (!records) return;
    const person = (r: RetirementRecord) => {
      const s = staffById.get(r.staffId);
      return { name: String(s?.name ?? ""), deathDate: String(s?.death_date ?? "") };
    };
    const yearList = records.filter((r) => r.fixedDate.startsWith(`${year}-`) && !r.input.death);
    const list = code === "316" ? yearList.filter((r) => !r.input.nonResident)
      : code === "339" ? yearList.filter((r) => r.input.nonResident)
      : records.filter((r) => r.input.death && r.payDate.startsWith(etaxMonth || "-"));
    if (!list.length) return dialog.warning(code === "325" ? "その月に支払った死亡退職の退職金がありません。" : `${year}年分の${ETAX_TITLES[code]}に書く退職金がありません。`);
    const errors = list.map((r) => ({ r, res: resultOf(r) })).filter((x) => x.res.error);
    if (errors.length) return dialog.warning(`計算できない退職金があります（開いて直してください）。\n${errors.map((x) => `${person(x.r).name}：${x.res.error}`).join("\n")}`);
    let numbers: Record<string, string> | null = null;
    if (etaxWithNumber) {
      const read = await unlock.readNumbers(db, currentUser, [...new Set(list.map((r) => r.staffId))]);
      if (!read) return;
      numbers = Object.fromEntries(Object.entries(read).map(([id, v]) => [id, String((v as any)?.[SELF_KEY] ?? "")]));
    }
    const file: EtaxFile = code === "316" ? etax316Of(list.map((r) => ({ record: r, result: resultOf(r), person: person(r) })), payer, numbers)
      : code === "339" ? etax339Of(list.map((r) => ({ record: r, result: resultOf(r), person: person(r) })), payer, numbers)
      : etax325Of(list.map((r) => ({ record: r, person: person(r) })), payer, submitDate, numbers);
    if (file.problems.length) return dialog.warning(`直すところがあるので、保存しませんでした。\n${file.problems.join("\n")}`);
    if (!file.rows.length) return dialog.warning("支払調書を出す受給者がいません（受給者ごとの額が100万円以下なら、支払調書は出さなくてよいので、CSV も要りません）。");
    const { bytes, unknown } = encodeEtaxFile(file);
    if (unknown.length) return dialog.warning(`シフトJISにない字があるので、保存しませんでした（${unknown.join("")}）。`);
    // ファイルに書いたマイナンバーの人数（番号を読まなければ 0）
    const myNumbers = etaxMyNumberCount(file);
    try {
      const saved = await saveBinaryFile(bytes, `${code}_${code === "325" ? etaxMonth.replace("-", "") : year}.csv`, { name: "CSV", extensions: ["csv"] }, guard.saveOptions(myNumbers));
      if (!saved) return;
      if (numbers) await logMyNumber(db, currentUser, `e-Tax の CSV（${ETAX_TITLES[code]}）を保存しました（マイナンバー ${myNumbers}人分）`);
      toast.success(`${saved.name} を保存しました（${file.rows.length}枚）`);
      if (file.notes.length) await dialog.warning(file.notes.join("\n"), "保存しました（確かめてください）");
      // マイナンバーを書いたときは、出し終わったら消すことなどを知らせる
      await guard.notice(saved, myNumbers, "tax");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
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
                        {r.input.death ? "死亡退職（相続税）"
                          : r.input.nonResident ? "非居住者（国内源泉所得の20.42％）"
                          : `${res.mixed ? "区分の違う退職手当等" : RETIREMENT_KIND_LABELS[res.kind]}・${res.section === "upper" ? "上段" : res.section === "middle" ? "中段" : "下段"}`}
                        {stale && <div style={{ color: "#b45309", fontSize: 11 }}>いまの入力で計算した額と違います（開いて保存し直してください）</div>}
                      </td>
                      <td style={S.tdNum}>{yen(r.amount)}</td>
                      <td style={S.tdNum}>{yen(r.incomeTax)}</td>
                      <td style={S.tdNum}>{yen(r.cityTax)}</td>
                      <td style={S.tdNum}>{yen(r.prefTax)}</td>
                      <td style={S.tdNum}>{yen(net)}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <button onClick={() => { setSelectedId(r.id); setDoc("slip"); }} style={{ ...S.button("#2563eb"), padding: "4px 8px", fontSize: 12 }}>
                          {r.input.death || r.input.nonResident ? "支払調書" : "源泉徴収票・申告書"}
                        </button>{" "}
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

      {selected && selected.input.death && (() => {
        const staff = staffById.get(selected.staffId);
        const problems = benefitReportProblems(selected);
        const submitted = submittedHeirs(records ?? [], selected.payDate.slice(0, 7));
        const heirs = heirsOf(selected).map((h, i) => ({ h, sent: submitted.has(heirKeyOf(selected, h, i)) }));
        const due = selected.payDate ? benefitReportDueDate(selected.payDate, (d) => holidays.has(d)) : "";
        return (
          <div style={S.card}>
            <div className="no-print" style={S.controls}>
              <h3 style={{ margin: 0, fontSize: 15, alignSelf: "center" }}>退職手当金等受給者別支払調書（{staff?.name}）</h3>
              <span style={{ flex: 1 }} />
              <label style={S.field}>
                <span style={S.label}>提出年月日</span>
                <input type="date" value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} style={S.input} />
              </label>
              <button onClick={() => print(false)} style={S.button("#2563eb")}>🖨 印刷・PDF保存</button>
              {myNumberAccess && <button onClick={() => print(true)} style={S.button("#7c3aed")}>退職者のマイナンバーを書いて印刷</button>}
              <button onClick={() => setSelectedId(null)} style={S.button("#94a3b8")}>閉じる</button>
            </div>
            <div className="no-print" style={{ ...S.small, marginBottom: 8, lineHeight: 1.7 }}>
              死亡退職で払う退職手当等は相続税の対象なので、退職所得の源泉徴収票ではなく、この支払調書を受給者（相続人など）ごとに1枚、合計表と一緒に税務署に出します。
              {due && <>提出期限は、支払った月の翌月{TAISHOKU_BENEFIT_REPORT.dueDay}日（{formatWareki(due)}）です（相続税法59条1項）。</>}
              受給者ごとの額（その月の合計）が{(TAISHOKU_BENEFIT_REPORT.omitUpTo / 10000).toLocaleString()}万円以下の人は、支払調書を出さなくてよいです（相続税法施行規則30条3項。合計表の支払総額には入れます）。
              {heirs.some((x) => !x.sent) && <>出さない受給者：{heirs.filter((x) => !x.sent).map((x) => `${x.h.name || "（氏名なし）"} ${x.h.amount.toLocaleString()}円`).join("、")}。</>}
              受給者の個人番号は、相続人などから受け取って手で書きます（Q には残しません）。退職者の個人番号は、
              {myNumberAccess ? "「退職者のマイナンバーを書いて印刷」で書くか、" : "事務取扱担当者が印刷するか、"}手で書きます。
            </div>
            {problems.length > 0 && <div className="no-print" style={{ ...S.warnBox, marginBottom: 8 }}>{problems.map((x, i) => <div key={i}>・{x}</div>)}</div>}
            <div id={PRINT_ID}>
              {heirs.filter((x) => x.sent).map(({ h }, i) => (
                <RetirementBenefitReportSheet
                  key={i}
                  data={{
                    heir: h, retireeName: String(staff?.name ?? ""), retireeAddress: selected.input.address, benefitKind: selected.input.benefitKind,
                    position: selected.input.position, retireDate: selected.input.serviceTo || String(staff?.retirement_date ?? ""), payDate: selected.payDate,
                    deathDate: String(staff?.death_date ?? ""), submitDate, remarks: "",
                  }}
                  payer={payer} retireeNumber={printNumber ?? ""}
                />
              ))}
            </div>
          </div>
        );
      })()}

      {selected && !selected.input.death && selected.input.nonResident && (() => {
        const staff = staffById.get(selected.staffId);
        const res = resultOf(selected);
        return (
          <div style={S.card}>
            <div className="no-print" style={S.controls}>
              <h3 style={{ margin: 0, fontSize: 15, alignSelf: "center" }}>非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（{staff?.name}）</h3>
              <span style={{ flex: 1 }} />
              <button onClick={() => print(false)} style={S.button("#2563eb")}>🖨 印刷・PDF保存</button>
              {myNumberAccess && <button onClick={() => print(true)} style={S.button("#7c3aed")}>マイナンバーを書いて印刷</button>}
              <button onClick={() => setSelectedId(null)} style={S.button("#94a3b8")}>閉じる</button>
            </div>
            <div className="no-print" style={{ ...S.small, marginBottom: 8, lineHeight: 1.7 }}>
              非居住者に払った退職手当等は、退職所得の源泉徴収票ではなく、この支払調書を合計表と一緒に税務署に出します（法定調書の手引 第3章の注）。
              支払金額は国内源泉所得（居住者として勤務した期間の分）で、区分は「退職手当等」です。個人番号又は法人番号の欄は、
              {myNumberAccess ? "「マイナンバーを書いて印刷」で書くか、" : "事務取扱担当者が印刷するか、"}手で書きます（番号がない人は書きません）。
            </div>
            {res.error && <div className="no-print" style={{ ...S.errorBox, marginBottom: 8 }}>{res.error}</div>}
            <div id={PRINT_ID}>
              <NonResidentReportSheet
                data={nonResidentReportOf({ ...selected }, { name: String(staff?.name ?? ""), deathDate: "" }, res)}
                payer={payer} myNumber={printNumber ?? ""}
              />
            </div>
          </div>
        );
      })()}

      {selected && !selected.input.death && !selected.input.nonResident && doc === "declaration" && (() => {
        const staff = staffById.get(selected.staffId);
        const res = resultOf(selected);
        return (
          <div style={S.card}>
            <div className="no-print" style={S.controls}>
              <h3 style={{ margin: 0, fontSize: 15, alignSelf: "center" }}>退職所得の受給に関する申告書の下書き（{staff?.name}）</h3>
              <span style={{ flex: 1 }} />
              <button onClick={() => setDoc("slip")} style={S.button("#64748b")}>源泉徴収票にする</button>
              <button onClick={() => print(false)} style={S.button("#2563eb")}>🖨 印刷・PDF保存</button>
              <button onClick={() => setSelectedId(null)} style={S.button("#94a3b8")}>閉じる</button>
            </div>
            <div className="no-print" style={{ ...S.small, marginBottom: 8, lineHeight: 1.7 }}>
              退職金を受ける人が、支払を受ける時までに会社に出す申告書（所得税法203条）の下書きです。Q に入れた内容を、国税庁の様式（令和8年1月1日以後）の A〜E 欄の並びで出します。
              本人に渡して確かめてもらい、生活扶助の有無・個人番号を書いて、出してもらいます（受け取った申告書は会社で保存します）。
              出してもらえないときは、所得税は支払金額の20.42％になります。
            </div>
            {res.error && <div className="no-print" style={{ ...S.errorBox, marginBottom: 8 }}>{res.error}</div>}
            {!res.error && retirementDeclarationOf(selected, res).notes.length > 0 && (
              <div className="no-print" style={{ ...S.warnBox, marginBottom: 8 }}>{retirementDeclarationOf(selected, res).notes.map((x, i) => <div key={i}>・{x}</div>)}</div>
            )}
            <div id={PRINT_ID}>
              <RetirementDeclarationSheet
                data={retirementDeclarationOf(selected, res)}
                payer={payer}
                person={{ name: String(staff?.name ?? ""), address: selected.input.address, januaryAddress: selected.input.januaryAddress, municipality: selected.municipality ? muniLabel(selected.municipality) : "" }}
              />
            </div>
          </div>
        );
      })()}

      {selected && !selected.input.death && !selected.input.nonResident && doc === "slip" && (
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
            <button onClick={() => setDoc("declaration")} style={S.button("#0f766e")}>受給に関する申告書の下書き</button>
            <button onClick={() => setSelectedId(null)} style={S.button("#94a3b8")}>閉じる</button>
          </div>
          <div className="no-print" style={{ ...S.small, marginBottom: 8, lineHeight: 1.7 }}>
            受給者交付用には、マイナンバー・法人番号を書きません。税務署提出用・市区町村提出用の個人番号の欄は、
            {myNumberAccess ? "「マイナンバーを書いて印刷」で書くか、" : "事務取扱担当者が印刷するか、"}手で書きます。
            市区町村提出用（特別徴収票）は、eLTAX で出せるようになるまで、作らず出さなくてもよいとされています（手引 第3章）。
            ④ 番号は、退職金を入れる画面で選んだときだけ書きます。未払の額を入れたときは、⑤ 支払金額に内書きします。
          </div>
          <div id={PRINT_ID}>
            <RetirementSlipSheet
              data={{
                name: String(staffById.get(selected.staffId)?.name ?? ""), address: selected.input.address, januaryAddress: selected.input.januaryAddress,
                position: selected.input.position, amount: selected.amount, serviceFrom: selected.input.serviceFrom, serviceTo: selected.input.serviceTo,
                unpaid: selected.input.unpaid, slipNumber: selected.input.slipNumber,
                result: { ...resultOf(selected), incomeTax: selected.incomeTax, cityTax: selected.cityTax, prefTax: selected.prefTax },
              }}
              payer={payer} copy={copy} myNumber={printNumber ?? ""}
            />
          </div>
        </div>
      )}

      {benefitSummary.length > 0 && (
        <div className="no-print" style={S.card}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>退職手当金等受給者別支払調書合計表に書く額（{year}年に支払った分）</h3>
          <div style={{ ...S.note, marginBottom: 8 }}>
            死亡退職で払った退職手当等の合計表は、支払った月ごと（「年月分」）に作ります。「支払総額」には支払調書を出さないもの（提出を省略できる額のもの）も含めたすべてを、
            「左のうち、支払調書を提出するものの合計」には、合計表と一緒に出す支払調書の分だけを書きます（合計表の記載要領）。提出者の欄は、会社の名前・所在地・法人番号・代表者です。
          </div>
          <table style={{ ...S.table, maxWidth: 760 }}>
            <thead>
              <tr>{["年月分", "支払総額：受給者数", "支払総額：給与金額", "支払調書を提出するもの：受給者数", "支払調書を提出するもの：給与金額"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {benefitSummary.map((g) => (
                <tr key={g.month}>
                  <td style={S.td}>{formatWareki(`${g.month}-01`).replace(/1日$/, "").replace(/月$/, "月分")}</td>
                  <td style={S.tdNum}>{g.total.persons} 人</td><td style={S.tdNum}>{yen(g.total.amount)}</td>
                  <td style={S.tdNum}>{g.submit.persons} 人</td><td style={S.tdNum}>{yen(g.submit.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>法定調書合計表に書く額（{year}年分）</h3>
        <div style={{ ...S.note, marginBottom: 8 }}>
          法定調書合計表の「2 退職所得の源泉徴収票合計表（316）」の欄です。令和8年分から、Ⓐ（退職手当等の総額）とⒷ（Ⓐのうち源泉徴収票を提出するもの）の両方に、
          すべての受給者の分を書きます（死亡退職と、非居住者に払った分は入れません）。退職所得の源泉徴収票を税務署に出すときは、合計表も出します。
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

      {nonResidentSummary.persons > 0 && (
        <div className="no-print" style={S.card}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>非居住者等に支払われる給与、報酬、年金及び賞金の支払調書合計表に書く額（{year}年分の退職手当等）</h3>
          <div style={{ ...S.note, marginBottom: 8 }}>
            合計表の「退職手当等」の行です。「支払総額（支払調書提出省略分を含む。）」と「左のうち、支払調書を提出するものの合計」の課税分に、
            支払調書と同じく国内源泉所得の額を書きます（まだ払っていない額は内書き）。租税条約で免除されたものは「免税分」に書きます（記載要領）。
            所得税は「非居住者・外国法人の所得についての所得税徴収高計算書（納付書）」で、徴収した月の翌月{TAISHOKU_NONRESIDENT.dueDay}日まで（国外で払うときは翌月末日まで）に納めます。
          </div>
          <table style={{ ...S.table, maxWidth: 640 }}>
            <thead><tr>{["区分", "人員", "支払金額", "うち未払（内書き）", "源泉徴収税額"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              <tr>
                <td style={S.td}>退職手当等（課税分）</td><td style={S.tdNum}>{nonResidentSummary.persons} 人</td><td style={S.tdNum}>{yen(nonResidentSummary.amount)}</td>
                <td style={S.tdNum}>{yen(nonResidentSummary.unpaid)}</td><td style={S.tdNum}>{yen(nonResidentSummary.tax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>e-Tax で出す CSV（{year}年分）</h3>
        <div style={{ ...S.note, marginBottom: 8 }}>
          国税庁の「レコードの内容及び記録要領」の形の CSV（シフトJIS）を保存します。退職所得の源泉徴収票（316）は e-Tax ソフト（WEB版）の
          「給与所得の源泉徴収票等の法定調書（及び同合計表）の提出」で読み込み、退職手当金等受給者別支払調書（325）と非居住者等の支払調書（339）は
          e-Tax ソフトで読み込みます。法定調書合計表は e-Tax の画面で作ります（上の額を入れます）。
          {myNumberAccess ? "マイナンバーは「マイナンバーを書く」にしたときだけ、保存するときに鍵を開けて書きます（記録には人数だけ残します）。" : "マイナンバーは、事務取扱担当者が保存するときだけ書けます。"}
        </div>
        <div style={S.controls}>
          <button onClick={() => saveEtax("316")} style={S.button("#2563eb")}>退職所得の源泉徴収票（316）を保存</button>
          {nonResidentSummary.persons > 0 && <button onClick={() => saveEtax("339")} style={S.button("#2563eb")}>非居住者等の支払調書（339）を保存</button>}
          {deathMonths.length > 0 && (
            <>
              <label style={S.field}>
                <span style={S.label}>死亡退職の支払った月</span>
                <select value={etaxMonth} onChange={(e) => setEtaxMonth(e.target.value)} style={S.input}>
                  <option value="">選んでください</option>
                  {deathMonths.map((m) => <option key={m} value={m}>{formatWareki(`${m}-01`).replace(/1日$/, "")}</option>)}
                </select>
              </label>
              <label style={S.field}>
                <span style={S.label}>提出年月日（325）</span>
                <input type="date" value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} style={S.input} />
              </label>
              <button onClick={() => saveEtax("325")} disabled={!etaxMonth} style={S.button("#2563eb", !etaxMonth)}>退職手当金等受給者別支払調書（325）を保存</button>
            </>
          )}
          {myNumberAccess && (
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={etaxWithNumber} onChange={(e) => setEtaxWithNumber(e.target.checked)} /> マイナンバーを書く</label>
          )}
        </div>
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
  const setOther = (i: number, patch: Partial<OtherRetirement>) => set({ others: inp.others.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const setPrior = (i: number, patch: Partial<PriorRetirement>) => set({ priors: inp.priors.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const setPart = (i: number, patch: Partial<RetirementPart>) => set({ parts: inp.parts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const kindSelect = (value: RetirementKind, onChange: (k: RetirementKind) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as RetirementKind)} style={S.input}>
      {(Object.keys(RETIREMENT_KIND_LABELS) as RetirementKind[]).map((k) => <option key={k} value={k}>{RETIREMENT_KIND_LABELS[k]}</option>)}
    </select>
  );
  const box = { display: "flex", flexWrap: "wrap" as const, gap: 6, alignItems: "center", width: "100%", padding: 6, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 };
  const small = { ...S.button("#94a3b8"), padding: "3px 8px", fontSize: 12 };
  const slipNumber = TAISHOKU_SLIP_NUMBERS.find((x) => x.code === inp.slipNumber);
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
      <Row
        label="区分ごとに分けて払う"
        note="役員になる前に使用人として勤めた期間の分も含めて払うときなど、同じ退職金に区分の違う部分があるときは、部分ごとに区分・額・勤続期間を入れます（額の合計は支払金額と同じにします）。区分ごとに控除額を分けて計算します（国税庁 タックスアンサー No.2741）。"
      >
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox" checked={inp.parts.length > 0}
            onChange={(e) => set({ parts: e.target.checked ? [
              { kind: "general", amount: draft.amount, from: inp.serviceFrom, to: "" },
              { kind: executive ? "officer" : "short", amount: 0, from: "", to: inp.serviceTo },
            ] : [] })}
          /> 分ける
        </label>
        {inp.parts.map((p, i) => (
          <div key={i} style={box}>
            {kindSelect(p.kind, (k) => setPart(i, { kind: k }))}
            <NumberInput value={p.amount || null} onChange={(v) => setPart(i, { amount: v ?? 0 })} width={130} /> 円
            <span>勤続期間</span>
            <input type="date" value={p.from} onChange={(e) => setPart(i, { from: e.target.value })} style={S.input} />〜
            <input type="date" value={p.to} onChange={(e) => setPart(i, { to: e.target.value })} style={S.input} />
            {inp.parts.length > 1 && <button onClick={() => set({ parts: inp.parts.filter((_, j) => j !== i) })} style={small}>消す</button>}
          </div>
        ))}
        {inp.parts.length > 0 && (
          <>
            <button onClick={() => set({ parts: [...inp.parts, { kind: "general", amount: 0, from: "", to: "" }] })} style={small}>＋ 部分を足す</button>
            <span style={S.small}>合計 {inp.parts.reduce((s, p) => s + p.amount, 0).toLocaleString()}円 ／ 支払金額 {draft.amount.toLocaleString()}円</span>
          </>
        )}
      </Row>
      {!inp.nonResident && (
        <Row label="退職所得の受給に関する申告書">
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.declared} onChange={(e) => set({ declared: e.target.checked })} /> 出している（出していなければ、所得税は支払金額の20.42％）</label>
        </Row>
      )}
      <Row label="そのほか">
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.disability} onChange={(e) => set({ disability: e.target.checked })} /> 障害者になったことが直接の原因で退職した（控除に100万円を加える）</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.death} onChange={(e) => set({ death: e.target.checked })} /> 死亡退職（相続税がかかるので、所得税・住民税を引かない）</label>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={inp.nonResident} onChange={(e) => set({ nonResident: e.target.checked })} /> 非居住者に払う（国内源泉所得の20.42％を源泉徴収。住民税はかからない。源泉徴収票ではなく非居住者等の支払調書）
        </label>
        {!inp.nonResident && (
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={inp.noJanuaryAddress} onChange={(e) => set({ noJanuaryAddress: e.target.checked })} /> {fixedYear || ""}年1月1日に国内に住所がなかった（住民税はかからない）
          </label>
        )}
      </Row>
      {inp.nonResident && !inp.death && (
        <Row
          label="非居住者の支払調書に書くこと"
          note="国内源泉所得は、退職金のうち居住者として勤務した期間に基因する部分です（海外勤務などで非居住者だった期間の分は入りません。空なら支払金額の全部）。計算の基礎（例：総額と期間の割合）・国内の納税地・納税管理人・租税条約で軽減や免除を受けるときの摘要は、支払調書と e-Tax の CSV に書きます。"
        >
          <span style={{ fontSize: 13 }}>国内源泉所得</span>
          <NumberInput value={inp.domesticAmount} onChange={(v) => set({ domesticAmount: v })} width={140} placeholder="全部" /> 円
          <input value={inp.domesticBasis} onChange={(e) => set({ domesticBasis: e.target.value })} placeholder="計算の基礎（30文字まで）" style={{ ...S.input, flex: 1, minWidth: 240 }} />
          <input value={inp.domesticTaxPlace} onChange={(e) => set({ domesticTaxPlace: e.target.value })} placeholder="国内の納税地（あれば）" style={{ ...S.input, flex: 1, minWidth: 240 }} />
          <input value={inp.taxAgent.name} onChange={(e) => set({ taxAgent: { ...inp.taxAgent, name: e.target.value } })} placeholder="納税管理人の氏名" style={{ ...S.input, width: 160 }} />
          <input value={inp.taxAgent.address} onChange={(e) => set({ taxAgent: { ...inp.taxAgent, address: e.target.value } })} placeholder="納税管理人の住所又は居所" style={{ ...S.input, flex: 1, minWidth: 240 }} />
          <input value={inp.treatyNote} onChange={(e) => set({ treatyNote: e.target.value })} placeholder="摘要（租税条約で軽減・免除されるときなど）" style={{ ...S.input, flex: 1, minWidth: 280 }} />
        </Row>
      )}
      {inp.death && (
        <Row
          label="死亡退職の受給者"
          note={`退職手当金等受給者別支払調書は、受給者（相続人など）ごとに1枚作ります。退職手当金等の種類は、退職金・功労金・確定給付企業年金規約などに基づく一時金などの名称です（記載要領）。受給者ごとの額（その月の合計）が${(TAISHOKU_BENEFIT_REPORT.omitUpTo / 10000).toLocaleString()}万円以下なら、自動で「出さない」にします（相続税法施行規則30条3項。合計表の支払総額には入ります）。`}
        >
          <span style={{ fontSize: 13 }}>退職手当金等の種類</span>
          <input value={inp.benefitKind} onChange={(e) => set({ benefitKind: e.target.value })} placeholder="退職金" style={{ ...S.input, width: 160 }} />
          {inp.heirs.map((h, i) => {
            const setHeir = (patch: Partial<typeof h>) => set({ heirs: inp.heirs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} style={box}>
                <input value={h.name} onChange={(e) => setHeir({ name: e.target.value })} placeholder="受給者の氏名" style={{ ...S.input, width: 140 }} />
                <input value={h.address} onChange={(e) => setHeir({ address: e.target.value })} placeholder="受給者の住所" style={{ ...S.input, flex: 1, minWidth: 220 }} />
                <input value={h.relation} onChange={(e) => setHeir({ relation: e.target.value })} placeholder="続柄（例：妻）" style={{ ...S.input, width: 110 }} />
                <NumberInput value={h.amount || null} onChange={(v) => setHeir({ amount: v ?? 0 })} width={120} /> 円
                <select value={h.omit === null ? "" : h.omit ? "omit" : "send"} onChange={(e) => setHeir({ omit: e.target.value === "" ? null : e.target.value === "omit" })} style={S.input}>
                  <option value="">支払調書：自動（{heirOmitted(h) ? "出さない" : "出す"}）</option>
                  <option value="send">支払調書を出す</option>
                  <option value="omit">支払調書を出さない</option>
                </select>
                <label><input type="checkbox" checked={h.abroad} onChange={(e) => setHeir({ abroad: e.target.checked })} /> 住所が国外</label>
                <button onClick={() => set({ heirs: inp.heirs.filter((_, j) => j !== i) })} style={small}>消す</button>
              </div>
            );
          })}
          <button
            onClick={() => set({ heirs: [...inp.heirs, { ...emptyRetirementHeir(), amount: Math.max(0, draft.amount - inp.heirs.reduce((t, x) => t + x.amount, 0)) }] })}
            style={small}
          >
            ＋ 受給者を足す
          </button>
        </Row>
      )}
      <Row label="退職所得控除額を手で決める" note="前の年以前に受けた退職金と重なる分は、下の「前年以前に受けた退職手当等」で計算します。Q で計算できないときだけ、障害者の100万円も含めた額を入れます（計算の基礎は摘要に書きます）。">
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
      <Row
        label="その年に支払済みの他の退職手当等"
        note="申告書に、同じ年にほかから受けた退職金（確定拠出年金の一時金も）が書いてあるとき。合わせた額で計算した税額から、ほかで引かれた税額を引きます（源泉徴収票は中段）。勤続期間を入れると、重なっていない期間を足して勤続年数を出し、区分が違えば区分ごとに分けて計算します。"
      >
        {inp.others.map((o, i) => (
          <div key={i} style={box}>
            <input value={o.payer} onChange={(e) => setOther(i, { payer: e.target.value })} placeholder="支払者の名前" style={{ ...S.input, width: 160 }} />
            <input value={o.payerAddress} onChange={(e) => setOther(i, { payerAddress: e.target.value })} placeholder="支払者の所在地（申告書の E 欄）" style={{ ...S.input, width: 200 }} />
            <span>支払を受けた日</span><input type="date" value={o.paidOn} onChange={(e) => setOther(i, { paidOn: e.target.value })} style={S.input} />
            {kindSelect(o.kind, (k) => setOther(i, { kind: k }))}
            <span>支払金額</span><NumberInput value={o.amount || null} onChange={(v) => setOther(i, { amount: v ?? 0 })} width={110} />
            <span>勤続期間</span>
            <input type="date" value={o.from} onChange={(e) => setOther(i, { from: e.target.value })} style={S.input} />〜
            <input type="date" value={o.to} onChange={(e) => setOther(i, { to: e.target.value })} style={S.input} />
            {!(o.from && o.to) && <><span>勤続年数</span><NumberInput value={o.years || null} onChange={(v) => setOther(i, { years: v ?? 0 })} width={60} /> 年</>}
            <label><input type="checkbox" checked={o.dc} onChange={(e) => setOther(i, { dc: e.target.checked })} /> 確定拠出年金の一時金</label>
            <span>所得税</span><NumberInput value={o.incomeTax || null} onChange={(v) => setOther(i, { incomeTax: v ?? 0 })} width={100} />
            <span>市町村民税</span><NumberInput value={o.cityTax || null} onChange={(v) => setOther(i, { cityTax: v ?? 0 })} width={90} />
            <span>道府県民税</span><NumberInput value={o.prefTax || null} onChange={(v) => setOther(i, { prefTax: v ?? 0 })} width={90} />
            <button onClick={() => set({ others: inp.others.filter((_, j) => j !== i), combinedYears: inp.others.length > 1 ? inp.combinedYears : null })} style={small}>消す</button>
          </div>
        ))}
        <button onClick={() => set({ others: [...inp.others, emptyOtherRetirement()] })} style={small}>＋ 足す</button>
        {inp.others.length > 0 && (
          <span style={{ fontSize: 13 }}>
            合わせた勤続年数を手で決める <NumberInput value={inp.combinedYears} onChange={(v) => set({ combinedYears: v })} width={60} placeholder="自動" /> 年
          </span>
        )}
      </Row>
      <Row
        label="前年以前に受けた退職手当等"
        note="申告書に、前の年以前に受けた退職金（確定拠出年金の一時金も）が書いてあるとき。勤続期間等が今回の勤続期間と重なっている分（前年以前4年内に受けたもの。令和8年以後に確定拠出年金の一時金を受けたときは、令和8年以後の分は9年内。その年に確定拠出年金の一時金も受けるときは19年内）と、今回の勤続期間に含めた前の勤務先などの期間の分を、退職所得控除額から引きます（所得税法施行令70条）。区分の違う退職手当等があるときは、短期・特定役員退職手当等の勤続期間と重なる分を、その区分の控除額からも引きます（施行令71条の2 11項・12項。含めた期間は、前の退職手当等の区分が同じときだけ）。"
      >
        {inp.priors.map((p, i) => (
          <div key={i} style={box}>
            <input value={p.payer} onChange={(e) => setPrior(i, { payer: e.target.value })} placeholder="支払者の名前" style={{ ...S.input, width: 160 }} />
            <span>支払を受けた日</span><input type="date" value={p.paidOn} onChange={(e) => setPrior(i, { paidOn: e.target.value })} style={S.input} />
            <span>収入金額</span><NumberInput value={p.amount || null} onChange={(v) => setPrior(i, { amount: v ?? 0 })} width={110} />
            <span>勤続期間等</span>
            <input type="date" value={p.from} onChange={(e) => setPrior(i, { from: e.target.value })} style={S.input} />〜
            <input type="date" value={p.to} onChange={(e) => setPrior(i, { to: e.target.value })} style={S.input} />
            <label><input type="checkbox" checked={p.dc} onChange={(e) => setPrior(i, { dc: e.target.checked })} /> 確定拠出年金の一時金</label>
            <label><input type="checkbox" checked={p.included} onChange={(e) => setPrior(i, { included: e.target.checked })} /> この期間を今回の勤続期間に含めた</label>
            <span>その退職手当等の区分</span>{kindSelect(p.kind, (k) => setPrior(i, { kind: k }))}
            <input value={p.payerAddress} onChange={(e) => setPrior(i, { payerAddress: e.target.value })} placeholder="支払者の所在地（申告書の E 欄）" style={{ ...S.input, width: 200 }} />
            <span>源泉徴収税額</span><NumberInput value={p.incomeTax} onChange={(v) => setPrior(i, { incomeTax: v })} width={100} placeholder="わかれば" />
            <button onClick={() => set({ priors: inp.priors.filter((_, j) => j !== i) })} style={small}>消す</button>
          </div>
        ))}
        <button onClick={() => set({ priors: [...inp.priors, emptyPriorRetirement()] })} style={small}>＋ 足す</button>
      </Row>
      <Row label="住民税の納入先" note={`${fixedYear || ""}年1月1日の住所の市区町村です（初めは、従業員の画面の住民税の市区町村）。`}>
        <LocalGovSelect code={draft.municipality} setCode={(c) => setDraft({ ...draft, municipality: c })} />
      </Row>
      <Row label="源泉徴収票・支払調書に書くこと">
        <input value={inp.address} onChange={(e) => set({ address: e.target.value })} placeholder="住所又は居所（作る日の現況）" style={{ ...S.input, flex: 2, minWidth: 260 }} />
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={inp.abroad} onChange={(e) => set({ abroad: e.target.checked })} /> 住所が国外</label>
        <input value={inp.januaryAddress} onChange={(e) => set({ januaryAddress: e.target.value })} placeholder={`${fixedYear || ""}年1月1日の住所`} style={{ ...S.input, flex: 2, minWidth: 260 }} />
        <input value={inp.position} onChange={(e) => set({ position: e.target.value })} placeholder="役職名（退職時）" style={{ ...S.input, width: 160 }} />
      </Row>
      <Row label="源泉徴収票の④番号" note="確定拠出年金の一時金・譲渡制限付株式などのときだけ選びます（会社が払う退職金だけなら空欄です）。5〜7のときは、摘要に経済的利益の価額を書きます。">
        <select value={inp.slipNumber} onChange={(e) => set({ slipNumber: e.target.value })} style={{ ...S.input, width: "100%", maxWidth: 560 }}>
          <option value="">空欄（どれにも当たらない）</option>
          {TAISHOKU_SLIP_NUMBERS.map((x) => <option key={x.code} value={x.code}>{x.code}：{x.label}</option>)}
        </select>
        {slipNumber?.benefit && (
          <><span style={{ fontSize: 13 }}>経済的利益の価額</span><NumberInput value={inp.economicBenefit} onChange={(v) => set({ economicBenefit: v })} width={130} /> 円</>
        )}
      </Row>
      <Row label="源泉徴収票を作る日に、まだ払っていない額" note="分けて払うなどで、まだ払っていない額があれば、⑤支払金額に内書きします。その分の所得税をまだ引いていなければ、未徴収税額を摘要に書きます。">
        <NumberInput value={inp.unpaid} onChange={(v) => set({ unpaid: v })} width={130} placeholder="なし" /> 円
        {!!inp.unpaid && (
          <><span style={{ fontSize: 13 }}>未徴収税額</span><NumberInput value={inp.unwithheldTax} onChange={(v) => set({ unwithheldTax: v })} width={110} /> 円</>
        )}
      </Row>

      <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f8fafc", borderRadius: 8 }}>
        {result.error ? (
          <div style={S.errorBox}>{result.error}</div>
        ) : (
          <>
            <table style={{ ...S.table, maxWidth: 720 }}>
              <tbody>
                {result.nonResident ? (
                  <tr><td style={S.td}>書類</td><td style={S.td} colSpan={3}>非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（源泉徴収票は作りません）</td></tr>
                ) : (
                  <tr><td style={S.td}>源泉徴収票の区分</td><td style={S.td} colSpan={3}>{RETIREMENT_SECTION_LABELS[result.section]}・{result.mixed ? "区分の違う退職手当等" : RETIREMENT_KIND_LABELS[result.kind]}</td></tr>
                )}
                <tr>
                  <td style={S.td}>勤続年数</td><td style={S.tdNum}>{result.years} 年</td>
                  <td style={S.td}>退職所得控除額{result.nonResident ? "（支払調書に書く）" : ""}</td><td style={S.tdNum}>{yen(result.deduction)}</td>
                </tr>
                {result.nonResident ? (
                  <tr>
                    <td style={S.td}>国内源泉所得 × {(TAISHOKU_NONRESIDENT.rate[0] * 100) / TAISHOKU_NONRESIDENT.rate[1]}％ × 102.1％</td><td style={S.tdNum}>{yen(result.domesticAmount)}</td>
                    <td style={S.td}>所得税（源泉徴収税額）</td><td style={{ ...S.tdNum, fontWeight: "bold" }}>{yen(result.incomeTax)}</td>
                  </tr>
                ) : (
                  <tr>
                    <td style={S.td}>課税退職所得金額（1,000円未満切り捨て）</td><td style={S.tdNum}>{yen(result.taxable)}</td>
                    <td style={S.td}>所得税（源泉徴収税額）</td><td style={{ ...S.tdNum, fontWeight: "bold" }}>{yen(result.incomeTax)}</td>
                  </tr>
                )}
                <tr>
                  <td style={S.td}>市町村民税（6％）</td><td style={S.tdNum}>{yen(result.cityTax)}</td>
                  <td style={S.td}>道府県民税（4％）</td><td style={S.tdNum}>{yen(result.prefTax)}</td>
                </tr>
                <tr style={{ fontWeight: "bold", backgroundColor: "#e0f2fe" }}>
                  <td style={S.td} colSpan={3}>差引支給額（支払金額 − 所得税 − 住民税）</td><td style={S.tdNum}>{yen(result.netPay)}</td>
                </tr>
              </tbody>
            </table>
            {result.overlapReduction > 0 && (
              <div style={{ ...S.small, marginTop: 6 }}>
                前年以前の退職手当等と重なる分として、退職所得控除額から {yen(result.overlapReduction)} を引きました（{result.overlaps.map((r) => `${r.type === "included" ? "含めた期間" : "重なる期間"} ${r.period} → ${r.years}年`).join("、")}）。
              </div>
            )}
            {result.mixed && (() => {
              const adjust = result.mixed.some((r) => r.priorCut > 0 || r.shortfall > 0 || r.absorbed > 0);
              const heads = ["区分", "収入金額", "勤続年数", "重複勤続年数", "控除額", ...(adjust ? ["前年以前と重なる分", "控除額に満たない部分", "ほかの区分の不足を引いた額"] : []), "退職所得"];
              const frac = (v: number) => `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} 円`;
              return (
                <table style={{ ...S.table, maxWidth: adjust ? 1000 : 720, marginTop: 8 }}>
                  <thead><tr>{heads.map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {result.mixed.map((r) => (
                      <tr key={r.kind}>
                        <td style={S.td}>{RETIREMENT_KIND_LABELS[r.kind]}</td>
                        <td style={S.tdNum}>{yen(r.amount)}</td>
                        <td style={S.tdNum}>{r.years} 年</td>
                        <td style={S.tdNum}>{r.overlapYears} 年{r.fullOverlapYears ? `（全重複 ${r.fullOverlapYears} 年）` : ""}</td>
                        <td style={S.tdNum}>{yen(r.deduction)}</td>
                        {adjust && (
                          <>
                            <td style={S.tdNum}>{r.priorCut ? `− ${yen(r.priorCut)}` : ""}</td>
                            <td style={S.tdNum}>{r.shortfall ? frac(r.shortfall) : ""}</td>
                            <td style={S.tdNum}>{r.absorbed ? `− ${frac(r.absorbed)}` : ""}</td>
                          </>
                        )}
                        <td style={S.tdNum}>{frac(r.income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            {result.remarks.length > 0 && <div style={{ ...S.small, marginTop: 6 }}>摘要：{result.remarks.join("／")}</div>}
          </>
        )}
        {result.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 8 }}>{result.notes.map((x, i) => <div key={i}>・{x}</div>)}</div>}
        {draft.payDate && !inp.nonResident && !inp.death && (
          <div style={{ ...S.small, marginTop: 6 }}>
            支払う日 {w(draft.payDate)}：納期の特例を受けていなければ、所得税・住民税とも {w(statutoryDueOf(Number(draft.payDate.slice(0, 4)), Number(draft.payDate.slice(5, 7)), false))}（土日祝日なら次の日）までに納めます。
          </div>
        )}
        {draft.payDate && inp.nonResident && !inp.death && (
          <div style={{ ...S.small, marginTop: 6 }}>
            支払う日 {w(draft.payDate)}：所得税は {w(statutoryDueOf(Number(draft.payDate.slice(0, 4)), Number(draft.payDate.slice(5, 7)), false))}（土日祝日なら次の日。国外で払うときは翌月末日）までに、
            非居住者・外国法人の所得についての所得税徴収高計算書（納付書）で納めます（所得税法212条）。
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
