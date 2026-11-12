/**
 * ブラウザ版の画面（各自のパソコンのブラウザで開く。timeqard/DESIGN.md の 10）
 *
 * 入口のパソコンの TimeQard（src-tauri/src/web.rs）が、同じネットワークの中だけに https で出す。
 * この画面は、TimeQard の決まった口（/api/…）にしか頼まず、記録のファイルには触れない。Tauri の部品は使わない。
 */
import { createRoot } from "react-dom/client";
import WebApp from "./WebApp";
import "./web.css";

createRoot(document.getElementById("root") as HTMLElement).render(<WebApp />);
