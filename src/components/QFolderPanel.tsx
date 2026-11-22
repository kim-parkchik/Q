/**
 * 最初の画面の「Q のフォルダ」（会社ファイルの初めの置き場所と、バックアップ・ログ・書き出しを置くところ。utils/qFolder.ts）
 * クラウドと同期していれば知らせ、このパソコンの設定として、同期しない場所に変えられるようにする
 */
import { useEffect, useState, type CSSProperties } from "react";
import { FolderOpen, TriangleAlert } from "lucide-react";
import { useMessageDialog } from "./MessageDialog";
import {
  applyQFolder,
  changedMessage,
  cloudFolderMessage,
  getQFolder,
  missingFolderMessage,
  pickedCloudMessage,
  pickQFolder,
  type QFolderChoice,
  type QFolderInfo,
} from "../utils/qFolder";

export default function QFolderPanel() {
  const dialog = useMessageDialog();
  const [info, setInfo] = useState<QFolderInfo | null>(null);
  const [showChoices, setShowChoices] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getQFolder()
      .then(setInfo)
      .catch((e) => console.error("Q のフォルダがわかりませんでした:", e));
  }, []);

  if (!info) return null;

  const warning = info.cloud ? cloudFolderMessage(info) : !info.exists && !info.isDefault ? missingFolderMessage(info) : null;

  const change = async (choice: QFolderChoice) => {
    setBusy(true);
    try {
      if (choice === "picked") {
        const picked = await pickQFolder();
        if (!picked) return; // 窓を閉じた
        if (picked.cloud) {
          const answer = await dialog.choose(pickedCloudMessage(picked), ["このフォルダにする"], "選んだフォルダも同期しています", "やめる");
          if (answer !== 0) return;
        }
      }
      const next = await applyQFolder(choice);
      setInfo(next);
      setShowChoices(false);
      dialog.warning(changedMessage(info, next), "Q のフォルダを変えました");
    } catch (e) {
      dialog.warning(e instanceof Error ? e.message : String(e), "Q のフォルダを変えられませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-q-folder style={panelStyle}>
      {warning && (
        <div role="alert" data-q-folder-warning style={warningStyle}>
          <div style={warningTitleStyle}>
            <TriangleAlert size={16} />
            {info.cloud ? `Q のフォルダが ${info.cloud} と同期しています` : "Q のフォルダが見つかりません"}
          </div>
          <div>{warning}</div>
        </div>
      )}
      <div style={currentStyle}>
        <FolderOpen size={14} />
        <span>
          Q のフォルダ（バックアップ・ログ・書き出しの置き場所）：<span data-q-folder-path>{info.path}</span>
        </span>
        {!warning && (
          <button type="button" data-q-folder-change onClick={() => setShowChoices((v) => !v)} style={linkStyle}>
            場所を変える
          </button>
        )}
      </div>
      {(warning || showChoices) && (
        <div style={choicesStyle}>
          {info.path !== info.homePath && !info.homeCloud && (
            <button type="button" data-q-folder-choice="home" disabled={busy} onClick={() => change("home")} style={buttonStyle(busy, true)}>
              ホームフォルダの Q（{info.homePath}）にする
            </button>
          )}
          <button type="button" data-q-folder-choice="picked" disabled={busy} onClick={() => change("picked")} style={buttonStyle(busy, false)}>
            ほかの場所を選ぶ…
          </button>
          {!info.isDefault && (
            <button type="button" data-q-folder-choice="default" disabled={busy} onClick={() => change("default")} style={buttonStyle(busy, false)}>
              書類フォルダの Q に戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- スタイル ---
const panelStyle: CSSProperties = { width: "620px", maxWidth: "90vw", fontSize: "12px", color: "#606266", lineHeight: 1.6 };
const warningStyle: CSSProperties = {
  border: "1px solid #f59e0b", backgroundColor: "#fffbeb", color: "#92400e", borderRadius: "6px", padding: "10px 12px", marginBottom: "10px",
};
const warningTitleStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", fontWeight: "bold", marginBottom: "4px" };
const currentStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flexWrap: "wrap", wordBreak: "break-all" };
const linkStyle: CSSProperties = { background: "none", border: "none", color: "#2f80c9", cursor: "pointer", padding: 0, fontSize: "12px", textDecoration: "underline" };
const choicesStyle: CSSProperties = { display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap", marginTop: "8px" };
const buttonStyle = (busy: boolean, main: boolean): CSSProperties => ({
  padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  border: main ? "none" : "1px solid #dcdfe6", backgroundColor: main ? "#002D62" : "white", color: main ? "white" : "#303133",
});
