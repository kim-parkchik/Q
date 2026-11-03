/**
 * 令和8年分の給与所得の源泉徴収票の記載に使う区分など
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第2章の PDF
 *           （nencho-tables/tebiki-02.pdf。SHA-256 15960b2fe6c35fe1ff1fa5a965277bbeaf2d9a724b0831c8d6677bd72aaa2612。入手元は nencho-tables/README.md）
 * 出典    : 国税庁ホームページ（https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/index.htm）の手引を加工して作成
 *           （PDF の記載要領を Q で使える形に変換したもので、国税庁が作成したものではありません）
 * 作り方  : python3 -I scripts/import_gensen_codes.py <PDF> <年> <このファイル>
 */
import type { WithholdingSlipMaster } from './nenchoTypes';

export const GENSEN_2026: WithholdingSlipMaster = {
  year: 2026,
  residentCode: "00",
  withoutAdjustment: {
    recipientIncomeLimit: 9000000,
    spouseIncomeLimit: 950000,
    earlierUntil: "11-30",
    earlierIncomeLimit: 580000,
    currentIncomeLimit: 620000,
    specificRelativeLimit: 1000000
  },
  specificRelativeCodes: [
    {
      amount: 630000,
      over: 620000,
      upTo: 850000,
      resident: "10",
      nonResident: "11"
    },
    {
      amount: 610000,
      over: 850000,
      upTo: 900000,
      resident: "20",
      nonResident: "21"
    },
    {
      amount: 510000,
      over: 900000,
      upTo: 950000,
      resident: "30",
      nonResident: "31"
    },
    {
      amount: 410000,
      over: 950000,
      upTo: 1000000,
      resident: "40",
      nonResident: "41"
    },
    {
      amount: 310000,
      over: 1000000,
      upTo: 1050000,
      resident: "50",
      nonResident: "51"
    },
    {
      amount: 210000,
      over: 1050000,
      upTo: 1100000,
      resident: "60",
      nonResident: "61"
    },
    {
      amount: 110000,
      over: 1100000,
      upTo: 1150000,
      resident: "70",
      nonResident: "71"
    },
    {
      amount: 60000,
      over: 1150000,
      upTo: 1200000,
      resident: "80",
      nonResident: "81"
    },
    {
      amount: 30000,
      over: 1200000,
      upTo: 1230000,
      resident: "90",
      nonResident: "91"
    }
  ],
  housingLoanKinds: [
    {
      code: "01",
      label: "住"
    },
    {
      code: "11",
      label: "住（特）"
    },
    {
      code: "21",
      label: "住（特特）"
    },
    {
      code: "31",
      label: "住（特特特）"
    },
    {
      code: "41",
      label: "住（特家）"
    },
    {
      code: "02",
      label: "認"
    },
    {
      code: "12",
      label: "認（特）"
    },
    {
      code: "22",
      label: "認（特特）"
    },
    {
      code: "32",
      label: "認（特特特）"
    },
    {
      code: "42",
      label: "認（特家）"
    },
    {
      code: "04",
      label: "震"
    },
    {
      code: "24",
      label: "震（特特）"
    },
    {
      code: "34",
      label: "震（特特特）"
    },
    {
      code: "44",
      label: "震（特家）"
    }
  ],
  minorBornOnOrAfter: "2009-01-03",
  youngBornOnOrAfter: "2011-01-02",
  lifeInsuranceYoungNote: "租税特別措置法第41条の15の5第1項適用"
};
