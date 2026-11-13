/**
 * 「振込先口座」：給与・賞与を振り込む従業員の口座（3つまで。固定額の口座と、残りを振り込む口座）
 * 一般的な給与ソフトと同じ形（マネーフォワード クラウド給与の「固定額1・固定額2・残額」）。口座がない人は現金で払う（振込データに入れない）。
 * 振込データは「振込データ」の画面で作る（utils/zengin.ts・utils/bankAccounts.ts）
 */
import { Landmark, PlusCircle, Trash2 } from "lucide-react";
import { inputStyle, labelStyle } from "../StaffManager.styles";
import type { StaffManagerState } from "../useStaffManager";
import { MAX_STAFF_ACCOUNTS, emptyStaffAccountForm, type StaffAccountForm } from "../../../utils/bankAccounts";
import { toZenginText, type AccountType } from "../../../utils/zengin";

interface Props {
  cm: StaffManagerState;
}

export default function BankAccountSection({ cm }: Props) {
  const { targetBankAccounts: accounts, setTargetBankAccounts: setAccounts, bankAccountErrors, targetFurigana } = cm;

  const update = (i: number, patch: Partial<StaffAccountForm>) =>
    setAccounts(accounts.map((a, j) => (j === i ? { ...a, ...patch } : patch.rest ? { ...a, rest: false } : a)));
  const add = () => {
    // 1つ目は残りを振り込む口座、2つ目からは固定額の口座（名義はフリガナから）
    const holder = toZenginText(targetFurigana || "").text;
    setAccounts([...accounts, emptyStaffAccountForm(accounts[0]?.holderName || holder, accounts.length === 0)]);
  };
  const remove = (i: number) => {
    const rest = accounts.filter((_, j) => j !== i);
    // 残りの口座を消したら、最後の口座を残りの口座にする
    if (rest.length > 0 && !rest.some((a) => a.rest)) rest[rest.length - 1] = { ...rest[rest.length - 1], rest: true, fixedAmount: "" };
    setAccounts(rest);
  };

  return (
    <div style={{ width: "100%" }}>
      <h4 style={{ borderLeft: "4px solid #16a085", paddingLeft: "10px", margin: "10px 0", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
        <Landmark size={14} /> 振込先口座（給与・賞与）
      </h4>
      {accounts.length === 0 && (
        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
          口座がありません（現金で払う人。振込データには入れません）。
        </div>
      )}
      {accounts.map((a, i) => (
        <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", marginBottom: "8px", backgroundColor: "#fcfcfc" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "6px" }}>
            <b style={{ fontSize: "12px" }}>口座{i + 1}</b>
            <button onClick={() => remove(i)} title="この口座を消す" style={{ marginLeft: "auto", background: "none", border: "none", color: "#e74c3c", cursor: "pointer" }}>
              <Trash2 size={14} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px 1fr", gap: "6px" }}>
            <div>
              <label style={labelStyle}>金融機関コード</label>
              <input value={a.bankCode} maxLength={4} onChange={(e) => update(i, { bankCode: e.target.value.replace(/\D/g, "") })} style={inputStyle} placeholder="4けた" />
            </div>
            <div>
              <label style={labelStyle}>金融機関名（カナ）</label>
              <input value={a.bankName} onChange={(e) => update(i, { bankName: e.target.value })} style={inputStyle} placeholder="例：ミツイスミトモ" />
            </div>
            <div>
              <label style={labelStyle}>支店コード</label>
              <input value={a.branchCode} maxLength={3} onChange={(e) => update(i, { branchCode: e.target.value.replace(/\D/g, "") })} style={inputStyle} placeholder="3けた" />
            </div>
            <div>
              <label style={labelStyle}>支店名（カナ）</label>
              <input value={a.branchName} onChange={(e) => update(i, { branchName: e.target.value })} style={inputStyle} placeholder="例：シブヤ" />
            </div>
            <div>
              <label style={labelStyle}>預金種目</label>
              <select value={a.accountType} onChange={(e) => update(i, { accountType: e.target.value as AccountType })} style={inputStyle}>
                <option value="ordinary">普通</option>
                <option value="current">当座</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>口座番号</label>
              <input value={a.accountNumber} maxLength={7} onChange={(e) => update(i, { accountNumber: e.target.value.replace(/\D/g, "") })} style={inputStyle} placeholder="7けたまで" />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>口座名義（カナ）</label>
              <input value={a.holderName} onChange={(e) => update(i, { holderName: e.target.value })} style={inputStyle} placeholder="例：ヤマダ タロウ" />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px", fontSize: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input type="radio" checked={a.rest} onChange={() => update(i, { rest: true, fixedAmount: "" })} /> 残り全部
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input type="radio" checked={!a.rest} onChange={() => update(i, { rest: false })} disabled={accounts.length === 1} /> 固定額
            </label>
            {!a.rest && (
              <input type="number" min={0} value={a.fixedAmount} onChange={(e) => update(i, { fixedAmount: e.target.value })}
                style={{ ...inputStyle, width: "120px", padding: "4px 8px", textAlign: "right" }} placeholder="円" />
            )}
            {a.holderName && <span style={{ color: "#94a3b8" }}>振込データの名義：{toZenginText(a.holderName).text}</span>}
          </div>
        </div>
      ))}
      {accounts.length < MAX_STAFF_ACCOUNTS && (
        <button onClick={add} style={{ background: "none", border: "1px dashed #94a3b8", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", color: "#475569", display: "flex", alignItems: "center", gap: "4px" }}>
          <PlusCircle size={14} /> 口座を足す
        </button>
      )}
      {accounts.length > 1 && (
        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
          固定額の口座に固定額を振り込み、差引支給額の残りを「残り全部」の口座に振り込みます。
        </div>
      )}
      {bankAccountErrors.length > 0 && (
        <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "6px" }}>
          {bankAccountErrors.map((e) => <div key={e}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  );
}
