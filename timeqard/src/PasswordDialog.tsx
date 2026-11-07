/**
 * 管理のパスワードを聞く（管理の画面を開くとき・TimeQard を閉じるとき）
 */
import { useState } from "react";
import { verifyPassword } from "./platform";

export default function PasswordDialog(props: {
  title: string;
  hash: string;
  onOk: () => void;
  onCancel: () => void;
  onForgot?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    try {
      if (await verifyPassword(password, props.hash)) props.onOk();
      else {
        setError("パスワードが違います。");
        setPassword("");
      }
    } catch (e) {
      setError(`確かめられませんでした：${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back">
      <div className="modal" style={{ width: "min(520px, 94vw)" }}>
        <h2>{props.title}</h2>
        <div className="field">
          <label>管理のパスワード</label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ width: "100%" }}
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        {props.onForgot && (
          <button className="link-btn" onClick={props.onForgot}>パスワードを忘れたとき</button>
        )}
        <div className="buttons">
          <button className="plain-btn" onClick={props.onCancel}>やめる</button>
          <button className="mid-btn k-entry" disabled={busy || !password} onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

/** 新しいパスワードを決める（2回入れて確かめる） */
export function NewPasswordFields(props: { onChange: (password: string | null) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const update = (na: string, nb: string) => {
    setA(na);
    setB(nb);
    props.onChange(na.length >= 4 && na === nb ? na : null);
  };
  return (
    <>
      <div className="field">
        <label>新しいパスワード（4文字以上）</label>
        <input type="password" value={a} onChange={(e) => update(e.target.value, b)} style={{ width: "100%" }} />
      </div>
      <div className="field">
        <label>もう一度</label>
        <input type="password" value={b} onChange={(e) => update(a, e.target.value)} style={{ width: "100%" }} />
      </div>
      {a && b && a !== b && <div className="error-text">2つのパスワードが違います。</div>}
      {a && a.length < 4 && <div className="error-text">4文字以上にしてください。</div>}
    </>
  );
}
