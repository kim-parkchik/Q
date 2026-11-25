/**
 * マイナンバーを書いた届書のファイルの知らせと、保存する前の確かめ（見直しの P6。utils/myNumberFiles.ts・
 * fileSaveUtils.ts の pickPathWithCheck・features/mynumber/useMyNumberFileGuard.ts）のテスト
 * 実行方法: bun test
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pickPathWithCheck } from "./fileSaveUtils";
import {
  KEEP_PERIODS, MY_NUMBER_CLOUD_CHOICES, MY_NUMBER_CLOUD_TITLE, MY_NUMBER_FILE_TITLE, myNumberCloudCheck, myNumberCloudMessage, myNumberFileNotice,
} from "./myNumberFiles";

describe("保存したあとの知らせ（myNumberFileNotice）", () => {
  test("年金事務所に出すファイル：ファイルの名前・人数・場所と、出し終わったら消すこと、健康保険・厚生年金保険の書類を残す期間（2年）", () => {
    const text = myNumberFileNotice({ name: "SHFD0006.CSV", path: "/Users/sample/Documents/Q/Export/SHFD0006.CSV", count: 3, kind: "pension" });
    expect(text.split("\n")).toEqual([
      "「SHFD0006.CSV」に、マイナンバーを3人分、暗号化せずに書きました。",
      "保存した場所：",
      "/Users/sample/Documents/Q/Export/SHFD0006.CSV",
      "",
      "・出し終わったら、このファイルを消してください。ごみ箱に入れたときは、ごみ箱も空にしてください。",
      "・控えとして残すときは、ほかの人が見られない場所に置き、法令で残す期間（健康保険・厚生年金保険の書類は、完結の日から2年）が過ぎたら、早めに消してください。",
      "・USB メモリやほかのパソコンに写したときは、そちらからも消してください。",
    ]);
    expect(MY_NUMBER_FILE_TITLE).toBe("マイナンバーが入ったファイルです");
  });

  test("健康保険組合は健康保険の書類（2年）、ハローワークは雇用保険の被保険者に関する書類（4年）。税（eLTAX・e-Tax）は期間を書かない", () => {
    const of = (kind: "healthUnion" | "employment" | "tax") =>
      myNumberFileNotice({ name: "a.csv", path: "C:\\Users\\sample\\Documents\\Q\\Export\\a.csv", count: 1, kind });
    expect(of("healthUnion")).toContain("法令で残す期間（健康保険の書類は、完結の日から2年）が過ぎたら、早めに消してください。");
    expect(of("employment")).toContain("法令で残す期間（雇用保険の被保険者に関する書類は、完結の日から4年）が過ぎたら、早めに消してください。");
    expect(of("tax")).toContain("・控えとして残すときは、ほかの人が見られない場所に置き、要らなくなったら、早めに消してください。");
    expect(of("tax")).not.toContain("法令で残す期間");
    expect(of("tax")).toContain("保存した場所：\nC:\\Users\\sample\\Documents\\Q\\Export\\a.csv");
    expect(Object.keys(KEEP_PERIODS).sort()).toEqual(["employment", "healthUnion", "pension", "tax"]);
  });
});

describe("保存する前の確かめ（myNumberCloudCheck）", () => {
  const errors: unknown[] = [];
  const original = console.error;
  beforeEach(() => {
    errors.length = 0;
    console.error = (...a: unknown[]) => { errors.push(a); };
  });
  afterEach(() => { console.error = original; });

  /** 聞いた文を残し、決めた答えを返す */
  const asker = (answer: number | null) => {
    const asked: string[] = [];
    return { asked, ask: async (m: string) => { asked.push(m); return answer; } };
  };

  test("同期しない場所なら、聞かずに書く。同期しているかわからないとき（確かめられなかったとき）も、聞かずに書く", async () => {
    const a = asker(0);
    expect(await myNumberCloudCheck(async () => null, a.ask)("/Users/sample/Q/Export/SHFD0006.CSV")).toBe(true);
    expect(await myNumberCloudCheck(async () => { throw new Error("見分けられない"); }, a.ask)("/Users/sample/Q/Export/SHFD0006.CSV")).toBe(true);
    expect(a.asked).toEqual([]);
    expect(errors.length).toBe(1);
  });

  test("同期する場所なら聞く：「ほかの場所を選ぶ」はもう一度選ぶ、「このまま保存する」は書く、「やめる」は書かない", async () => {
    const path = "/Users/sample/Library/Mobile Documents/com~apple~CloudDocs/SHFD0006.CSV";
    const cloud = async () => "iCloud Drive";
    expect(MY_NUMBER_CLOUD_CHOICES).toEqual(["ほかの場所を選ぶ", "このまま保存する"]);
    expect(MY_NUMBER_CLOUD_TITLE).toBe("クラウドと同期する場所です");
    const again = asker(0);
    expect(await myNumberCloudCheck(cloud, again.ask)(path)).toBe("again");
    expect(again.asked).toEqual([myNumberCloudMessage("iCloud Drive", path)]);
    expect(await myNumberCloudCheck(cloud, asker(1).ask)(path)).toBe(true);
    expect(await myNumberCloudCheck(cloud, asker(null).ask)(path)).toBe(false);
  });

  test("確かめの文：クラウドの名前と、ファイルの名前（Windows の場所でも）", () => {
    expect(myNumberCloudMessage("OneDrive", "C:\\Users\\sample\\OneDrive\\書類\\給与支払報告書_2026年分.csv").split("\n")).toEqual([
      "選んだ場所は、OneDrive と同期するフォルダの中です。",
      "「給与支払報告書_2026年分.csv」には、マイナンバーを暗号化せずに書くので、このまま保存すると、マイナンバーがクラウドに上がります" +
        "（このパソコンで消しても、クラウドのごみ箱などに、しばらく残ることがあります）。",
      "同期しない場所を選び直してください。",
    ]);
  });
});

describe("保存の窓で選んだ場所と、書く前の確かめ（pickPathWithCheck）", () => {
  /** 保存の窓の代わり（選ぶ場所を順に返す） */
  const picker = (...paths: (string | null)[]) => {
    let i = 0;
    const pick = async () => paths[i++] ?? null;
    return { pick, count: () => i };
  };

  test("確かめがなければ、選んだ場所に書く。キャンセルなら書かない", async () => {
    const p = picker("/Users/sample/Q/Export/a.csv");
    expect(await pickPathWithCheck(p.pick)).toBe("/Users/sample/Q/Export/a.csv");
    const c = picker(null);
    let checked = 0;
    expect(await pickPathWithCheck(c.pick, async () => { checked++; return true; })).toBeNull();
    expect(checked).toBe(0);
  });

  test("「ほかの場所を選ぶ」なら保存の窓をもう一度出し、同期しない場所を選べば聞かずに書く。「やめる」なら書かない", async () => {
    const icloud = "/Users/sample/Library/Mobile Documents/com~apple~CloudDocs/SHFD0006.CSV";
    const home = "/Users/sample/Q/Export/SHFD0006.CSV";
    const cloudOf = async (path: string) => (path.includes("Mobile Documents") ? "iCloud Drive" : null);
    const asked: string[] = [];
    const p = picker(icloud, home);
    const check = myNumberCloudCheck(cloudOf, async (m) => { asked.push(m); return 0; });
    expect(await pickPathWithCheck(p.pick, check)).toBe(home);
    expect([p.count(), asked.length]).toEqual([2, 1]);
    // このまま保存する
    expect(await pickPathWithCheck(picker(icloud).pick, myNumberCloudCheck(cloudOf, async () => 1))).toBe(icloud);
    // やめる
    const q = picker(icloud, home);
    expect(await pickPathWithCheck(q.pick, myNumberCloudCheck(cloudOf, async () => null))).toBeNull();
    expect(q.count()).toBe(1);
  });
});

describe("マイナンバーを書いた届書のファイルを保存するところ", () => {
  const SRC = join(import.meta.dir, "..");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  test("6つの保存（年金事務所・健康保険組合・ハローワーク・給与支払報告書・給与所得者異動届出書・e-Tax）は、書く前に確かめ、保存したあとに知らせる", () => {
    const shaho = read("features/payroll/useShahoFile.ts");
    expect(shaho.match(/guard\.saveOptions\(myNumbers\)/g)?.length).toBe(2);
    expect(shaho).toContain(`guard.notice(saved, myNumbers, "pension")`);
    expect(shaho).toContain(`guard.notice(saved, myNumbers, "healthUnion")`);
    const sites: [string, string, string][] = [
      ["features/payroll/useKoyoReportManager.ts", "resolved.count", "employment"],
      ["features/nencho/useSalaryPaymentReportManager.ts", "out.myNumbers", "tax"],
      ["features/payroll/ResidentTaxIdouManager.tsx", "withNumbers", "tax"],
      ["features/payroll/RetirementManager.tsx", "myNumbers", "tax"],
    ];
    for (const [file, count, kind] of sites) {
      const text = read(file);
      expect(text).toContain(`guard.saveOptions(${count})`);
      expect(text).toContain(`guard.notice(saved, ${count}, "${kind}")`);
    }
  });

  test("年金事務所・健康保険組合に出すファイルは、書いたマイナンバーの人数を渡す", () => {
    expect(read("features/payroll/useShahoMyNumbers.ts")).toContain("label, count, resolved.count);");
    expect(read("features/payroll/useLeaveReportManager.ts")).toContain("label, included.length, resolved.count);");
    expect(read("features/payroll/ShahoFilePanel.tsx")).toContain("label, rows.length, resolved.count);");
  });

  test("マイナンバーを読んでファイルを保存するところは、どれも書く前に確かめる（ほかの保存を見落とさない）", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(SRC);
    const savers = files.filter((p) => {
      const text = readFileSync(p, "utf8");
      return /readNumbers\(|my\.resolve\(/.test(text) && /save(Csv|Binary|Text)File\(/.test(text);
    });
    expect(savers.map((p) => p.slice(SRC.length + 1)).sort()).toEqual([
      "features/nencho/useSalaryPaymentReportManager.ts",
      "features/payroll/ResidentTaxIdouManager.tsx",
      "features/payroll/RetirementManager.tsx",
      "features/payroll/useKoyoReportManager.ts",
    ]);
    for (const p of savers) expect(readFileSync(p, "utf8")).toContain("guard.saveOptions(");
  });
});
