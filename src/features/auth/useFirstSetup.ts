import { useState } from "react";

export function useFirstSetup(db: any, onComplete: () => void) {
    const [loginId] = useState("admin");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [error, setError] = useState("");

    // 🆕 ハッシュ化関数（useSystemSettingsと同じもの）
    const hashPassword = async (password: string) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== passwordConfirm) return setError("パスワードが一致しません。");
        if (password.length < 4) return setError("パスワードは4文字以上で設定してください。");
        if (!displayName.trim()) return setError("表示名を入力してください。");

        try {
            // 🆕 ここでハッシュ化！
            const hashedPassword = await hashPassword(password);

            await db.execute(
                `INSERT INTO users (login_id, display_name, password_hash, role) 
                 VALUES (?, ?, ?, 'admin')`,
                [loginId, displayName, hashedPassword] // 🆕 ハッシュ化した値を保存
            );
            alert("管理者アカウントを作成しました。ログインしてください。");
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
        handleSubmit
    };
}