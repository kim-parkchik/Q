/**
 * 時・分を2つの枠で入力する部品（勤怠の時刻入力用）
 * （AttendanceManager.tsx から分割）
 */
import { useEffect, useState } from "react";

// ニコイチ入力コンポーネント
export default function TimeInputPair({ 
  value, 
  onChange, 
  disabled, 
  isFinalized // 🆕 確定によるロックかどうかを受け取る
}: { 
  value: string, 
  onChange: (val: string) => void, 
  disabled?: boolean,
  isFinalized?: boolean 
}) {
  const [initialH, initialM] = (value || ":").split(":");
  const [localH, setLocalH] = useState(initialH || "");
  const [localM, setLocalM] = useState(initialM || "");

  useEffect(() => {
    const [vh, vm] = (value || ":").split(":");
    setLocalH(vh || "");
    setLocalM(vm || "");
  }, [value]);

  const handleBlur = () => {
    // 1. 両方空なら、値を消去する（休憩なし等）
    if (!localH && !localM) {
      if (value !== ":") onChange(":");
      return;
    }

    // 2. 片方だけ入力されている場合は、無理に補完せずそのままにする
    // （ユーザーが入力途中で他の場所を触った可能性があるため）
    if (!localH || !localM) {
      onChange(`${localH}:${localM}`);
      return;
    }

    // 3. 両方入力がある時だけ、綺麗に「0埋め」して桁を揃える
    const paddedH = localH.padStart(2, '0');
    const paddedM = localM.padStart(2, '0');
    const newValue = `${paddedH}:${paddedM}`;

    if (newValue !== value) {
      setLocalH(paddedH); // 入力欄の中身も 09 に更新
      setLocalM(paddedM);
      onChange(newValue);
    }
  };

  const formatInput = (val: string) => {
    return val
      .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[^0-9]/g, "")
  };

  const inputStyle = {
    width: "28px",
    border: "none",
    outline: "none",
    textAlign: "center" as const,
    fontSize: "14px",
    fontFamily: "monospace",
    backgroundColor: "transparent",
    padding: "4px 0",
    margin: "0",
    lineHeight: "1.2",
    cursor: disabled ? "not-allowed" : "text",
    
    // --- ここを修正：確定(disabled)時は緑、それ以外は通常色 ---
    color: isFinalized 
      ? "#27ae60"          // 確定時は「緑」
      : (disabled ? "#bdc3c7" : "#333"), // 欠勤などで無効な時は「薄いグレー」、通常は「濃いグレー」
    
    fontWeight: isFinalized ? "bold" : "normal",
    opacity: 1, 
    WebkitTextFillColor: isFinalized 
      ? "#27ae60" 
      : (disabled ? "#bdc3c7" : "#333"),
  };

  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isFinalized ? "transparent" : (disabled ? "#f5f5f5" : "#ffffff"),
      border: isFinalized ? "1px solid transparent" : "1px solid #ddd",
      borderRadius: "4px",
      padding: "0 2px",
      width: "60px",
      // 確定時はシャドウも不要なら消す
      boxShadow: disabled ? "none" : "inset 0 1px 2px rgba(0,0,0,0.05)"
    }}>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={localH}
        placeholder="--"
        onChange={e => {
          const cleaned = formatInput(e.target.value);
          setLocalH(cleaned);
          onChange(`${cleaned}:${localM}`);
        }}
        onBlur={handleBlur}
        style={inputStyle}
      />
      {/* コロンの色も確定時は緑に合わせると綺麗です */}
      <span style={{ 
        // ★ ここを修正：入力欄の文字色と同じロジックに
        color: isFinalized 
          ? "#27ae60"          // 確定時は「緑」
          : (disabled ? "#bdc3c7" : "#ccc"), // 欠勤などで無効なら「薄いグレー」、通常は「薄い目印グレー」
          
        fontWeight: "bold", 
        userSelect: "none" 
      }}>:</span>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={localM}
        placeholder="--"
        onChange={e => {
          const cleaned = formatInput(e.target.value);
          setLocalM(cleaned);
          onChange(`${localH}:${cleaned}`);
        }}
        onBlur={handleBlur}
        style={inputStyle}
      />
    </div>
  );
}
