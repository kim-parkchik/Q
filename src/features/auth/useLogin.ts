import { useState } from "react";

export function useLogin(db: any, onLoginSuccess: (user: any) => void) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // 🆕 パスワードをハッシュ化する関数
  const hashPassword = async (password: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      // 1. 入力されたパスワードをハッシュ化する
      const hashedPassword = await hashPassword(password);

      // 2. ハッシュ化した値を使ってSQLを発行する
      const users = await db.select(
        "SELECT * FROM users WHERE login_id = ? AND password_hash = ? AND status = 'active'",
        [loginId, hashedPassword] // 🆕 password ではなく hashedPassword を渡す
      ) as any[];

      if (users.length > 0) {
        // ログイン成功時の処理
        await db.execute(
          "UPDATE users SET last_login = DATETIME('now', 'localtime') WHERE id = ?", 
          [users[0].id]
        );
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