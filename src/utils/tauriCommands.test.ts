/**
 * Rust のコマンド（lib.rs の generate_handler! に登録したもの）は、どれも画面から使うことのテスト（見直しの P7）
 * ・画面から使わないコマンドを残すと、要らない入口が増える（前は、Tauri のひな形の見本 greet が残っていた）。
 * ・Q は src-tauri/src/lib.rs と src・shared、TimeQard は timeqard/src-tauri/src/lib.rs と timeqard/src・shared を見る。
 *   テストのファイルと確かめ用の画面（timeqard/dev）の中は、使ったうちに数えない。
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** lib.rs の generate_handler![…] に登録したコマンドの名前（web::web_start は web_start） */
const commandsOf = (lib: string): string[] => {
  const list = lib.match(/generate_handler!\[([^\]]*)\]/);
  if (!list) return [];
  return list[1].split(",").map((s) => s.trim().split("::").pop() ?? "").filter(Boolean);
};

/** dirs の中の .ts・.tsx（テストのファイルを除く）の中身をつないだもの */
const sourceOf = (dirs: string[]): string => {
  const texts: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) texts.push(readFileSync(p, "utf8"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return texts.join("\n");
};

/** 画面のどこにも「"名前"」と書いていないコマンド */
const unusedOf = (commands: string[], source: string) => commands.filter((c) => !source.includes(`"${c}"`));

describe("Rust のコマンドは、どれも画面から使う", () => {
  test("Q：登録したコマンドは、どれも画面から呼ぶ。Tauri のひな形の見本（greet）は残さない", () => {
    const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    const commands = commandsOf(lib);
    // 一覧を読めていること（読めなければ、何も確かめずに通ってしまう）
    expect(commands).toContain("hash_password");
    expect(commands).not.toContain("greet");
    expect(lib).not.toMatch(/\bfn greet\b/);
    expect(unusedOf(commands, sourceOf(["src", "shared"]))).toEqual([]);
  });

  test("TimeQard：登録したコマンドは、どれも画面から呼ぶ", () => {
    const commands = commandsOf(readFileSync(join(ROOT, "timeqard/src-tauri/src/lib.rs"), "utf8"));
    expect(commands).toContain("web_start");
    expect(unusedOf(commands, sourceOf(["timeqard/src", "shared"]))).toEqual([]);
  });

  test("一覧の読み方：モジュールの名前を外し、最後の「,」や空白・改行は数えない。画面に書いていなければ、使っていない", () => {
    expect(commandsOf("tauri::generate_handler![\n    a,\n    web::b,\n    c\n]")).toEqual(["a", "b", "c"]);
    expect(commandsOf("tauri::generate_handler![a, b,]")).toEqual(["a", "b"]);
    expect(commandsOf("一覧がない")).toEqual([]);
    expect(unusedOf(["a", "b"], `invoke("a", {});`)).toEqual(["b"]);
  });
});
