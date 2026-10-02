/**
 * 【開発用】メッセージ表示のテストパネル
 * 開発モード（bun tauri dev）のときだけ「システム設定」の下に表示される。
 * 配布用にビルドしたアプリには表示されない。
 */
import { useMessageDialog } from "./MessageDialog";
import { useToast } from "./Toast";

export default function DevMessagePreview() {
    const dialog = useMessageDialog();
    const toast = useToast();

    return (
        <div style={panelStyle}>
            <div style={{ fontWeight: "bold", marginBottom: "10px", color: "#64748b" }}>
                🛠 開発用：メッセージ表示テスト（開発モードのみ表示）
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button style={btn("#e74c3c")} onClick={() => dialog.error("支店情報の保存に失敗しました。")}>エラー（赤）</button>
                <button style={btn("#d68910")} onClick={() => dialog.warning("名称と都道府県は必須です")}>注意（黄）</button>
                <button style={btn("#2ecc71")} onClick={() => toast.success("「本店」を更新しました")}>成功通知</button>
                <button style={btn("#3498db")} onClick={() => toast.info("お知らせの通知です")}>お知らせ通知</button>
                <button style={btn("#64748b")} onClick={() => { dialog.error("1つ目のエラーです"); dialog.warning("2つ目の注意です（順番に表示）"); }}>連続表示</button>
            </div>
        </div>
    );
}

const panelStyle = {
    marginTop: "40px",
    padding: "16px",
    border: "2px dashed #cbd5e1",
    borderRadius: "10px",
    backgroundColor: "#f8fafc",
    fontSize: "13px",
};

const btn = (color: string) => ({
    backgroundColor: color,
    color: "white",
    border: "none",
    borderRadius: "6px",
    padding: "8px 14px",
    fontWeight: "bold" as const,
    cursor: "pointer",
});
