/**
 * 「労働条件通知書」の画面（作り方は utils/laborConditions.ts）
 * 従業員を選ぶと、モデル様式（令和8年10月以降。一般労働者用・短時間労働者用）の欄に、従業員ごとに入れた値・会社の初めの値・
 * Q の設定から作った値を入れて出す。欄を直すと、その人の値として残す（会社の初めの値は「会社の初めの値」のタブで入れる）。
 * 印刷して本人に渡す（雇入れのときと、有期労働契約を更新するとき）。
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { loadAnnualWorkDays } from "../../utils/annualWorkDays";
import { checkSocialInsEnrolled } from "../../utils/calcSalary";
import {
  LABOR_FORM_LABELS, LABOR_SECTIONS, laborDefaults, parseCompanyLaborConditions, parseStaffLaborConditions, resolveLaborConditions,
  stringifyCompanyLaborConditions, stringifyStaffLaborConditions, type CompanyLaborConditions, type LaborContext, type LaborFormType,
  type StaffLaborConditions,
} from "../../utils/laborConditions";
import { formatWareki } from "../../utils/wareki";
import * as S from "../payroll/reportStyles";

const PRINT_ID = "labor-conditions-print";

interface Props {
  db: Database;
  staffList: any[];
}

export default function LaborConditionsManager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [tab, setTab] = useState<"staff" | "company">("staff");
  const [staffId, setStaffId] = useState("");
  const [companyRow, setCompanyRow] = useState<any>(null);
  const [companyValues, setCompanyValues] = useState<CompanyLaborConditions>({});
  const [staffValues, setStaffValues] = useState<StaffLaborConditions>({ formType: "", fields: {} });
  const [ctx, setCtx] = useState<Omit<LaborContext, "staff" | "company" | "today"> | null>(null);

  const staff = staffList.find((s) => String(s.id) === staffId);
  const today = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.select<any[]>("SELECT name, address, representative, annual_holidays, hourly_leave, labor_conditions FROM company WHERE id = 1");
        setCompanyRow(rows?.[0] ?? {});
        setCompanyValues(parseCompanyLaborConditions(rows?.[0]?.labor_conditions));
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  useEffect(() => {
    if (!staff) { setCtx(null); return; }
    setStaffValues(parseStaffLaborConditions(staff.labor_conditions));
    let cancelled = false;
    (async () => {
      try {
        const [branch] = await db.select<any[]>("SELECT name, address FROM branches WHERE id = ?", [Number(staff.branch_id ?? 1)]);
        const [group] = await db.select<any[]>("SELECT closing_day, is_next_month, payment_day, fixed_break, premium_rates FROM payroll_groups WHERE id = ?", [Number(staff.payroll_group_id ?? 1)]);
        const items = await db.select<any[]>(
          `SELECT m.name, v.amount FROM staff_salary_values v JOIN salary_item_master m ON m.id = v.item_id
           WHERE v.staff_id = ? AND m.type = 'earning' AND m.category = 'fixed' AND v.amount <> 0 ORDER BY m.display_order, m.id`,
          [String(staff.id)],
        );
        const leaveTypes = await db.select<any[]>("SELECT name, is_paid FROM leave_types WHERE is_active = 1 ORDER BY sort_order, id");
        const accounts = await db.select<any[]>("SELECT COUNT(*) AS n FROM staff_bank_accounts WHERE staff_id = ?", [String(staff.id)]);
        const annualDays = Number(staff.calendar_pattern_id ?? 1) === 0 ? null : await loadAnnualWorkDays(db, staff, dayjs().year());
        const ym = dayjs();
        if (cancelled) return;
        setCtx({
          branch: branch ? { name: String(branch.name ?? ""), address: String(branch.address ?? "") } : null,
          group: group ?? null,
          allowances: (items ?? []).map((r) => ({ name: String(r.name), amount: Number(r.amount) || 0 })),
          leaveTypes: (leaveTypes ?? []).map((r) => ({ name: String(r.name), isPaid: Number(r.is_paid) === 1 })),
          hasBankAccount: Number(accounts?.[0]?.n ?? 0) > 0,
          annualDays,
          socialInsured: checkSocialInsEnrolled(staff, ym.year(), ym.month() + 1),
        });
      } catch (e) {
        console.error("労働条件通知書の読み込みエラー:", e);
        if (!cancelled) setCtx(null);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff]);

  const resolved = useMemo(() => {
    if (!staff || !ctx || !companyRow) return null;
    const defaults = laborDefaults({ ...ctx, staff, company: companyRow, today });
    return resolveLaborConditions(staffValues, companyValues, defaults, staff);
  }, [staff, ctx, companyRow, staffValues, companyValues, today]);

  const saveStaff = async (next: StaffLaborConditions) => {
    if (!staff) return;
    try {
      const json = stringifyStaffLaborConditions(next);
      await db.execute("UPDATE staff SET labor_conditions = ? WHERE id = ?", [json, String(staff.id)]);
      staff.labor_conditions = json;
      setStaffValues(next);
      toast.success("保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const saveCompany = async (next: CompanyLaborConditions) => {
    try {
      await db.execute("UPDATE company SET labor_conditions = ? WHERE id = 1", [stringifyCompanyLaborConditions(next)]);
      setCompanyValues(next);
      toast.success("会社の初めの値を保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const setStaffField = (key: string, value: string) => {
    const fields = { ...staffValues.fields };
    if (value === "") delete fields[key];
    else fields[key] = value;
    void saveStaff({ ...staffValues, fields });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>労働条件通知書</h3>
        <p style={S.note}>
          人を雇うときは、契約期間・就業の場所と業務・始業終業の時刻・休日・賃金・退職などの労働条件を、書面で明示します（労働基準法15条・施行規則5条。
          令和6年4月からは就業の場所と業務の「変更の範囲」も）。短時間・有期の人には、昇給・退職手当・賞与の有無と相談窓口も書面で明示します（パートタイム・有期雇用労働法6条）。
          厚生労働省のモデル様式（令和8年10月以降の様式）の欄に、従業員の設定から作った値を入れて出します。会社で同じこと（更新の判断の基準・定年・相談窓口など）は
          「会社の初めの値」に入れておくと、全員に使います。欄を直すと、その人の値として残ります（空にすると初めの値に戻ります）。
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => setTab("staff")} style={S.tabButton(tab === "staff")}>従業員ごとの通知書</button>
          <button onClick={() => setTab("company")} style={S.tabButton(tab === "company")}>会社の初めの値</button>
        </div>
      </div>

      {tab === "company" ? (
        <div className="no-print" style={S.card}>
          <p style={S.note}>ここに入れた値は、従業員ごとに直していない人の通知書に使います。</p>
          {LABOR_SECTIONS.map((sec) => {
            const fields = sec.fields.filter((f) => f.company);
            if (fields.length === 0) return null;
            return (
              <div key={sec.title} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: "bold", margin: "8px 0 4px" }}>{sec.title}</div>
                {fields.map((f) => (
                  <FieldRow key={f.key} label={f.label + (f.parttimeOnly ? "（短時間労働者用）" : "")} multiline={f.multiline} hint={f.hint}
                    value={companyValues[f.key] ?? ""} onCommit={(v) => {
                      const next = { ...companyValues };
                      if (v.trim() === "") delete next[f.key];
                      else next[f.key] = v;
                      void saveCompany(next);
                    }} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="no-print" style={S.card}>
            <div style={S.controls}>
              <label style={S.field}>
                <span style={S.label}>従業員</span>
                <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={S.input}>
                  <option value="">選んでください</option>
                  {staffList.filter((s) => (s.status || "active") !== "retired").map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}</option>)}
                </select>
              </label>
              {staff && (
                <label style={S.field}>
                  <span style={S.label}>様式</span>
                  <select value={staffValues.formType} onChange={(e) => void saveStaff({ ...staffValues, formType: e.target.value as "" | LaborFormType })} style={S.input}>
                    <option value="">週の所定労働時間で決める（30時間未満は短時間）{resolved ? `：${LABOR_FORM_LABELS[resolved.formType]}` : ""}</option>
                    <option value="general">{LABOR_FORM_LABELS.general}</option>
                    <option value="parttime">{LABOR_FORM_LABELS.parttime}</option>
                  </select>
                </label>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={() => window.print()} disabled={!resolved} style={S.button("#2563eb", !resolved)}>🖨 印刷・PDF保存</button>
            </div>
            {resolved && resolved.problems.length > 0 && (
              <div style={S.warnBox}>{resolved.problems.map((p, i) => <div key={i}>・{p}</div>)}</div>
            )}
            {resolved && LABOR_SECTIONS.map((sec) => {
              const fields = sec.fields.filter((f) => f.key in resolved.values);
              return (
                <div key={sec.title} style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: "bold", margin: "6px 0 4px" }}>{sec.title}</div>
                  {fields.map((f) => (
                    <FieldRow key={`${staffId}:${f.key}`} label={f.label} multiline={f.multiline} hint={f.hint}
                      value={resolved.values[f.key]} own={f.key in staffValues.fields}
                      onCommit={(v) => { if (v !== resolved.values[f.key]) setStaffField(f.key, v); }}
                      onReset={f.key in staffValues.fields ? () => setStaffField(f.key, "") : undefined} />
                  ))}
                </div>
              );
            })}
          </div>
          {resolved && staff && <NoticeSheet name={String(staff.name ?? "")} formType={resolved.formType} values={resolved.values} />}
        </>
      )}
    </div>
  );
}

function FieldRow({ label, value, multiline, hint, own, onCommit, onReset }: {
  label: string; value: string; multiline?: boolean; hint?: string; own?: boolean; onCommit: (v: string) => void; onReset?: () => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const style: CSSProperties = { ...S.input, width: "100%", boxSizing: "border-box", fontFamily: "inherit", backgroundColor: own ? "#fffbeb" : "white" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr auto", gap: 8, alignItems: "start", marginBottom: 4 }}>
      <div style={{ fontSize: 12, color: "#334155", paddingTop: 6 }}>{label}</div>
      {multiline
        ? <textarea value={text} placeholder={hint} rows={Math.max(2, text.split("\n").length)} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text)} style={style} />
        : <input value={text} placeholder={hint} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text)} style={style} />}
      {onReset ? <button onClick={onReset} style={{ ...S.button("#64748b"), padding: "4px 8px", fontSize: 11 }} title="この人の値を消して、初めの値に戻す">戻す</button> : <span />}
    </div>
  );
}

/** 印刷する通知書（モデル様式の並び） */
function NoticeSheet({ name, formType, values }: { name: string; formType: LaborFormType; values: Record<string, string> }) {
  const cell: CSSProperties = { border: "1px solid #333", padding: "4px 6px", fontSize: "9.5pt", verticalAlign: "top", whiteSpace: "pre-wrap", lineHeight: 1.5 };
  const head: CSSProperties = { ...cell, width: "22%", fontWeight: "bold", backgroundColor: "#f8fafc" };
  const v = (key: string) => values[key] ?? "";
  const lines = (keys: [string, string][]) => keys.filter(([k]) => k in values).map(([k, label]) => `${label}${label ? "　" : ""}${v(k)}`).join("\n");
  const issue = v("issueDate");
  return (
    <div id={PRINT_ID} style={{ ...S.card, fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', serif" }}>
      <div style={{ fontSize: "9pt" }}>（{formType === "parttime" ? "短時間労働者用" : "一般労働者用"}；常用、有期雇用型）</div>
      <h2 style={{ textAlign: "center", fontSize: "16pt", letterSpacing: "0.5em", margin: "4px 0 8px" }}>労働条件通知書</h2>
      <div style={{ textAlign: "right", fontSize: "10pt" }}>{/^\d{4}-\d{2}-\d{2}$/.test(issue) ? formatWareki(issue) : issue}</div>
      <div style={{ fontSize: "11pt", margin: "4px 0" }}>{name}　殿</div>
      <div style={{ textAlign: "right", fontSize: "10pt", lineHeight: 1.6 }}>
        <div>事業場名称・所在地　{v("workplace")}</div>
        <div>使用者職氏名　{v("employer")}</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <tbody>
          <tr><td style={head}>契約期間</td><td style={cell}>{lines([["contractPeriod", ""], ["renewal", "１ 契約の更新の有無"], ["renewalCriteria", "２ 契約の更新は次により判断する"], ["renewalLimit", "３ 更新上限の有無"], ["conversion", "【無期転換】"], ["specialMeasure", "【有期雇用特別措置法による特例】"]])}</td></tr>
          <tr><td style={head}>就業の場所</td><td style={cell}>{lines([["placeNow", "（雇入れ直後）"], ["placeRange", "（変更の範囲）"]])}</td></tr>
          <tr><td style={head}>従事すべき業務の内容</td><td style={cell}>{lines([["jobNow", "（雇入れ直後）"], ["jobRange", "（変更の範囲）"]])}</td></tr>
          <tr><td style={head}>始業、終業の時刻、休憩時間、就業時転換、所定時間外労働の有無に関する事項</td>
            <td style={cell}>{lines([["workHours", "１ 始業・終業の時刻等"], ["breakTime", "２ 休憩時間"], ["overtime", "３ 所定時間外労働の有無"], ["holidayWork", "４ 休日労働"], ["workRules", "○詳細は、就業規則"]])}</td></tr>
          <tr><td style={head}>{formType === "parttime" ? "休日及び勤務日" : "休日"}</td><td style={cell}>{lines([["holidays", ""], ["workDays", "（勤務日）"], ["holidayRules", "○詳細は、就業規則"]])}</td></tr>
          <tr><td style={head}>休暇</td><td style={cell}>{lines([["annualLeave", "１ 年次有給休暇"], ["substituteLeave", "２ 代替休暇"], ["otherLeave", "３ その他の休暇"], ["leaveRules", "○詳細は、就業規則"]])}</td></tr>
          <tr><td style={head}>賃金</td><td style={cell}>{lines([["basePay", "１ 基本賃金"], ["allowances", "２ 諸手当の額又は計算方法\n"], ["premiumRates", "３ 所定時間外、休日又は深夜労働に対して支払われる割増賃金率\n"], ["closingDay", "４ 賃金締切日"], ["payDay", "５ 賃金支払日"], ["payMethod", "６ 賃金の支払方法"], ["deductions", "７ 労使協定に基づく賃金支払時の控除"], ["raise", "８ 昇給"], ["bonus", "９ 賞与"], ["retirementPay", "10 退職金"]])}</td></tr>
          <tr><td style={head}>退職に関する事項</td><td style={cell}>{lines([["retirementAge", "１ 定年制"], ["continuedEmployment", "２ 継続雇用制度"], ["businessSupport", "３ 創業支援等措置"], ["resignNotice", "４ 自己都合退職の手続"], ["dismissal", "５ 解雇の事由及び手続"]])}</td></tr>
          <tr><td style={head}>その他</td><td style={cell}>{lines([["socialInsurance", "・社会保険の加入状況"], ["employmentInsurance", "・雇用保険の適用"], ["chutaikyo", "・中小企業退職金共済制度"], ["corporatePension", "・企業年金制度"], ["explanationDesk", "・通常の労働者との間の待遇の相違（内容・理由）等について説明を求めることができる窓口"], ["consultationDesk", "・雇用管理の改善等に関する事項に係る相談窓口"], ["rulesName", "・具体的に適用される就業規則名"], ["others", "・その他"]])}</td></tr>
        </tbody>
      </table>
      <div style={{ fontSize: "8.5pt", lineHeight: 1.6, marginTop: 6 }}>
        <div>以上のほかは、当社就業規則による。就業規則を確認できる場所や方法（{v("rulesPlace")}）</div>
        <div>※ 本通知書の交付は、労働基準法第15条に基づく労働条件の明示及び短時間労働者及び有期雇用労働者の雇用管理の改善等に関する法律（パートタイム・有期雇用労働法）第6条に基づく文書の交付を兼ねるものであること。</div>
        {/期間の定めあり/.test(v("contractPeriod")) && (
          <div>※ 労働契約法第18条の規定により、有期労働契約（平成25年4月1日以降に開始するもの）の契約期間が通算5年を超える場合には、労働契約の期間の末日までに労働者から申込みをすることにより、当該労働契約の期間の末日の翌日から期間の定めのない労働契約に転換されます。</div>
        )}
      </div>
    </div>
  );
}
