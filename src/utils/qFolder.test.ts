import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR_NAME, BACKUP_DIR_NAME, EXPORT_DIR_NAME } from "../constants/appConfig";
import {
  changedMessage,
  cloudFileMessage,
  cloudFolderMessage,
  getQFolder,
  missingFolderMessage,
  pickedCloudMessage,
  type QFolderInfo,
} from "./qFolder";

const SRC = join(import.meta.dir, "..");
const ROOT = join(SRC, "..");

/** src の中の .ts・.tsx（テストは除く） */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const icloud: QFolderInfo = {
  path: "/Users/someone/Documents/Q",
  isDefault: true,
  exists: true,
  cloud: "iCloud Drive",
  defaultPath: "/Users/someone/Documents/Q",
  homePath: "/Users/someone/Q",
  homeCloud: null,
};
const home: QFolderInfo = { ...icloud, path: "/Users/someone/Q", isDefault: false, cloud: null };

describe("Q のフォルダ（バックアップ・書き出しの置き場所）", () => {
  test("Rust の側の答えを受け取る。場所がわからない答えは使わない", async () => {
    const calls: unknown[] = [];
    const info = await getQFolder(async (cmd, args) => {
      calls.push([cmd, args]);
      return icloud;
    });
    expect(info).toEqual(icloud);
    expect(calls).toEqual([["q_folder", undefined]]);
    await expect(getQFolder(async () => null)).rejects.toThrow("Q のフォルダがわかりません");
    await expect(getQFolder(async () => ({ ...icloud, path: "" }))).rejects.toThrow("Q のフォルダがわかりません");
  });

  test("クラウドと同期しているときの知らせ", () => {
    const message = cloudFolderMessage(icloud);
    expect(message).toContain("Q のフォルダ（/Users/someone/Documents/Q）は、iCloud Drive と同期しています。");
    expect(message).toContain("バックアップ・書き出したファイルが、自動でクラウドに上がります");
    expect(message).toContain("同期しない場所に変えてください。");
    expect(missingFolderMessage(home)).toContain("Q のフォルダ（/Users/someone/Q）が見つかりません。");
  });

  test("同期する場所の会社ファイルを開く前の知らせには、移し方（-wal もいっしょに）を書く", () => {
    const message = cloudFileMessage("OneDrive");
    expect(message.startsWith("この会社ファイルは、OneDrive と同期する場所にあります。\n")).toBe(true);
    expect(message).toContain("同期しない場所（Q のフォルダなど）に移してから開くことをおすすめします。");
    expect(message).toContain("Q で閉じてから移し、名前の後ろに「-wal」が付いた同じ名前のファイルがあれば、いっしょに移してください。");
    expect(pickedCloudMessage({ path: "/Users/someone/Library/CloudStorage/Drive/Q", cloud: "クラウドのフォルダ" }))
      .toContain("選んだフォルダ（/Users/someone/Library/CloudStorage/Drive/Q）も、クラウドのフォルダ と同期しています。");
  });

  test("場所を変えたときは、前のフォルダのファイルが残っていることを知らせる", () => {
    const message = changedMessage(icloud, home);
    expect(message).toContain("Q のフォルダを「/Users/someone/Q」にしました。");
    expect(message).toContain("前のフォルダ（/Users/someone/Documents/Q）にあるバックアップ・書き出したファイルと会社ファイルは、そのまま残っています。");
    expect(message).not.toContain("新しいフォルダも");
    expect(changedMessage(home, { ...home, path: "/Volumes/外付け/Q", cloud: "OneDrive" })).toContain("新しいフォルダも、OneDrive と同期しています。");
    expect(changedMessage(home, home)).toBe("Q のフォルダは「/Users/someone/Q」のままです。");
  });

  test("Q のフォルダの場所は qFolder.ts で決める（書類フォルダを直接使わない）", () => {
    const direct = sourceFiles(SRC).filter((path) => /documentDir\(|BaseDirectory\.Document\b/.test(readFileSync(path, "utf8")));
    expect(direct).toEqual([]);
  });

  test("フォルダの名前は、Rust の側・権限（書類フォルダの Q はいつも読み書きできる）と同じ", () => {
    const rust = readFileSync(join(ROOT, "src-tauri/src/q_folder.rs"), "utf8");
    expect(rust).toContain(`pub const FOLDER_NAME: &str = "${APP_DIR_NAME}";`);
    expect(rust).toContain(`const SUBFOLDERS: [&str; 2] = ["${BACKUP_DIR_NAME}", "${EXPORT_DIR_NAME}"];`);
    const capability = JSON.parse(readFileSync(join(ROOT, "src-tauri/capabilities/default.json"), "utf8"));
    const scope = capability.permissions.find((p: any) => p.identifier === "fs:scope");
    expect(scope.allow.map((a: any) => a.path)).toEqual([`$DOCUMENT/${APP_DIR_NAME}`, `$DOCUMENT/${APP_DIR_NAME}/**`]);
    // 画面からは好きな場所を指せない（Q のフォルダを変える命令は、選び方だけを受け取る）
    const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toMatch(/fn apply_q_folder\(\s*app: tauri::AppHandle,\s*pending: tauri::State<'_, q_folder::PendingFolder>,\s*choice: String,\s*\)/);
    for (const command of ["q_folder", "pick_q_folder", "apply_q_folder", "cloud_place_of"]) {
      expect(lib).toMatch(new RegExp(`generate_handler!\\[[^\\]]*\\b${command}\\b`));
    }
  });
});
