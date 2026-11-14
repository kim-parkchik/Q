/**
 * 「振込元口座」タブ：給与・賞与を振り込む会社の口座（振込データ（全銀協規定形式）のヘッダーに書く。utils/zengin.ts）
 * 一般的な給与ソフトと同じ形（クラウド型の給与ソフトの「支払口座」：いくつでも登録でき、振込データを作るときに選ぶ）。
 * 委託者コード（会社コード）と委託者名は、銀行と給与振込の契約をしたときに銀行から知らされたとおりに入れる
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { Pencil, PlusCircle, RotateCcw, X } from "lucide-react";
import { useToast } from "../../../components/Toast";
import { useMessageDialog } from "../../../components/MessageDialog";
import { writeLog } from "../../../utils/logUtils";
import { loadSourceAccounts, sourceAccountValues, type SourceAccountRow } from "../../../utils/bankAccounts";
import { ACCOUNT_TYPE_LABELS, sourceAccountProblems, toZenginText, type AccountType } from "../../../utils/zengin";
import { addBoxStyle, btnStyle, editBtnStyle, inputStyle, miniLabelStyle, tabContentStyle } from "../CompanyManager.styles";

interface Props {
  db: Database;
}

interface FormState {
  label: string;
  clientCode: string;
  clientName: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AccountType;
  accountNumber: string;
}

const EMPTY: FormState = { label: "", clientCode: "", clientName: "", bankCode: "", bankName: "", branchCode: "", branchName: "", accountType: "ordinary", accountNumber: "" };

export default function TransferSourceTab({ db }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [accounts, setAccounts] = useState<SourceAccountRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showInactive, setShowInactive] = useState(false);

  const reload = useCallback(async () => {
    try {
      setAccounts(await loadSourceAccounts(db));
    } catch (e) {
      console.error(e);
      dialog.error(`振込元口座を読み込めませんでした。\n${e}`);
    }
  }, [db]);
  useEffect(() => { reload(); }, [reload]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const reset = () => { setEditingId(null); setForm(EMPTY); };
  const startEdit = (a: SourceAccountRow) => {
    setEditingId(a.id);
    setForm({
      label: a.label, clientCode: a.clientCode, clientName: a.clientName, bankCode: a.bankCode, bankName: a.bankName,
      branchCode: a.branchCode, branchName: a.branchName, accountType: a.accountType, accountNumber: a.accountNumber,
    });
  };

  const save = async () => {
    const problems = sourceAccountProblems(form);
    if (problems.length > 0) return dialog.warning(problems.join("\n"));
    const label = form.label.trim() || `${toZenginText(form.bankName).text} ${toZenginText(form.branchName).text}`.trim();
    try {
      const values = sourceAccountValues({ ...form, label });
      if (editingId !== null) {
        await db.execute(
          `UPDATE transfer_source_accounts SET label = ?, client_code = ?, client_name = ?, bank_code = ?, bank_name = ?,
             branch_code = ?, branch_name = ?, account_type = ?, account_number = ? WHERE id = ?`,
          [...values, editingId],
        );
      } else {
        await db.execute(
          `INSERT INTO transfer_source_accounts (label, client_code, client_name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [...values, accounts.length],
        );
      }
      // 口座番号はログに書かない
      await writeLog(db, "INFO", "salary", `振込元口座「${label}」を${editingId !== null ? "直しました" : "足しました"}`);
      toast.success(editingId !== null ? `「${label}」を保存しました` : `「${label}」を足しました`);
      reset();
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  const toggleActive = async (a: SourceAccountRow) => {
    try {
      await db.execute("UPDATE transfer_source_accounts SET is_active = ? WHERE id = ?", [a.active ? 0 : 1, a.id]);
      await writeLog(db, "INFO", "salary", `振込元口座「${a.label}」を${a.active ? "やめました" : "戻しました"}`);
      toast.success(a.active ? `「${a.label}」をやめました` : `「${a.label}」を戻しました`);
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`変えられませんでした。\n${e}`);
    }
  };

  const active = accounts.filter((a) => a.active);
  const inactive = accounts.filter((a) => !a.active);
  const preview = (s: string) => toZenginText(s).text;

  return (
    <section style={tabContentStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "25px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={note}>
            給与・賞与を振り込む会社の口座です。「振込データ」の画面で選ぶと、全銀協規定形式（給与振込・賞与振込）のファイルの頭に書きます。
            委託者コード（会社コード）と委託者名は、銀行と給与振込の契約をしたときに銀行から知らされたとおりに入れてください。
            名前は半角カナにして保存します（ひらがな・全角カナで入れても変えます）。
          </div>
          {active.length === 0 && <div style={{ ...note, backgroundColor: "#fffbeb", color: "#92400e" }}>まだ振込元口座がありません。右から足してください。</div>}
          {active.map((a) => (
            <div key={a.id} style={card(editingId === a.id)}>
              <div style={{ flex: 1, fontSize: "13px", lineHeight: 1.6 }}>
                <div style={{ fontWeight: "bold", fontSize: "15px" }}>{a.label}</div>
                <div style={{ color: "#475569" }}>
                  {a.bankCode} {a.bankName}　{a.branchCode} {a.branchName}　{ACCOUNT_TYPE_LABELS[a.accountType]} {a.accountNumber}
                </div>
                <div style={{ color: "#64748b", fontSize: "12px" }}>委託者コード {a.clientCode}・委託者名 {a.clientName}</div>
              </div>
              <button onClick={() => startEdit(a)} style={editBtnStyle}><Pencil size={14} /> 編集</button>
              <button onClick={() => toggleActive(a)} style={{ ...editBtnStyle, color: "#e74c3c" }} title="やめる（振込データの画面で選べなくする）"><X size={14} /></button>
            </div>
          ))}
          {inactive.length > 0 && (
            <div>
              <button onClick={() => setShowInactive(!showInactive)} style={{ fontSize: "12px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>
                {showInactive ? "▲ やめた口座を隠す" : `▼ やめた口座を見る（${inactive.length}件）`}
              </button>
              {showInactive && inactive.map((a) => (
                <div key={a.id} style={{ ...card(false), opacity: 0.6, marginTop: "8px" }}>
                  <span style={{ flex: 1, fontSize: "13px", color: "#64748b" }}>{a.label}（やめた）</span>
                  <button onClick={() => toggleActive(a)} style={{ ...editBtnStyle, color: "#27ae60" }}><RotateCcw size={12} /> 戻す</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...addBoxStyle, border: editingId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
          <h4 style={{ margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            {editingId !== null ? <Pencil size={20} color="#f1c40f" /> : <PlusCircle size={20} color="#3498db" />}
            {editingId !== null ? "振込元口座を直す" : "振込元口座を足す"}
          </h4>
          <label style={miniLabelStyle}>見分けるための名前（なければ銀行と支店の名前）</label>
          <input value={form.label} onChange={(e) => set("label", e.target.value)} style={{ ...inputStyle, marginBottom: "10px" }} placeholder="例：給与用 三菱UFJ 本店" />
          <div style={grid2}>
            <div>
              <label style={miniLabelStyle}>委託者コード（10けた）</label>
              <input value={form.clientCode} onChange={(e) => set("clientCode", e.target.value.replace(/\D/g, ""))} maxLength={10} style={inputStyle} placeholder="銀行から知らされた番号" />
            </div>
            <div>
              <label style={miniLabelStyle}>委託者名（カナ）</label>
              <input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} style={inputStyle} placeholder="例：カ）ヤマダショウテン" />
            </div>
            <div>
              <label style={miniLabelStyle}>金融機関コード（4けた）</label>
              <input value={form.bankCode} onChange={(e) => set("bankCode", e.target.value.replace(/\D/g, ""))} maxLength={4} style={inputStyle} />
            </div>
            <div>
              <label style={miniLabelStyle}>金融機関名（カナ）</label>
              <input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} style={inputStyle} placeholder="例：ミツビシユーエフジェイ" />
            </div>
            <div>
              <label style={miniLabelStyle}>支店コード（3けた）</label>
              <input value={form.branchCode} onChange={(e) => set("branchCode", e.target.value.replace(/\D/g, ""))} maxLength={3} style={inputStyle} />
            </div>
            <div>
              <label style={miniLabelStyle}>支店名（カナ）</label>
              <input value={form.branchName} onChange={(e) => set("branchName", e.target.value)} style={inputStyle} placeholder="例：ホンテン" />
            </div>
            <div>
              <label style={miniLabelStyle}>預金種目</label>
              <select value={form.accountType} onChange={(e) => set("accountType", e.target.value as AccountType)} style={inputStyle}>
                <option value="ordinary">普通</option>
                <option value="current">当座</option>
              </select>
            </div>
            <div>
              <label style={miniLabelStyle}>口座番号（7けたまで）</label>
              <input value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))} maxLength={7} style={inputStyle} />
            </div>
          </div>
          {(form.clientName || form.bankName || form.branchName) && (
            <div style={{ fontSize: "11px", color: "#64748b", margin: "8px 0" }}>
              振込データに書く名前：{preview(form.clientName) || "-"}／{preview(form.bankName) || "-"}／{preview(form.branchName) || "-"}
            </div>
          )}
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button onClick={save} style={{ ...btnStyle, flex: 1, backgroundColor: "#3498db" }}>{editingId !== null ? "保存する" : "足す"}</button>
            {editingId !== null && <button onClick={reset} style={{ ...btnStyle, width: "80px", backgroundColor: "#95a5a6" }}>やめる</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

const note: CSSProperties = { fontSize: "12px", color: "#475569", backgroundColor: "#f1f5f9", borderRadius: "8px", padding: "10px 12px", lineHeight: 1.6 };
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" };
const card = (editing: boolean): CSSProperties => ({
  backgroundColor: "white", padding: "14px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
  display: "flex", alignItems: "center", gap: "10px", border: editing ? "2px solid #f1c40f" : "1px solid transparent",
});
