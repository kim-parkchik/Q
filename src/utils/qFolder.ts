/**
 * Q のフォルダ（会社ファイルの初めの置き場所と、バックアップ（Backup）・書き出し（Export）を置くところ）
 *
 * 初めは書類フォルダの「Q」で、このパソコンの設定として、ほかの場所に変えられる（Rust の側の src-tauri/src/q_folder.rs）。
 * 書類フォルダが iCloud（Mac の「デスクトップと書類」）や OneDrive（Windows の書類フォルダを OneDrive に移す設定）と同期していると、
 * バックアップ・書き出したファイルが自動でクラウドに上がり、同期のせいで会社ファイルが開けなくなることもあるので、
 * 最初の画面（components/QFolderPanel.tsx）と、同期する場所の会社ファイルを開くとき（useApp.ts）に知らせる。
 * 場所を選ぶ窓は Rust の側で開く（画面からは好きな場所を指せない。S1 で狭めた読み書きの範囲を広げられないように）。
 * ※ Q のフォルダの場所は、かならずここで決める（書類フォルダを直接使わない。qFolder.test.ts で確かめている）
 */
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";

/** いまの Q のフォルダ */
export interface QFolderInfo {
  path: string;
  /** 書類フォルダの Q（初め）のままか */
  isDefault: boolean;
  exists: boolean;
  /** 同期しているクラウドの名前（"iCloud Drive"・"OneDrive"・"クラウドのフォルダ"）。同期していなければ null */
  cloud: string | null;
  /** 書類フォルダの Q */
  defaultPath: string;
  /** ホームフォルダの Q（同期しない場所の候補） */
  homePath: string;
  /** ホームフォルダの Q も同期していれば、その名前（ふつうはない） */
  homeCloud: string | null;
}

/** 窓で選んだフォルダ（まだ Q のフォルダにはしていない） */
export interface PickedFolder {
  path: string;
  cloud: string | null;
}

/** "picked"：窓で選んだフォルダ・"home"：ホームフォルダの Q・"default"：書類フォルダの Q */
export type QFolderChoice = "picked" | "home" | "default";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export const getQFolder = async (run: Invoke = invoke): Promise<QFolderInfo> => {
  const info = (await run("q_folder")) as QFolderInfo | null;
  if (!info || typeof info.path !== "string" || info.path === "") throw new Error("Q のフォルダがわかりません");
  return info;
};

/** Q のフォルダの場所。sub を渡せば、その中のフォルダ（Backup・Export）の場所 */
export const qFolderPath = async (sub?: string): Promise<string> => {
  const { path } = await getQFolder();
  return sub ? join(path, sub) : path;
};

/** 窓でフォルダを選んでもらう（やめたら null。Q のフォルダにできないフォルダなら、わけを投げる） */
export const pickQFolder = () => invoke<PickedFolder | null>("pick_q_folder");

/** Q のフォルダを変える */
export const applyQFolder = (choice: QFolderChoice) => invoke<QFolderInfo>("apply_q_folder", { choice });

/** 会社ファイルがクラウドと同期する場所にあれば、そのクラウドの名前 */
export const cloudPlaceOf = (path: string) => invoke<string | null>("cloud_place_of", { path });

/** 移すときの注意（作業中のファイル -wal を置いていくと、最後に保存した分がなくなることがある） */
const MOVE_NOTE = "会社ファイルを移すときは、Q で閉じてから移し、名前の後ろに「-wal」が付いた同じ名前のファイルがあれば、いっしょに移してください。";

/** Q のフォルダがクラウドと同期しているときの知らせ */
export const cloudFolderMessage = (info: QFolderInfo): string =>
  `Q のフォルダ（${info.path}）は、${info.cloud} と同期しています。` +
  "会社ファイルのバックアップ・書き出したファイルが、自動でクラウドに上がります（会社ファイルは、マイナンバーのほかは暗号化していません）。" +
  "同期のせいで、会社ファイルが開けなくなったり、こわれたりすることもあります。同期しない場所に変えてください。";

/** ほかの場所にした Q のフォルダが見つからないときの知らせ */
export const missingFolderMessage = (info: QFolderInfo): string =>
  `Q のフォルダ（${info.path}）が見つかりません。外付けのディスクなどにあるなら、つないでください。ほかの場所に変えることもできます。`;

/** 同期する場所にある会社ファイルを開く前の知らせ */
export const cloudFileMessage = (service: string): string =>
  `この会社ファイルは、${service} と同期する場所にあります。\n` +
  "会社ファイルの中身（マイナンバーのほかは暗号化していない、給与・住所などの個人情報）が、自動でクラウドに上がります。" +
  "開いているあいだに同期すると、会社ファイルが開けなくなったり、こわれたりすることもあります。\n" +
  `同期しない場所（Q のフォルダなど）に移してから開くことをおすすめします。${MOVE_NOTE}`;

/** 窓で選んだフォルダも同期しているときの確かめ */
export const pickedCloudMessage = (picked: PickedFolder): string =>
  `選んだフォルダ（${picked.path}）も、${picked.cloud} と同期しています。` +
  "このフォルダを Q のフォルダにすると、バックアップ・書き出したファイルがクラウドに上がります。このフォルダにしますか？";

/** Q のフォルダを変えたときの知らせ */
export const changedMessage = (before: QFolderInfo, after: QFolderInfo): string => {
  if (before.path === after.path) return `Q のフォルダは「${after.path}」のままです。`;
  return (
    `Q のフォルダを「${after.path}」にしました。これからのバックアップ・書き出しは、ここに置きます。\n` +
    `前のフォルダ（${before.path}）にあるバックアップ・書き出したファイルと会社ファイルは、そのまま残っています。` +
    `クラウドから消したいときは、新しいフォルダに移してください。${MOVE_NOTE}` +
    (after.cloud ? `\n新しいフォルダも、${after.cloud} と同期しています。` : "")
  );
};
