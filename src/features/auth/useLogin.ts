import { useState } from "react";

export function useLogin(db: any, onLoginSuccess: (user: any) => void) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const users = await db.select(
        "SELECT * FROM users WHERE login_id = ? AND password_hash = ? AND status = 'active'",
        [loginId, password]
      ) as any[];

      if (users.length > 0) {
        db.execute("UPDATE users SET last_login = DATETIME('now', 'localtime') WHERE id = ?", [users[0].id]);
        onLoginSuccess(users[0]);
      } else {
        setError("ログインIDまたはパスワードが正しくありません。");
      }
    } catch (err) {
      console.error(err);
      setError("データベース接続エラーが発生しました。");
    }
  };

  return {
    loginId, setLoginId,
    password, setPassword,
    error, handleLogin
  };
}