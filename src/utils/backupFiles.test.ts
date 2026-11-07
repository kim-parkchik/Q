/**
 * バックアップ（.qb）の名前と、残す世代の整理のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { backupFileName, backupsBeforeEncryption, backupsToDelete, backupTimeOf, companyBaseName, isBackupFile, isBackupOf, restoredFileName } from "./backupFiles";

describe("バックアップの名前", () => {
    test("会社ファイルの名前（拡張子を除く）", () => {
        expect(companyBaseName("/Users/a/Documents/Q/山田商店.qp")).toBe("山田商店");
        expect(companyBaseName("C:\\Users\\a\\Documents\\Q\\Tom's.qp")).toBe("Tom's");
    });
    test("秒まで入れる（同じ分のうちに2回閉じても、名前がぶつからない）", () => {
        expect(backupFileName("山田商店", new Date(2026, 10, 6, 9, 5, 7))).toBe("山田商店_20261106_090507.qb");
    });
});

describe("残す世代の整理（その会社ファイルのバックアップだけ）", () => {
    test("名前の頭が同じ別の会社ファイル（山田商店2）のバックアップは、数えない・消さない", () => {
        const files = [
            "山田商店_20261101_090000.qb", "山田商店_20261102_090000.qb", "山田商店_20261103_090000.qb",
            "山田商店2_20261101_090000.qb", "山田商店2_20261102_090000.qb",
        ];
        expect(backupsToDelete(files, "山田商店", 2)).toEqual(["山田商店_20261101_090000.qb"]);
        expect(backupsToDelete(files, "山田商店2", 1)).toEqual(["山田商店2_20261101_090000.qb"]);
    });
    test("「ABC」を閉じても、「ABC商事」のバックアップを消さない（自分のバックアップも残す）", () => {
        const files = ["ABC商事_20261105_090000.qb", "ABC商事_20261106_090000.qb", "ABC_20261101_090000.qb"];
        expect(backupsToDelete(files, "ABC", 1)).toEqual([]);
    });
    test("以前の名前（秒なしの「_HHMM」）も数え、日時の順に並べる", () => {
        const files = ["会社_20261106_1259.qb", "会社_20261106_120130.qb", "会社_20261105_2359.qb"];
        expect(backupsToDelete(files, "会社", 2)).toEqual(["会社_20261105_2359.qb"]);
    });
    test("バックアップから作った写しのバックアップ・バックアップのバックアップは、もとの会社ファイルの世代に数えない", () => {
        expect(isBackupOf("会社_20261106_120130_復元_20261107_090000.qb", "会社")).toBe(false);
        expect(isBackupOf("会社_20261106_1200_20261107_0900.qb", "会社")).toBe(false);
        expect(isBackupOf("会社_20261106_120130_復元_20261107_090000.qb", "会社_20261106_120130_復元")).toBe(true);
    });
    test("名前に記号があっても、その文字のまま見分ける", () => {
        expect(isBackupOf("(株)山田_20261106_120130.qb", "(株)山田")).toBe(true);
        expect(isBackupOf("(株)山田_20261106_120130.qb", "株)山田")).toBe(false);
        expect(isBackupOf("a.b_20261106_120130.qb", "a.b")).toBe(true);
        expect(isBackupOf("axb_20261106_120130.qb", "a.b")).toBe(false);
        expect(isBackupOf("会社_20261106_120130.qp", "会社")).toBe(false);
    });
    test("残す世代数が空・0なら10世代", () => {
        const files = Array.from({ length: 12 }, (_, i) => `会社_202611${String(i + 1).padStart(2, "0")}_090000.qb`);
        expect(backupsToDelete(files, "会社", null)).toEqual(["会社_20261102_090000.qb", "会社_20261101_090000.qb"]);
        expect(backupsToDelete(files, "会社", 0)).toHaveLength(2);
        expect(backupsToDelete(files, "会社", 12)).toEqual([]);
        expect(backupsToDelete(files, "会社", 11)).toEqual(["会社_20261101_090000.qb"]);
    });
});

describe("バックアップを開く（写しの会社ファイルを作る）", () => {
    test("写しの名前は「バックアップの名前_復元.qp」", () => {
        expect(restoredFileName("/Users/a/Documents/Q/Backup/山田商店_20261106_120130.qb")).toBe("山田商店_20261106_120130_復元.qp");
    });
    test(".qb のファイルか", () => {
        expect(isBackupFile("/a/b.qb")).toBe(true);
        expect(isBackupFile("/a/b.QB")).toBe(true);
        expect(isBackupFile("/a/b.qp")).toBe(false);
    });
});

describe("マイナンバーの暗号化を始める前のバックアップ", () => {
    test("名前から、バックアップを作った日時を読む（以前の秒のない名前は00秒）", () => {
        expect(backupTimeOf("山田商店_20261106_120130.qb", "山田商店")).toBe("2026-11-06 12:01:30");
        expect(backupTimeOf("山田商店_20261106_1201.qb", "山田商店")).toBe("2026-11-06 12:01:00");
        expect(backupTimeOf("山田商店2_20261106_120130.qb", "山田商店")).toBeNull();
        expect(backupTimeOf("山田商店_20261106_120130_復元_20261107_090000.qb", "山田商店")).toBeNull();
    });
    test("暗号化を始めた日時より前に作ったものと、始めてからのものに分ける（その会社ファイルのものだけ。古い順）", () => {
        const files = [
            "山田商店_20261107_180000.qb", "山田商店_20261105_1730.qb", "山田商店_20261106_120130.qb",
            "山田商店2_20261101_090000.qb", "メモ.txt",
        ];
        expect(backupsBeforeEncryption(files, "山田商店", "2026-11-06 15:00:00")).toEqual({
            before: ["山田商店_20261105_1730.qb", "山田商店_20261106_120130.qb"],
            after: ["山田商店_20261107_180000.qb"],
        });
    });
    test("暗号化を始めたのと同じ秒に作ったバックアップは、始めてからのもの（閉じたときに作るので）", () => {
        expect(backupsBeforeEncryption(["会社_20261106_150000.qb"], "会社", "2026-11-06 15:00:00")).toEqual({ before: [], after: ["会社_20261106_150000.qb"] });
    });
});
