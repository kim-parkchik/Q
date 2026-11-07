/**
 * 打刻カード（QR コード）の印刷（くわしくは timeqard/DESIGN.md の 5.2）
 *
 * ・名刺の大きさ（91×55mm）。A4 に10枚（2列×5段。上下11mm・左右14mm の余白）。市販の A4 の名刺用紙（10面）に合わせた。
 *   ふつうの紙に刷って、切り取り線で切ってもよい。
 * ・QR コードの中身は「TQ1」＋会社の印＋カードの番号（スタッフID ではない）。誤り訂正は Q（約25%が汚れても読める）。
 *   QR コードは、まわりの白い余白を入れて 33mm 角（1マスは約0.9mm）。
 * ・画面には出さず、印刷するときだけ出す（Q の画面（#root）は印刷しない）。
 */
import { createPortal } from "react-dom";
import { cardPayload, jstDate, parseIso } from "../../../shared/timeqard";
import { encodeQr, qrSvgPath } from "../../utils/qrCode";
import type { CardStaff } from "./useTimeQardManager";

const QUIET = 4; // QR コードのまわりの白いマス（決まりでは4マス以上）

export function TimeQardCard({ companyName, companyMark, person, cutLine }: { companyName: string; companyMark: string; person: CardStaff; cutLine: boolean }) {
  if (!person.card) return null;
  const qr = encodeQr(cardPayload(companyMark, person.card.cardNumber), { ecc: "Q" });
  const n = qr.size + QUIET * 2;
  const issuedMs = parseIso(person.card.issuedAt);
  return (
    <div
      style={{
        width: "91mm",
        height: "55mm",
        boxSizing: "border-box",
        padding: "4mm 5mm",
        border: cutLine ? "0.2mm dashed #aaa" : "0.2mm solid transparent",
        display: "flex",
        gap: "4mm",
        alignItems: "center",
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        fontFamily: "'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif",
        breakInside: "avoid",
      }}
    >
      <svg viewBox={`0 0 ${n} ${n}`} style={{ width: "33mm", height: "33mm", flex: "none" }} shapeRendering="crispEdges" role="img" aria-label="打刻カードの QR コード">
        <rect width={n} height={n} fill="#fff" />
        <path d={qrSvgPath(qr, QUIET)} fill="#000" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "7pt", color: "#333", letterSpacing: "0.04em" }}>TimeQard 打刻カード</div>
        <div style={{ fontSize: "8pt", marginTop: "1mm", overflowWrap: "anywhere" }}>{companyName}</div>
        <div style={{ fontSize: "14pt", fontWeight: "bold", marginTop: "3mm", overflowWrap: "anywhere", lineHeight: 1.2 }}>{person.name}</div>
        <div style={{ fontSize: "9pt", marginTop: "1mm" }}>ID {person.id}</div>
        <div style={{ fontSize: "6.5pt", color: "#333", marginTop: "3mm", lineHeight: 1.45 }}>
          入口でかざしてください。
          <br />
          なくしたら担当者へ。
        </div>
        {issuedMs !== null && <div style={{ fontSize: "6pt", color: "#555", marginTop: "1mm" }}>作った日 {jstDate(issuedMs)}</div>}
      </div>
    </div>
  );
}

export default function CardPrintSheet(props: { companyName: string; companyMark: string; people: CardStaff[]; cutLine: boolean }) {
  const pages: CardStaff[][] = [];
  for (let i = 0; i < props.people.length; i += 10) pages.push(props.people.slice(i, i + 10));
  return createPortal(
    <div id="timeqard-card-print">
      <style>{`
        @media screen { #timeqard-card-print { display: none; } }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          #root { display: none !important; }
          #timeqard-card-print .tq-page {
            width: 210mm; height: 297mm; box-sizing: border-box; padding: 11mm 14mm;
            display: grid; grid-template-columns: 91mm 91mm; grid-template-rows: repeat(5, 55mm);
            break-after: page; page-break-after: always; overflow: hidden;
          }
          #timeqard-card-print .tq-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      {pages.map((page, i) => (
        <div className="tq-page" key={i}>
          {page.map((p) => (
            <TimeQardCard key={p.id} companyName={props.companyName} companyMark={props.companyMark} person={p} cutLine={props.cutLine} />
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}
