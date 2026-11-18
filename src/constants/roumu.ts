// このファイルは scripts/import_roumu_tables.py で作ったものです。手で直さないでください。
// 入手元・SHA-256・作り直し方は roumu-forms/README.md
// 労働基準法36条（labor-standards-act-36.xml SHA-256 0e710ea4cbe62071a5684e012cc3cba510ef2ba1ce7d7c5e1faa3bbfc0dfb667）
// 障害者の雇用の促進等に関する法律施行令9条（disability-employment-order-9.xml SHA-256 f465720cdf2585aab39c9e869f34f59aa2c948417b26a45eaf3cfb07d51fc6e7）
// 障害者雇用状況報告書 様式第6号（shougai-youshiki6.pdf SHA-256 f35700e657753e58374f524f1be952502a43cc8e85314c87859d5055183dba94）
// 高年齢者雇用状況等報告書及び障害者雇用状況報告書 記入要領 令和8年6月（koyoujoukyou-kinyuyouryou.pdf SHA-256 247cb4bb49be50ce7bd248f88bcbd607798ed43c73aa6ba27fe994346e45d0da）
// 障害者雇用状況報告記入要領（shougai-kinyuyouryou.pdf SHA-256 c8f5aa65e60af2deeb2de3c659fe185d3b2bcfdd32ed88282a592e499d57d14e）

/** 36協定の時間外労働・休日労働の上限（時間。労働基準法36条4項〜6項） */
export const KYOTEI36_LIMITS = {
  /** 限度時間（4項）：1か月 45時間・1年 360時間 */
  monthly: 45,
  annual: 360,
  /** 対象期間が3か月を超える1年単位の変形労働時間制の人の限度時間：1か月 42時間・1年 320時間 */
  monthlyVariable: 42,
  annualVariable: 320,
  /** 特別条項（5項）：1か月の時間外労働と休日労働の合計は 100時間未満・1年の時間外労働は 720時間以内・限度時間を超えられるのは1年に 6か月まで */
  specialMonthlyBelow: 100,
  specialAnnual: 720,
  specialMonthsMax: 6,
  /** 実際の時間（6項2号・3号）：1か月の時間外労働と休日労働の合計は 100時間未満、2〜6か月の平均は 80時間以内 */
  actualMonthlyBelow: 100,
  averageMax: 80,
  averageMonths: [2, 3, 4, 5, 6],
} as const;

/** 障害者雇用率（法定雇用率。[分子, 分母]。障害者の雇用の促進等に関する法律施行令9条） */
export const DISABILITY_EMPLOYMENT_RATE: [number, number] = [27, 1000];
/** 様式第6号の裏面の注意にある法定雇用率（一般の企業。令和8年6月1日現在の報告まで。令和9年からは施行令9条の率） */
export const DISABILITY_EMPLOYMENT_RATE_FORM6: [number, number] = [25, 1000];
/** 様式第6号の数え方：常用雇用労働者の数は イ＋ロ×0.5、身体障害者は 重度×2＋重度以外＋重度の短時間＋（重度以外の短時間＋重度の特定短時間）×0.5、精神障害者は 精神＋精神の短時間＋特定短時間×0.5 */
export const FORM6_WEIGHTS = { regular: 1, shortTime: 0.5, severe: 2, severeShortTime: 1, specifiedShortTime: 0.5, mentalShortTime: 1 } as const;
/** 高年齢者雇用状況等報告の「常用労働者」：1年以上継続して雇用される（見込みを含む）人のうち、1週間の所定労働時間が 20時間以上の人（記入要領） */
export const ELDERLY_REPORT_REGULAR_WEEKLY_HOURS = 20;
/** 高年齢者雇用状況等報告書（様式第2号）の⑮常用労働者数の年齢の区分（[から, まで]。null は上限・下限なし） */
export const ELDERLY_AGE_BANDS: [number | null, number | null][] = [[null, 44], [45, 49], [50, 54], [55, 59], [60, 64], [65, 69], [70, null]];
/** 障害者雇用状況報告の週の所定労働時間（記入要領）：常用雇用労働者は regularMin 時間以上、そのうち shortBelow 時間未満は短時間労働者、
 *  specifiedMin 時間以上 regularMin 時間未満は特定短時間労働者（重度身体・重度知的・精神の人だけ 0.5 人と数える） */
export const DISABILITY_WEEKLY_HOURS = { regularMin: 20, shortBelow: 30, specifiedMin: 10 } as const;
/** 令和8年6月1日現在の報告で、報告する事業主（常用雇用労働者 40.0人以上。法定雇用率 25/1000 の逆数） */
export const DISABILITY_REPORT_MIN_WORKERS_FORM6 = 40.0;
