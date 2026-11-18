/**
 * 「振込データ」の画面：確定した給与・賞与の差引支給額を、全銀協規定形式（給与振込・賞与振込）のファイルに書き出す
 * 一般的な給与ソフトと同じ形（クラウド型の給与ソフトの「支払業務」の FBデータ：対象と支給日・振込日・支払口座・
 * 振込方法（給与・賞与）・レコード長（120。改行なし）を選んで出す）。
 * ・給与は、支給年月と給与規定グループを選ぶ（振込日の初めの値は、その月のグループの支払日）。賞与は、賞与を選ぶ（初めは支給日）
 * ・振込先は、従業員の画面の「振込先口座」（固定額の口座と残りの口座に分ける）。口座がない人は現金で払うので入れない
 * ・確定した給与・賞与だけを入れる（差引支給額は確定した結果から読む）
 * 計算は utils/zengin.ts（レコードの形は constants/zengin.ts。銀行の仕様書からスクリプトで作ったもの）
 * ・振込一覧表（振込先・振込額・件数・合計）を印刷できる。口座がない（現金で払う）人の金種表（お札と硬貨の枚数。utils/kinshu.ts）も出す
 * ・退職金（退職金の画面で保存したもの）は、支払う日を選び、支払金額から所得税・住民税を引いた額を振り込む。銀行の仕様書の種別コードは
 *   給与振込（11）と賞与振込（12）だけなので、どちらで送るかを選ぶ（銀行との契約で確かめる）。死亡退職の退職金は受給者（相続人など）の
 *   口座に振り込むので入れない
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { writeLog } from "../../utils/logUtils";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { loadSourceAccounts, loadStaffBankAccounts, type SourceAccountRow } from "../../utils/bankAccounts";
import { salaryPayDate } from "../../utils/flatTaxReduction";
import { KINSHU, kinshuLabel, kinshuOf, kinshuTotal } from "../../utils/kinshu";
import { parseRetirementInput } from "../../utils/retirementIncome";
import { printStyle } from "./reportStyles";
import {
  ACCOUNT_TYPE_LABELS, bankAccountProblems, buildZenginRecords, encodeZengin, sourceAccountProblems, splitTransfer,
  type StaffAccount, type TransferLine,
} from "../../utils/zengin";

interface Props {
  db: Database;
  staffList: any[];
}

type Kind = "salary" | "bonus" | "retirement";
interface Group { id: number; name: string; payment_day: number | null }
interface Retirement { staffId: string; payDate: string; net: number; death: boolean }
interface Bonus { id: number; name: string; target_year: number; target_month: number; payment_date: string | null; is_closed: number }

/** 1人分（振込の行・口座がない・分けられない） */
interface StaffRow {
  staffId: string;
  name: string;
  netPay: number;
  lines: { account: StaffAccount; amount: number }[];
  /** 振り込まない理由（口座がない＝現金・差引支給額が0円以下）。振り込む人は null */
  skip: string | null;
  /** 直すところ（口座の入れ方の間違い・分けられない）。直すまで書き出せない */
  problems: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const today = new Date();

export default function TransferDataManager({ db, staffList }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [kind, setKind] = useState<Kind>("salary");
  /** 退職金：支払う日と、送る種別（給与振込・賞与振込） */
  const [retireDate, setRetireDate] = useState("");
  const [retireCode, setRetireCode] = useState<"salary" | "bonus" | "">("");
  const [retirements, setRetirements] = useState<Retirement[]>([]);
  const [payYear, setPayYear] = useState(today.getFullYear());
  const [payMonth, setPayMonth] = useState(today.getMonth() + 1);
  const [groupId, setGroupId] = useState(1);
  const [bonusId, setBonusId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [transferDate, setTransferDate] = useState("");
  const [newline, setNewline] = useState(false);
  const [showText, setShowText] = useState(false);
  const [printTarget, setPrintTarget] = useState<"list" | "kinshu" | null>(null);

  const [sources, setSources] = useState<SourceAccountRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [accounts, setAccounts] = useState<Map<string, StaffAccount[]>>(new Map());
  /** 確定した差引支給額（人ごと。読み込み中は null） */
  const [netPays, setNetPays] = useState<Map<string, number> | null>(null);

  // 口座・給与規定グループ・賞与を読む
  const loadBase = useCallback(async () => {
    try {
      const [src, grp, bns, acc, ret] = await Promise.all([
        loadSourceAccounts(db),
        db.select("SELECT id, name, payment_day FROM payroll_groups ORDER BY id") as Promise<Group[]>,
        db.select("SELECT id, name, target_year, target_month, payment_date, is_closed FROM bonus_settings ORDER BY target_year DESC, target_month DESC, id DESC") as Promise<Bonus[]>,
        loadStaffBankAccounts(db),
        db.select("SELECT staff_id, pay_date, amount, income_tax, city_tax, pref_tax, detail FROM retirement_allowances ORDER BY pay_date DESC, id")
          .catch(() => []) as Promise<any[]>,
      ]);
      const rets: Retirement[] = (ret ?? []).map((r) => ({
        staffId: String(r.staff_id), payDate: String(r.pay_date ?? ""),
        net: (Number(r.amount) || 0) - (Number(r.income_tax) || 0) - (Number(r.city_tax) || 0) - (Number(r.pref_tax) || 0),
        death: parseRetirementInput(r.detail).death,
      }));
      setRetirements(rets);
      setRetireDate((d) => d || rets.find((r) => !r.death && r.payDate)?.payDate || "");
      const active = src.filter((s) => s.active);
      setSources(active);
      setSourceId((id) => (id !== null && active.some((s) => s.id === id) ? id : active[0]?.id ?? null));
      setGroups(grp ?? []);
      setGroupId((id) => ((grp ?? []).some((g) => Number(g.id) === id) ? id : Number(grp?.[0]?.id ?? 1)));
      setBonuses(bns ?? []);
      setBonusId((id) => (id !== null ? id : Number(bns?.[0]?.id ?? 0) || null));
      setAccounts(acc);
    } catch (e) {
      console.error(e);
      dialog.error(`振込データに使うものを読み込めませんでした。\n${e}`);
    }
  }, [db]);
  useEffect(() => { loadBase(); }, [loadBase]);

  const group = groups.find((g) => Number(g.id) === groupId) ?? null;
  const bonus = bonuses.find((b) => Number(b.id) === bonusId) ?? null;

  // 振込日の初めの値：給与はその月のグループの支払日、賞与は支給日
  useEffect(() => {
    if (kind === "salary") setTransferDate(salaryPayDate(payYear, payMonth, group?.payment_day ?? 25));
    else if (kind === "retirement") setTransferDate(retireDate);
    else setTransferDate(bonus?.payment_date || (bonus ? `${bonus.target_year}-${pad(bonus.target_month)}-01` : ""));
  }, [kind, payYear, payMonth, group?.payment_day, bonusId, bonus?.payment_date, retireDate]);

  // 確定した差引支給額を読む
  useEffect(() => {
    let cancelled = false;
    setNetPays(null);
    if (kind === "retirement") {
      const map = new Map<string, number>();
      for (const r of retirements.filter((x) => x.payDate === retireDate && !x.death)) map.set(r.staffId, (map.get(r.staffId) ?? 0) + r.net);
      setNetPays(map);
      return;
    }
    (async () => {
      try {
        const rows = (kind === "salary"
          ? await db.select("SELECT staff_id, net_pay FROM salary_results WHERE CAST(target_year AS INTEGER) = ? AND CAST(target_month AS INTEGER) = ?", [payYear, payMonth])
          : bonusId === null ? [] : await db.select("SELECT staff_id, net_pay FROM bonus_results WHERE bonus_setting_id = ?", [bonusId])) as { staff_id: string; net_pay: number }[];
        if (!cancelled) setNetPays(new Map((rows ?? []).map((r) => [String(r.staff_id), Number(r.net_pay) || 0])));
      } catch (e) {
        console.error(e);
        if (!cancelled) setNetPays(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [db, kind, payYear, payMonth, bonusId, retirements, retireDate]);

  const staffById = useMemo(() => new Map(staffList.map((s) => [String(s.id), s])), [staffList]);

  // 1人ずつ：振込の行・現金・直すところ
  const rows = useMemo((): StaffRow[] => {
    if (!netPays) return [];
    const list: StaffRow[] = [];
    for (const [staffId, netPay] of netPays) {
      const staff = staffById.get(staffId);
      if (kind === "salary" && Number(staff?.payroll_group_id || 1) !== groupId) continue;
      const accs = accounts.get(staffId) ?? [];
      const row: StaffRow = { staffId, name: String(staff?.name ?? staffId), netPay, lines: [], skip: null, problems: [] };
      if (netPay <= 0) row.skip = "差引支給額が0円以下";
      else if (accs.length === 0) row.skip = "口座がない（現金で払う）";
      else {
        row.problems = accs.flatMap((a, i) => bankAccountProblems(a, a.holderName).map((p) => `口座${i + 1}：${p}`));
        const split = splitTransfer(netPay, accs);
        if (split.error) row.problems.push(split.error);
        else row.lines = split.lines;
      }
      list.push(row);
    }
    return list.sort((a, b) => a.staffId.localeCompare(b.staffId, "ja", { numeric: true }));
  }, [netPays, accounts, staffById, kind, groupId]);

  // まだ確定していない人（給与：そのグループの在籍している人で、確定した給与がない人）
  const unconfirmed = useMemo(() => {
    if (kind !== "salary" || !netPays) return [];
    return staffList
      .filter((s) => Number(s.payroll_group_id || 1) === groupId && (s.status || "active") !== "retired" && !netPays.has(String(s.id)))
      .map((s) => String(s.name));
  }, [kind, netPays, staffList, groupId]);

  const source = sources.find((s) => s.id === sourceId) ?? null;
  const sourceProblems = source ? sourceAccountProblems(source) : ["振込元口座を、会社設定の「振込元口座」で足してください"];
  const transferLines: TransferLine[] = rows.flatMap((r) => r.lines.map((l) => ({ account: l.account, amount: l.amount, staffCode: r.staffId })));
  const total = transferLines.reduce((sum, l) => sum + l.amount, 0);
  const withProblems = rows.filter((r) => r.problems.length > 0);
  const weekday = transferDate ? new Date(`${transferDate}T00:00:00`).getDay() : -1;

  /** 銀行に送る種別（退職金は、選んだ給与振込か賞与振込） */
  const zenginKind = kind === "retirement" ? retireCode || null : kind;
  const records = useMemo(() => {
    if (!source || sourceProblems.length > 0 || !transferDate || transferLines.length === 0 || withProblems.length > 0 || !zenginKind) return null;
    try {
      return buildZenginRecords({ kind: zenginKind, source, transferDate, lines: transferLines });
    } catch (e) {
      return null;
    }
  }, [source, sourceProblems.length, transferDate, transferLines, withProblems.length, zenginKind]);

  const blocked = [
    ...(netPays === null ? ["確定した給与・賞与を読み込んでいます"] : []),
    ...sourceProblems.map((p) => `振込元口座：${p}`),
    ...(!transferDate ? ["振込日を入れてください"] : []),
    ...(netPays !== null && transferLines.length === 0 ? ["振り込む人がいません（確定した給与・賞与と、従業員の振込先口座を確かめてください）"] : []),
    ...(withProblems.length > 0 ? [`口座を直す人がいます（${withProblems.map((r) => r.name).join("・")}）`] : []),
    ...(kind === "retirement" && !retireCode ? ["退職金を送る種別（給与振込か賞与振込）を選んでください"] : []),
  ];
  const retireDates = [...new Set(retirements.filter((r) => !r.death && r.payDate).map((r) => r.payDate))];
  const deathOnDate = kind === "retirement" ? retirements.filter((r) => r.death && r.payDate === retireDate) : [];

  // 印刷する部分を決めてから印刷し、終わったら戻す
  useEffect(() => {
    if (!printTarget) return;
    const done = () => { setPrintTarget(null); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printTarget]);

  /** 口座がない（現金で払う）人と、その金種 */
  const cashRows = rows.filter((r) => r.skip === "口座がない（現金で払う）");
  const cashTotal = kinshuTotal(cashRows.map((r) => r.netPay));

  const targetLabel = kind === "salary" ? `${payYear}年${payMonth}月支給の給与（${group?.name ?? ""}）`
    : kind === "retirement" ? (retireDate ? `退職金（${retireDate}支払）` : "退職金")
    : bonus ? `${bonus.name}（${bonus.payment_date ?? ""}）` : "";
  const kindLabel = zenginKind === "salary" ? "給与振込" : zenginKind === "bonus" ? "賞与振込" : "";

  const exportFile = async () => {
    if (!records || blocked.length > 0) return dialog.warning(blocked.join("\n"));
    try {
      const bytes = encodeZengin(records, newline);
      const fileName = `${kind === "salary" ? "kyuyo" : kind === "bonus" ? "shoyo" : "taishoku"}_fb_${transferDate.replace(/-/g, "")}.txt`;
      const saved = await saveBinaryFile(bytes, fileName, { name: "振込データ", extensions: ["txt", "dat"] });
      if (!saved) return;
      // 口座番号はログに書かない
      await writeLog(db, "INFO", "salary", `振込データ（${kindLabel}・${targetLabel}・振込日 ${transferDate}・${transferLines.length}件・合計 ${total.toLocaleString()}円）を書き出しました（${saved.name}）`);
      toast.success(`振込データを保存しました（${saved.name}）`);
    } catch (e) {
      console.error(e);
      dialog.error(`振込データを書き出せませんでした。\n${e}`);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>振込データ（全銀協規定形式）</h3>
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 12 }}>
          確定した給与・賞与の差引支給額と、退職金の画面で保存した退職金の差引支給額を、銀行のインターネットバンキングなどに送る振込データ（給与振込・賞与振込）にします。
          振込先は従業員の画面の「振込先口座」、振込元は会社設定の「振込元口座」です。口座がない人は現金で払うので入れません。
          給与振込は、ふつう振込日の3営業日前までに銀行に送ります（銀行との契約を確かめてください）。
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={field}>
            <span style={label}>振り込むもの</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={input}>
              <option value="salary">給与（給与振込）</option>
              <option value="bonus">賞与（賞与振込）</option>
              <option value="retirement">退職金</option>
            </select>
          </label>
          {kind === "retirement" ? (
            <>
              <label style={field}>
                <span style={label}>退職金を支払う日</span>
                <select value={retireDate} onChange={(e) => setRetireDate(e.target.value)} style={input}>
                  {retireDates.length === 0 && <option value="">（退職金の画面で保存した退職金がありません）</option>}
                  {retireDates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label style={field}>
                <span style={label}>送る種別</span>
                <select value={retireCode} onChange={(e) => setRetireCode(e.target.value as "salary" | "bonus" | "")} style={input}>
                  <option value="">選んでください</option>
                  <option value="salary">給与振込（11）</option>
                  <option value="bonus">賞与振込（12）</option>
                </select>
              </label>
            </>
          ) : kind === "salary" ? (
            <>
              <label style={field}>
                <span style={label}>支給年月</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" value={payYear} onChange={(e) => setPayYear(Number(e.target.value) || payYear)} style={{ ...input, width: 80 }} />
                  <select value={payMonth} onChange={(e) => setPayMonth(Number(e.target.value))} style={{ ...input, width: 70 }}>
                    {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
                  </select>
                </div>
              </label>
              <label style={field}>
                <span style={label}>給与規定グループ</span>
                <select value={groupId} onChange={(e) => setGroupId(Number(e.target.value))} style={input}>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <label style={field}>
              <span style={label}>賞与</span>
              <select value={bonusId ?? ""} onChange={(e) => setBonusId(Number(e.target.value) || null)} style={input}>
                {bonuses.length === 0 && <option value="">（賞与がありません）</option>}
                {bonuses.map((b) => <option key={b.id} value={b.id}>{b.name}（{b.payment_date ?? `${b.target_year}年${b.target_month}月`}）{Number(b.is_closed) === 1 ? "" : "・未確定"}</option>)}
              </select>
            </label>
          )}
          <label style={field}>
            <span style={label}>振込日</span>
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} style={input} />
          </label>
          <label style={field}>
            <span style={label}>振込元口座</span>
            <select value={sourceId ?? ""} onChange={(e) => setSourceId(Number(e.target.value) || null)} style={input}>
              {sources.length === 0 && <option value="">（会社設定の「振込元口座」で足してください）</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label style={field}>
            <span style={label}>レコード長</span>
            <select value={newline ? "122" : "120"} onChange={(e) => setNewline(e.target.value === "122")} style={input}>
              <option value="120">120（改行なし）</option>
              <option value="122">改行あり（CR+LF）</option>
            </select>
          </label>
        </div>
        {weekday === 0 || weekday === 6 ? (
          <div style={warn}>⚠ 振込日が{weekday === 0 ? "日曜日" : "土曜日"}です。銀行の営業日にしてください。</div>
        ) : null}
        {kind === "bonus" && bonus && Number(bonus.is_closed) !== 1 && (
          <div style={warn}>⚠ この賞与はまだ確定していません。賞与の画面で確定してから書き出してください（確定した人だけを入れます）。</div>
        )}
        {kind === "retirement" && (
          <div style={{ ...warn, color: "#475569" }}>
            退職金の振込データの種別コードは、銀行の給与・賞与振込の仕様書に「11（給与振込）」と「12（賞与振込）」しかないので、どちらで送るかを選びます。
            退職金を給与・賞与振込で送れるかは、銀行との契約で確かめてください（送れないときは、銀行の画面の総合振込などで振り込みます）。
          </div>
        )}
        {deathOnDate.length > 0 && (
          <div style={warn}>⚠ 死亡退職の退職金（{deathOnDate.map((r) => staffById.get(r.staffId)?.name ?? r.staffId).join("・")}）は、受給者（相続人など）の口座に振り込むので、入れていません。</div>
        )}
        {unconfirmed.length > 0 && (
          <div style={warn}>⚠ 給与がまだ確定していない人がいます（入れていません）：{unconfirmed.join("・")}</div>
        )}
      </div>

      {printTarget && <style>{printStyle(printTarget === "kinshu" ? "transfer-kinshu-print" : "transfer-list-print", false)}</style>}
      <div style={card}>
        <div id="transfer-list-print">
        {printTarget === "list" && <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>振込一覧表</h2>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <b style={{ fontSize: 14 }}>{targetLabel}</b>
          <span style={{ fontSize: 13, color: "#475569" }}>振込 {transferLines.length}件・合計 {total.toLocaleString()}円</span>
          {transferDate && <span style={{ fontSize: 13, color: "#475569" }}>振込日 {transferDate}</span>}
          {source && (
            <span style={{ fontSize: 12, color: "#64748b" }}>
              振込元 {source.bankCode} {source.bankName}　{source.branchCode} {source.branchName}　{ACCOUNT_TYPE_LABELS[source.accountType]} {source.accountNumber}
            </span>
          )}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc" }}>
              {["社員番号", "名前", "差引支給額", "振込先", "振込額"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, color: "#94a3b8" }}>{netPays === null ? "読み込んでいます…" : kind === "retirement" ? "この日に支払う退職金がありません" : "確定した給与・賞与がありません"}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.staffId}>
                <td style={td}>{r.staffId}</td>
                <td style={td}>{r.name}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.netPay.toLocaleString()}円</td>
                <td style={td}>
                  {r.skip && <span style={{ color: "#94a3b8" }}>{r.skip}</span>}
                  {r.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>⚠ {p}</div>)}
                  {r.lines.map((l, i) => (
                    <div key={i}>
                      {l.account.bankCode} {l.account.bankName}　{l.account.branchCode} {l.account.branchName}　{ACCOUNT_TYPE_LABELS[l.account.accountType]} {l.account.accountNumber}
                      <span style={{ color: "#64748b" }}>（{l.account.holderName}）</span>
                    </div>
                  ))}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  {r.lines.map((l, i) => <div key={i}>{l.amount.toLocaleString()}円</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {blocked.length > 0 && (
          <div style={{ ...warn, color: "#b91c1c" }}>{blocked.map((b) => <div key={b}>⚠ {b}</div>)}</div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button onClick={exportFile} disabled={blocked.length > 0}
            style={{ ...button, backgroundColor: blocked.length > 0 ? "#cbd5e1" : "#16a085", cursor: blocked.length > 0 ? "not-allowed" : "pointer" }}>
            振込データを書き出す
          </button>
          <button onClick={() => setPrintTarget("list")} disabled={rows.length === 0}
            style={{ ...button, backgroundColor: rows.length === 0 ? "#cbd5e1" : "#2563eb", cursor: rows.length === 0 ? "not-allowed" : "pointer" }}>
            振込一覧表を印刷
          </button>
          {records && (
            <button onClick={() => setShowText(!showText)} style={{ ...button, backgroundColor: "white", color: "#475569", border: "1px solid #cbd5e1" }}>
              {showText ? "中身を隠す" : "中身を見る"}
            </button>
          )}
        </div>
        {showText && records && (
          <pre id="zengin-text" style={{ marginTop: 10, fontSize: 12, backgroundColor: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 6, overflowX: "auto" }}>
            {records.join("\n")}
          </pre>
        )}
      </div>

      {cashRows.length > 0 && (
        <div style={card}>
          <div id="transfer-kinshu-print">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>金種表（現金で払う人）</b>
              <span style={{ fontSize: 13, color: "#475569" }}>{targetLabel}　{cashRows.length}人・合計 {cashRows.reduce((t, r) => t + r.netPay, 0).toLocaleString()}円</span>
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>
              振込先口座がない人の差引支給額を、お札と硬貨の枚数に分けます（大きいお金から順に。2千円札は使いません）。合計の枚数は、銀行で両替するときに使います。
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc" }}>
                    {["社員番号", "名前", "支給額", ...KINSHU.map(kinshuLabel)].map((h) => <th key={h} style={{ ...th, whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cashRows.map((r) => (
                    <tr key={r.staffId}>
                      <td style={td}>{r.staffId}</td>
                      <td style={td}>{r.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{r.netPay.toLocaleString()}円</td>
                      {kinshuOf(r.netPay).map((n, i) => <td key={i} style={{ ...td, textAlign: "right" }}>{n || ""}</td>)}
                    </tr>
                  ))}
                  <tr style={{ fontWeight: "bold", backgroundColor: "#f8fafc" }}>
                    <td style={td} colSpan={2}>合計</td>
                    <td style={{ ...td, textAlign: "right" }}>{cashRows.reduce((t, r) => t + r.netPay, 0).toLocaleString()}円</td>
                    {cashTotal.map((n, i) => <td key={i} style={{ ...td, textAlign: "right" }}>{n || ""}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={() => setPrintTarget("kinshu")} style={{ ...button, backgroundColor: "#2563eb" }}>金種表を印刷</button>
          </div>
        </div>
      )}
    </div>
  );
}

const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: CSSProperties = { fontSize: 12, color: "#64748b" };
const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
const warn: CSSProperties = { marginTop: 10, fontSize: 12, color: "#b45309", lineHeight: 1.6 };
const th: CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #e2e8f0", fontSize: 12, color: "#64748b" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const button: CSSProperties = { padding: "10px 18px", borderRadius: 8, border: "none", color: "white", fontWeight: "bold", fontSize: 14 };
