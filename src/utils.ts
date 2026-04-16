/* --- ヘルパー関数（内部のみで使用） --- */

const parseTimeToMinutes = (t: string): number => {
    if (!t || t.length < 5) return 0;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
};

const calcNightMinutes = (start: number, end: number): number => {
    const nightStart = 22 * 60; // 22:00
    const nightEnd = 29 * 60;   // 翌5:00
    const overlapStart = Math.max(start, nightStart);
    const overlapEnd = Math.min(end, nightEnd);
    return Math.max(0, overlapEnd - overlapStart);
};

/* --- 外部から呼び出すメインロジック --- */

/**
 * 総労働時間と深夜時間を同時に計算する（詳細版）
 */
export const calcDetailedDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string) => {
    if (!inT || inT.length < 5 || !outT || outT.length < 5) {
        return { total: "0.000", night: "0.000" };
    }

    let start = parseTimeToMinutes(inT);
    let end = parseTimeToMinutes(outT);
    
    // 日跨ぎ対応：退勤の方が出勤より前なら翌日とみなす
    if (end < start) end += 24 * 60;

    let totalMin = end - start;
    let nightMin = calcNightMinutes(start, end);

    const deduct = (s?: string, e?: string) => {
        if (!s || s.length < 5 || !e || e.length < 5) return;
        let bs = parseTimeToMinutes(s);
        let be = parseTimeToMinutes(e);
        if (be < bs) be += 24 * 60;
        
        totalMin -= (be - bs);
        nightMin -= calcNightMinutes(bs, be);
    };

    deduct(bStart, bEnd);
    deduct(outV, returnV);

    return {
        total: (Math.max(0, totalMin) / 60).toFixed(3),
        night: (Math.max(0, nightMin) / 60).toFixed(3)
    };
};

/**
 * 従来の calcDiff（後方互換性のため残す）
 */
export const calcDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string): string => {
    // 内部で calcDetailedDiff を呼び出して total だけを返す
    return calcDetailedDiff(inT, outT, bStart, bEnd, outV, returnV).total;
};

/**
 * 小数の時間を「〇時間〇分」の形式に変換する
 * 例: 4.5 -> "4時間30分"
 * 例: 10.667 -> "10時間40分"
 */
export const formatHours = (decimalHours: number): string => {
  // 1. そもそも数値じゃない、または NaN の場合は「0分」と返す
  if (typeof decimalHours !== 'number' || isNaN(decimalHours) || decimalHours <= 0) {
    return "0分";
  }
  
  try {
    const h = Math.floor(decimalHours);
    const m = Math.round((decimalHours - h) * 60);
    
    if (h === 0) return `${m}分`;
    if (m === 0) return `${h}時間`;
    return `${h}時間${m}分`;
  } catch (e) {
    // 万が一ここでエラーが起きても全体を落とさない
    return "計算中...";
  }
};

export const fetchAddressByZip = async (zip: string) => {
    const cleanZip = zip.replace(/[^\d]/g, "");
    if (cleanZip.length !== 7) return null;
    
    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanZip}`);
    const data = await response.json();
    return data.results ? data.results[0] : null;
};

// --- 共通スタイル（もし必要ならここに出しておけます） ---
export const modernIconBtnStyle = (color: string) => ({
  backgroundColor: "transparent",
  border: `1.5px solid ${color}`,
  color: color,
  padding: "4px 12px",
  margin: "0 4px",
  borderRadius: "20px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "bold" as const,
  transition: "all 0.2s ease",
  display: "inline-flex" as const,
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
});

export const smallBtnStyle = (color: string) => ({
    ...modernIconBtnStyle(color),
    padding: "4px 8px", // 上下4px、左右8pxに縮小
    fontSize: "12px",   // 文字を少し小さく
    lineHeight: "1",
    minWidth: "40px"    // 最小幅を固定
});