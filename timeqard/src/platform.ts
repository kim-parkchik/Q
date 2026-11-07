/**
 * パソコンとのやりとり（Tauri）をまとめたところ。画面の部品からは、ここを通して使う。
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { join } from "@tauri-apps/api/path";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import type { KioskDb } from "./store";

/** 記録のファイル（timeqard.db。置き場所は OS ごとの設定のフォルダ） */
export const openKioskDb = async (): Promise<KioskDb> => {
  const db = await Database.load("sqlite:timeqard.db");
  return db as unknown as KioskDb;
};

export const hashPassword = (password: string) => invoke<string>("hash_password", { password });
export const verifyPassword = (password: string, hash: string) => invoke<boolean>("verify_password", { password, hash });

/** TimeQard を閉じる（管理のパスワードを確かめたあとだけ呼ぶ） */
export const quitApp = () => invoke<void>("quit_app");

/** 閉じるボタン（Alt+F4・⌘Q も）が押されたとき（パスワードを聞いてから閉じる） */
export const onCloseRequested = (handler: () => void) => listen("timeqard://close-requested", handler);

export const setFullscreen = async (on: boolean) => {
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch (e) {
    console.warn("画面いっぱいにできませんでした", e);
  }
};

export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (enabled: boolean) => invoke<void>("set_autostart", { enabled });

/** 記録のファイルの置き場所（控えから戻すときに使う） */
export const dataDir = () => invoke<string>("data_dir");

/** 古い控えを消す（新しいものから keep 個を残す。TimeQard が作った名前の控えだけ） */
export const pruneBackups = (dir: string, keep: number) => invoke<number>("prune_backups", { dir, keep });

export const joinPath = (...parts: string[]) => join(...parts);

/** ファイルを選んで、文字として読む（選ばなければ null） */
export const pickTextFile = async (title: string, extensions: string[]) => {
  const path = await open({ title, multiple: false, directory: false, filters: [{ name: title, extensions }] });
  if (!path || Array.isArray(path)) return null;
  const text = await readTextFile(path);
  return { path, name: path.split(/[\\/]/).pop() ?? path, text };
};

/** フォルダを選ぶ（選ばなければ null） */
export const pickFolder = async (title: string) => {
  const path = await open({ title, directory: true, multiple: false });
  return !path || Array.isArray(path) ? null : path;
};

/** CSV を保存する（Excel で文字化けしないよう、BOM を付けた UTF-8） */
export const saveCsv = async (content: string, defaultName: string) => {
  const path = await save({ title: "保存先を選んでください（USB メモリなど）", defaultPath: defaultName, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return null;
  const body = new TextEncoder().encode(content);
  const data = new Uint8Array(body.length + 3);
  data.set([0xef, 0xbb, 0xbf], 0);
  data.set(body, 3);
  await writeFile(path, data);
  return { path, name: path.split(/[\\/]/).pop() ?? path };
};

export const confirm = (text: string, title: string, okLabel = "はい", cancelLabel = "いいえ") =>
  ask(text, { title, kind: "warning", okLabel, cancelLabel });
