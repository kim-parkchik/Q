/**
 * ファイルの保存（保存先を選ぶ窓を出して書き込む）
 *
 * ブラウザ式のダウンロードだと「ダウンロード」フォルダに黙って保存されてしまうため、
 * Tauri の保存ダイアログで場所とファイル名を選んでもらう。
 * 初期位置は Q のフォルダの「Export」フォルダ（初めは書類フォルダの Q/Export。utils/qFolder.ts）。
 * 書く前の確かめ（options.beforeWrite）を渡すと、選んだ場所を見てから書く（マイナンバーを書いた届書のファイル。見直しの P6）。
 */
import { save } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { EXPORT_DIR_NAME } from "../constants/appConfig";
import { qFolderPath } from "./qFolder";

export interface SavedFile {
    /** 保存したファイルのフルパス */
    path: string;
    /** 保存したファイル名（パスの最後の部分） */
    name: string;
}

/** パスからファイル名だけを取り出す（Mac / Windows 両対応） */
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * 書く前の確かめ（保存の窓で選んだ場所を見て決める）。true なら書く。"again" なら保存の窓をもう一度出す（ほかの場所を選ぶ）。
 * false なら書かずにやめる（キャンセルと同じく null を返す）
 */
export type BeforeWrite = (path: string) => Promise<boolean | "again">;

/** 保存のしかた */
export interface SaveOptions {
    /** 書く前の確かめ（マイナンバーを書いた届書のファイルは、クラウドと同期する場所かを見る。features/mynumber/useMyNumberFileGuard.ts） */
    beforeWrite?: BeforeWrite;
}

/** 保存の窓の初めの場所（Q のフォルダの Export。用意できなくても保存自体は続けるので、そのときはファイル名だけ） */
const exportPathOf = async (defaultFileName: string): Promise<string> => {
    try {
        const exportDir = await qFolderPath(EXPORT_DIR_NAME);
        await mkdir(exportDir, { recursive: true });
        return await join(exportDir, defaultFileName);
    } catch (e) {
        console.warn("出力フォルダの準備に失敗しました:", e);
        return defaultFileName;
    }
};

/**
 * 場所を選んでもらい、書く前の確かめをする（"again" なら、もう一度選んでもらう）。キャンセルしたとき・確かめでやめたときは null
 * @param pick 保存の窓を出して、選んだ場所を返す（キャンセルなら null）
 */
export const pickPathWithCheck = async (pick: () => Promise<string | null>, beforeWrite?: BeforeWrite): Promise<string | null> => {
    for (;;) {
        const path = await pick();
        if (!path) return null; // キャンセル
        const answer = beforeWrite ? await beforeWrite(path) : true;
        if (answer === "again") continue;
        return answer ? path : null;
    }
};

/** 保存の窓で、保存する場所を選んでもらう（キャンセルしたとき・書く前の確かめでやめたときは null） */
const choosePath = async (defaultFileName: string, filter: { name: string; extensions: string[] }, options?: SaveOptions): Promise<string | null> => {
    const defaultPath = await exportPathOf(defaultFileName);
    return pickPathWithCheck(() => save({ title: "保存先を選んでください", defaultPath, filters: [filter] }), options?.beforeWrite);
};

/**
 * CSV を保存する（Excel で文字化けしないよう、先頭に BOM を付けた UTF-8 で保存）
 * @param content CSV の中身
 * @param defaultFileName 保存ダイアログに最初に入っているファイル名
 * @param options 書く前の確かめなど
 * @returns 保存したファイルの情報。キャンセルされたら null
 */
export const saveCsvFile = async (content: string, defaultFileName: string, options?: SaveOptions): Promise<SavedFile | null> => {
    const path = await choosePath(defaultFileName, { name: "CSV", extensions: ["csv"] }, options);
    if (!path) return null; // キャンセル

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = new TextEncoder().encode(content.replace(/^﻿/, "")); // BOMの二重付与を防ぐ
    const data = new Uint8Array(bom.length + body.length);
    data.set(bom, 0);
    data.set(body, bom.length);

    await writeFile(path, data);
    return { path, name: baseName(path) };
};

/**
 * 文字のファイル（JSON など）を、UTF-8（BOM なし）で保存する
 * @param filter 保存ダイアログで選べるファイルの種類（例: { name: "JSON", extensions: ["json"] }）
 * @param options 書く前の確かめなど
 * @returns 保存したファイルの情報。キャンセルされたら null
 */
export const saveTextFile = async (
    content: string,
    defaultFileName: string,
    filter: { name: string; extensions: string[] },
    options?: SaveOptions
): Promise<SavedFile | null> => {
    const path = await choosePath(defaultFileName, filter, options);
    if (!path) return null; // キャンセル

    await writeFile(path, new TextEncoder().encode(content));
    return { path, name: baseName(path) };
};

/**
 * バイトのファイル（銀行に送る振込データなど）を、そのまま保存する
 * @param filter 保存ダイアログで選べるファイルの種類（例: { name: "振込データ", extensions: ["txt"] }）
 * @param options 書く前の確かめなど
 * @returns 保存したファイルの情報。キャンセルされたら null
 */
export const saveBinaryFile = async (
    data: Uint8Array,
    defaultFileName: string,
    filter: { name: string; extensions: string[] },
    options?: SaveOptions
): Promise<SavedFile | null> => {
    const path = await choosePath(defaultFileName, filter, options);
    if (!path) return null; // キャンセル

    await writeFile(path, data);
    return { path, name: baseName(path) };
};
