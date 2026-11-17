/**
 * 労災保険率（事業の種類ごと）と一般拠出金率
 *
 * scripts/import_rousai_rates.py で、厚生労働省「労災保険率表（令和６年度～）」（文字認識で読み、「労災保険率の改定について」の率と
 * すべて同じことを確かめた）と「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」から作ったファイルです。手で直さないでください。
 * 作り方と入手元は nendo-koshin/README.md
 */
import type { YearMonth } from './kenpoTableTypes';

/** 事業の種類（codes は労災保険率表の事業の種類の番号。林業は 02・03 の2つ）と労災保険率（1,000分の rate） */
export interface RousaiRateRow {
  codes: string[];
  name: string;
  rate: number;
}

export interface RousaiRatePeriod {
  /** この月の分から使う（労災保険率は、原則3年ごとに4月1日から変わる） */
  from: YearMonth;
  source: string;
  rows: RousaiRateRow[];
}

export const ROUSAI_RATE_PERIODS: RousaiRatePeriod[] = [
  {
    from: { year: 2024, month: 4 },
    source: "https://www.mhlw.go.jp/content/11200000/001221989.pdf",
    rows: [
      {"codes": ["02", "03"], "name": "林業", "rate": 52.0},
      {"codes": ["11"], "name": "海面漁業", "rate": 18.0},
      {"codes": ["12"], "name": "定置網漁業又は海面魚類養殖業", "rate": 37.0},
      {"codes": ["21"], "name": "金属鉱業、非金属鉱業又は石炭鉱業", "rate": 88.0},
      {"codes": ["23"], "name": "石灰石鉱業又はドロマイト鉱業", "rate": 13.0},
      {"codes": ["24"], "name": "原油又は天然ガス鉱業", "rate": 2.5},
      {"codes": ["25"], "name": "採石業", "rate": 37.0},
      {"codes": ["26"], "name": "その他の鉱業", "rate": 26.0},
      {"codes": ["31"], "name": "水力発電施設、ずい道等新設事業", "rate": 34.0},
      {"codes": ["32"], "name": "道路新設事業", "rate": 11.0},
      {"codes": ["33"], "name": "舗装工事業", "rate": 9.0},
      {"codes": ["34"], "name": "鉄道又は軌道新設事業", "rate": 9.0},
      {"codes": ["35"], "name": "建築事業", "rate": 9.5},
      {"codes": ["38"], "name": "既設建築物設備工事業", "rate": 12.0},
      {"codes": ["36"], "name": "機械装置の組立て又は据付けの事業", "rate": 6.0},
      {"codes": ["37"], "name": "その他の建設事業", "rate": 15.0},
      {"codes": ["41"], "name": "食料品製造業", "rate": 5.5},
      {"codes": ["42"], "name": "繊維工業又は繊維製品製造業", "rate": 4.0},
      {"codes": ["44"], "name": "木材又は木製品製造業", "rate": 13.0},
      {"codes": ["45"], "name": "パルプ又は紙製造業", "rate": 7.0},
      {"codes": ["46"], "name": "印刷又は製本業", "rate": 3.5},
      {"codes": ["47"], "name": "化学工業", "rate": 4.5},
      {"codes": ["48"], "name": "ガラス又はセメント製造業", "rate": 6.0},
      {"codes": ["66"], "name": "コンクリート製造業", "rate": 13.0},
      {"codes": ["62"], "name": "陶磁器製品製造業", "rate": 17.0},
      {"codes": ["49"], "name": "その他の窯業又は土石製品製造業", "rate": 23.0},
      {"codes": ["50"], "name": "金属精錬業", "rate": 6.5},
      {"codes": ["51"], "name": "非鉄金属精錬業", "rate": 7.0},
      {"codes": ["52"], "name": "金属材料品製造業", "rate": 5.0},
      {"codes": ["53"], "name": "鋳物業", "rate": 16.0},
      {"codes": ["54"], "name": "金属製品製造業又は金属加工業", "rate": 9.0},
      {"codes": ["63"], "name": "洋食器、刃物、手工具又は一般金物製造業", "rate": 6.5},
      {"codes": ["55"], "name": "めつき業", "rate": 6.5},
      {"codes": ["56"], "name": "機械器具製造業", "rate": 5.0},
      {"codes": ["57"], "name": "電気機械器具製造業", "rate": 3.0},
      {"codes": ["58"], "name": "輸送用機械器具製造業", "rate": 4.0},
      {"codes": ["59"], "name": "船舶製造又は修理業", "rate": 23.0},
      {"codes": ["60"], "name": "計量器、光学機械、時計等製造業", "rate": 2.5},
      {"codes": ["64"], "name": "貴金属製品、装身具、皮革製品等製造業", "rate": 3.5},
      {"codes": ["61"], "name": "その他の製造業", "rate": 6.0},
      {"codes": ["71"], "name": "交通運輸事業", "rate": 4.0},
      {"codes": ["72"], "name": "貨物取扱事業", "rate": 8.5},
      {"codes": ["73"], "name": "港湾貨物取扱事業", "rate": 9.0},
      {"codes": ["74"], "name": "港湾荷役業", "rate": 12.0},
      {"codes": ["81"], "name": "電気、ガス、水道又は熱供給の事業", "rate": 3.0},
      {"codes": ["95"], "name": "農業又は海面漁業以外の漁業", "rate": 13.0},
      {"codes": ["91"], "name": "清掃、火葬又はと畜の事業", "rate": 13.0},
      {"codes": ["93"], "name": "ビルメンテナンス業", "rate": 6.0},
      {"codes": ["96"], "name": "倉庫業、警備業、消毒又は害虫駆除の事業又はゴルフ場の事業", "rate": 6.5},
      {"codes": ["97"], "name": "通信業、放送業、新聞業又は出版業", "rate": 2.5},
      {"codes": ["98"], "name": "卸売業・小売業、飲食店又は宿泊業", "rate": 3.0},
      {"codes": ["99"], "name": "金融業、保険業又は不動産業", "rate": 2.5},
      {"codes": ["94"], "name": "その他の各種事業", "rate": 3.0},
      {"codes": ["90"], "name": "船舶所有者の事業", "rate": 42.0},
    ],
  },
];

/** 一般拠出金率（1,000分の）。賃金総額（千円未満は切り捨て）にかける */
export const GENERAL_CONTRIBUTION_RATE = 0.02;
