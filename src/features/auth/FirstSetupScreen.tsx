import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { S }  from "./FirstSetupScreen.styles";
import { useFirstSetup, MIN_PASSWORD_LENGTH } from "./useFirstSetup";

/** 入力欄の下に出す小さな案内（ok: 緑のチェック / ng: 赤のバツ / 未入力: 灰色） */
function FieldHint({ state, children }: { state: "ok" | "ng" | "neutral"; children: React.ReactNode }) {
  const color = state === "ok" ? "#27ae60" : state === "ng" ? "#e74c3c" : "#95a5a6";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color, marginTop: "-8px", marginBottom: "12px" }}>
      {state === "ok" && <CheckCircle2 size={13} />}
      {state === "ng" && <XCircle size={13} />}
      <span>{children}</span>
    </div>
  );
}

export default function FirstSetupScreen({ db, onComplete }: { db: any, onComplete: () => void }) {

  const f = useFirstSetup(db, onComplete);

  return (
    <div style={S.container}>
      <div style={S.card}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <img 
            src="/logo.svg" 
            alt="App Logo" 
            style={{ width: "120px", height: "auto" }} 
          />
        </div>
        <p style={{ textAlign: "center", color: "#95a5a6", fontSize: "14px" }}>
          最初に使用する管理者アカウントを作成します。
        </p>

        <form onSubmit={f.handleSubmit}>
          <label style={S.label}>ログインID</label>
          <input 
            type="text" 
            value={f.loginId} 
            readOnly 
            style={{ ...S.input, backgroundColor: "#f9f9f9", cursor: "not-allowed" }} 
          />

          <label style={S.label}>管理者のお名前</label>
          <input 
            type="text" 
            value={f.displayName} 
            onChange={e => f.setDisplayName(e.target.value)} 
            style={S.input}
            required 
          />

          <label style={S.label}>パスワード</label>
          <input 
            type="password" 
            value={f.password} 
            onChange={e => f.setPassword(e.target.value)} 
            style={S.input}
            required 
          />
          <FieldHint state={f.password.length === 0 ? "neutral" : f.isPasswordLongEnough ? "ok" : "ng"}>
            {MIN_PASSWORD_LENGTH}文字以上で入力してください
          </FieldHint>

          <label style={S.label}>パスワード（確認）</label>
          <input 
            type="password" 
            value={f.passwordConfirm} 
            onChange={e => f.setPasswordConfirm(e.target.value)} 
            style={{
              ...S.input,
              // 確認欄に入力が始まってから、一致していなければ赤い枠にする
              borderColor: f.isConfirmStarted && !f.isPasswordMatched ? "#e74c3c" : undefined,
            }}
            required 
          />
          {f.isConfirmStarted && (
            <FieldHint state={f.isPasswordMatched ? "ok" : "ng"}>
              {f.isPasswordMatched ? "パスワードが一致しています" : "パスワードが一致しません"}
            </FieldHint>
          )}

          {f.error && (
            <p style={{ 
              color: "#e74c3c", 
              fontSize: "13px", 
              textAlign: "center",
              display: "flex",         // アイコンと文字を横並びに
              alignItems: "center",    // 上下中央揃え
              justifyContent: "center", // 左右中央揃え
              gap: "6px",              // アイコンと文字の間隔
              marginTop: "10px"
            }}>
              <AlertTriangle size={16} strokeWidth={2.5} /> 
              {f.error}
            </p>
          )}

          <button
            type="submit"
            disabled={!f.canSubmit}
            title={!f.canSubmit ? "すべての項目を正しく入力すると押せるようになります" : undefined}
            style={{
              ...S.primaryButton,
              backgroundColor: f.canSubmit ? S.primaryButton.backgroundColor : "#bdc3c7",
              cursor: f.canSubmit ? "pointer" : "not-allowed",
            }}
          >
            アカウントを作成して開始
          </button>
        </form>
      </div>
    </div>
  );
}