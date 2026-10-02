/**
 * ファイルの保存（保存先を選ぶ窓を出して書き込む）
 *
 * ブラウザ式のダウンロードだと「ダウンロード」フォルダに黙って保存されてしまうため、
 * Tauri の保存ダイアログで場所とファイル名を選んでもらう。
 * 初期位置は「書類/Q/Export」フォルダ。
 */
import { save } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { APP_DIR_NAME, EXPORT_DIR_NAME } from "../constants/appConfig";

export interface SavedFile {
    /** 保存したファイルのフルパス */
    path: string;
    /** 保存したファイル名（パスの最後の部分） */
    name: string;
}

/** パスからファイル名だけを取り出す（Mac / Windows 両対応） */
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * CSV を保存する（Excel で文字化けしないよう、先頭に BOM を付けた UTF-8 で保存）
 * @param content CSV の中身
 * @param defaultFileName 保存ダイアログに最初に入っているファイル名
 * @returns 保存したファイルの情報。キャンセルされたら null
 */
export const saveCsvFile = async (content: string, defaultFileName: string): Promise<SavedFile | null> => {
    // 初期フォルダ（書類/Q/Export）を用意する。作れなくても保存自体は続ける。
    let defaultPath = defaultFileName;
    try {
        const exportDir = await join(await documentDir(), APP_DIR_NAME, EXPORT_DIR_NAME);
        await mkdir(exportDir, { recursive: true });
        defaultPath = await join(exportDir, defaultFileName);
    } catch (e) {
        console.warn("出力フォルダの準備に失敗しました:", e);
    }

    const path = await save({
        title: "保存先を選んでください",
        defaultPath,
        filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return null; // キャンセル

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = new TextEncoder().encode(content.replace(/^﻿/, "")); // BOMの二重付与を防ぐ
    const data = new Uint8Array(bom.length + body.length);
    data.set(bom, 0);
    data.set(body, bom.length);

    await writeFile(path, data);
    return { path, name: baseName(path) };
};
