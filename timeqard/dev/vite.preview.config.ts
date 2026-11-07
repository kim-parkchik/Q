// TimeQard の確かめ用の画面（dev/preview.html）。記録のファイル（src/store.ts）を dev/fakeStore.ts に入れ替える（開発用）
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fakeStore = fileURLToPath(new URL("./fakeStore.ts", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [{ find: /^\.\/store$/, replacement: fakeStore }],
  },
  server: {
    host: "localhost",
    port: 1432,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
});
