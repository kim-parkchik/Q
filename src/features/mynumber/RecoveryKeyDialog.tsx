/**
 * 回復用キーを見せる窓（暗号化を始めたとき・回復用キーで開けたとき・作り直したときの1回だけ）
 * 印刷するか書き写してから閉じてもらう。閉じたら、Q には残らない（包んだ鍵だけを置く。utils/myNumberCrypto.ts）
 * コピー（クリップボード）は用意しない（ほかのアプリや履歴に残らないように）
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound } from "lucide-react";

interface Props {
  recoveryKey: string;
  companyName: string;
  userName: string;
  onClose: () => void;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const NOTES = [
  "パスワードを忘れたときに、これで鍵を開けられます。これがあれば、パスワードがなくてもマイナンバーを取り出せます。",
  "パソコンやバックアップとは別の、鍵のかかる所にしまってください。写真に撮る・メールで送る・パソコンに保存するのはやめてください。",
  "文字は数字と英大文字です（I・L・O・U は使いません）。打つときは空白を入れても入れなくてもかまいません。",
  "回復用キーで開けたときや、作り直したときは、新しいキーになり、この紙は使えなくなります。",
];

/** 4文字ずつ、番号を付けて並べる */
function KeyGroups({ recoveryKey, size }: { recoveryKey: string; size: number }) {
  const groups = recoveryKey.split(" ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", justifyContent: "start", gap: "8px 18px" }}>
      {groups.map((g, i) => (
        <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#94a3b8", width: 16, textAlign: "right" }}>{i + 1}</span>
          <span style={{ fontFamily: "'SF Mono', Menlo, Consolas, monospace", fontSize: size, letterSpacing: 2, color: "#0f172a" }}>{g}</span>
        </div>
      ))}
    </div>
  );
}

/** 印刷する紙 */
function PrintSheet({ recoveryKey, companyName, userName }: Omit<Props, "onClose">) {
  return createPortal(
    <div id="mynumber-recovery-print">
      <style>{`
        @media screen { #mynumber-recovery-print { display: none; } }
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          #root { display: none !important; }
        }
      `}</style>
      <div style={{ color: "#000", fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif" }}>
        <div style={{ fontSize: 20, fontWeight: "bold", marginBottom: 6 }}>Q マイナンバーの回復用キー</div>
        <div style={{ fontSize: 12, marginBottom: 18 }}>
          会社：{companyName || "（会社名なし）"}　／　作った日：{today()}　／　作った人：{userName}
        </div>
        <div style={{ border: "2px solid #000", borderRadius: 6, padding: "18px 20px", marginBottom: 18 }}>
          <KeyGroups recoveryKey={recoveryKey} size={22} />
        </div>
        <ul style={{ fontSize: 12, lineHeight: 1.9, paddingLeft: 18, margin: 0 }}>
          {NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </div>,
    document.body
  );
}

export default function RecoveryKeyDialog({ recoveryKey, companyName, userName, onClose }: Props) {
  const [kept, setKept] = useState(false);
  return (
    <div style={overlay}>
      <div role="dialog" aria-modal="true" aria-labelledby="q-recovery-title" style={box}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={iconWrap}><KeyRound size={24} color="#b45309" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="q-recovery-title" style={{ fontSize: 16, fontWeight: "bold", color: "#1e293b", marginBottom: 6 }}>回復用キー（この画面でしか出しません）</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>印刷するか、紙に書き写してください。閉じると、もう見られません。</div>
          </div>
        </div>
        <div style={{ margin: "16px 0", padding: "16px 18px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <KeyGroups recoveryKey={recoveryKey} size={18} />
        </div>
        <ul style={{ fontSize: 12, color: "#475569", lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
          {NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={() => window.print()} style={{ ...btn, background: "#fff", color: "#1e293b", border: "1px solid #cbd5e1" }}>印刷する</button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1e293b", marginLeft: "auto" }}>
            <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
            印刷した・書き写した
          </label>
          <button type="button" onClick={onClose} disabled={!kept} style={{ ...btn, background: kept ? "#27ae60" : "#a7d7b8", color: "#fff", border: "none", cursor: kept ? "pointer" : "default" }}>閉じる</button>
        </div>
      </div>
      <PrintSheet recoveryKey={recoveryKey} companyName={companyName} userName={userName} />
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, backgroundColor: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
};
const box: React.CSSProperties = {
  width: 560, maxWidth: "calc(100vw - 40px)", backgroundColor: "white", borderRadius: 12, padding: "22px 24px 18px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)", borderTop: "6px solid #d68910",
};
const iconWrap: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", backgroundColor: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const btn: React.CSSProperties = { borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: "bold", cursor: "pointer" };
