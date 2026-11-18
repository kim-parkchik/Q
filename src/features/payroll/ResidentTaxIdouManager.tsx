/**
 * 「住民税の異動届出書」の画面：給与支払報告・特別徴収に係る給与所得者異動届出書（作り方は utils/residentTaxIdou.ts）
 * ・退職した人・亡くなった人（従業員の画面の退職日・死亡日）と、ここで加えたほかの異動（休職・転勤など）を出す
 * ・年税額・徴収済額・未徴収税額は、住民税の画面の年度の額と、確定した給与で引いた住民税から計算する
 * ・徴収方法・新しい勤務先などの入れたものは、従業員の resident_tax_idou（JSON）に異動の日ごとに残す
 * ・eLTAX の PCdesk に取り込む CSV を保存できる（直すところがない届出書だけ）。保存すると、届け出た日を残す
 * ・紙で出すときは、届出書に書き写す中身を印刷する（市区町村の様式は、記載要領の項目のとおり）
 * ・マイナンバー：事務取扱担当者が CSV を保存するとき・印刷するときに選べば、本人の番号を書く（記録には人数だけ残す）
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { payDateOf } from "../../utils/koyoBenefits";
import { localGovByCode, localGovLabel } from "../../utils/localGov";
import { SELF_KEY } from "../../utils/myNumber";
import { fiscalYearLabel } from "../../utils/residentTax";
import { formatWareki } from "../../utils/wareki";
import {
  buildIdouCsv, buildIdouRow, codeLabel, idouForms, IDOU_LUMP_REASON_OPTIONS, IDOU_METHOD_OPTIONS, IDOU_ORDINARY_REASON_OPTIONS, IDOU_REASON_OPTIONS,
  IDOU_YEAR_LABELS, parseIdouInputs, resolveIdou, staffCollectionOf, stringifyIdouInputs,
  type IdouCollection, type IdouInput, type IdouNewEmployer, type IdouResolved, type IdouRow, type IdouSalary,
} from "../../utils/residentTaxIdou";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import * as S from "./reportStyles";
import ResidentTaxKirikaePanel from "./ResidentTaxKirikaePanel";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
  onDataChange: () => Promise<void> | void;
}

interface CompanyInfo {
  name: string; address: string; kana: string; corporateNumber: string;
  dept: string; contactName: string; phone: string;
}

/** 1つの異動（1人の1つの異動の日） */
interface Entry {
  key: string;
  staff: any;
  input: IdouInput;
  collection: IdouCollection;
  resolved: IdouResolved;
  rows: IdouRow[];
}

const PRINT_ID = "idou-print";
const KIRIKAE_ID = "resident-tax-kirikae-print";
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ymLabel = (ym: string | null) => (ym ? formatWareki(`${ym}-01`).replace(/1日$/, "") : "");
const muniLabel = (code: string) => localGovLabel(localGovByCode(code)) || code || "（市区町村が入っていません）";
/** 提出先の宛名（「千代田区長」「大阪市長」） */
const addressee = (code: string) => {
  const g = localGovByCode(code);
  return g ? `${g.name}長` : "";
};

export default function ResidentTaxIdouManager({ db, staffList, currentUser, onDataChange }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const unlock = useMyNumberUnlock();
  const [salaries, setSalaries] = useState<Record<string, IdouSalary[]> | null>(null);
  const [designations, setDesignations] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<CompanyInfo>({ name: "", address: "", kana: "", corporateNumber: "", dept: "", contactName: "", phone: "" });
  const [inputs, setInputs] = useState<Record<string, Record<string, IdouInput>>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showReported, setShowReported] = useState(false);
  const [myNumberAccess, setMyNumberAccess] = useState(false);
  const [printNumbers, setPrintNumbers] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState<{ staffId: string; date: string; reason: string } | null>(null);
  /** 特別徴収への切替申請書の内容を出す（印刷はその部分だけ） */
  const [kirikae, setKirikae] = useState(false);

  useEffect(() => {
    const map: Record<string, Record<string, IdouInput>> = {};
    for (const s of staffList) map[String(s.id)] = parseIdouInputs(s.resident_tax_idou);
    setInputs(map);
  }, [staffList]);

  useEffect(() => {
    hasMyNumberAccess(db, currentUser).then(setMyNumberAccess).catch(() => setMyNumberAccess(false));
  }, [db, currentUser]);

  useEffect(() => {
    (async () => {
      try {
        const groups = await db.select<{ id: number; payment_day: number }[]>("SELECT id, payment_day FROM payroll_groups ORDER BY id");
        const rows = await db.select<any[]>(
          `SELECT r.staff_id, r.target_year, r.target_month, r.resident_tax, s.payroll_group_id
           FROM salary_results r JOIN staff s ON s.id = r.staff_id WHERE r.target_year >= ?`,
          [new Date().getFullYear() - 2],
        );
        const map: Record<string, IdouSalary[]> = {};
        for (const r of rows ?? []) {
          const group = groups?.find((g) => g.id === Number(r.payroll_group_id)) ?? groups?.[0] ?? { payment_day: 25 };
          (map[String(r.staff_id)] ??= []).push({
            year: Number(r.target_year), month: Number(r.target_month), residentTax: Number(r.resident_tax) || 0,
            payDate: payDateOf(group, Number(r.target_year), Number(r.target_month)),
          });
        }
        setSalaries(map);
        const m = await db.select<{ code: string; designation_number: string | null }[]>("SELECT code, designation_number FROM resident_tax_municipalities");
        setDesignations(Object.fromEntries((m ?? []).map((x) => [x.code, String(x.designation_number ?? "").trim()])));
        const c = await db.select<any[]>("SELECT name, address, corporate_number, phone FROM company WHERE id = 1");
        const p = await db.select<any[]>("SELECT payer_kana, contact_dept, contact_section, contact_name, contact_phone FROM salary_report_settings WHERE id = 1");
        setCompany({
          name: String(c?.[0]?.name ?? ""), address: String(c?.[0]?.address ?? ""), corporateNumber: String(c?.[0]?.corporate_number ?? ""),
          kana: String(p?.[0]?.payer_kana ?? ""),
          dept: [p?.[0]?.contact_dept, p?.[0]?.contact_section].filter(Boolean).join(" "),
          contactName: String(p?.[0]?.contact_name ?? ""), phone: String(p?.[0]?.contact_phone || c?.[0]?.phone || ""),
        });
      } catch (e) {
        console.error("住民税の異動届出書の読み込みエラー:", e);
        setSalaries({});
      }
    })();
  }, [db]);

  // 異動の一覧：退職日・死亡日がある人（400日前から）と、ここで加えた異動
  const entries: Entry[] = useMemo(() => {
    if (!salaries) return [];
    const from = daysAgo(400);
    const out: Entry[] = [];
    for (const s of staffList) {
      const id = String(s.id);
      const saved = inputs[id] ?? {};
      const dates = new Map<string, IdouInput>();
      const lastDay = s.death_date || s.retirement_date;
      if (lastDay && lastDay >= from) dates.set(lastDay, { ...(saved[lastDay] ?? {}), date: lastDay, reason: saved[lastDay]?.reason ?? (s.death_date ? "4" : "1") });
      for (const [date, inp] of Object.entries(saved)) if (!dates.has(date)) dates.set(date, inp);
      for (const [date, input] of dates) {
        const collection = staffCollectionOf(s, date, salaries[id] ?? []);
        const resolved = resolveIdou(input, collection);
        const forms = idouForms(collection, resolved.nextYearReported, String(s.resident_tax_municipality ?? "").trim());
        if (forms.length === 0 && !saved[date]) continue;
        const person = { staffId: id, name: String(s.name ?? ""), furigana: String(s.furigana ?? ""), birthday: String(s.birthday ?? ""), address: String(s.address ?? "") };
        const rows = forms.map((f) => buildIdouRow(f, person, resolved, designations[f.municipality] ?? "", id));
        out.push({ key: `${id}#${date}`, staff: s, input, collection, resolved, rows });
      }
    }
    return out.sort((a, b) => b.input.date.localeCompare(a.input.date));
  }, [staffList, inputs, salaries, designations]);

  const shown = entries.filter((e) => showReported || !e.input.reportedOn);
  const current = entries.find((e) => e.key === selected) ?? shown[0] ?? null;

  const saveInput = async (staffId: string, date: string, patch: Partial<IdouInput> | null) => {
    const map = { ...(inputs[staffId] ?? {}) };
    if (patch === null) delete map[date];
    else map[date] = { ...(map[date] ?? { date, reason: "1" }), ...patch, date };
    setInputs({ ...inputs, [staffId]: map });
    try {
      await db.execute("UPDATE staff SET resident_tax_idou = ? WHERE id = ?", [stringifyIdouInputs(map), staffId]);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const patchCurrent = (patch: Partial<IdouInput>) => current && saveInput(String(current.staff.id), current.input.date, patch);

  /** eLTAX に取り込む CSV（届け出ていない人の、直すところがない届出書） */
  const exportCsv = async () => {
    const targets = shown.filter((e) => !e.input.reportedOn && e.rows.length > 0 && e.rows.every((r) => r.problems.length === 0));
    const blocked = shown.filter((e) => !e.input.reportedOn && e.rows.some((r) => r.problems.length > 0));
    if (targets.length === 0) {
      dialog.warning("CSV に入れられる届出書がありません。直すところがある人を直してください。", "CSV を作れません");
      return;
    }
    if (blocked.length > 0) {
      const ok = await ask(
        `次の${blocked.length}人は、直すところがあるので CSV に入りません。\n\n${blocked.map((e) => `・${e.staff.name}`).join("\n")}\n\nほかの${targets.length}人で CSV を作りますか？`,
        { title: "CSV に入らない人がいます", kind: "warning" },
      );
      if (!ok) return;
    }
    try {
      let numbers: Record<string, Record<string, string>> | null = null;
      if (myNumberAccess) {
        numbers = await unlock.readNumbers(db, currentUser, targets.map((e) => String(e.staff.id)));
        if (!numbers) return;
      }
      const rows = targets.flatMap((e) => {
        const id = String(e.staff.id);
        const person = { staffId: id, name: String(e.staff.name ?? ""), furigana: String(e.staff.furigana ?? ""), birthday: String(e.staff.birthday ?? ""), address: String(e.staff.address ?? ""), myNumber: numbers?.[id]?.[SELF_KEY] };
        return e.rows.map((r) => buildIdouRow(r.form, person, e.resolved, designations[r.form.municipality] ?? "", id));
      });
      const saved = await saveCsvFile(buildIdouCsv(rows), `給与所得者異動届出書_${todayStr().replace(/-/g, "")}.csv`);
      if (!saved) return;
      const withNumbers = numbers ? targets.filter((e) => numbers![String(e.staff.id)]?.[SELF_KEY]).length : 0;
      if (myNumberAccess) await logMyNumber(db, currentUser, `給与所得者異動届出書の CSV（${rows.length}枚。本人のマイナンバー ${withNumbers}人分）を書き出しました：${saved.name}`);
      for (const e of targets) await saveInput(String(e.staff.id), e.input.date, { reportedOn: todayStr() });
      await onDataChange();
      toast.success(`「${saved.name}」を保存しました（${rows.length}枚）。PCdesk に取り込んで出します`);
      if (!myNumberAccess) await dialog.warning("マイナンバーは書いていません（事務取扱担当者の印がある人が書き出すと書きます）。");
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  /** 書き写す中身を印刷する（事務取扱担当者が選べば、マイナンバーも書く） */
  const print = async (withNumbers: boolean) => {
    if (!current) return;
    if (withNumbers) {
      const id = String(current.staff.id);
      const numbers = await unlock.readNumbers(db, currentUser, [id]);
      if (!numbers) return;
      await logMyNumber(db, currentUser, `給与所得者異動届出書を印刷しました（${current.staff.name}。マイナンバー ${numbers[id]?.[SELF_KEY] ? 1 : 0}人分）`);
      setPrintNumbers(numbers[id] ?? {});
    } else {
      setPrintNumbers(null);
      setTimeout(() => window.print(), 0);
    }
  };
  useEffect(() => {
    if (!printNumbers) return;
    const done = () => { setPrintNumbers(null); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printNumbers]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(kirikae ? KIRIKAE_ID : PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>住民税の異動届出書（給与支払報告・特別徴収に係る給与所得者異動届出書）</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          住民税を特別徴収している人が、退職・休職・死亡などで給与を払わなくなったら、翌月10日までに市区町村に出します（地方税法321条の7）。
          次の年度の給与支払報告書を出したあと（1月〜5月）に退職した人も、出した市区町村に出します。
          年税額・徴収済額・未徴収税額は、住民税の画面の年度の額と、確定した給与で引いた住民税から出します。
          1月1日〜4月30日に退職した人は、残りを最後の給与からまとめて引きます（一括徴収。地方税法321条の5第2項）。
          書き方は、総務省・地方税共同機構「給与支払報告・特別徴収に係る給与所得者異動届出書 記載要領」によります。
          eLTAX で出すときは CSV を保存して PCdesk に取り込み、紙で出すときは中身を印刷して市区町村の様式に書き写します。
        </div>
        <div style={S.controls}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showReported} onChange={(e) => setShowReported(e.target.checked)} />
            届け出た人も出す
          </label>
          <button onClick={() => setAdding({ staffId: String(staffList[0]?.id ?? ""), date: todayStr(), reason: "3" })} style={S.button("#64748b")}>
            ＋ ほかの異動（休職・転勤など）を加える
          </button>
          <button onClick={() => setKirikae(!kirikae)} style={S.button(kirikae ? "#2563eb" : "#64748b")}>
            {kirikae ? "切替申請書を閉じる" : "特別徴収への切替申請書"}
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={exportCsv} style={S.button("#16a085")}>eLTAX 用の CSV を保存</button>
        </div>
        {adding && (
          <div style={{ ...S.controls, backgroundColor: "#f8fafc", padding: 10, borderRadius: 8 }}>
            <label style={S.field}>
              <span style={S.label}>従業員</span>
              <select value={adding.staffId} onChange={(e) => setAdding({ ...adding, staffId: e.target.value })} style={S.input}>
                {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}</option>)}
              </select>
            </label>
            <label style={S.field}>
              <span style={S.label}>異動年月日（給与を払わなくなった日）</span>
              <input type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} style={S.input} />
            </label>
            <label style={S.field}>
              <span style={S.label}>異動の事由</span>
              <select value={adding.reason} onChange={(e) => setAdding({ ...adding, reason: e.target.value })} style={S.input}>
                {IDOU_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}：{o.label}</option>)}
              </select>
            </label>
            <button onClick={async () => {
              if (!adding.staffId || !/^\d{4}-\d{2}-\d{2}$/.test(adding.date)) return;
              await saveInput(adding.staffId, adding.date, { reason: adding.reason });
              setSelected(`${adding.staffId}#${adding.date}`);
              setAdding(null);
            }} style={S.button("#2563eb")}>加える</button>
            <button onClick={() => setAdding(null)} style={S.button("#94a3b8")}>やめる</button>
          </div>
        )}
      </div>
      {kirikae && <div id={KIRIKAE_ID}><ResidentTaxKirikaePanel db={db} staffList={staffList} /></div>}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div className="no-print" style={{ ...S.card, width: 300, flexShrink: 0, padding: 12 }}>
          {salaries === null ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>読み込んでいます…</div>
          ) : shown.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>出す届出書はありません（退職日・死亡日が入っている人で、住民税を特別徴収している人などが出ます）。</div>
          ) : shown.map((e) => {
            const bad = e.rows.some((r) => r.problems.length > 0);
            return (
              <div key={e.key} onClick={() => setSelected(e.key)} style={{
                padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 4,
                border: current?.key === e.key ? "2px solid #2563eb" : "1px solid #e2e8f0", backgroundColor: current?.key === e.key ? "#eff6ff" : "white",
              }}>
                <div style={{ fontWeight: "bold", fontSize: 13 }}>{e.staff.name}</div>
                <div style={S.small}>
                  {e.input.date} {codeLabel(34, e.input.reason)}　{e.rows.map((r) => IDOU_YEAR_LABELS[r.form.yearKind]).join("・") || "出さなくてよい"}
                </div>
                <div style={{ fontSize: 11, color: e.input.reportedOn ? "#16a34a" : bad ? "#b91c1c" : "#2563eb" }}>
                  {e.input.reportedOn ? `届け出た（${e.input.reportedOn}）` : bad ? "直すところがあります" : "出せます"}
                </div>
              </div>
            );
          })}
        </div>

        {current && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Detail key={current.key} entry={current} patch={patchCurrent} onRemove={inputs[String(current.staff.id)]?.[current.input.date] && current.input.date !== (current.staff.death_date || current.staff.retirement_date)
              ? () => { saveInput(String(current.staff.id), current.input.date, null); setSelected(null); } : null}
              onReported={(on) => patchCurrent({ reportedOn: on ? todayStr() : null })}
              onPrint={print} myNumberAccess={myNumberAccess} />
            <div id={PRINT_ID}>
              {current.rows.map((r, i) => (
                <PaperSheet key={i} row={r} entry={current} company={company} designation={designations[r.form.municipality] ?? ""} myNumber={printNumbers?.[SELF_KEY] ?? ""} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 選んだ異動の、入れる・選ぶところと、直すところ */
function Detail({ entry, patch, onRemove, onReported, onPrint, myNumberAccess }: {
  entry: Entry; patch: (p: Partial<IdouInput>) => void; onRemove: (() => void) | null; onReported: (on: boolean) => void;
  onPrint: (withNumbers: boolean) => void; myNumberAccess: boolean;
}) {
  const { input, collection: c, resolved: r } = entry;
  const tokuchoNow = c.annual > 0;
  const emp = r.newEmployer;
  const setEmp = (p: Partial<IdouNewEmployer>) => patch({ newEmployer: { ...emp, ...p } });
  const text = (labelText: string, value: string, on: (v: string) => void, w = 220) => (
    <label style={S.field}>
      <span style={S.label}>{labelText}</span>
      <input defaultValue={value} onBlur={(e) => e.target.value !== value && on(e.target.value)} style={{ ...S.input, width: w }} />
    </label>
  );
  return (
    <div className="no-print" style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{entry.staff.name}（{entry.staff.id}）</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => onPrint(false)} style={S.button("#2563eb")}>🖨 中身を印刷</button>
          {myNumberAccess && <button onClick={() => onPrint(true)} style={S.button("#7c3aed")}>マイナンバーを書いて印刷</button>}
          <button onClick={() => onReported(!input.reportedOn)} style={S.button(input.reportedOn ? "#94a3b8" : "#16a34a")}>
            {input.reportedOn ? "届け出た印を外す" : "届け出た印を付ける"}
          </button>
          {onRemove && <button onClick={onRemove} style={S.button("#dc2626")}>この異動を消す</button>}
        </div>
      </div>

      <div style={{ ...S.controls, marginTop: 10 }}>
        <label style={S.field}>
          <span style={S.label}>異動年月日</span>
          <div style={{ fontSize: 13, padding: "6px 0" }}>{formatWareki(input.date)}（{input.date}）</div>
        </label>
        <label style={S.field}>
          <span style={S.label}>異動の事由</span>
          <select value={input.reason} onChange={(e) => patch({ reason: e.target.value })} style={S.input}>
            {IDOU_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}：{o.label}</option>)}
          </select>
        </label>
        {input.reason === "7" && text("事由・理由（10文字まで）", input.reasonText ?? "", (v) => patch({ reasonText: v }), 160)}
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={r.nextYearReported} onChange={(e) => patch({ nextYearReported: e.target.checked })} />
          次の年度の給与支払報告書を出した（1月末までに出す。2月〜5月の異動は初めから印）
        </label>
      </div>

      <table style={{ ...S.table, maxWidth: 680 }}>
        <tbody>
          <tr><td style={S.td}>年度</td><td style={S.td}>{fiscalYearLabel(c.fiscalYear)}　納付先 {muniLabel(c.municipality)}</td></tr>
          <tr><td style={S.td}>（ア）特別徴収税額（年税額）</td><td style={S.tdNum}>{tokuchoNow ? `${S.yen(c.annual)} 円` : "特別徴収していません"}</td></tr>
          {tokuchoNow && <>
            <tr><td style={S.td}>（イ）徴収済額</td><td style={S.tdNum}>{S.yen(c.collected)} 円　{c.collectedFrom ? `${ymLabel(c.collectedFrom)}〜${ymLabel(c.collectedTo)}` : ""}</td></tr>
            <tr><td style={S.td}>（ウ）未徴収税額（ア）−（イ）</td><td style={S.tdNum}>{S.yen(c.uncollected)} 円　{c.uncollectedFrom ? `${ymLabel(c.uncollectedFrom)}〜${ymLabel(c.uncollectedTo)}` : ""}</td></tr>
            {c.lump > 0 && <tr><td style={S.td}>最後の給与でまとめて引いた額</td><td style={S.tdNum}>{S.yen(c.lump)} 円（{c.lumpPayDate} 支払）</td></tr>}
          </>}
        </tbody>
      </table>

      {(tokuchoNow || r.method === "1") && (
        <div style={{ ...S.controls, marginTop: 10 }}>
          <label style={S.field}>
            <span style={S.label}>異動後の未徴収税額の徴収方法{tokuchoNow ? "" : "（新年度分は、特別徴収を続けるときだけ）"}</span>
            <select value={r.method} onChange={(e) => patch({ method: e.target.value as IdouInput["method"] })} style={S.input}>
              <option value="">選んでいない</option>
              {IDOU_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}：{o.label}</option>)}
            </select>
          </label>
          {r.method === "2" && <>
            <label style={S.field}>
              <span style={S.label}>一括徴収の理由</span>
              <select value={r.lumpReason} onChange={(e) => patch({ lumpReason: e.target.value as IdouInput["lumpReason"] })} style={S.input}>
                <option value="">選んでいない</option>
                {IDOU_LUMP_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}：{o.label}（{o.value === "1" ? "6月〜12月の異動で本人が申し出た" : "1月〜4月の異動"}）</option>)}
              </select>
            </label>
            <label style={S.field}>
              <span style={S.label}>徴収予定月日（最後の給与の支払日）</span>
              <input type="date" value={r.lumpDate} onChange={(e) => patch({ lumpDate: e.target.value })} style={S.input} />
            </label>
            <label style={S.field}>
              <span style={S.label}>徴収予定額（未徴収税額と同じ）</span>
              <input type="number" defaultValue={r.lumpAmount || ""} onBlur={(e) => patch({ lumpAmount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ ...S.input, width: 120 }} />
            </label>
            <label style={S.field}>
              <span style={S.label}>納入月</span>
              <select value={r.lumpPayMonth ?? ""} onChange={(e) => patch({ lumpPayMonth: e.target.value ? Number(e.target.value) : null })} style={S.input}>
                <option value="">選んでいない</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
              </select>
            </label>
          </>}
          {r.method === "3" && (
            <label style={S.field}>
              <span style={S.label}>普通徴収の理由</span>
              <select value={r.ordinaryReason} onChange={(e) => patch({ ordinaryReason: e.target.value as IdouInput["ordinaryReason"] })} style={S.input}>
                <option value="">選んでいない</option>
                {IDOU_ORDINARY_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}：{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {!tokuchoNow && r.method !== "1" && (
        <div style={{ ...S.small, marginTop: 8 }}>
          新年度分だけの届出書です。新しい勤務先で特別徴収を続けるときは、
          <button onClick={() => patch({ method: "1" })} style={{ ...S.button("#64748b"), padding: "2px 8px", fontSize: 11 }}>特別徴収を続ける</button>
          を押して、新しい勤務先を入れます（続けなければ普通徴収になります）。
        </div>
      )}

      {r.method === "1" && (
        <div style={{ backgroundColor: "#f8fafc", borderRadius: 8, padding: 10, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 6 }}>新しい勤務先（特別徴収を続けるとき）</div>
          <div style={S.controls}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={emp.isNew} onChange={(e) => setEmp({ isNew: e.target.checked })} />
              提出先の市区町村から指定番号を指定されたことがない（新規）
            </label>
            {!emp.isNew && text("特別徴収義務者指定番号", emp.designation, (v) => setEmp({ designation: v }), 150)}
            {emp.isNew && (
              <label style={S.field}>
                <span style={S.label}>納入書の要否</span>
                <select value={emp.slip} onChange={(e) => setEmp({ slip: e.target.value as IdouNewEmployer["slip"] })} style={S.input}>
                  <option value="">選んでいない</option>
                  <option value="1">1：必要</option>
                  <option value="2">2：不要</option>
                </select>
              </label>
            )}
            {text("法人番号", emp.corporateNumber, (v) => setEmp({ corporateNumber: v }), 140)}
            {text("郵便番号", emp.zip, (v) => setEmp({ zip: v }), 90)}
            {text("所在地", emp.address, (v) => setEmp({ address: v }), 300)}
            {text("名称", emp.name, (v) => setEmp({ name: v }), 220)}
            {text("名称のフリガナ", emp.kana, (v) => setEmp({ kana: v }), 220)}
            {text("担当者の所属", emp.dept, (v) => setEmp({ dept: v }), 140)}
            {text("担当者の氏名", emp.contactName, (v) => setEmp({ contactName: v }), 140)}
            {text("電話", emp.phone, (v) => setEmp({ phone: v }), 130)}
            {text("内線", emp.ext, (v) => setEmp({ ext: v }), 70)}
            {tokuchoNow && (
              <>
                <label style={S.field}>
                  <span style={S.label}>月割額</span>
                  <input type="number" defaultValue={emp.monthly || ""} onBlur={(e) => setEmp({ monthly: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ ...S.input, width: 100 }} />
                </label>
                <label style={S.field}>
                  <span style={S.label}>納入開始月</span>
                  <select value={emp.startMonth || ""} onChange={(e) => setEmp({ startMonth: Number(e.target.value) || 0 })} style={S.input}>
                    <option value="">選んでいない</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
                  </select>
                </label>
              </>
            )}
            {text("新しい勤務先の受給者番号", emp.staffNumber, (v) => setEmp({ staffNumber: v }), 120)}
          </div>
        </div>
      )}

      {r.defaults.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 10 }}>{r.defaults.notes.map((n, i) => <div key={i}>・{n}</div>)}</div>}
      {entry.rows.length === 0 && <div style={{ ...S.small, marginTop: 10 }}>この異動では、届出書を出さなくてよい（特別徴収をしていなくて、次の年度の給与支払報告書も出していない）です。</div>}
      {entry.rows.map((row, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: "bold" }}>
            {IDOU_YEAR_LABELS[row.form.yearKind]}分の届出書 → {muniLabel(row.form.municipality)}（{fiscalYearLabel(row.form.fiscalYear)}）
          </div>
          {row.problems.length > 0
            ? <div style={{ ...S.errorBox, marginTop: 4 }}>{row.problems.map((p, j) => <div key={j}>・{p}</div>)}</div>
            : <div style={{ fontSize: 12, color: "#16a34a" }}>直すところはありません。</div>}
        </div>
      ))}
    </div>
  );
}

/** 届出書に書き写す中身（記載要領の項目の順） */
function PaperSheet({ row, entry, company, designation, myNumber }: { row: IdouRow; entry: Entry; company: CompanyInfo; designation: string; myNumber: string }) {
  const v = (no: number) => row.values[no - 1] ?? "";
  const r = entry.resolved;
  const c = entry.collection;
  const kind = row.form.yearKind;
  const s = entry.staff;
  const lines: [string, string][] = [
    ["宛名（提出先）", `${addressee(row.form.municipality)}　（${muniLabel(row.form.municipality)}）`],
    ["提出年月日", ""],
    ["年度", `${IDOU_YEAR_LABELS[kind]}分（${fiscalYearLabel(row.form.fiscalYear)}）`],
    ["給与支払者の所在地", company.address],
    ["給与支払者の氏名又は名称", company.name],
    ["フリガナ", company.kana],
    ["個人番号又は法人番号", company.corporateNumber],
    ["特別徴収義務者指定番号", designation],
    ["宛名番号（給与所得者の）", v(4)],
    ["担当者連絡先（所属・氏名・電話・内線）", [company.dept, company.contactName, company.phone].filter(Boolean).join("　")],
    ["給与所得者の氏名", String(s.name ?? "")],
    ["フリガナ", v(5)],
    ["生年月日", formatWareki(String(s.birthday ?? ""))],
    ["個人番号", myNumber],
    ["受給者番号", v(12)],
    ["1月1日現在の住所", ""],
    ["異動後の住所", String(s.address ?? "")],
  ];
  if (kind !== "2") {
    lines.push(
      ["（ア）特別徴収税額（年税額）", `${S.yen(c.annual)} 円`],
      ["（イ）徴収済額", `${S.yen(c.collected)} 円　${c.collectedFrom ? `期間 ${ymLabel(c.collectedFrom)}〜${ymLabel(c.collectedTo)}` : ""}`],
      ["（ウ）未徴収税額（ア）−（イ）", `${S.yen(c.uncollected)} 円　${c.uncollectedFrom ? `期間 ${ymLabel(c.uncollectedFrom)}〜${ymLabel(c.uncollectedTo)}` : ""}`],
    );
  }
  lines.push(
    ["異動年月日", formatWareki(entry.input.date)],
    ["異動の事由", `${entry.input.reason}．${codeLabel(34, entry.input.reason)}${entry.input.reason === "7" ? `（${entry.input.reasonText ?? ""}）` : ""}`],
  );
  if (kind !== "2") lines.push(["異動後の未徴収税額の徴収方法", r.method ? `${r.method}．${codeLabel(36, r.method)}` : ""]);
  if (r.method === "1") {
    const e = r.newEmployer;
    lines.push(
      ["【特別徴収継続】新しい勤務先の指定番号", e.isNew ? "新規" : e.designation],
      ["法人番号", e.corporateNumber], ["所在地", `${e.zip ? `〒${e.zip}　` : ""}${e.address}`], ["氏名又は名称（フリガナ）", `${e.name}（${e.kana}）`],
      ["担当者連絡先", [e.dept, e.contactName, e.phone, e.ext ? `内線 ${e.ext}` : ""].filter(Boolean).join("　")],
    );
    if (kind !== "2") lines.push(["月割額・納入開始月", `${e.monthly ? `${S.yen(e.monthly)} 円` : ""}　${e.startMonth ? `${e.startMonth}月から` : ""}`]);
    lines.push(["受給者番号", e.staffNumber]);
    if (e.isNew) lines.push(["納入書の要否", e.slip === "1" ? "必要" : e.slip === "2" ? "不要" : ""]);
  }
  if (kind !== "2" && r.method === "2") {
    lines.push(
      ["【一括徴収】理由", r.lumpReason ? `${r.lumpReason}．${codeLabel(52, r.lumpReason)}（${r.lumpReason === "1" ? `${v(53) ? `${fiscalYearLabel(row.form.fiscalYear)}` : ""}` : `${Number(v(56)) ? `令和${Number(v(56))}年` : ""}`}）` : ""],
      ["徴収予定月日", formatWareki(r.lumpDate)], ["徴収予定額", r.lumpAmount ? `${S.yen(r.lumpAmount)} 円` : ""], ["納入月", r.lumpPayMonth ? `${r.lumpPayMonth}月` : ""],
    );
  }
  if (kind !== "2" && r.method === "3") {
    lines.push(["【普通徴収】理由", r.ordinaryReason ? `${r.ordinaryReason}．${codeLabel(63, r.ordinaryReason)}${v(65) ? `（令和${Number(v(65))}年）` : v(67) ? `（令和${Number(v(67))}年）` : ""}` : ""]);
  }
  return (
    <div className="page" style={{ ...S.card, marginBottom: 16 } as CSSProperties}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>給与支払報告・特別徴収に係る給与所得者異動届出書（書き写す中身）</h2>
      <div style={{ ...S.small, marginBottom: 8 }}>
        {IDOU_YEAR_LABELS[kind]}分 → {muniLabel(row.form.municipality)}。空の欄（提出年月日・1月1日現在の住所{myNumber ? "" : "・個人番号"}）は手で書きます。
      </div>
      <table style={S.table}>
        <tbody>
          {lines.map(([k, val], i) => (
            <tr key={i}><td style={{ ...S.td, width: 260, backgroundColor: "#f8fafc" }}>{k}</td><td style={S.td}>{val}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
