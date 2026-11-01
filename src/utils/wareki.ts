/**
 * 西暦の日付（YYYY-MM-DD）を和暦（元号・年・月・日）にする
 * 源泉徴収票の生年月日・中途就職／退職の年月日・居住開始年月日は、和暦で書く（国税庁「法定調書の作成と提出の手引」）
 *
 * 元号の始まりの日：大正 1912年7月30日、昭和 1926年12月25日、平成 1989年1月8日、令和 2019年5月1日
 */
export interface Wareki {
  era: string;
  year: number;
  month: number;
  day: number;
}

const ERAS: { era: string; from: string }[] = [
  { era: "令和", from: "2019-05-01" },
  { era: "平成", from: "1989-01-08" },
  { era: "昭和", from: "1926-12-25" },
  { era: "大正", from: "1912-07-30" },
  { era: "明治", from: "1868-01-01" },
];

/** 和暦にする（日付でなければ null） */
export const toWareki = (date: string | null | undefined): Wareki | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return null;
  const e = ERAS.find((x) => date! >= x.from);
  if (!e) return null;
  return { era: e.era, year: Number(m[1]) - Number(e.from.slice(0, 4)) + 1, month: Number(m[2]), day: Number(m[3]) };
};

/** 「令和8年3月31日」のような文字にする（日付でなければ空） */
export const formatWareki = (date: string | null | undefined): string => {
  const w = toWareki(date);
  return w ? `${w.era}${w.year === 1 ? "元" : w.year}年${w.month}月${w.day}日` : "";
};
