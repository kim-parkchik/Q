/**
 * 「ID で押す」：スタッフID を入れる（カードを忘れた日）
 *
 * 文字を入れる欄（input）を使わずに、キーの位置で読む（日本語入力がオンでも、全角やかなにならない）。
 * 画面の数字のボタンでも入れられる（マウスだけでも使える）。この画面でカードを読ませても、カードとして読む。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_PAYLOAD_LENGTH, CARD_PAYLOAD_PREFIX } from "../../shared/timeqard";
import { charOfKey } from "./keys";

const MAX_LENGTH = 40;

export default function IdDialog(props: { onSubmit: (text: string) => void; onCancel: () => void }) {
  const [value, setValueState] = useState("");
  const valueRef = useRef("");
  const setValue = useCallback((v: string) => {
    valueRef.current = v.slice(0, MAX_LENGTH);
    setValueState(valueRef.current);
  }, []);
  const { onSubmit, onCancel } = props;

  const submit = useCallback(
    (text: string) => {
      if (text.trim() !== "") onSubmit(text);
    },
    [onSubmit]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Tab") {
        e.preventDefault();
        submit(valueRef.current);
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        e.preventDefault();
        setValue(valueRef.current.slice(0, -1));
        return;
      }
      const ch = charOfKey(e.code, e.shiftKey);
      if (ch === null) return;
      e.preventDefault();
      const next = (valueRef.current + ch).slice(0, MAX_LENGTH);
      setValue(next);
      // 終わりの印を送らない読み取り機で、カードを読ませたとき
      if (next.length === CARD_PAYLOAD_LENGTH && next.startsWith(CARD_PAYLOAD_PREFIX)) submit(next);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, submit, setValue]);

  const press = (ch: string) => setValue(valueRef.current + ch);

  return (
    <div className="modal-back">
      <div className="modal" style={{ width: "min(520px, 94vw)" }}>
        <h2>ID で押す</h2>
        <p style={{ fontSize: 16, margin: "0 0 10px", color: "#444" }}>スタッフID を入れて「探す」を押してください（キーボードでも入れられます）。</p>
        <div className="id-display">{value || <span style={{ color: "#bbb" }}>　</span>}</div>
        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => press(d)}>{d}</button>
          ))}
          <button style={{ fontSize: 20 }} onClick={() => setValue("")}>消す</button>
          <button onClick={() => press("0")}>0</button>
          <button style={{ fontSize: 20 }} onClick={() => setValue(valueRef.current.slice(0, -1))}>1字消す</button>
        </div>
        <div className="buttons">
          <button className="plain-btn" onClick={onCancel}>やめる</button>
          <button className="mid-btn k-entry" disabled={value.trim() === ""} onClick={() => submit(value)}>探す</button>
        </div>
      </div>
    </div>
  );
}
