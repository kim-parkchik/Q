import { useState } from "react";
import { hashPassword } from "../../utils/authUtils";
import { useToast } from "../../components/Toast";

/** パスワードの最低文字数 */
export const MIN_PASSWORD_LENGTH = 4;

export function useFirstSetup(db: any, onComplete: () => void) {
  const [loginId] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const toast = useToast();

  // --- 入力中のチェック（ボタンの有効・無効と、入力欄の下の案内に使う） ---
  const isNameFilled = displayName.trim().length > 0;
  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  // 確認欄に入力が始まってから一致を判定する（何も入れていないうちに赤字を出さない）
  const isConfirmStarted = passwordConfirm.length > 0;
  const isPasswordMatched = isConfirmStarted && password === passwordConfirm;
  const canSubmit = isNameFilled && isPasswordLongEnough && isPasswordMatched;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 画面ではボタンを無効にしているが、念のためここでも確認する
    if (!isNameFilled) return setError("管理者のお名前を入力してください。");
    if (!isPasswordLongEnough) return setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上で設定してください。`);
    if (password !== passwordConfirm) return setError("パスワードが一致しません。");

    try {
      const hashedPassword = await hashPassword(password);

      await db.execute(
        `INSERT INTO users (login_id, display_name, password_hash, role) 
          VALUES (?, ?, ?, 'admin')`,
        [loginId, displayName, hashedPassword] // Argon2のハッシュが保存される
      );
        
      toast.success("管理者アカウントを作成しました。ログインしてください");
      onComplete();
    } catch (err) {
      console.error(err);
      setError("ユーザーの作成に失敗しました。IDが重複している可能性があります。");
    }
  };

  // 画面側で使いたい「データ」と「関数」をセットにして返す
  return {
    loginId,
    displayName,
    setDisplayName,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
    error,
    handleSubmit,
    isPasswordLongEnough,
    isConfirmStarted,
    isPasswordMatched,
    canSubmit
  };
}