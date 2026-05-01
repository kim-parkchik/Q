import { useState } from "react";
import { invoke } from "@tauri-apps/api/core"; // 🆕 追加

export function useLogin(db: any, onLoginSuccess: (user: any) => void) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      // 1. まずはログインIDだけでユーザーを探す
      const users = await db.select(
        "SELECT * FROM users WHERE login_id = ? AND status = 'active'",
        [loginId]
      ) as any[];

      if (users.length > 0) {
        const user = users[0];

        // 2. Rust側に「入力パスワード」と「DBのハッシュ」を渡して検証してもらう
        const isValid = await invoke<boolean>("verify_password", {
          password: password,
          hash: user.password_hash,
        });

        if (isValid) {
          // ログイン成功
          await db.execute(
            "UPDATE users SET last_login = DATETIME('now', 'localtime') WHERE id = ?", 
            [user.id]
          );
          onLoginSuccess(user);
        } else {
          setError("ログインIDまたはパスワードが正しくありません。");
        }
      } else {
        setError("ログインIDまたはパスワードが正しくありません。");
      }
    } catch (err) {
      console.error(err);
      setError("データベース接続エラーが発生しました。");
    }
  };

  return { loginId, setLoginId, password, setPassword, error, handleLogin };
}