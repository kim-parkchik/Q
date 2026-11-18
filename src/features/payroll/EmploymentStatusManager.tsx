/**
 * 「高年齢者・障害者の雇用状況報告」の画面（作り方は utils/employmentStatus.ts）
 * ・障害者雇用状況報告書（様式第6号）：従業員ごとに障害の種類・重度かどうかを入れ（staff.disability_employment）、6月1日現在の
 *   常用雇用労働者の数・障害者の数・実雇用率・不足数を出す
 * ・高年齢者雇用状況等報告書（様式第2号）：Q で数えられる欄（⑮常用労働者数・⑯解雇等による離職者・⑰定年に達した人）を出す
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import {
  disabilityReport, elderlyReport, hoursClassOf, parseDisabilityInfo, retirementAgeOf, stringifyDisabilityInfo, type DisabilityInfo, disabilityReportByBranch, withTotalNi, type BranchReportSetting,
} from "../../utils/employmentStatus";
import { DISABILITY_PHYSICAL_TYPES } from "../../constants/roumu";
import { parseCompanyLaborConditions } from "../../utils/laborConditions";
import { weeklyMinutesOf } from "../../utils/koyoInfo";
import { formatWareki } from "../../utils/wareki";
import * as S from "./reportStyles";

const PRINT_ID = "employment-status-print";
const CLASS_LABELS = { regular: "30時間以上", short: "20〜30時間（短時間）", specified: "10〜20時間（特定短時間）", none: "10時間未満" } as const;

interface Settings {
  exclusionPct: number; disabilityPromoter: string; elderlyPromoter: string; writer: string;
  /** Ｃ欄（事業所別の内訳）を書く（除外率が設定されている事業所・特例子会社・Ａ型事業所がある企業）と、拠点ごとの設定 */
  byBranch: boolean;
  branches: Record<string, BranchReportSetting>;
}

export default function EmploymentStatusManager({ db, staffList }: { db: Database; staffList: any[] }) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const thisYear = dayjs().month() >= 5 ? dayjs().year() : dayjs().year() - 1;
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState<"disability" | "elderly">("disability");
  const [settings, setSettings] = useState<Settings>({ exclusionPct: 0, disabilityPromoter: "", elderlyPromoter: "", writer: "", byBranch: false, branches: {} });
  const [branchList, setBranchList] = useState<{ id: number; name: string; address: string; koyo: string }[]>([]);
  const [retirementText, setRetirementText] = useState<string | undefined>(undefined);
  const [company, setCompany] = useState<any>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [c] = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
        setCompany(c ?? {});
        const o = c?.employment_report ? JSON.parse(String(c.employment_report)) : {};
        setSettings({
          exclusionPct: Number(o.exclusionPct) || 0, disabilityPromoter: String(o.disabilityPromoter ?? ""), elderlyPromoter: String(o.elderlyPromoter ?? ""), writer: String(o.writer ?? ""),
          byBranch: o.byBranch === true, branches: o.branches && typeof o.branches === "object" ? o.branches : {},
        });
        const bs = await db.select<any[]>("SELECT id, name, address, koyo_office_number FROM branches ORDER BY id");
        setBranchList((bs ?? []).map((b) => ({ id: Number(b.id), name: String(b.name ?? ""), address: String(b.address ?? ""), koyo: String(b.koyo_office_number ?? "") })));
        setRetirementText(parseCompanyLaborConditions(c?.labor_conditions).retirementAge);
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  const saveSettings = async (next: Settings) => {
    setSettings(next);
    try {
      await db.execute("UPDATE company SET employment_report = ? WHERE id = 1", [JSON.stringify(next)]);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const saveDisability = async (s: any, d: DisabilityInfo) => {
    try {
      const json = stringifyDisabilityInfo(d);
      await db.execute("UPDATE staff SET disability_employment = ? WHERE id = ?", [json, String(s.id)]);
      s.disability_employment = json;
      setTick((t) => t + 1);
      toast.success("保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const asOf = `${year}-06-01`;
  const people = useMemo(() => staffList.filter((s) => {
    const join = String(s.join_date ?? "");
    const leave = String(s.retirement_date ?? "");
    return (!join || join <= asOf) && (!leave || leave >= asOf);
  }), [staffList, asOf]);
  const byBranch = useMemo(() => (settings.byBranch ? disabilityReportByBranch(staffList, year, branchList, settings.branches) : null), [staffList, year, branchList, settings, tick]);
  const dr = useMemo(() => {
    const r = disabilityReport(staffList, year, settings.exclusionPct);
    return byBranch ? withTotalNi(r, byBranch.ni) : r;
  }, [staffList, year, settings.exclusionPct, tick, byBranch]);
  const setBranch = (id: number, patch: Partial<BranchReportSetting>) => {
    const cur = settings.branches[String(id)] ?? { kubun: "3", exclusionPct: 0, business: "" };
    void saveSettings({ ...settings, branches: { ...settings.branches, [String(id)]: { ...cur, ...patch } } });
  };
  const retirementAge = retirementAgeOf(retirementText);
  const er = useMemo(() => elderlyReport(staffList, year, retirementAge), [staffList, year, retirementAge]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>高年齢者・障害者の雇用状況報告</h3>
        <p style={S.note}>
          毎年6月1日現在の状況を、7月15日までに、本社を管轄するハローワークに、支社・支店の分もまとめて報告します（電子申請もできます）。高年齢者雇用状況等報告は、
          従業員に高年齢者がいなくても出します。障害者雇用状況報告は、法定雇用障害者数が1人以上になる事業主（令和8年は常用雇用労働者 40.0人以上）が出します。
        </p>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>報告の年（6月1日現在）</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.input}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}年（{formatWareki(`${y}-06-01`)}現在）</option>)}
            </select>
          </label>
          <button onClick={() => setTab("disability")} style={S.tabButton(tab === "disability")}>障害者雇用状況報告書（様式第6号）</button>
          <button onClick={() => setTab("elderly")} style={S.tabButton(tab === "elderly")}>高年齢者雇用状況等報告書（様式第2号）</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} style={S.button("#2563eb")}>🖨 印刷</button>
        </div>
      </div>

      {tab === "disability" ? (
        <>
          <div className="no-print" style={S.card}>
            <div style={S.controls}>
              <label style={S.field}>
                <span style={S.label}>除外率（%。除外率設定業種のときだけ）</span>
                <input type="number" min={0} max={100} value={settings.exclusionPct} disabled={settings.byBranch} onChange={(e) => void saveSettings({ ...settings, exclusionPct: Number(e.target.value) || 0 })} style={{ ...S.input, width: 120 }} />
              </label>
              <label style={{ fontSize: 13, alignSelf: "center" }}>
                <input type="checkbox" checked={settings.byBranch} onChange={(e) => void saveSettings({ ...settings, byBranch: e.target.checked })} /> 事業所別の内訳（Ｃ欄）を書く（除外率が設定されている事業所・特例子会社・Ａ型事業所がある企業）
              </label>
              <label style={S.field}>
                <span style={S.label}>障害者雇用推進者（役職名・氏名）</span>
                <input value={settings.disabilityPromoter} onChange={(e) => setSettings({ ...settings, disabilityPromoter: e.target.value })} onBlur={() => void saveSettings(settings)} style={S.input} />
              </label>
              <label style={S.field}>
                <span style={S.label}>記入担当者（所属部課名・氏名）</span>
                <input value={settings.writer} onChange={(e) => setSettings({ ...settings, writer: e.target.value })} onBlur={() => void saveSettings(settings)} style={S.input} />
              </label>
            </div>
            <p style={S.small}>
              障害者手帳など（身体障害者手帳・療育手帳または判定書・精神障害者保健福祉手帳）で確かめた人だけを入れます。本人の同意を得て、報告のためだけに使います
              （プライバシーに配慮した障害者の把握・確認ガイドライン）。週の所定労働時間は、従業員の設定（出勤する曜日と1日の所定労働時間、または雇用保険の欄の1週間の所定労働時間）から数えます。
            </p>
            {settings.byBranch && (
              <table style={{ ...S.table, marginBottom: 10 }}>
                <thead><tr>{["事業所（拠点）", "⑥ 事業所の区分", "⑨ 除外率（%）", "⑧ 事業の内容"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {branchList.map((b) => {
                    const set = settings.branches[String(b.id)] ?? { kubun: "3", exclusionPct: 0, business: "" };
                    return (
                      <tr key={b.id}>
                        <td style={S.td}>{b.name}</td>
                        <td style={S.td}>
                          <select value={set.kubun} onChange={(e) => setBranch(b.id, { kubun: e.target.value as BranchReportSetting["kubun"] })} style={S.input}>
                            <option value="1">1 特例子会社に含まれる事業所</option><option value="2">2 指定就労継続支援Ａ型事業所</option><option value="3">3 上記1及び2以外</option>
                          </select>
                        </td>
                        <td style={S.td}><input type="number" min={0} max={100} value={set.exclusionPct} onChange={(e) => setBranch(b.id, { exclusionPct: Number(e.target.value) || 0 })} style={{ ...S.input, width: 80 }} /></td>
                        <td style={S.td}><input defaultValue={set.business} onBlur={(e) => { if (e.target.value !== set.business) setBranch(b.id, { business: e.target.value }); }} style={S.input} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <table style={S.table}>
              <thead><tr>{["従業員", "週の所定労働時間", "障害の種類", "確かめた書類（メモ）", "数え方"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {people.map((s) => {
                  const d = parseDisabilityInfo(s.disability_employment);
                  const value = d.kind ? `${d.kind}${d.severe ? ":severe" : ""}` : "";
                  const row = dr.rows.find((r) => r.id === String(s.id));
                  return (
                    <tr key={s.id}>
                      <td style={S.td}>{s.id} {s.name}</td>
                      <td style={S.td}>{Math.round(weeklyMinutesOf(s) / 6) / 10}時間（{CLASS_LABELS[hoursClassOf(s)]}）</td>
                      <td style={S.td}>
                        <select value={value} onChange={(e) => {
                          const [kind, sev] = e.target.value.split(":");
                          void saveDisability(s, { kind: (kind || "") as DisabilityInfo["kind"], severe: sev === "severe", physicalType: kind === "physical" ? d.physicalType : null, note: d.note });
                        }} style={S.input}>
                          <option value="">—</option>
                          <option value="physical">身体障害者</option>
                          <option value="physical:severe">身体障害者（重度）</option>
                          <option value="intellectual">知的障害者</option>
                          <option value="intellectual:severe">知的障害者（重度）</option>
                          <option value="mental">精神障害者</option>
                        </select>
                        {d.kind === "physical" && (
                          <select value={d.physicalType ?? ""} onChange={(e) => void saveDisability(s, { ...d, physicalType: e.target.value ? Number(e.target.value) : null })} style={{ ...S.input, marginLeft: 4 }} title="Ｄ欄の種類（2つ以上の障害があれば主たる障害）">
                            <option value="">種類（Ｄ欄）</option>
                            {DISABILITY_PHYSICAL_TYPES.map((x) => <option key={x.no} value={x.no}>{x.label}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={S.td}>
                        {d.kind && <input defaultValue={d.note} onBlur={(e) => { if (e.target.value !== d.note) void saveDisability(s, { ...d, note: e.target.value }); }} style={S.input} />}
                      </td>
                      <td style={S.tdNum}>{row ? `${row.weight}人` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div id={PRINT_ID} style={S.card}><DisabilitySheet r={dr} company={company} settings={settings} byBranch={byBranch} branchList={branchList} /></div>
        </>
      ) : (
        <>
          <div className="no-print" style={S.card}>
            <div style={S.controls}>
              <label style={S.field}>
                <span style={S.label}>高年齢者雇用等推進者（所属及び役職・氏名）</span>
                <input value={settings.elderlyPromoter} onChange={(e) => setSettings({ ...settings, elderlyPromoter: e.target.value })} onBlur={() => void saveSettings(settings)} style={S.input} />
              </label>
            </div>
            <p style={S.small}>
              定年の年齢は、労働条件通知書の「会社の初めの値」の定年制（「有（60歳）」）から読みます{retirementAge === null ? "（入っていないので、⑰は出しません）" : `（${retirementAge}歳）`}。
              ⑧〜⑭（定年制・継続雇用制度・創業支援等措置などの制度）と⑱⑲は、就業規則で確かめて書きます。
            </p>
          </div>
          <div id={PRINT_ID} style={S.card}><ElderlySheet r={er} settings={settings} /></div>
        </>
      )}
    </div>
  );
}

const cell: CSSProperties = { border: "1px solid #333", padding: "3px 6px", fontSize: "9.5pt", textAlign: "right" };
const lab: CSSProperties = { ...cell, textAlign: "left", backgroundColor: "#f8fafc" };
const num = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

function DisabilitySheet({ r, company, settings, byBranch, branchList }: {
  r: ReturnType<typeof disabilityReport>; company: any; settings: Settings;
  byBranch: ReturnType<typeof disabilityReportByBranch> | null; branchList: { id: number; name: string; address: string; koyo: string }[];
}) {
  const c = r.cells;
  const line = (label: string, v: { n: number; newN: number }) => (
    <tr><td style={lab}>{label}</td><td style={cell}>{v.n}人（{v.newN}人）</td></tr>
  );
  return (
    <div>
      <h2 style={{ textAlign: "center", fontSize: "14pt", margin: "0 0 4px" }}>障害者雇用状況報告書（{formatWareki(r.asOf)}現在）に書く数</h2>
      <div style={{ fontSize: "9.5pt", marginBottom: 6 }}>{company.name ?? ""}　法定雇用率 {r.rate[0] / 10}%　除外率 {settings.exclusionPct}%</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={lab}>10(イ) 常用雇用労働者の数（短時間労働者を除く）</td><td style={cell}>{r.i}人</td></tr>
          <tr><td style={lab}>10(ロ) 短時間労働者の数</td><td style={cell}>{r.ro}人</td></tr>
          <tr><td style={lab}>10(ハ) 常用雇用労働者の数［イ＋（ロ×0.5）］</td><td style={cell}>{num(r.ha)}人</td></tr>
          <tr><td style={lab}>10(ニ) 法定雇用障害者の算定の基礎となる労働者の数</td><td style={cell}>{num(r.ni)}人</td></tr>
          <tr><td style={{ ...lab, fontWeight: "bold" }} colSpan={2}>11 常用雇用身体障害者、知的障害者及び精神障害者の数（括弧内は本年6月1日以前1年間に新規に雇い入れた者）</td></tr>
          {line("(ホ) 重度身体障害者の数", c.ho)}
          {line("(ヘ) 重度身体障害者以外の身体障害者の数", c.he)}
          {line("(ト) 重度身体障害者である短時間労働者の数", c.to)}
          {line("(チ) 重度身体障害者以外の身体障害者である短時間労働者の数", c.chi)}
          {line("(リ) 重度身体障害者である特定短時間労働者の数", c.ri)}
          <tr><td style={lab}>(ヌ) 身体障害者の数［(ホ×2)＋ヘ＋ト＋((チ＋リ)×0.5)］</td><td style={cell}>{num(r.physical)}人</td></tr>
          {line("(ル) 重度知的障害者の数", c.ru)}
          {line("(ヲ) 重度知的障害者以外の知的障害者の数", c.wo)}
          {line("(ワ) 重度知的障害者である短時間労働者の数", c.wa)}
          {line("(カ) 重度知的障害者以外の知的障害者である短時間労働者の数", c.ka)}
          {line("(ヨ) 重度知的障害者である特定短時間労働者の数", c.yo)}
          <tr><td style={lab}>(タ) 知的障害者の数［(ル×2)＋ヲ＋ワ＋((カ＋ヨ)×0.5)］</td><td style={cell}>{num(r.intellectual)}人</td></tr>
          {line("(レ) 精神障害者の数", c.re)}
          {line("(ソ) 精神障害者である短時間労働者の数", c.so)}
          {line("(ツ) 精神障害者である特定短時間労働者の数", c.tsu)}
          <tr><td style={lab}>(ネ) 精神障害者の数［レ＋ソ＋(ツ×0.5)］</td><td style={cell}>{num(r.mental)}人</td></tr>
          <tr><td style={lab}>12 計［(ヌ)＋(タ)＋(ネ)］</td><td style={cell}>{num(r.total)}人</td></tr>
          <tr><td style={lab}>13 実雇用率（12 ÷ 10(ニ) × 100）</td><td style={cell}>{r.actualRate === null ? "" : `${r.actualRate.toFixed(2)}%`}</td></tr>
          <tr><td style={lab}>法定雇用障害者数（10(ニ) × 法定雇用率。1人未満切り捨て）</td><td style={cell}>{r.required}人</td></tr>
          <tr><td style={lab}>14 不足数</td><td style={cell}>{num(r.shortage)}人</td></tr>
          <tr><td style={{ ...lab, fontWeight: "bold" }} colSpan={2}>Ｄ 障害者の雇用の促進等に関する法律別表に掲げる種類別の身体障害者数（実人数）</td></tr>
          {DISABILITY_PHYSICAL_TYPES.map((x, i) => (
            <tr key={x.no}><td style={lab}>{x.label}（第{x.no}号に該当する者）</td><td style={cell}>{r.physicalTypes[i]}人</td></tr>
          ))}
          <tr><td style={lab}>E 障害者雇用推進者／F 記入担当者</td><td style={{ ...cell, textAlign: "left" }}>{settings.disabilityPromoter}／{settings.writer}</td></tr>
        </tbody>
      </table>
      {r.physicalTypeUnknown > 0 && <p className="no-print" style={{ ...S.small, color: "#b45309" }}>身体障害者のうち {r.physicalTypeUnknown}人は、Ｄ欄の種類が入っていません（障害の種類の欄で選んでください）。</p>}
      {byBranch && (
        <>
          <div style={{ fontSize: "10pt", fontWeight: "bold", margin: "10px 0 4px" }}>Ｃ 事業所別の内訳</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={lab}>欄</th>{byBranch.list.map((x) => <th key={x.branch.id} style={{ ...lab, textAlign: "center" }}>{x.branch.name}</th>)}</tr></thead>
            <tbody>
              <tr><td style={lab}>④ 適用事業所番号</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{branchList.find((b) => b.id === x.branch.id)?.koyo || "（会社の番号）"}</td>)}</tr>
              <tr><td style={lab}>⑥ 事業所の区分</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{x.setting.kubun}</td>)}</tr>
              <tr><td style={lab}>⑦ 事業所の所在地</td>{byBranch.list.map((x) => <td key={x.branch.id} style={{ ...cell, textAlign: "left" }}>{branchList.find((b) => b.id === x.branch.id)?.address || company.address || ""}</td>)}</tr>
              <tr><td style={lab}>⑧ 事業の内容</td>{byBranch.list.map((x) => <td key={x.branch.id} style={{ ...cell, textAlign: "left" }}>{x.setting.business}</td>)}</tr>
              <tr><td style={lab}>⑨ 除外率</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{x.setting.exclusionPct}%</td>)}</tr>
              <tr><td style={lab}>⑩(イ)・(ロ)・(ハ)・(ニ)</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{x.report.i}・{x.report.ro}・{num(x.report.ha)}・{num(x.report.ni)}人</td>)}</tr>
              <tr><td style={lab}>(ヌ)・(タ)・(ネ)</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{num(x.report.physical)}・{num(x.report.intellectual)}・{num(x.report.mental)}人</td>)}</tr>
              <tr><td style={lab}>12 計</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{num(x.report.total)}人</td>)}</tr>
              {DISABILITY_PHYSICAL_TYPES.map((t, i) => (
                <tr key={t.no}><td style={lab}>Ｄ {t.label}</td>{byBranch.list.map((x) => <td key={x.branch.id} style={cell}>{x.report.physicalTypes[i]}人</td>)}</tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="no-print" style={{ ...S.small, marginTop: 6 }}>
        {r.mustReport ? "法定雇用障害者数が1人以上なので、報告が要ります。" : "法定雇用障害者数が1人未満なので、報告は要りません（会社全体の常用雇用労働者で数えます）。"}
        事業所別の内訳（Ｃ欄）は、除外率が設定されている事業所・特例子会社・Ａ型事業所がある企業だけが書きます（ほかの企業は合計欄だけ）。
        Ｄ欄（身体障害者の種類別の人数）は、身体障害者手帳で確かめた種類（2つ以上あれば主たる障害）で数えます。
      </p>
    </div>
  );
}

function ElderlySheet({ r, settings }: { r: ReturnType<typeof elderlyReport>; settings: Settings }) {
  return (
    <div>
      <h2 style={{ textAlign: "center", fontSize: "14pt", margin: "0 0 6px" }}>高年齢者雇用状況等報告書（{formatWareki(r.asOf)}現在）に書く数</h2>
      <div style={{ fontSize: "10pt", fontWeight: "bold", margin: "4px 0" }}>⑮ 常用労働者数（うち女性）</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={lab}>総数</th>{r.bands.map((b) => <th key={b.label} style={lab}>{b.label}</th>)}</tr></thead>
        <tbody><tr><td style={cell}>{r.total}（{r.women}）人</td>{r.bands.map((b) => <td key={b.label} style={cell}>{b.total}（{b.women}）人</td>)}</tr></tbody>
      </table>
      <div style={{ fontSize: "10pt", fontWeight: "bold", margin: "10px 0 4px" }}>⑯ 過去1年間の離職者の状況（{formatWareki(`${r.year - 1}-06-01`)}〜{formatWareki(`${r.year}-05-31`)}）</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={lab}>解雇等による45歳以上70歳未満の離職者数（うち女性）</td><td style={cell}>{r.dismissed.names.length}（{r.dismissed.women}）人</td></tr>
          <tr><td style={lab}>うち求職活動支援書を作成した対象者数</td><td style={{ ...cell, textAlign: "left" }}>（書く）</td></tr>
        </tbody>
      </table>
      {r.dismissed.names.length > 0 && <div className="no-print" style={S.small}>数えた人：{r.dismissed.names.join("・")}（退職の事由が解雇・会社都合・退職勧奨の人）</div>}
      <div style={{ fontSize: "10pt", fontWeight: "bold", margin: "10px 0 4px" }}>⑰ 過去1年間に定年に達した人{r.retirementAge !== null ? `（定年 ${r.retirementAge}歳）` : ""}</div>
      {r.retirementAge === null ? <div style={S.small}>定年の年齢がわからないので、出していません。</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={lab}>(a) 定年到達者の総数</td><td style={cell}>{r.reached.length}人</td></tr>
            <tr><td style={lab}>(b) 定年退職者数（継続雇用を希望しない者等）</td><td style={cell}>{r.reached.filter((x) => x.outcome === "退職").length}人</td></tr>
            <tr><td style={lab}>(c) 継続雇用者数</td><td style={cell}>{r.reached.filter((x) => x.outcome === "継続雇用").length}人</td></tr>
          </tbody>
        </table>
      )}
      {r.reached.length > 0 && <div className="no-print" style={S.small}>数えた人：{r.reached.map((x) => `${x.name}（${formatWareki(x.date)}・${x.outcome}）`).join("、")}。継続雇用を希望したのに継続雇用されなかった人（e）などは、確かめて直してください。</div>}
      <div style={{ fontSize: "9.5pt", marginTop: 10 }}>高年齢者雇用等推進者：{settings.elderlyPromoter}</div>
    </div>
  );
}
