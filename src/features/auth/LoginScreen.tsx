import * as S from "./LoginScreen.styles";
import { useLogin } from "./useLogin";

export default function LoginScreen({ db, onLoginSuccess }: { db: any, onLoginSuccess: (user: any) => void }) {
  const { loginId, setLoginId, password, setPassword, error, handleLogin } = useLogin(db, onLoginSuccess);

  return (
    <div style={S.containerStyle}>
      <div style={S.cardStyle}>
        {/* --- ロゴ表示部分 --- */}
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <img 
            src="/logo.svg" 
            alt="App Logo" 
            style={{ width: "120px", height: "auto" }} 
          />
        </div>
        {/* ------------------ */}
        
        <form onSubmit={handleLogin}>
          <div style={S.inputGroupStyle}>
            <label style={S.labelStyle}>ログインID</label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              style={S.inputStyle}
              placeholder="admin"
              required
            />
          </div>
          
          <div style={{ ...S.inputGroupStyle, marginBottom: "25px" }}>
            <label style={S.labelStyle}>パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={S.inputStyle}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p style={{ color: "#e74c3c", fontSize: "13px", marginBottom: "15px" }}>{error}</p>}

          <button type="submit" style={S.buttonStyle}>
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}