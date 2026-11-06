/**
 * 通勤手当の非課税限度額（1か月当たり）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁の資料（commute-tables/ フォルダ。入手元とハッシュは commute-tables/README.md）
 *   - 「通勤手当の非課税限度額の引上げについて」（令和7年11月）https://www.nta.go.jp/users/gensen/2025tsukin/pdf/01.pdf
 *   - 「通勤手当の非課税限度額の改正に関するＱ＆Ａ」（令和8年4月）https://www.nta.go.jp/users/gensen/2026tsukin/pdf/01.pdf
 *   - タックスアンサー No.2585「マイカー・自転車通勤者の通勤手当」https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2585.htm
 *   （資料を加工して作成したもので、国税庁が作成したものではありません）
 * 作り方  : python3 -I scripts/import_commute_limits.py commute-tables src/constants/tax/commuteLimits.ts
 * 確認    : 令和8年の表は Q&A とタックスアンサーで一致し、令和7年の表は令和7年11月の資料と Q&A の「同左」の行で一致する
 *
 * from は「この日以後に支払われるべき通勤手当」に使う日（空は、それより前のすべて）。
 * maxPerMonth は交通機関・有料道路を使う人の最高限度（合理的な運賃等の額まで）、distanceBands は交通用具（マイカー・自転車など）の
 * 片道の通勤距離の区分（fromKm 以上 toKm 未満。toKm が null は上限なし。limit 0 は全額課税）、
 * parkingAdditionMax は駐車場等の料金相当額を足せる上限（その制度がない期間は null）。
 * 根拠：所得税法9条、所得税法施行令20条の2
 */

export interface CommuteDistanceBand {
  fromKm: number;
  toKm: number | null;
  limit: number;
}

export interface CommuteLimitPeriod {
  from: string;
  maxPerMonth: number;
  parkingAdditionMax: number | null;
  distanceBands: CommuteDistanceBand[];
  source: string;
}

export const COMMUTE_LIMIT_PERIODS: CommuteLimitPeriod[] = [
  {
    "from": "",
    "maxPerMonth": 150000,
    "parkingAdditionMax": null,
    "distanceBands": [
      {
        "fromKm": 0,
        "toKm": 2,
        "limit": 0
      },
      {
        "fromKm": 2,
        "toKm": 10,
        "limit": 4200
      },
      {
        "fromKm": 10,
        "toKm": 15,
        "limit": 7100
      },
      {
        "fromKm": 15,
        "toKm": 25,
        "limit": 12900
      },
      {
        "fromKm": 25,
        "toKm": 35,
        "limit": 18700
      },
      {
        "fromKm": 35,
        "toKm": 45,
        "limit": 24400
      },
      {
        "fromKm": 45,
        "toKm": 55,
        "limit": 28000
      },
      {
        "fromKm": 55,
        "toKm": null,
        "limit": 31600
      }
    ],
    "source": "https://www.nta.go.jp/users/gensen/2025tsukin/pdf/01.pdf（改正前の列）"
  },
  {
    "from": "2025-04-01",
    "maxPerMonth": 150000,
    "parkingAdditionMax": null,
    "distanceBands": [
      {
        "fromKm": 0,
        "toKm": 2,
        "limit": 0
      },
      {
        "fromKm": 2,
        "toKm": 10,
        "limit": 4200
      },
      {
        "fromKm": 10,
        "toKm": 15,
        "limit": 7300
      },
      {
        "fromKm": 15,
        "toKm": 25,
        "limit": 13500
      },
      {
        "fromKm": 25,
        "toKm": 35,
        "limit": 19700
      },
      {
        "fromKm": 35,
        "toKm": 45,
        "limit": 25900
      },
      {
        "fromKm": 45,
        "toKm": 55,
        "limit": 32300
      },
      {
        "fromKm": 55,
        "toKm": null,
        "limit": 38700
      }
    ],
    "source": "https://www.nta.go.jp/users/gensen/2025tsukin/pdf/01.pdf（改正後の列）"
  },
  {
    "from": "2026-04-01",
    "maxPerMonth": 150000,
    "parkingAdditionMax": 5000,
    "distanceBands": [
      {
        "fromKm": 0,
        "toKm": 2,
        "limit": 0
      },
      {
        "fromKm": 2,
        "toKm": 10,
        "limit": 4200
      },
      {
        "fromKm": 10,
        "toKm": 15,
        "limit": 7300
      },
      {
        "fromKm": 15,
        "toKm": 25,
        "limit": 13500
      },
      {
        "fromKm": 25,
        "toKm": 35,
        "limit": 19700
      },
      {
        "fromKm": 35,
        "toKm": 45,
        "limit": 25900
      },
      {
        "fromKm": 45,
        "toKm": 55,
        "limit": 32300
      },
      {
        "fromKm": 55,
        "toKm": 65,
        "limit": 38700
      },
      {
        "fromKm": 65,
        "toKm": 75,
        "limit": 45700
      },
      {
        "fromKm": 75,
        "toKm": 85,
        "limit": 52700
      },
      {
        "fromKm": 85,
        "toKm": 95,
        "limit": 59600
      },
      {
        "fromKm": 95,
        "toKm": null,
        "limit": 66400
      }
    ],
    "source": "https://www.nta.go.jp/users/gensen/2026tsukin/pdf/01.pdf（Q1-1 の表。https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2585.htm と一致することを確認）"
  }
];
