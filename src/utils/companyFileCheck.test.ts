import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { companyFileProblem, sqliteUrl } from "./companyFileCheck";

const SRC = join(import.meta.dir, "..");

/** src の中の .ts・.tsx（テストは除く） */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe("会社ファイルを開く前の確かめ（となりにある作業中のファイル -wal）", () => {
  test("Rust の check_company_file に、Database.load と同じ sqlite:… を渡す", async () => {
    const calls: unknown[] = [];
    const url = sqliteUrl("/Users/someone/Documents/Q/会社.qp");
    expect(url).toBe("sqlite:/Users/someone/Documents/Q/会社.qp");
    const problem = await companyFileProblem(url, async (cmd, args) => {
      calls.push([cmd, args]);
      return null;
    });
    expect(problem).toBeNull();
    expect(calls).toEqual([["check_company_file", { db: "sqlite:/Users/someone/Documents/Q/会社.qp" }]]);
  });

  test("合っていなければ、Rust の側の知らせをそのまま返す。確かめられなかったときも開かない", async () => {
    const message = "この会社ファイルは開きません。\nとなりにある作業中のファイル「会社.qp-wal」と会社ファイルとで、ページの大きさが合っていません";
    expect(await companyFileProblem("sqlite:/x/会社.qp", async () => { throw message; })).toBe(message);
    expect(await companyFileProblem("sqlite:/x/会社.qp", async () => { throw new Error("読めません"); })).toBe("読めません");
  });

  test("会社ファイルを開くのは useApp.ts の1か所だけで、開く前にかならず確かめる", () => {
    const opens = sourceFiles(SRC).filter((path) => /Database\.load\(/.test(readFileSync(path, "utf8")));
    expect(opens.map((path) => relative(SRC, path))).toEqual(["useApp.ts"]);
    const app = readFileSync(join(SRC, "useApp.ts"), "utf8");
    expect(app.match(/Database\.load\(/g)).toHaveLength(1);
    expect(app).toContain("Database.load(url)");
    const check = app.indexOf("await companyFileProblem(url)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(app.indexOf("Database.load(url)"));
    // 合っていなければ、開かずに戻る
    expect(app.slice(check, app.indexOf("Database.load(url)"))).toContain("return;");
  });
});
