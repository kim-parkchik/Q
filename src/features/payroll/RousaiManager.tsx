/**
 * 「労災の書類」の画面（作り方は utils/rousaiForms.ts）
 * 従業員と負傷又は発病の日を選ぶと、平均賃金算定内訳（様式第8号 別紙1。確定した給与から計算する平均賃金）と、
 * 休業補償給付支給請求書（様式第8号）・療養補償給付たる療養の給付請求書（様式第5号）の事業主が証明する欄、
 * 労働者死傷病報告に書く内容を出して印刷する。
 * ・別紙1：「その他の休職」が業務外の傷病の療養などのときは、裏面②（休業した期間の日数・賃金）と表面①（その期間を除いた平均賃金）も出す
 * ・別紙2：療養のため労働できなかった期間の勤怠から、全部休業日と部分算定日（一部休業日・有給休暇）を分け、部分算定日の賃金の額を出す
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import type { AverageWageResult } from "../../utils/averageWage";
import { loadAverageWage } from "../../utils/averageWageStore";
import {
  besshi1NonWorkOf, besshi1Of, besshi2Of, payMethodLabel, periodText, senText, shishobyoForm, youshiki5Form, youshiki8Form,
  type AccidentInput, type Besshi1, type Besshi1NonWork,
} from "../../utils/rousaiForms";
import { parseLeavePeriods } from "../../utils/leaveExemption";
import { formatWareki } from "../../utils/wareki";
import { PrintFormSheet } from "./PrintFormSheet";
import * as S from "./reportStyles";

const PRINT_ID = "rousai-print";
type Doc = "besshi1" | "besshi2" | "youshiki8" | "youshiki5" | "shishobyo";
const DOC_LABELS: Record<Doc, string> = {
  besshi1: "平均賃金算定内訳（様式第8号 別紙1）",
  besshi2: "一部休業などの内訳（様式第8号 別紙2）",
  youshiki8: "休業補償給付支給請求書（様式第8号）の事業主の証明",
  youshiki5: "療養補償給付たる療養の給付請求書（様式第5号）の事業主の証明",
  shishobyo: "労働者死傷病報告（休業4日以上・死亡）",
};

export default function RousaiManager({ db, staffList }: { db: Database; staffList: any[] }) {
  const today = dayjs().format("YYYY-MM-DD");
  const [doc, setDoc] = useState<Doc>("besshi1");
  const [staffId, setStaffId] = useState("");
  const [v, setV] = useState({
    date: "", time: "", witness: "", cause: "", leaveFrom: "", leaveTo: "", unpaidDays: "", reportedOn: "", certifiedOn: today,
    industry: "", expected: "", occupation: "", injury: "", part: "", place: "", writer: "", submittedOn: today,
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const [company, setCompany] = useState<any>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [wage, setWage] = useState<AverageWageResult | null>(null);
  const [bonuses, setBonuses] = useState<{ date: string; amount: number }[]>([]);
  /** 別紙1 ②：「その他の休職」を業務外の傷病の療養などとして書く・休業した日に払った賃金（賃金計算期間の番号 → 円） */
  const [nonWork, setNonWork] = useState(false);
  const [nonWorkWages, setNonWorkWages] = useState<Record<number, number>>({});
  /** 別紙2：療養のため労働できなかった期間の勤怠・休業日にも月給を払った・直した賃金の額（日 → 円） */
  const [leaveRows, setLeaveRows] = useState<any[]>([]);
  const [monthlyPaid, setMonthlyPaid] = useState(false);
  const [partialAmounts, setPartialAmounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      try {
        const [c] = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
        setCompany(c ?? {});
        setBranches((await db.select<any[]>("SELECT * FROM branches ORDER BY id")) ?? []);
        setGroups((await db.select<any[]>("SELECT id, closing_day FROM payroll_groups")) ?? []);
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const staff = staffList.find((s) => String(s.id) === staffId);
  useEffect(() => {
    setWage(null);
    setBonuses([]);
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await loadAverageWage(db, staff, v.date);
        // 特別給与（3か月を超える期間ごとに払う賃金＝賞与）：負傷又は発病の日以前1年間に払ったもの（別紙1の裏面③）
        const from = dayjs(v.date).subtract(1, "year").add(1, "day").format("YYYY-MM-DD");
        const rows = await db.select<any[]>(
          `SELECT s.payment_date, b.total_earnings FROM bonus_results b JOIN bonus_settings s ON s.id = b.bonus_setting_id
           WHERE b.staff_id = ? AND s.payment_date BETWEEN ? AND ? ORDER BY s.payment_date`,
          [String(staff.id), from, v.date],
        );
        if (cancelled) return;
        setWage(r);
        setBonuses((rows ?? []).map((x) => ({ date: String(x.payment_date), amount: Number(x.total_earnings) || 0 })));
      } catch (e) {
        console.error("平均賃金の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff, v.date]);

  const branch = branches.find((b) => Number(b.id) === Number(staff?.branch_id ?? 1));
  const place = {
    ...company,
    labor_ins_num: String(branch?.labor_ins_num || company.labor_ins_num || ""),
    address: String(branch?.id !== 1 && branch?.address ? branch.address : company.address ?? ""),
    phone: String(branch?.id !== 1 && branch?.phone ? branch.phone : company.phone ?? ""),
    name: branch && branch.id !== 1 ? `${company.name ?? ""} ${branch.name}` : company.name,
  };
  const besshi = wage ? besshi1Of(wage) : null;
  const otherLeaves = staff ? parseLeavePeriods(staff.leave_periods).filter((l) => l.type === "other") : [];
  const besshiNonWork = besshi && nonWork
    ? besshi1NonWorkOf(besshi, otherLeaves.map((l) => ({ start: l.start, end: l.end })), "業務外の傷病の療養など", (i) => nonWorkWages[i] ?? null)
    : null;
  // 別紙2：療養のため労働できなかった期間の勤怠を読む
  useEffect(() => {
    setLeaveRows([]);
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(v.leaveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(v.leaveTo)) return;
    let cancelled = false;
    db.select<any[]>("SELECT work_date, work_type, work_hours FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ?", [String(staff.id), v.leaveFrom, v.leaveTo])
      .then((rows) => { if (!cancelled) setLeaveRows(rows ?? []); })
      .catch((e) => console.error("勤怠の読み込みエラー:", e));
    return () => { cancelled = true; };
  }, [db, staff, v.leaveFrom, v.leaveTo]);
  const besshi2 = staff ? besshi2Of(v.leaveFrom, v.leaveTo, leaveRows, staff, monthlyPaid) : null;
  const input: AccidentInput | null = staff ? { ...v, staff, company: place } : null;
  const workers = staffList.filter((s) => (s.status || "active") !== "retired" && Number(s.branch_id ?? 1) === Number(staff?.branch_id ?? 1)).length;
  const form = useMemo(() => {
    if (!input) return null;
    if (doc === "youshiki8") return youshiki8Form(input, besshi);
    if (doc === "youshiki5") return youshiki5Form(input);
    if (doc === "shishobyo") return shishobyoForm({ ...input, industry: v.industry, workers, expected: v.expected, occupation: v.occupation, injury: v.injury, part: v.part, place: v.place, writer: v.writer, submittedOn: v.submittedOn });
    return null;
  }, [doc, input, besshi, workers]);
  const closingDay = groups.find((g) => Number(g.id) === Number(staff?.payroll_group_id ?? 1))?.closing_day;

  const text = (key: keyof typeof v, label: string, width = 200, type = "text") => (
    <label style={{ ...S.field, width }}>
      <span style={S.label}>{label}</span>
      <input type={type} value={v[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof v>)} style={S.input} />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>労災の書類（業務災害）</h3>
        <p style={S.note}>
          仕事中のけがや病気で休んだ・治療を受けたときの、労災保険の請求書に事業主が証明する内容と、平均賃金算定内訳（別紙1）、労働者死傷病報告に書く内容を出します。
          平均賃金は、負傷又は発病の日の前の3か月の確定した給与から計算します（平均賃金の画面と同じ計算。手で入れた額があればその額）。
        </p>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>作るもの</span>
            <select value={doc} onChange={(e) => setDoc(e.target.value as Doc)} style={S.input}>
              {(Object.keys(DOC_LABELS) as Doc[]).map((k) => <option key={k} value={k}>{DOC_LABELS[k]}</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>従業員</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={S.input}>
              <option value="">選んでください</option>
              {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}</option>)}
            </select>
          </label>
          {text("date", "負傷又は発病年月日", 170, "date")}
          {text("time", "時刻（14時30分など）", 150)}
          <button onClick={() => window.print()} disabled={!staff} style={S.button("#2563eb", !staff)}>🖨 印刷・PDF保存</button>
        </div>
        {doc === "besshi1" && otherLeaves.length > 0 && (
          <div style={S.controls}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={nonWork} onChange={(e) => setNonWork(e.target.checked)} /> 「その他の休職」（{otherLeaves.map((l) => `${l.start}〜${l.end || ""}`).join("・")}）は業務外の傷病の療養などのため（別紙1の①②を書く）
            </label>
            {nonWork && besshiNonWork && besshiNonWork.rows.map((r, i) => r.days > 0 && (
              <label key={i} style={S.field}>
                <span style={S.label}>{periodText(r.from, r.to)}の休業した日の賃金（給与を払わない休職なら0）</span>
                <input type="number" min={0} value={nonWorkWages[i] ?? 0} onChange={(e) => setNonWorkWages({ ...nonWorkWages, [i]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ ...S.input, width: 140 }} />
              </label>
            ))}
          </div>
        )}
        {doc === "besshi2" && (
          <div style={S.controls}>
            {text("leaveFrom", "療養のため労働できなかった期間（から）", 200, "date")}
            {text("leaveTo", "（まで）", 170, "date")}
            {staff?.wage_type === "monthly" && (
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={monthlyPaid} onChange={(e) => setMonthlyPaid(e.target.checked)} /> 休業した日にも月給を払った（月額 ÷ 30 を部分算定日の賃金にする）</label>
            )}
          </div>
        )}
        {doc !== "besshi1" && doc !== "besshi2" && (
          <>
            <div style={S.controls}>
              {text("witness", "災害発生の事実を確認した者の職名・氏名", 300)}
              {doc === "youshiki8" && text("leaveFrom", "療養のため労働できなかった期間（から）", 200, "date")}
              {doc === "youshiki8" && text("leaveTo", "（まで）", 170, "date")}
              {doc === "youshiki8" && text("unpaidDays", "そのうち賃金を受けなかった日数", 200)}
              {doc === "youshiki8" && text("reportedOn", "死傷病報告を出した日", 170, "date")}
              {doc !== "shishobyo" && text("certifiedOn", "証明日", 170, "date")}
            </div>
            <label style={{ ...S.field, marginBottom: 8 }}>
              <span style={S.label}>災害の原因及び発生状況（①どのような場所で ②どのような作業をしているときに ③どのような物・環境に ④どのような不安全・有害な状態があって ⑤どのような災害が発生したか）</span>
              <textarea value={v.cause} onChange={(e) => set({ cause: e.target.value })} rows={3} style={{ ...S.input, fontFamily: "inherit" }} />
            </label>
            {doc === "shishobyo" && (
              <div style={S.controls}>
                {text("industry", "事業の種類（日本標準産業分類の4桁と名前）", 300)}
                {text("occupation", "職種（日本標準職業分類の3桁と名前）", 280)}
                {text("expected", "休業見込期間（2週・1か月など）または死亡日時", 280)}
                {text("injury", "傷病名", 180)}
                {text("part", "傷病部位", 160)}
                {text("place", "被災地の所在地", 280)}
                {text("writer", "報告書作成者の職氏名", 220)}
                {text("submittedOn", "提出日", 170, "date")}
              </div>
            )}
          </>
        )}
        {wage?.error && <div style={S.warnBox}>平均賃金：{wage.error}</div>}
        {wage?.manual && <div style={S.note}>平均賃金は、平均賃金の画面で手で入れた額（{senText(wage.manual.amountSen)}）です。下の内訳は確定した給与から計算したものです。</div>}
      </div>
      <div id={PRINT_ID} style={S.card}>
        {!staff ? <div style={S.small}>従業員を選んでください。</div>
          : doc === "besshi1" ? (besshi ? <Besshi1Sheet b={besshi} staff={staff} eventDate={v.date} laborNum={place.labor_ins_num} closingDay={closingDay} bonuses={bonuses} nonWork={besshiNonWork} />
            : <div style={S.small}>負傷又は発病年月日を入れてください。</div>)
          : doc === "besshi2" ? (besshi2 && besshi2.days.length > 0
            ? <Besshi2Sheet staff={staff} eventDate={v.date} laborNum={place.labor_ins_num} from={v.leaveFrom} to={v.leaveTo} b2={besshi2} amounts={partialAmounts} setAmounts={setPartialAmounts} />
            : <div style={S.small}>療養のため労働できなかった期間を入れてください。</div>)
          : form ? <PrintFormSheet form={form} office={[]} /> : null}
      </div>
    </div>
  );
}

function Besshi1Sheet({ b, staff, eventDate, laborNum, closingDay, bonuses, nonWork }: {
  b: Besshi1; staff: any; eventDate: string; laborNum: string; closingDay: number | undefined; bonuses: { date: string; amount: number }[];
  nonWork: Besshi1NonWork | null;
}) {
  const cell: CSSProperties = { border: "1px solid #333", padding: "3px 5px", fontSize: "9pt", textAlign: "right", whiteSpace: "nowrap" };
  const head: CSSProperties = { ...cell, textAlign: "center", backgroundColor: "#f1f5f9", fontWeight: "bold", whiteSpace: "normal" };
  const lab: CSSProperties = { ...cell, textAlign: "left", backgroundColor: "#f8fafc" };
  const y = (n: number) => `${n.toLocaleString()}円`;
  const table = (title: string, rows: typeof b.a, withWorked: boolean, totalMark: string, workedMark: string) => (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
      <thead>
        <tr><th style={{ ...head, width: "26%" }}>{title}</th>{rows.map((r, i) => <th key={i} style={head}>{periodText(r.from, r.to)}</th>)}<th style={head}>計</th></tr>
      </thead>
      <tbody>
        <tr><td style={lab}>総日数</td>{rows.map((r, i) => <td key={i} style={cell}>{r.days}日</td>)}<td style={cell}>(イ) {b.i}日</td></tr>
        {withWorked && <tr><td style={lab}>労働日数</td>{rows.map((r, i) => <td key={i} style={cell}>{r.workedDays}日</td>)}<td style={cell}>{workedMark} {b.ha}日</td></tr>}
        <tr><td style={lab}>基本賃金</td>{rows.map((r, i) => <td key={i} style={cell}>{y(r.base)}</td>)}<td style={cell}>{y(rows.reduce((s, r) => s + r.base, 0))}</td></tr>
        <tr><td style={lab}>手当（その他の賃金）</td>{rows.map((r, i) => <td key={i} style={cell}>{y(r.allowance)}</td>)}<td style={cell}>{y(rows.reduce((s, r) => s + r.allowance, 0))}</td></tr>
        <tr><td style={lab}>計</td>{rows.map((r, i) => <td key={i} style={cell}>{y(r.total)}</td>)}<td style={cell}>{totalMark} {y(rows.reduce((s, r) => s + r.total, 0))}</td></tr>
      </tbody>
    </table>
  );
  return (
    <div style={{ fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif" }}>
      <div style={{ fontSize: "9pt" }}>様式第８号（別紙１）（表面）</div>
      <h2 style={{ textAlign: "center", fontSize: "14pt", margin: "2px 0 6px" }}>平均賃金算定内訳（労働基準法第12条参照のこと。）</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={lab}>労働保険番号</td><td style={{ ...cell, textAlign: "left" }}>{laborNum}</td><td style={lab}>氏名</td><td style={{ ...cell, textAlign: "left" }}>{staff.name}</td><td style={lab}>災害発生年月日</td><td style={{ ...cell, textAlign: "left" }}>{formatWareki(eventDate)}</td></tr>
          <tr><td style={lab}>雇入年月日</td><td style={{ ...cell, textAlign: "left" }}>{formatWareki(staff.join_date)}</td><td style={lab}>常用・日雇の別</td><td style={{ ...cell, textAlign: "left" }}>常用</td><td style={lab}>賃金支給方法・賃金締切日</td><td style={{ ...cell, textAlign: "left" }}>{payMethodLabel(staff.wage_type)}・毎月 {Number(closingDay) === 99 ? "末" : closingDay}日</td></tr>
        </tbody>
      </table>
      {table("Ａ 月・週その他一定の期間によって支払ったもの（賃金計算期間）", b.a, false, "(ロ)", "")}
      {table("Ｂ 日若しくは時間又は出来高払制その他の請負制によって支払ったもの（賃金計算期間）", b.b, true, "(ニ)", "(ハ)")}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
        <tbody>
          <tr><td style={{ ...lab, width: "26%" }}>総計</td><td style={cell}>(ホ) {y(b.ho)}</td></tr>
          <tr><td style={lab}>平均賃金</td><td style={cell}>賃金総額(ホ) {y(b.ho)} ÷ 総日数(イ) {b.i}日 ＝ {senText(b.principleSen)}</td></tr>
          {b.hasB && (
            <tr><td style={lab}>最低保障平均賃金の計算方法</td><td style={{ ...cell, whiteSpace: "normal" }}>
              Ａの(ロ) {y(b.ro)} ÷ 総日数(イ) {b.i}日 ＝ {senText(b.heSen)}(ヘ)　／　Ｂの(ニ) {y(b.ni)} ÷ 労働日数(ハ) {b.ha}日 × 60/100 ＝ {senText(b.toSen)}(ト)　／　(ヘ)＋(ト) ＝ {senText(b.minimumSen)}（最低保障平均賃金）
            </td></tr>
          )}
          <tr><td style={lab}>使う平均賃金</td><td style={{ ...cell, fontWeight: "bold" }}>{senText(b.amountSen)}</td></tr>
          {nonWork && (
            <tr><td style={lab}>① 業務外の傷病の療養等のため休業した期間の日数・賃金を除いた平均賃金</td><td style={{ ...cell, whiteSpace: "normal" }}>
              （賃金の総額(ホ) {y(b.ho)} − (リ) {y(nonWork.ri)}）÷（総日数(イ) {b.i}日 − (チ) {nonWork.chi}日）＝ {senText(nonWork.sen)}
            </td></tr>
          )}
        </tbody>
      </table>
      {nonWork && (<>
        <div style={{ fontSize: "9pt", margin: "10px 0 2px" }}>様式第８号（別紙１）（裏面）② 業務外の傷病の療養等のため休業した期間及びその期間中の賃金の内訳（休業の事由：{nonWork.reason}）</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...head, width: "26%" }}>賃金計算期間</th>{nonWork.rows.map((r, i) => <th key={i} style={head}>{periodText(r.from, r.to)}</th>)}<th style={head}>計</th></tr></thead>
          <tbody>
            <tr><td style={lab}>休業した期間の日数</td>{nonWork.rows.map((r, i) => <td key={i} style={cell}>{r.days}日</td>)}<td style={cell}>(チ) {nonWork.chi}日</td></tr>
            <tr><td style={lab}>休業した期間中の賃金</td>{nonWork.rows.map((r, i) => <td key={i} style={cell}>{y(r.wages)}</td>)}<td style={cell}>(リ) {y(nonWork.ri)}</td></tr>
          </tbody>
        </table>
      </>)}
      <div style={{ fontSize: "9pt", margin: "10px 0 2px" }}>様式第８号（別紙１）（裏面）③ 特別給与の額（負傷又は発病の日以前1年間に支払われた、3か月を超える期間ごとに支払われる賃金）</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {bonuses.length === 0 ? <tr><td style={{ ...cell, textAlign: "left" }}>なし</td></tr> : bonuses.map((x) => (
            <tr key={x.date}><td style={{ ...lab, width: "26%" }}>{formatWareki(x.date)}</td><td style={cell}>{y(x.amount)}</td></tr>
          ))}
          {bonuses.length > 0 && <tr><td style={lab}>合計</td><td style={cell}>{y(bonuses.reduce((s, x) => s + x.amount, 0))}</td></tr>}
        </tbody>
      </table>
      <p className="no-print" style={{ ...S.small, marginTop: 6 }}>
        日日雇い入れられる人・漁業・林業の人の欄は、ここでは出しません（届書に書き足します）。業務外の傷病の療養などで休業した期間があるときは、上で印を付けると①・②を出します。
      </p>
    </div>
  );
}

function Besshi2Sheet({ staff, eventDate, laborNum, from, to, b2, amounts, setAmounts }: {
  staff: any; eventDate: string; laborNum: string; from: string; to: string;
  b2: { days: { date: string; kind: "whole" | "partial" | "worked"; amount: number; note: string }[]; whole: number; partial: number; worked: number };
  amounts: Record<string, number>; setAmounts: (v: Record<string, number>) => void;
}) {
  const cell: CSSProperties = { border: "1px solid #333", padding: "3px 5px", fontSize: "9pt" };
  const lab: CSSProperties = { ...cell, backgroundColor: "#f8fafc", width: "30%" };
  const partial = b2.days.filter((d) => d.kind === "partial");
  return (
    <div style={{ fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif" }}>
      <div style={{ fontSize: "9pt" }}>様式第８号（別紙２）</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <tbody>
          <tr><td style={lab}>労働保険番号</td><td style={cell}>{laborNum}</td><td style={lab}>氏名</td><td style={cell}>{staff.name}</td></tr>
          <tr><td style={lab}>災害発生年月日</td><td style={cell} colSpan={3}>{formatWareki(eventDate)}</td></tr>
          <tr><td style={lab}>① 療養のため労働できなかった期間</td><td style={cell} colSpan={3}>{formatWareki(from)}から{formatWareki(to)}まで {b2.days.length}日間</td></tr>
          <tr><td style={lab}>② ①のうち賃金を受けなかった日の日数</td><td style={cell} colSpan={3}>{b2.whole + b2.partial}日</td></tr>
          <tr><td style={lab}>③ ②の日数の内訳</td><td style={cell} colSpan={3}>全部休業日 {b2.whole}日・部分算定日 {b2.partial}日</td></tr>
        </tbody>
      </table>
      <div style={{ fontSize: "9pt", margin: "8px 0 2px" }}>④ 部分算定日の年月日及び当該労働者に対し支払われる賃金の額</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={cell}>年月日</th><th style={cell}>賃金の額</th><th style={cell}>備考</th></tr></thead>
        <tbody>
          {partial.length === 0 ? <tr><td style={cell} colSpan={3}>なし</td></tr> : partial.map((d) => (
            <tr key={d.date}>
              <td style={cell}>{formatWareki(d.date)}</td>
              <td style={{ ...cell, textAlign: "right" }}>
                <span className="print-only">{(amounts[d.date] ?? d.amount).toLocaleString()}円</span>
                <input className="no-print" type="number" min={0} value={amounts[d.date] ?? d.amount}
                  onChange={(e) => setAmounts({ ...amounts, [d.date]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ ...S.input, width: 110, textAlign: "right" }} />
              </td>
              <td style={cell}>{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b2.worked > 0 && <p className="no-print" style={{ ...S.warnBox, marginTop: 6 }}>この期間に、所定労働時間を働いた日が {b2.worked}日あります（休業していないので②③に入れていません。療養のため労働できなかった期間を確かめてください）。</p>}
      <p className="no-print" style={{ ...S.small, marginTop: 6 }}>
        勤怠から、所定労働時間の一部だけ働いた日と有給休暇の日を部分算定日にしました。賃金の額の初めの値は、時給は働いた時間 × 時給、
        日給は日給、月給は月額 ÷ 30 です。実際に払った額に直してください。
      </p>
    </div>
  );
}
