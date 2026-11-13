/**
 * 「休暇の種類」タブ：会社独自の休暇（特別休暇。夏季休暇・慶弔休暇など）の種類を決める
 *
 * 種類ごとに、有給か無給か・残りを数えるか・半日でも取れるか・時間単位でも取れるか・発生（毎年◯月◯日に◯日）・
 * 消滅（付与日から◯か月か、◯月◯日まで）を決める。子の看護等休暇・介護休暇は、見本から作れる（LEAVE_TYPE_TEMPLATES）。
 * 付与と残りは「有給休暇管理」の画面、取った日は勤怠の画面の区分で入れる（くわしくは utils/specialLeave.ts）。
 * いちばん上で、年次有給休暇の付与日の決まり（入社日ごとか、毎年◯月◯日にそろえるか）も決める（utils/annualLeaveGrant.ts）。
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, PlusCircle, Trash2, X } from "lucide-react";
import { useToast } from "../../../components/Toast";
import { useMessageDialog } from "../../../components/MessageDialog";
import { writeLog } from "../../../utils/logUtils";
import {
  LEAVE_TYPE_TEMPLATES, describeExpiryRule, describeGrantRule, isValidLeaveDays, leaveTypeToRow, loadLeaveTypes, parseExpiryRule, parseGrantRule,
  type ExpiryRule, type GrantRule, type LeaveType,
} from "../../../utils/specialLeave";
import { addBoxStyle, branchCardStyle, editBtnStyle, inputStyle, miniLabelStyle, tabContentStyle } from "../CompanyManager.styles";
import { describeAnnualLeaveRule, parseAnnualLeaveRule, stringifyAnnualLeaveRule, type AnnualLeaveRule } from "../../../utils/annualLeaveGrant";

interface Props {
  db: Database;
}

interface FormState {
  name: string;
  paid: boolean;
  trackBalance: boolean;
  allowHalf: boolean;
  allowHourly: boolean;
  useGrantRule: boolean;
  grantMonth: string;
  grantDay: string;
  grantDays: string;
  expiryMode: "months" | "date";
  expiryMonths: string;
  expiryMonth: string;
  expiryDay: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  paid: true,
  trackBalance: true,
  allowHalf: false,
  allowHourly: false,
  useGrantRule: false,
  grantMonth: "7",
  grantDay: "1",
  grantDays: "3",
  expiryMode: "months",
  expiryMonths: "12",
  expiryMonth: "9",
  expiryDay: "30",
  active: true,
};

const formOf = (t: LeaveType): FormState => ({
  name: t.name,
  paid: t.paid,
  trackBalance: t.trackBalance,
  allowHalf: t.allowHalf,
  allowHourly: t.allowHourly,
  useGrantRule: !!t.grantRule,
  grantMonth: String(t.grantRule?.month ?? 7),
  grantDay: String(t.grantRule?.day ?? 1),
  grantDays: String(t.grantRule?.days ?? 3),
  expiryMode: t.expiryRule.mode,
  expiryMonths: String(t.expiryRule.mode === "months" ? t.expiryRule.months : 12),
  expiryMonth: String(t.expiryRule.mode === "date" ? t.expiryRule.month : 9),
  expiryDay: String(t.expiryRule.mode === "date" ? t.expiryRule.day : 30),
  active: t.active,
});

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function LeaveTypeTab({ db }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTypes(await loadLeaveTypes(db));
    } catch (e) {
      console.error(e);
      dialog.error(`休暇の種類を読み込めませんでした。\n${e}`);
    }
  }, [db, dialog]);

  useEffect(() => { reload(); }, [reload]);

  // 年次有給休暇の付与日の決まり（company.annual_leave_rule）
  const [annualRule, setAnnualRule] = useState<AnnualLeaveRule>({ mode: "hire" });
  const [savedAnnualRule, setSavedAnnualRule] = useState<string>("");
  useEffect(() => {
    (async () => {
      try {
        const rows = (await db.select("SELECT annual_leave_rule FROM company WHERE id = 1")) as { annual_leave_rule?: string | null }[];
        const rule = parseAnnualLeaveRule(rows?.[0]?.annual_leave_rule);
        setAnnualRule(rule);
        setSavedAnnualRule(stringifyAnnualLeaveRule(rule));
      } catch (e) {
        console.error("年次有給休暇の付与日の決まりの読み込みエラー:", e);
      }
    })();
  }, [db]);
  const saveAnnualRule = async () => {
    try {
      const value = stringifyAnnualLeaveRule(annualRule);
      await db.execute("UPDATE company SET annual_leave_rule = ? WHERE id = 1", [value]);
      await writeLog(db, "INFO", "attendance", `年次有給休暇の付与日の決まりを「${describeAnnualLeaveRule(annualRule)}」にしました`);
      setSavedAnnualRule(value);
      toast.success("年次有給休暇の付与日の決まりを保存しました");
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const save = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) return dialog.warning("休暇の名前を入れてください（例：夏季休暇）。");
    if (name.length > 30) return dialog.warning("休暇の名前は30文字までにしてください。");
    if (["年次有給休暇", "有給休暇", "法定有給"].includes(name)) {
      return dialog.warning("年次有給休暇は、ここで作らずに「有給休暇管理」の画面で付与してください。");
    }
    if (types.some((t) => t.id !== editingId && t.name === name)) return dialog.warning(`「${name}」はもうあります。ほかの名前にしてください。`);

    let grantRule: GrantRule | null = null;
    if (form.trackBalance && form.useGrantRule) {
      grantRule = parseGrantRule(JSON.stringify({ month: Number(form.grantMonth), day: Number(form.grantDay), days: Number(form.grantDays) }));
      if (!grantRule) {
        if (!isValidLeaveDays(form.grantDays)) return dialog.warning("付与する日数は、0.5日きざみの、0より大きい数で入れてください。");
        return dialog.warning(`${form.grantMonth}月${form.grantDay}日はありません。付与する日を直してください。`);
      }
    }
    const rawExpiry = form.expiryMode === "months"
      ? { mode: "months", months: Number(form.expiryMonths) }
      : { mode: "date", month: Number(form.expiryMonth), day: Number(form.expiryDay) };
    const expiryRule: ExpiryRule = parseExpiryRule(JSON.stringify(rawExpiry));
    if (JSON.stringify(expiryRule) !== JSON.stringify(rawExpiry)) {
      return dialog.warning(form.expiryMode === "months"
        ? "有効期限の月数は、1から120までの数で入れてください。"
        : `${form.expiryMonth}月${form.expiryDay}日はありません。有効期限を直してください。`);
    }

    const current = types.find((t) => t.id === editingId);
    const row = leaveTypeToRow({
      name,
      paid: form.paid,
      trackBalance: form.trackBalance,
      allowHalf: form.allowHalf,
      allowHourly: form.allowHourly,
      grantRule,
      expiryRule,
      active: editingId === null ? true : form.active,
      sortOrder: current ? current.sortOrder : types.reduce((max, t) => Math.max(max, t.sortOrder + 1), 0),
    });
    setSaving(true);
    try {
      if (editingId === null) {
        await db.execute(
          "INSERT INTO leave_types (name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [row.name, row.is_paid, row.track_balance, row.allow_half, row.allow_hourly, row.grant_rule, row.expiry_rule, row.is_active, row.sort_order],
        );
        await writeLog(db, "INFO", "attendance", `休暇の種類「${name}」を作りました`);
        toast.success(`「${name}」を作りました`);
      } else {
        await db.execute(
          "UPDATE leave_types SET name = ?, is_paid = ?, track_balance = ?, allow_half = ?, allow_hourly = ?, grant_rule = ?, expiry_rule = ?, is_active = ? WHERE id = ?",
          [row.name, row.is_paid, row.track_balance, row.allow_half, row.allow_hourly, row.grant_rule, row.expiry_rule, row.is_active, editingId],
        );
        await writeLog(db, "INFO", "attendance", `休暇の種類「${current?.name ?? name}」を直しました${current && current.name !== name ? `（名前を「${name}」に）` : ""}`);
        toast.success(`「${name}」を直しました`);
      }
      resetForm();
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`休暇の種類を保存できませんでした。\n${e}`);
    } finally {
      setSaving(false);
    }
  };

  // 見本（子の看護等休暇・介護休暇）のうち、まだない名前のものを作る
  const missingTemplates = LEAVE_TYPE_TEMPLATES.filter((tpl) => !types.some((t) => t.name === tpl.name));
  const addTemplates = async () => {
    if (saving || missingTemplates.length === 0) return;
    setSaving(true);
    try {
      let order = types.reduce((max, t) => Math.max(max, t.sortOrder + 1), 0);
      for (const tpl of missingTemplates) {
        const row = leaveTypeToRow({ ...tpl, active: true, sortOrder: order++ });
        await db.execute(
          "INSERT INTO leave_types (name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [row.name, row.is_paid, row.track_balance, row.allow_half, row.allow_hourly, row.grant_rule, row.expiry_rule, row.is_active, row.sort_order],
        );
      }
      const names = missingTemplates.map((t) => `「${t.name}」`).join("・");
      await writeLog(db, "INFO", "attendance", `休暇の種類 ${names} を見本から作りました`);
      toast.success(`${names}を作りました`);
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`休暇の種類を作れませんでした。\n${e}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: LeaveType) => {
    try {
      const used = (await db.select(
        `SELECT (SELECT COUNT(*) FROM attendance WHERE leave_type_id = ?) AS days,
                (SELECT COUNT(*) FROM special_leave_grants WHERE leave_type_id = ?) AS grants`,
        [t.id, t.id],
      )) as { days: number; grants: number }[];
      const days = Number(used?.[0]?.days) || 0;
      const grants = Number(used?.[0]?.grants) || 0;
      if (days > 0 || grants > 0) {
        return dialog.warning(
          `「${t.name}」は、勤怠（${days}日）か付与（${grants}件）で使っているので、消せません。\n` +
          "これからは使わないときは、「直す」で「使う」の印を外してください（勤怠で選べなくなり、前の記録はそのまま残ります）。");
      }
      const ok = await ask(`休暇の種類「${t.name}」を消しますか？`, { title: "休暇の種類を消す", kind: "warning", okLabel: "消す", cancelLabel: "やめる" });
      if (!ok) return;
      await db.execute("DELETE FROM leave_types WHERE id = ?", [t.id]);
      await writeLog(db, "INFO", "attendance", `休暇の種類「${t.name}」を消しました`);
      toast.success(`「${t.name}」を消しました`);
      if (editingId === t.id) resetForm();
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`休暇の種類を消せませんでした。\n${e}`);
    }
  };

  return (
    <section style={tabContentStyle}>
      {/* 年次有給休暇の付与日（労働基準法39条。日数は条文の表。付与日をそろえるのは平成6年1月4日 基発1号の斉一的取扱い） */}
      <div style={{ ...noteStyle, backgroundColor: "#f0fdf4", borderColor: "#c6f6d5", marginBottom: "16px" }}>
        <div style={{ fontWeight: "bold", color: "#22543d", marginBottom: "6px" }}>年次有給休暇の付与日</div>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input type="radio" checked={annualRule.mode === "hire"} onChange={() => setAnnualRule({ mode: "hire" })} />
          入社日ごと（入社6か月後、その後1年ごと。法定どおり）
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
          <input type="radio" checked={annualRule.mode === "unified"}
            onChange={() => setAnnualRule({ mode: "unified", month: 4, day: 1, first: "sixMonths" })} />
          会社で決めた日にそろえる：毎年
          <select style={smallSelectStyle} disabled={annualRule.mode !== "unified"}
            value={annualRule.mode === "unified" ? annualRule.month : 4}
            onChange={(e) => annualRule.mode === "unified" && setAnnualRule({ ...annualRule, month: Number(e.target.value) })}>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>月
          <select style={smallSelectStyle} disabled={annualRule.mode !== "unified"}
            value={annualRule.mode === "unified" ? annualRule.day : 1}
            onChange={(e) => annualRule.mode === "unified" && setAnnualRule({ ...annualRule, day: Number(e.target.value) })}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>日
        </label>
        {annualRule.mode === "unified" && (
          <div style={{ marginLeft: "22px", marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="radio" checked={annualRule.first === "sixMonths"} onChange={() => setAnnualRule({ ...annualRule, first: "sixMonths" })} />
              初回は入社6か月後、2回目から決めた日（2回目は前倒しで、次の段の日数）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="radio" checked={annualRule.first === "unifiedFirst"} onChange={() => setAnnualRule({ ...annualRule, first: "unifiedFirst" })} />
              入社6か月後より先に決めた日が来れば、その日に初回（来なければ6か月後）。その後は決めた日ごと
            </label>
          </div>
        )}
        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px", lineHeight: 1.6 }}>
          付与の日が来たら「有給休暇管理」の画面で、日数（労働基準法39条の表。パートなどは比例付与の表）と出勤率（8割以上）と一緒に知らせます。
          そろえるときも、法定の基準日（入社6か月後・その後1年ごと）より遅くはしません（前倒しにします）。前倒しで短くなった期間は、8割の出勤率では全部出勤したものとみなします
          （平成6年1月4日 基発1号。次の年からも、同じかそれ以上前倒しにします）。年5日の取得は、人ごとに付与日から1年で確かめます。
        </div>
        <button onClick={saveAnnualRule} disabled={stringifyAnnualLeaveRule(annualRule) === savedAnnualRule}
          style={{ marginTop: "8px", padding: "6px 16px", borderRadius: "6px", border: "none", fontWeight: "bold", cursor: "pointer", color: "white",
            backgroundColor: stringifyAnnualLeaveRule(annualRule) === savedAnnualRule ? "#cbd5e1" : "#38a169" }}>
          保存する
        </button>
      </div>

      <div style={noteStyle}>
        法定の年次有給休暇とは別の、会社が就業規則で決める休暇（夏季休暇・慶弔休暇・リフレッシュ休暇など）の種類を作ります。
        付与と残りは「有給休暇管理」の画面で、取った日は勤怠の画面の区分で入れます。
        <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
          <li>年次有給休暇の年5日の取得義務には数えません（特別休暇は、会社が時季を指定する年5日の対象になりません）。</li>
          <li>会社が一斉に休む日（夏季休業など）を就業規則で「休日」にしているときは、ここではなく「会社カレンダー」で休日にしてください（1年の所定労働日数が減ります）。</li>
          <li>有給・無給を変えても、確定した勤怠の日は変わりません（確定し直すと、新しい設定で計算します）。</li>
        </ul>
        {missingTemplates.length > 0 && (
          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #e2e8f0" }}>
            <button onClick={addTemplates} disabled={saving}
              style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid #3182ce", backgroundColor: "white", color: "#3182ce", fontWeight: "bold", cursor: "pointer" }}>
              見本から作る：{missingTemplates.map((t) => t.name).join("・")}
            </button>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", lineHeight: 1.6 }}>
              育児・介護休業法の休暇です。見本は、無給・毎年4月1日に5日・3月31日まで（会社が1年を決めていないときの1年）・時間単位でも取れる、です（作ったあとで直せます）。
              対象の子・家族が2人以上の人は10日なので、付与するときに日数を直してください。対象の子・家族がいない人には「付与しない」にします。
              有給にするか無給にするかは、会社の規定で決めます。
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "25px", marginTop: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {types.length === 0 && (
            <div style={{ ...branchCardStyle, color: "#94a3b8", justifyContent: "center" }}>
              休暇の種類はまだありません。右の欄から作ってください。
            </div>
          )}
          {types.map((t) => (
            <div key={t.id} style={{
              ...branchCardStyle,
              alignItems: "flex-start",
              borderLeft: `5px solid ${t.active ? (t.paid ? "#38a169" : "#dd6b20") : "#cbd5e1"}`,
              backgroundColor: editingId === t.id ? "#fff9db" : t.active ? "white" : "#f8fafc",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                  <strong style={{ color: t.active ? "#2c3e50" : "#94a3b8" }}>{t.name}</strong>
                  <span style={badgeStyle(t.paid ? "#38a169" : "#dd6b20")}>{t.paid ? "有給" : "無給"}</span>
                  {t.allowHalf && <span style={badgeStyle("#3182ce")}>半日も可</span>}
                  {t.allowHourly && <span style={badgeStyle("#6b46c1")}>時間単位も可</span>}
                  {!t.trackBalance && <span style={badgeStyle("#64748b")}>残りを数えない</span>}
                  {!t.active && <span style={badgeStyle("#94a3b8")}>使わない</span>}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.7 }}>
                  {t.trackBalance ? (
                    <>
                      <div>発生：{describeGrantRule(t.grantRule)}</div>
                      <div>消滅：{describeExpiryRule(t.expiryRule)}</div>
                    </>
                  ) : (
                    <div>そのつど取る休暇（付与と残りは数えません）</div>
                  )}
                  <div>給与：{t.paid ? "月給の人は引かず、日給・時給の人には所定労働時間の分を払います" : "月給の人は欠勤と同じ計算で引き、日給・時給の人には払いません"}</div>
                </div>
              </div>
              {editingId === null && (
                <div style={{ display: "flex", gap: "10px" }}>
                  <button style={editBtnStyle} onClick={() => { setEditingId(t.id); setForm(formOf(t)); }}>
                    <Pencil size={13} /> 直す
                  </button>
                  <button style={{ ...editBtnStyle, color: "#e74c3c" }} onClick={() => remove(t)}>
                    <Trash2 size={13} /> 消す
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={addBoxStyle}>
          <h4 style={{ margin: "0 0 12px", color: "#2c3e50", display: "flex", alignItems: "center", gap: "6px" }}>
            {editingId === null ? <><PlusCircle size={16} /> 休暇の種類を作る</> : <><Pencil size={16} /> 休暇の種類を直す</>}
          </h4>

          <label style={miniLabelStyle}>名前</label>
          <input style={{ ...inputStyle, marginBottom: "12px" }} value={form.name} maxLength={30}
            placeholder="例：夏季休暇" onChange={(e) => set("name", e.target.value)} />

          <label style={miniLabelStyle}>給与</label>
          <div style={{ display: "flex", gap: "14px", marginBottom: "4px", fontSize: "13px" }}>
            <label><input type="radio" checked={form.paid} onChange={() => set("paid", true)} /> 有給</label>
            <label><input type="radio" checked={!form.paid} onChange={() => set("paid", false)} /> 無給</label>
          </div>
          <p style={hintStyle}>
            {form.paid
              ? "有給：月給の人は引かず、日給・時給の人には所定労働時間の分を払います（年次有給休暇と同じ）。"
              : "無給：月給の人は、給与規定グループの欠勤控除と同じ計算で引きます（明細では欠勤と分けて出します）。日給・時給の人には払いません。"}
          </p>

          <label style={checkLabelStyle}>
            <input type="checkbox" checked={form.allowHalf} onChange={(e) => set("allowHalf", e.target.checked)} /> 半日でも取れる
          </label>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={form.allowHourly} onChange={(e) => set("allowHourly", e.target.checked)} /> 時間単位でも取れる（1時間単位）
          </label>
          {form.allowHourly && (
            <p style={hintStyle}>
              勤怠の「時間休」で、休暇の種類と時間を入れます。1日分は、1日の所定労働時間（1時間に満たない端数は切り上げ）として数えます。
              子の看護等休暇・介護休暇は、1時間単位でも取れるようにしなければなりません（育児・介護休業法施行規則34条・40条）。
            </p>
          )}
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={form.trackBalance} onChange={(e) => set("trackBalance", e.target.checked)} /> 残りを数える（付与した日数から引く）
          </label>
          <p style={hintStyle}>慶弔休暇のように、そのつど取る休暇は外してください（付与はいらず、取った日だけを出します）。</p>

          {form.trackBalance && (
            <>
              <div style={sectionStyle}>発生</div>
              <label style={checkLabelStyle}>
                <input type="checkbox" checked={form.useGrantRule} onChange={(e) => set("useGrantRule", e.target.checked)} /> 毎年決まった日に付与する
              </label>
              {form.useGrantRule ? (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", flexWrap: "wrap" }}>
                  毎年
                  <select style={smallSelectStyle} value={form.grantMonth} onChange={(e) => set("grantMonth", e.target.value)}>
                    {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>月
                  <select style={smallSelectStyle} value={form.grantDay} onChange={(e) => set("grantDay", e.target.value)}>
                    {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>日に
                  <input type="number" min="0.5" step="0.5" style={{ ...inputStyle, width: "64px", padding: "6px" }}
                    value={form.grantDays} onChange={(e) => set("grantDays", e.target.value)} />日
                </div>
              ) : (
                <p style={hintStyle}>付与する日が決まっていない休暇は、「有給休暇管理」の画面で人ごとに付与します。</p>
              )}
              {form.useGrantRule && (
                <p style={hintStyle}>その日が来たら「有給休暇管理」の画面で知らせ、ボタンで、その日に在籍している人に付与します（人ごとに日数を変えたり、付与しないこともできます）。</p>
              )}

              <div style={sectionStyle}>消滅（有効期限）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input type="radio" checked={form.expiryMode === "months"} onChange={() => set("expiryMode", "months")} />
                  付与日から
                  <input type="number" min="1" max="120" step="1" style={{ ...inputStyle, width: "64px", padding: "6px" }}
                    value={form.expiryMonths} disabled={form.expiryMode !== "months"} onChange={(e) => set("expiryMonths", e.target.value)} />
                  か月
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input type="radio" checked={form.expiryMode === "date"} onChange={() => set("expiryMode", "date")} />
                  <select style={smallSelectStyle} value={form.expiryMonth} disabled={form.expiryMode !== "date"} onChange={(e) => set("expiryMonth", e.target.value)}>
                    {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>月
                  <select style={smallSelectStyle} value={form.expiryDay} disabled={form.expiryMode !== "date"} onChange={(e) => set("expiryDay", e.target.value)}>
                    {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>日まで
                </label>
              </div>
              <p style={hintStyle}>有効期限が過ぎた残りは、自動で「期限で消えた」にします。「◯月◯日まで」は、付与日のあとで最初のその日までです。</p>
            </>
          )}

          {editingId !== null && (
            <label style={{ ...checkLabelStyle, marginTop: "10px" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> 使う（外すと勤怠で選べなくなります。前の記録はそのまま）
            </label>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
            <button onClick={save} disabled={saving} style={{ flex: 1, backgroundColor: saving ? "#9ae6b4" : "#2ecc71", color: "white", border: "none", padding: "10px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
              {editingId === null ? "作る" : "保存する"}
            </button>
            {editingId !== null && (
              <button onClick={resetForm} style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white", cursor: "pointer" }}>
                <X size={14} /> やめる
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const noteStyle: CSSProperties = {
  backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#475569", lineHeight: 1.7,
};
const hintStyle: CSSProperties = { fontSize: "11px", color: "#64748b", margin: "4px 0 10px", lineHeight: 1.6 };
const checkLabelStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", marginTop: "6px", cursor: "pointer" };
const sectionStyle: CSSProperties = { fontSize: "12px", fontWeight: "bold", color: "#475569", margin: "14px 0 2px", borderTop: "1px solid #e2e8f0", paddingTop: "10px" };
const smallSelectStyle: CSSProperties = { padding: "5px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "13px" };
const badgeStyle = (color: string): CSSProperties => ({
  fontSize: "11px", fontWeight: "bold", color, border: `1px solid ${color}`, borderRadius: "10px", padding: "0 8px",
});
