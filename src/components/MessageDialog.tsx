/**
 * エラー・注意のメッセージダイアログ（アプリ内で表示する、赤／黄色の窓）
 *
 * ブラウザ標準の alert() は、見た目を変えられず、macOS ではアプリのアイコンが出るだけで
 * エラーかどうかが分かりにくい。そこで、アプリ内で同じ見た目の窓を出す。
 *
 * ■ 使い分けのルール
 *   - 処理が失敗した（保存できなかった等）       … dialog.error("〜に失敗しました")   赤・✕
 *   - 入力不足や、ルール上できない操作の案内     … dialog.warning("〜を入力してください") 黄・！
 *   - 成功の知らせ                               … toast.success（Toast.tsx）
 *   - 取り消せない操作の確認                     … これまで通り ask()
 *
 * ■ 使い方
 *   const dialog = useMessageDialog();
 *   return dialog.warning("会社名は必須です");   // OK を押すまで待つ場合は await する
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { XCircle, AlertTriangle } from "lucide-react";

type DialogKind = "error" | "warning";

interface DialogItem {
    kind: DialogKind;
    title: string;
    message: string;
    resolve: () => void;
}

interface MessageDialogApi {
    error: (message: string, title?: string) => Promise<void>;
    warning: (message: string, title?: string) => Promise<void>;
}

const DEFAULT_TITLES: Record<DialogKind, string> = {
    error: "エラー",
    warning: "確認してください",
};

const MessageDialogContext = createContext<MessageDialogApi | null>(null);

export function MessageDialogProvider({ children }: { children: ReactNode }) {
    // 複数同時に呼ばれた場合は順番に表示する
    const [queue, setQueue] = useState<DialogItem[]>([]);
    const current = queue[0];

    const open = useCallback((kind: DialogKind, message: string, title?: string) => {
        return new Promise<void>((resolve) => {
            setQueue((prev) => [...prev, { kind, message, title: title ?? DEFAULT_TITLES[kind], resolve }]);
        });
    }, []);

    const close = useCallback(() => {
        setQueue((prev) => {
            prev[0]?.resolve();
            return prev.slice(1);
        });
    }, []);

    const api = useMemo<MessageDialogApi>(() => ({
        error: (message, title) => open("error", message, title),
        warning: (message, title) => open("warning", message, title),
    }), [open]);

    return (
        <MessageDialogContext.Provider value={api}>
            {children}
            {current && <DialogView item={current} onClose={close} />}
        </MessageDialogContext.Provider>
    );
}

/** メッセージダイアログを出すための関数を取得する（MessageDialogProvider の内側で使う） */
export function useMessageDialog(): MessageDialogApi {
    const ctx = useContext(MessageDialogContext);
    if (!ctx) throw new Error("useMessageDialog は MessageDialogProvider の内側で使ってください");
    return ctx;
}

function DialogView({ item, onClose }: { item: DialogItem; onClose: () => void }) {
    const okRef = useRef<HTMLButtonElement>(null);
    const color = THEME[item.kind];

    // 開いたら OK ボタンにフォーカス（Enter で閉じられる）。Esc でも閉じる。
    useEffect(() => {
        okRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [item, onClose]);

    return (
        <div style={overlayStyle}>
            <style>{dialogKeyframes}</style>
            <div role="alertdialog" aria-modal="true" aria-labelledby="q-dialog-title" style={{ ...boxStyle, borderTop: `6px solid ${color.main}` }}>
                <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                    <div style={{ ...iconWrapStyle, backgroundColor: color.light }}>
                        {item.kind === "error"
                            ? <XCircle size={28} color={color.main} />
                            : <AlertTriangle size={28} color={color.main} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div id="q-dialog-title" style={{ ...titleStyle, color: color.main }}>{item.title}</div>
                        <div style={messageStyle}>{item.message}</div>
                    </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
                    <button ref={okRef} onClick={onClose} style={{ ...okBtnStyle, backgroundColor: color.main }}>
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- スタイル ---
const THEME: Record<DialogKind, { main: string; light: string }> = {
    error: { main: "#e74c3c", light: "#fdecea" },
    warning: { main: "#d68910", light: "#fef5e7" },
};

const overlayStyle = {
    position: "fixed" as const,
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10001,
    animation: "qDialogFade 0.15s ease-out",
};

const boxStyle = {
    width: "420px",
    maxWidth: "calc(100vw - 40px)",
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "22px 24px 18px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
    animation: "qDialogPop 0.18s ease-out",
};

const iconWrapStyle = {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
};

const titleStyle = {
    fontSize: "16px",
    fontWeight: "bold" as const,
    marginBottom: "6px",
};

const messageStyle = {
    fontSize: "14px",
    color: "#2c3e50",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
};

const okBtnStyle = {
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "10px 28px",
    fontSize: "14px",
    fontWeight: "bold" as const,
    cursor: "pointer",
};

const dialogKeyframes = `
@keyframes qDialogFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes qDialogPop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`;
