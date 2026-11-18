/**
 * 「36協定」の画面（作り方は utils/kyotei36.ts）
 * ・協定届：事業場（拠点）ごとに協定の中身を入れて残し（company.kyotei36）、様式第9号（特別条項があれば様式第9号の2）に書く内容を印刷する
 * ・上限の確認：確定した給与の時間外労働・休日労働の時間で、法律（100時間未満・2〜6か月平均80時間以内）と協定の時間を超えていないかを見る
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { KYOTEI36_LIMITS } from "../../constants/roumu";
import { ROUSAI_RATE_PERIODS } from "../../constants/insurance/rousaiRates";
import {
  check36, emptyHolidayRow, emptyKyotei36, emptyOvertimeRow, emptySpecialRow, kyotei36Problems, limitsOf, parseKyotei36Settings,
  stringifyKyotei36Settings, warningsOf, type HolidayRow, type Kyotei36, type Kyotei36Settings, type MonthHours, type OvertimeRow, type SpecialRow,
} from "../../utils/kyotei36";
import { parseLedger } from "../../utils/legalBooks";
import { formatWareki } from "../../utils/wareki";
import * as S from "../payroll/reportStyles";

const PRINT_ID = "kyotei36-print";

interface Props {
  db: Database;
  staffList: any[];
}

const w = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatWareki(d) : d);
const ageOn = (birthday: string, on: string) => {
  if (!birthday) return null;
  const b = dayjs(birthday);
  const d = dayjs(on);
  let a = d.year() - b.year();
  if (d.month() < b.month() || (d.month() === b.month() && d.date() < b.date())) a -= 1;
  return a;
};

export default function Kyotei36Manager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [tab, setTab] = useState<"form" | "check">("form");
  const [branches, setBranches] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [settings, setSettings] = useState<Kyotei36Settings>({});
  const [placeId, setPlaceId] = useState("1");
  const [draft, setDraft] = useState<Kyotei36>(emptyKyotei36());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const b = await db.select<any[]>("SELECT id, name, address, phone, labor_ins_num, rousai_business FROM branches ORDER BY id");
        const c = await db.select<any[]>("SELECT name, address, phone, corporate_number, labor_ins_num, representative, rousai_business, kyotei36 FROM company WHERE id = 1");
        setBranches(b ?? []);
        setCompany(c?.[0] ?? {});
        setSettings(parseKyotei36Settings(c?.[0]?.kyotei36));
        if ((b ?? []).length > 0) setPlaceId(String(b[0].id));
      } catch (e) {
        console.error("36協定の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const place = branches.find((b) => String(b.id) === placeId) ?? null;
  const placeStaff = useMemo(
    () => staffList.filter((s) => String(s.branch_id ?? 1) === placeId && (s.status || "active") !== "retired"),
    [staffList, placeId],
  );

  // 事業場を選んだら、残してある協定（なければ初めの値）を出す
  useEffect(() => {
    if (!company) return;
    const saved = settings[placeId];
    if (saved) { setDraft(saved); setDirty(false); return; }
    const k = emptyKyotei36();
    const code = String(place?.rousai_business || company.rousai_business || "");
    const rows = ROUSAI_RATE_PERIODS[ROUSAI_RATE_PERIODS.length - 1]?.rows ?? [];
    k.businessType = rows.find((r) => r.codes.includes(code))?.name ?? "";
    const today = dayjs().format("YYYY-MM-DD");
    const adults = placeStaff.filter((s) => (ageOn(String(s.birthday ?? ""), today) ?? 18) >= 18).length;
    k.overtime = [{ ...emptyOvertimeRow(), workers: adults > 0 ? String(adults) : "", month: String(KYOTEI36_LIMITS.monthly), year: String(KYOTEI36_LIMITS.annual) }];
    k.holiday = [{ ...emptyHolidayRow(), workers: adults > 0 ? String(adults) : "" }];
    // 「代表取締役 見本 太郎」は職名と氏名に分ける（初めの言葉が職名らしいときだけ）
    const rep = String(company.representative ?? "").trim().split(/[ 　]+/).filter(Boolean);
    if (rep.length >= 2 && /(代表|取締役|社長|会長|理事|理事長|所長|店長|院長|役員|事業主)$/.test(rep[0])) {
      k.employerTitle = rep[0];
      k.employerName = rep.slice(1).join(" ");
    } else k.employerName = rep.join(" ");
    setDraft(k);
    setDirty(false);
  }, [placeId, company, settings]);

  const save = async () => {
    const next = { ...settings, [placeId]: draft };
    try {
      await db.execute("UPDATE company SET kyotei36 = ? WHERE id = 1", [stringifyKyotei36Settings(next)]);
      setSettings(next);
      setDirty(false);
      toast.success("36協定を保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const set = (patch: Partial<Kyotei36>) => { setDraft({ ...draft, ...patch }); setDirty(true); };
  const problems = kyotei36Problems(draft);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <style>{S.printStyle(PRINT_ID, true)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>36協定（時間外労働・休日労働に関する協定届）</h3>
        <p style={S.note}>
          法定労働時間（1日8時間・1週40時間）を超えて働かせたり、法定休日に働かせたりするには、事業場ごとに労使で36協定を結び、労働基準監督署に届け出ます（労働基準法36条）。
          時間外労働は1か月{KYOTEI36_LIMITS.monthly}時間・1年{KYOTEI36_LIMITS.annual}時間まで（限度時間）。臨時に超えるときは特別条項（様式第9号の2）で、1か月は休日労働と合わせて{KYOTEI36_LIMITS.specialMonthlyBelow}時間未満、
          1年は{KYOTEI36_LIMITS.specialAnnual}時間以内、超えられるのは1年に{KYOTEI36_LIMITS.specialMonthsMax}か月までです。実際の時間外労働と休日労働の合計は、どの月も{KYOTEI36_LIMITS.actualMonthlyBelow}時間未満、
          2〜6か月の平均は{KYOTEI36_LIMITS.averageMax}時間以内にしなければなりません（守らないと罰則があります）。
        </p>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>事業場（拠点）</span>
            <select value={placeId} onChange={(e) => {
              if (dirty && !window.confirm("保存していない変更があります。ほかの事業場に移りますか？")) return;
              setPlaceId(e.target.value);
            }} style={S.input}>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}{settings[String(b.id)] ? "（協定あり）" : ""}</option>)}
            </select>
          </label>
          <button onClick={() => setTab("form")} style={S.tabButton(tab === "form")}>協定届の内容</button>
          <button onClick={() => setTab("check")} style={S.tabButton(tab === "check")}>上限の確認</button>
        </div>
      </div>
      {tab === "form" ? (
        <>
          <div className="no-print" style={S.card}>
            <Editor k={draft} set={set} />
            {problems.length > 0 && <div style={{ ...S.warnBox, marginTop: 10 }}>{problems.map((p, i) => <div key={i}>・{p}</div>)}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={save} disabled={!dirty} style={S.button("#16a085", !dirty)}>保存する</button>
              <button onClick={() => window.print()} style={S.button("#2563eb")}>🖨 届の内容を印刷（{draft.special ? "様式第9号の2" : "様式第9号"}）</button>
            </div>
            <p style={{ ...S.small, marginTop: 6 }}>
              印刷するのは、届書に書く内容です。届け出るときは、厚生労働省の様式（Word）か e-Gov の電子申請で出します。様式のチェックボックス（100時間未満・80時間以内を守ること、
              労働組合・過半数代表者の要件）は、内容を確かめてチェックします（チェックがないと有効な協定・届になりません）。
            </p>
          </div>
          <FormSheet k={draft} company={company ?? {}} place={place} />
        </>
      ) : (
        <CheckPanel db={db} staff={placeStaff} k={settings[placeId] ?? null} />
      )}
    </div>
  );
}

// ── 入れる画面 ─────────────────────────────────────────────

const cellInput: CSSProperties = { ...S.input, width: "100%", boxSizing: "border-box", padding: "4px 6px", fontSize: 12 };

function Line({ label, value, onChange, type = "text", width = 260 }: { label: string; value: string; onChange: (v: string) => void; type?: string; width?: number }) {
  return (
    <label style={{ ...S.field, width }}>
      <span style={S.label}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={S.input} />
    </label>
  );
}

function RowsTable<T extends Record<string, any>>({ title, rows, columns, onChange, empty }: {
  title: string; rows: T[]; columns: { key: keyof T & string; label: string; width?: number; check?: boolean }[]; onChange: (rows: T[]) => void; empty: () => T;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4 }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead><tr>{columns.map((c) => <th key={c.key} style={{ ...S.th, whiteSpace: "normal", width: c.width }}>{c.label}</th>)}<th style={S.th} /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={S.td}>
                    {c.check
                      ? <input type="checkbox" checked={r[c.key] === true} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.checked } : x)))} />
                      : <input value={String(r[c.key] ?? "")} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))} style={cellInput} />}
                  </td>
                ))}
                <td style={S.td}><button onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [empty()])} style={{ ...S.button("#94a3b8"), padding: "2px 8px", fontSize: 11 }}>消す</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => onChange([...rows, empty()])} style={{ ...S.button("#64748b"), padding: "4px 10px", fontSize: 12, marginTop: 4 }}>＋ 行を足す</button>
    </div>
  );
}

function Editor({ k, set }: { k: Kyotei36; set: (p: Partial<Kyotei36>) => void }) {
  return (
    <div>
      <div style={S.controls}>
        <Line label="事業の種類" value={k.businessType} onChange={(v) => set({ businessType: v })} width={300} />
        <Line label="協定の有効期間（から）" type="date" value={k.periodFrom} onChange={(v) => set({ periodFrom: v })} width={160} />
        <Line label="（まで）" type="date" value={k.periodTo} onChange={(v) => set({ periodTo: v })} width={160} />
        <Line label="起算日" type="date" value={k.startDate} onChange={(v) => set({ startDate: v })} width={160} />
      </div>
      <RowsTable<OvertimeRow> title="時間外労働（延長することができる時間数は、法定労働時間を超える時間数）" rows={k.overtime} empty={emptyOvertimeRow} onChange={(rows) => set({ overtime: rows })}
        columns={[
          { key: "reason", label: "必要のある具体的事由", width: 200 }, { key: "work", label: "業務の種類", width: 120 }, { key: "workers", label: "労働者数（18歳以上）", width: 70 },
          { key: "prescribed", label: "所定労働時間（1日・任意）", width: 70 }, { key: "day", label: "1日", width: 60 }, { key: "month", label: `1箇月（${KYOTEI36_LIMITS.monthly}時間まで）`, width: 70 },
          { key: "year", label: `1年（${KYOTEI36_LIMITS.annual}時間まで）`, width: 70 }, { key: "variable", label: "②1年単位の変形労働時間制", width: 70, check: true },
        ]} />
      <RowsTable<HolidayRow> title="休日労働" rows={k.holiday} empty={emptyHolidayRow} onChange={(rows) => set({ holiday: rows })}
        columns={[
          { key: "reason", label: "必要のある具体的事由", width: 200 }, { key: "work", label: "業務の種類", width: 120 }, { key: "workers", label: "労働者数（18歳以上）", width: 70 },
          { key: "holidays", label: "所定休日（任意）", width: 120 }, { key: "days", label: "労働させることができる法定休日の日数", width: 120 }, { key: "hours", label: "始業及び終業の時刻", width: 120 },
        ]} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 13 }}>
        <input type="checkbox" checked={k.special} onChange={(e) => set({ special: e.target.checked })} />
        特別条項を付ける（臨時的に限度時間を超えて労働させる。様式第9号の2）
      </label>
      {k.special && (
        <div style={{ borderLeft: "3px solid #f59e0b", paddingLeft: 10, marginTop: 6 }}>
          <label style={{ ...S.field }}>
            <span style={S.label}>臨時的に限度時間を超えて労働させることができる場合（できる限り具体的に）</span>
            <textarea value={k.specialCases} onChange={(e) => set({ specialCases: e.target.value })} rows={2} style={{ ...S.input, fontFamily: "inherit" }} />
          </label>
          <RowsTable<SpecialRow> title="特別条項の時間" rows={k.specialRows} empty={emptySpecialRow} onChange={(rows) => set({ specialRows: rows })}
            columns={[
              { key: "work", label: "業務の種類", width: 120 }, { key: "workers", label: "労働者数", width: 60 }, { key: "day", label: "1日（任意）", width: 60 },
              { key: "times", label: `回数（${KYOTEI36_LIMITS.specialMonthsMax}回以内）`, width: 60 }, { key: "month", label: `1箇月 時間外＋休日（${KYOTEI36_LIMITS.specialMonthlyBelow}時間未満）`, width: 90 },
              { key: "monthRate", label: "割増賃金率（%）", width: 60 }, { key: "year", label: `1年 時間外（${KYOTEI36_LIMITS.specialAnnual}時間以内）`, width: 80 }, { key: "yearRate", label: "割増賃金率（%）", width: 60 },
            ]} />
          <div style={{ ...S.controls, marginTop: 8 }}>
            <Line label="限度時間を超えて労働させる場合における手続" value={k.procedure} onChange={(v) => set({ procedure: v })} width={360} />
            <Line label="健康・福祉を確保する措置（該当する番号）" value={k.measureNumbers} onChange={(v) => set({ measureNumbers: v })} width={200} />
            <Line label="（具体的内容）" value={k.measureDetail} onChange={(v) => set({ measureDetail: v })} width={420} />
          </div>
          <div style={S.small}>措置の番号：①医師による面接指導 ②深夜労働の回数の制限 ③勤務間インターバル ④代償休日・特別な休暇 ⑤健康診断 ⑥年次有給休暇の連続取得の促進 ⑦相談窓口 ⑧配置転換 ⑨産業医等の助言・保健指導 ⑩その他</div>
        </div>
      )}
      <div style={{ ...S.controls, marginTop: 12 }}>
        <Line label="協定の成立年月日" type="date" value={k.agreedOn} onChange={(v) => set({ agreedOn: v })} width={160} />
        <Line label="労働組合の名称（過半数労働組合があるとき）" value={k.partyUnion} onChange={(v) => set({ partyUnion: v })} width={280} />
        <Line label="過半数代表者の職名" value={k.partyTitle} onChange={(v) => set({ partyTitle: v })} width={160} />
        <Line label="過半数代表者の氏名" value={k.partyName} onChange={(v) => set({ partyName: v })} width={160} />
        <Line label="選出方法" value={k.selectionMethod} onChange={(v) => set({ selectionMethod: v })} width={220} />
      </div>
      <div style={S.controls}>
        <Line label="届け出る日" type="date" value={k.submittedOn} onChange={(v) => set({ submittedOn: v })} width={160} />
        <Line label="使用者 職名" value={k.employerTitle} onChange={(v) => set({ employerTitle: v })} width={180} />
        <Line label="使用者 氏名" value={k.employerName} onChange={(v) => set({ employerName: v })} width={180} />
        <Line label="労働基準監督署" value={k.office} onChange={(v) => set({ office: v })} width={180} />
      </div>
    </div>
  );
}

// ── 印刷 ──────────────────────────────────────────────────

function FormSheet({ k, company, place }: { k: Kyotei36; company: any; place: any }) {
  const cell: CSSProperties = { border: "1px solid #333", padding: "3px 5px", fontSize: "8.5pt", verticalAlign: "top" };
  const head: CSSProperties = { ...cell, backgroundColor: "#f1f5f9", fontWeight: "bold", textAlign: "center" };
  const placeName = place?.name ? `${company.name ?? ""}　${place.name}` : String(company.name ?? "");
  const address = String(place?.address || company.address || "");
  const phone = String(place?.phone || company.phone || "");
  const laborNum = String(place?.labor_ins_num || company.labor_ins_num || "");
  const filled = <T,>(rows: T[], keys: (keyof T)[]) => rows.filter((r) => keys.some((x) => String(r[x] ?? "").trim() !== ""));
  const party = k.partyUnion ? `労働組合の名称　${k.partyUnion}` : `職名　${k.partyTitle}　氏名　${k.partyName}`;
  const footer = (
    <>
      <div style={{ fontSize: "8.5pt", marginTop: 6, lineHeight: 1.7 }}>
        <div>☑ 上記で定める時間数にかかわらず、時間外労働及び休日労働を合算した時間数は、1箇月について100時間未満でなければならず、かつ2箇月から6箇月までを平均して80時間を超過しないこと。</div>
        <div>協定の成立年月日　{w(k.agreedOn)}</div>
        <div>協定の当事者である労働組合（事業場の労働者の過半数で組織する労働組合）の名称又は労働者の過半数を代表する者の　{party}</div>
        {!k.partyUnion && <div>協定の当事者（労働者の過半数を代表する者の場合）の選出方法（{k.selectionMethod}）</div>}
        <div>☐ 上記協定の当事者である労働組合が事業場の全ての労働者の過半数で組織する労働組合である又は上記協定の当事者である労働者の過半数を代表する者が事業場の全ての労働者の過半数を代表する者であること。（確かめてチェック）</div>
        {!k.partyUnion && <div>☐ 上記労働者の過半数を代表する者が、労働基準法第41条第2号に規定する監督又は管理の地位にある者でなく、かつ、同法に規定する協定等をする者を選出することを明らかにして実施される投票、挙手等の方法による手続により選出された者であつて使用者の意向に基づき選出されたものでないこと。（確かめてチェック）</div>}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span>{w(k.submittedOn)}　{k.office}労働基準監督署長殿</span>
          <span>使用者　職名　{k.employerTitle}　氏名　{k.employerName}</span>
        </div>
      </div>
    </>
  );
  return (
    <div id={PRINT_ID} style={{ ...S.card, fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif" }}>
      <div className="page">
        <div style={{ fontSize: "8.5pt" }}>{k.special ? "様式第９号の２（第16条第１項関係）" : "様式第９号（第16条第１項関係）"}</div>
        <h2 style={{ textAlign: "center", fontSize: "13pt", margin: "2px 0 6px" }}>時間外労働・休日労働に関する協定届</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={head}>労働保険番号</td><td style={cell}>{laborNum}</td>
              <td style={head}>法人番号</td><td style={cell}>{String(company.corporate_number ?? "")}</td>
            </tr>
            <tr>
              <td style={head}>事業の種類</td><td style={cell}>{k.businessType}</td>
              <td style={head}>事業の名称</td><td style={cell}>{placeName}</td>
            </tr>
            <tr>
              <td style={head}>事業の所在地（電話番号）</td><td style={cell}>{address}（電話番号：{phone}）</td>
              <td style={head}>協定の有効期間</td><td style={cell}>{w(k.periodFrom)}{k.periodFrom || k.periodTo ? "から" : ""}{w(k.periodTo)}{k.periodTo ? "まで" : ""}</td>
            </tr>
          </tbody>
        </table>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead>
            <tr>
              <th style={head}>時間外労働をさせる必要のある具体的事由</th><th style={head}>業務の種類</th><th style={head}>労働者数（満18歳以上の者）</th>
              <th style={head}>所定労働時間（1日）（任意）</th><th style={head}>1日</th><th style={head}>1箇月（①45時間まで、②42時間まで）</th>
              <th style={head}>1年（①360時間まで、②320時間まで）起算日 {w(k.startDate)}</th>
            </tr>
          </thead>
          <tbody>
            {filled(k.overtime, ["reason", "work", "month", "year"]).map((r, i) => (
              <tr key={i}>
                <td style={cell}>{r.variable ? "② " : "① "}{r.reason}</td><td style={cell}>{r.work}</td><td style={cell}>{r.workers}{r.workers ? "人" : ""}</td>
                <td style={cell}>{r.prescribed}</td><td style={cell}>{r.day}{r.day ? "時間" : ""}</td>
                <td style={cell}>{r.month}{r.month ? "時間" : ""}</td><td style={cell}>{r.year}{r.year ? "時間" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead>
            <tr>
              <th style={head}>休日労働をさせる必要のある具体的事由</th><th style={head}>業務の種類</th><th style={head}>労働者数（満18歳以上の者）</th>
              <th style={head}>所定休日（任意）</th><th style={head}>労働させることができる法定休日の日数</th><th style={head}>労働させることができる法定休日における始業及び終業の時刻</th>
            </tr>
          </thead>
          <tbody>
            {filled(k.holiday, ["reason", "work", "days"]).map((r, i) => (
              <tr key={i}>
                <td style={cell}>{r.reason}</td><td style={cell}>{r.work}</td><td style={cell}>{r.workers}{r.workers ? "人" : ""}</td>
                <td style={cell}>{r.holidays}</td><td style={cell}>{r.days}</td><td style={cell}>{r.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!k.special && footer}
      </div>
      {k.special && (
        <div className="page">
          <div style={{ fontSize: "8.5pt" }}>様式第９号の２（第16条第１項関係）</div>
          <h2 style={{ textAlign: "center", fontSize: "13pt", margin: "2px 0 6px" }}>時間外労働・休日労働に関する協定届（特別条項）</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>臨時的に限度時間を超えて労働させることができる場合</th><th style={head}>業務の種類</th><th style={head}>労働者数（満18歳以上の者）</th>
                <th style={head}>1日（任意）</th><th style={head}>限度時間を超えて労働させることができる回数（6回以内に限る。）</th>
                <th style={head}>1箇月 延長することができる時間数及び休日労働の時間数（100時間未満に限る。）</th><th style={head}>割増賃金率</th>
                <th style={head}>1年 延長することができる時間数（720時間以内に限る。）起算日 {w(k.startDate)}</th><th style={head}>割増賃金率</th>
              </tr>
            </thead>
            <tbody>
              {filled(k.specialRows, ["work", "month", "year"]).map((r, i) => (
                <tr key={i}>
                  <td style={cell}>{i === 0 ? k.specialCases : ""}</td><td style={cell}>{r.work}</td><td style={cell}>{r.workers}{r.workers ? "人" : ""}</td>
                  <td style={cell}>{r.day}</td><td style={cell}>{r.times}{r.times ? "回" : ""}</td><td style={cell}>{r.month}{r.month ? "時間" : ""}</td>
                  <td style={cell}>{r.monthRate}{r.monthRate ? "％" : ""}</td><td style={cell}>{r.year}{r.year ? "時間" : ""}</td><td style={cell}>{r.yearRate}{r.yearRate ? "％" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <tbody>
              <tr><td style={{ ...head, width: "30%" }}>限度時間を超えて労働させる場合における手続</td><td style={cell}>{k.procedure}</td></tr>
              <tr><td style={head}>限度時間を超えて労働させる労働者に対する健康及び福祉を確保するための措置</td><td style={cell}>（該当する番号）{k.measureNumbers}　（具体的内容）{k.measureDetail}</td></tr>
            </tbody>
          </table>
          {footer}
        </div>
      )}
    </div>
  );
}

// ── 上限の確認 ─────────────────────────────────────────────

/** 給与の計算期間の月（終わりの日の月。「4月分」） */
const monthOf = (c: { periodEnd: string }) => `${Number(c.periodEnd.slice(5, 7))}月分`;

function CheckPanel({ db, staff, k }: { db: Database; staff: any[]; k: Kyotei36 | null }) {
  const limits = limitsOf(k);
  const defaultStart = k?.startDate || dayjs().startOf("year").format("YYYY-MM-DD");
  const [start, setStart] = useState(defaultStart);
  useEffect(() => setStart(defaultStart), [defaultStart]);
  const [rows, setRows] = useState<{ id: string; name: string; months: MonthHours[] }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      try {
        // 起算日の5か月前から（2〜6か月の平均は、起算日をまたいでも数える）、起算日から1年まで
        const from = dayjs(start).subtract(6, "month");
        const to = dayjs(start).add(1, "year").add(1, "month");
        const out: { id: string; name: string; months: MonthHours[] }[] = [];
        for (const s of staff) {
          const res = await db.select<any[]>(
            `SELECT target_year, target_month, ledger, total_overtime_hours FROM salary_results
             WHERE staff_id = ? AND (target_year * 100 + target_month) BETWEEN ? AND ? ORDER BY target_year, target_month`,
            [String(s.id), from.year() * 100 + from.month() + 1, to.year() * 100 + to.month() + 1],
          );
          const months = (res ?? []).map((r): MonthHours => {
            const l = parseLedger(r.ledger);
            const ym = `${r.target_year}-${String(r.target_month).padStart(2, "0")}`;
            return {
              ym,
              periodEnd: l?.periodEnd ?? dayjs(`${ym}-01`).endOf("month").format("YYYY-MM-DD"),
              overtime: l ? l.overtimeHours : Number(r.total_overtime_hours) || 0,
              holiday: l ? l.holidayHours : 0,
            };
          });
          out.push({ id: String(s.id), name: String(s.name ?? ""), months });
        }
        if (!cancelled) setRows(out);
      } catch (e) {
        console.error("36協定の確認の読み込みエラー:", e);
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff, start]);

  const yearEnd = dayjs(start).add(1, "year").subtract(1, "day").format("YYYY-MM-DD");
  return (
    <div style={S.card}>
      <div style={S.controls}>
        <label style={S.field}>
          <span style={S.label}>起算日（この日から1年を見る）</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={S.input} />
        </label>
        <div style={{ ...S.note, alignSelf: "center" }}>
          {limits.agreed
            ? `協定：1か月 ${limits.month}時間・1年 ${limits.year}時間${limits.special ? `／特別条項：1か月 ${limits.special.month}時間未満（休日労働を含む）・1年 ${limits.special.year}時間・${limits.special.times}回まで` : "（特別条項なし）"}`
            : `協定が入っていないので、法律の限度時間（1か月 ${limits.month}時間・1年 ${limits.year}時間）で見ます`}
        </div>
      </div>
      <p style={S.small}>
        時間は確定した給与の賃金台帳の内訳（時間外労働時間数＝法定時間外、休日労働時間数＝法定休日）から、給与の計算期間を1か月として数えます。
        赤は法律や協定を超えたところ、黄色は近づいているところです。2〜6か月の平均は、起算日の前の月とも合わせて見ます。
      </p>
      {rows === null ? <div style={S.small}>読み込んでいます…</div> : rows.length === 0 ? <div style={S.small}>この事業場に従業員がいません。</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr><th style={S.th}>氏名</th><th style={S.th}>月（時間外＋休日＝合計／最大の平均）</th><th style={S.th}>1年の時間外</th><th style={S.th}>限度超え</th><th style={S.th}>確かめること</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const checks = check36(p.months, limits, start);
                const inYear = checks.filter((c) => c.periodEnd >= start && c.periodEnd <= yearEnd);
                const issues = inYear.flatMap((c) => c.violations.map((v) => `${monthOf(c)}：${v}`));
                const warns = inYear.flatMap((c) => warningsOf(c, limits).map((v) => `${monthOf(c)}：${v}`));
                const yearTotal = inYear.length > 0 ? inYear[inYear.length - 1].yearToDate : 0;
                return (
                  <tr key={p.id}>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{p.name}</td>
                    <td style={S.td}>
                      {inYear.length === 0 ? <span style={S.small}>確定した給与がありません</span> : inYear.map((c) => (
                        <span key={c.ym} style={{
                          display: "inline-block", margin: "1px 6px 1px 0", padding: "1px 4px", borderRadius: 4, fontSize: 11,
                          backgroundColor: c.violations.length > 0 ? "#fee2e2" : warningsOf(c, limits).length > 0 ? "#fef3c7" : "#f1f5f9",
                        }}>
                          {monthOf(c)} {c.overtime}＋{c.holiday}＝{c.total}{c.maxAverage ? `／平均${c.maxAverage.average}` : ""}
                        </span>
                      ))}
                    </td>
                    <td style={S.tdNum}>{yearTotal}時間</td>
                    <td style={S.tdNum}>{inYear.filter((c) => c.overMonth).length}回</td>
                    <td style={S.td}>
                      {issues.map((x, i) => <div key={`v${i}`} style={{ color: "#b91c1c" }}>・{x}</div>)}
                      {warns.map((x, i) => <div key={`w${i}`} style={{ color: "#92400e" }}>・{x}</div>)}
                      {issues.length + warns.length === 0 && <span style={{ color: "#15803d" }}>問題ありません</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
