import * as S from "./FirstSetupScreen.styles";
import { useFirstSetup } from "./useFirstSetup"; // 脳みそを読み込む

export default function FirstSetupScreen({ db, onComplete }: { db: any, onComplete: () => void }) {
    // 脳みそから必要なものを取り出す
    const f = useFirstSetup(db, onComplete);

    return (
        <div style={S.containerStyle}>
            <div style={S.cardStyle}>
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
                    <label style={S.labelStyle}>ログインID</label>
                    <input 
                        type="text" 
                        value={f.loginId} 
                        readOnly 
                        style={{ ...S.inputStyle, backgroundColor: "#f9f9f9" }} 
                    />

                    <label style={S.labelStyle}>管理者のお名前</label>
                    <input 
                        type="text" 
                        value={f.displayName} 
                        onChange={e => f.setDisplayName(e.target.value)} 
                        style={S.inputStyle}
                        required 
                    />

                    <label style={S.labelStyle}>パスワード</label>
                    <input 
                        type="password" 
                        value={f.password} 
                        onChange={e => f.setPassword(e.target.value)} 
                        style={S.inputStyle}
                        required 
                    />

                    <label style={S.labelStyle}>パスワード（確認）</label>
                    <input 
                        type="password" 
                        value={f.passwordConfirm} 
                        onChange={e => f.setPasswordConfirm(e.target.value)} 
                        style={S.inputStyle}
                        required 
                    />

                    {f.error && (
                        <p style={{ color: "#e74c3c", fontSize: "13px", textAlign: "center" }}>
                            ⚠️ {f.error}
                        </p>
                    )}

                    <button type="submit" style={{
                        width: "100%", padding: "15px", backgroundColor: "#2ecc71", color: "white",
                        border: "none", borderRadius: "8px", marginTop: "30px", fontSize: "18px", fontWeight: "bold"
                    }}>
                        アカウントを作成して開始
                    </button>
                </form>
            </div>
        </div>
    );
}