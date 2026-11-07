/**
 * USB の QR コード読み取り機（キーボードと同じように文字を打ち込む）と、キーボードで打った ID を受け取る
 *
 * ・日本語入力がオンのままでも読めるように、打ち込まれた文字（e.key）ではなく、キーの位置（e.code）で読む。
 *   QR コードの中身は英大文字と数字だけなので、キーの位置から決まる（A〜Z・0〜9）。
 * ・Enter か Tab（読み取り機の終わりの印）で、たまった文字を渡す。終わりの印を送らない読み取り機のために、
 *   「TQ1」で始まる37文字がたまったら、そこで渡す。
 * ・0.5秒より長く間があいたら、たまった文字を捨てる（読み取り機は、とても速く打ち込む）。
 */
import { useEffect, useRef } from "react";
import { CARD_PAYLOAD_LENGTH, CARD_PAYLOAD_PREFIX } from "../../shared/timeqard";
import { charOfKey } from "./keys";

const GAP_MS = 500;

/** 打ち込まれた文字を受け取る（enabled が false のあいだは受け取らない。文字を入れる欄にいるときも受け取らない） */
export const useScanner = (enabled: boolean, onInput: (text: string) => void) => {
  const buffer = useRef("");
  const last = useRef(0);
  const handler = useRef(onInput);
  handler.current = onInput;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const now = performance.now();
      if (now - last.current > GAP_MS) buffer.current = "";
      last.current = now;
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Tab") {
        const text = buffer.current;
        buffer.current = "";
        if (text.length > 0) {
          e.preventDefault();
          handler.current(text);
        }
        return;
      }
      const ch = charOfKey(e.code, e.shiftKey);
      if (ch === null) return;
      e.preventDefault();
      buffer.current += ch;
      if (buffer.current.length === CARD_PAYLOAD_LENGTH && buffer.current.startsWith(CARD_PAYLOAD_PREFIX)) {
        const text = buffer.current;
        buffer.current = "";
        handler.current(text);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
};
