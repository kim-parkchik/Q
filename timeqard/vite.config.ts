// TimeQard の画面を作る（Q と同じ部品（React・Vite）を、リポジトリのいちばん上の node_modules から使う）
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1430, // Q（1420）と同時に動かせるように
    strictPort: true,
    fs: { allow: [repoRoot] }, // shared/timeqard を読むため
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: ["es2020", "safari15", "chrome105"], // macOS 10.15 に入る最後の Safari（15）・Ubuntu 22.04 の WebKitGTK・Windows の WebView2 で動くように
    rollupOptions: {
      // index.html：入口のパソコンの画面。web.html：各自のパソコンのブラウザで開く画面（ブラウザ版。TimeQard のサーバーが出す）
      input: { main: `${here}index.html`, web: `${here}web.html` },
    },
  },
});
