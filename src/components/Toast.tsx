/**
 * トースト通知（画面の右下に数秒だけ出て自然に消える通知）
 *
 * ■ 使い分けのルール
 *   - 保存・追加・更新・削除に「成功」したとき … toast.success("〜しました")
 *   - 入力不足やエラー、取り消せない操作の確認 … これまで通り alert / ask（操作を止めて確実に伝える）
 *
 * ■ 使い方
 *   const toast = useToast();
 *   toast.success("支店を追加しました");
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "info";

interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

interface ToastApi {
    success: (message: string) => void;
    info: (message: string) => void;
}

/** 表示している時間（ミリ秒） */
const TOAST_DURATION_MS = 3000;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);

    const remove = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const show = useCallback((kind: ToastKind, message: string) => {
        const id = nextId.current++;
        setToasts((prev) => [...prev, { id, kind, message }]);
        setTimeout(() => remove(id), TOAST_DURATION_MS);
    }, [remove]);

    const api = useMemo<ToastApi>(() => ({
        success: (message) => show("success", message),
        info: (message) => show("info", message),
    }), [show]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <style>{toastKeyframes}</style>
            <div style={containerStyle} aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} role="status" style={{ ...toastStyle, borderLeftColor: COLORS[t.kind] }}>
                        {t.kind === "success"
                            ? <CheckCircle2 size={18} color={COLORS.success} />
                            : <Info size={18} color={COLORS.info} />}
                        <span style={{ flex: 1 }}>{t.message}</span>
                        <button onClick={() => remove(t.id)} style={closeBtnStyle} aria-label="閉じる">
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

/** トーストを出すための関数を取得する（ToastProvider の内側で使う） */
export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast は ToastProvider の内側で使ってください");
    return ctx;
}

// --- スタイル ---
const COLORS: Record<ToastKind, string> = {
    success: "#2ecc71",
    info: "#3498db",
};

const containerStyle = {
    position: "fixed" as const,
    right: "24px",
    bottom: "24px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    zIndex: 10000,
    pointerEvents: "none" as const,
};

const toastStyle = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: "260px",
    maxWidth: "420px",
    padding: "12px 14px",
    backgroundColor: "white",
    color: "#2c3e50",
    fontSize: "14px",
    fontWeight: "bold" as const,
    borderRadius: "8px",
    borderLeft: "5px solid",
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    animation: "qToastIn 0.25s ease-out",
    pointerEvents: "auto" as const,
};

const closeBtnStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#94a3b8",
    padding: "2px",
    display: "flex",
};

const toastKeyframes = `
@keyframes qToastIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
}`;
