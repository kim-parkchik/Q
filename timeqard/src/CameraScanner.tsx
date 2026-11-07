/**
 * パソコンのカメラで、打刻カードの QR コードを読む（くわしくは timeqard/DESIGN.md の 6）
 *
 * ・カメラの映像を小さく出し、1秒に5回くらい、1こまを小さくして（横480画素まで）QR コードを探す。
 * ・探すのは別の仕事（qrWorker.ts）でする（古いパソコンでも、時計やボタンが固まらないように）。
 *   別の仕事を動かせない画面の部品なら、画面の側で探す（そのときは、1秒に2回くらいにする）。
 * ・映像は保存せず、どこにも送らない。
 * ・カメラが使えないとき（ない・許されていない）は、わけを小さく出す（USB の読み取り機と ID で押すのは、いつでも使える）。
 */
import { useEffect, useRef, useState } from "react";

const SCAN_INTERVAL_MS = 200;
/** 別の仕事を使えず、画面の側で探すとき */
const MAIN_THREAD_INTERVAL_MS = 450;
const MAX_WIDTH = 480;

type Status = { kind: "starting" } | { kind: "on" } | { kind: "error"; message: string };

const describe = (e: unknown) => {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "カメラを使うことが許されていません（パソコンの設定で、TimeQard にカメラを許してください）。";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "カメラが見つかりません。";
  if (name === "NotReadableError") return "カメラをほかのソフトが使っているか、カメラが動きません。";
  return `カメラを使えません（${name || String(e)}）。`;
};

/** inline：打刻の画面のまん中に出す。hidden：見えなくする（人の画面などを出しているあいだも、次の人のカードを読めるように動かしておく） */
export default function CameraScanner(props: { deviceId: string; mode: "inline" | "hidden"; onDetect: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetect = useRef(props.onDetect);
  onDetect.current = props.onDetect;
  const [status, setStatus] = useState<Status>({ kind: "starting" });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let worker: Worker | null = null;
    let decodeHere: ((data: Uint8ClampedArray, w: number, h: number) => string | null) | null = null;
    let timer = 0;
    let waiting = false;
    // 別の仕事を動かせないときは、QR コードを読む部品（jsQR）を画面の側で読み込んで使う
    const useMainThread = async () => {
      worker?.terminate();
      worker = null;
      const { default: jsQR } = await import("jsqr");
      decodeHere = (data, w, h) => jsQR(data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
      waiting = false;
    };
    setStatus({ kind: "starting" });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("getUserMedia がありません"), { name: "NotSupported" });
        const size = { width: { ideal: 640 }, height: { ideal: 480 } };
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: props.deviceId ? { ...size, deviceId: { exact: props.deviceId } } : size,
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        try {
          worker = new Worker(new URL("./qrWorker.ts", import.meta.url), { type: "module" });
          worker.onmessage = (e: MessageEvent<string | null>) => {
            waiting = false;
            if (e.data) onDetect.current(e.data);
          };
          worker.onerror = (e) => {
            e.preventDefault();
            void useMainThread();
          };
        } catch {
          await useMainThread();
        }
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        setStatus({ kind: "on" });
        const tick = () => {
          if (stopped) return;
          if (!waiting && ctx && video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
            const w = Math.round(video.videoWidth * scale);
            const h = Math.round(video.videoHeight * scale);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const frame = ctx.getImageData(0, 0, w, h);
            if (worker) {
              waiting = true;
              worker.postMessage({ width: w, height: h, data: frame.data.buffer }, [frame.data.buffer]);
            } else if (decodeHere) {
              const text = decodeHere(frame.data, w, h);
              if (text) onDetect.current(text);
            }
          }
          timer = window.setTimeout(tick, worker ? SCAN_INTERVAL_MS : MAIN_THREAD_INTERVAL_MS);
        };
        tick();
      } catch (e) {
        if (!stopped) setStatus({ kind: "error", message: describe(e) });
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      worker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [props.deviceId]);

  return (
    <div className={`camera ${props.mode}`}>
      {/* 鏡のように左右を入れ替えて出す（読み取りには、入れ替える前の映像を使う） */}
      <video ref={videoRef} muted playsInline style={{ display: status.kind === "error" ? "none" : "block" }} />
      <div className="camera-label">
        {status.kind === "on" && "カメラにカードを向けても読めます"}
        {status.kind === "starting" && "カメラを準備しています…"}
        {status.kind === "error" && status.message}
      </div>
    </div>
  );
}
