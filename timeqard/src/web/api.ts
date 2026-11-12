/**
 * ブラウザ版の画面から、入口のパソコンの TimeQard に頼む（POST /api/<名前>。中身は JSON）
 *
 * ログインの印（token）は、画面の中（メモリ）にだけ持つ。クッキー・ブラウザの保存場所には残さない
 * （ページを開き直すと、ログアウトになる）。
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown>
  ) {
    super(message);
  }
}

/** 頼む。うまくいかなければ ApiError（status 0 は、つながらなかったとき） */
export const call = async <T>(action: string, body: object = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`/api/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new ApiError(0, "入口のパソコンにつながりません。ネットワークと、入口のパソコンの TimeQard が動いているかを確かめてください。", {});
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const message = typeof data.error === "string" && data.error ? data.error : `うまくいきませんでした（${res.status}）。`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
};

/** 会社専用の証明書の名前と指紋（入口のパソコンのサーバーが、そのまま答える） */
export interface CertInfo {
  caName: string;
  sha256: string;
  sha1: string;
  fileName: string;
}

export const certInfo = async (): Promise<CertInfo> => {
  const res = await fetch("/api/cert-info", { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`証明書のことを読めませんでした（${res.status}）`);
  return (await res.json()) as CertInfo;
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** CSV をダウンロードする（Excel で文字化けしないよう、BOM を付けた UTF-8） */
export const downloadCsv = (fileName: string, csv: string) => {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
