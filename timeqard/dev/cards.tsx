/**
 * Q で印刷する打刻カード（src/features/timeqard/CardPrintSheet.tsx）を、A4 の1枚の並びで画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/cards.html を開く
 */
import { createRoot } from "react-dom/client";
import { newCardNumber } from "../../shared/timeqard";
import { TimeQardCard } from "../../src/features/timeqard/CardPrintSheet";
import type { CardStaff } from "../../src/features/timeqard/useTimeQardManager";

const names = ["山田 太郎", "佐藤 花子", "長谷川 ジェニファー 美由紀", "鈴木 一郎", "ジョン・スミス", "髙橋 﨑子", "田中 誠", "渡辺 さくら", "伊藤 健太郎", "小林 あおい"];
const people: CardStaff[] = names.map((name, i) => ({
  id: String(1001 + i * 7),
  name,
  status: "active",
  joinDate: "2019-04-01",
  retirementDate: "",
  card: { id: i + 1, staffId: String(1001 + i * 7), cardNumber: newCardNumber(), issuedAt: "2026-11-07T10:00:00+09:00" },
}));

createRoot(document.getElementById("root") as HTMLElement).render(
  <div className="tq-page">
    {people.map((p) => (
      <TimeQardCard key={p.id} companyName="株式会社 確かめ用サンプル商事 東京本社" companyMark="K7M3QP2X" person={p} cutLine />
    ))}
  </div>
);
