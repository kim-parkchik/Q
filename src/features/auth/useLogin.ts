import { useState } from "react";
import { verifyPassword } from "../../utils/authUtils";
import { attemptLogin } from "./loginGuard";

/**
 * ログインの画面（LoginScreen.tsx）の入れたものと、ログインのボタン
 * パスワードを確かめ、続けてまちがえた回数を数え、操作の記録に残すのは loginGuard.ts
 */
export function useLogin(db: any, onLoginSuccess: (user: any) => void) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const result = await attemptLogin(db, loginId, password, { verify: verifyPassword });
      if (result.ok) {
        onLoginSuccess(result.user);
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setError("データベース接続エラーが発生しました。");
    }
  };

  return { loginId, setLoginId, password, setPassword, error, handleLogin };
}
