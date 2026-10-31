/**
 * 地域別最低賃金（時間額）と発効年月日
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 厚生労働省 最低賃金制度のページ（minimum-wage-tables/ フォルダ）
 * 出典    : 厚生労働省ホームページ「地域別最低賃金の全国一覧（過去5年分）」（https://saiteichingin.mhlw.go.jp/table/page_list_past.html）
 *           「地域別最低賃金全国一覧」（https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php）を加工して作成
 *           （表を Q で使える形に変換したもので、厚生労働省が作成したものではありません）
 * 作り方  : python3 -I scripts/import_minimum_wage.py <過去5年分のHTML> <今年度のHTML> <このファイル>
 */
export interface MinimumWageEntry {
  /** 発効年月日（この日から） */
  from: string;
  /** 最低賃金（時間額・円） */
  amount: number;
}

/** 都道府県ごとの最低賃金（発効日の古い順）。都道府県名は保険料率と同じ書き方（東京・大阪・青森など） */
export const MINIMUM_WAGES: Record<string, MinimumWageEntry[]> = {
  "北海道": [{ from: "2021-10-01", amount: 889 }, { from: "2022-10-02", amount: 920 }, { from: "2023-10-01", amount: 960 }, { from: "2024-10-01", amount: 1010 }, { from: "2025-10-04", amount: 1075 }, { from: "2026-10-01", amount: 1131 }],
  "青森": [{ from: "2021-10-06", amount: 822 }, { from: "2022-10-05", amount: 853 }, { from: "2023-10-07", amount: 898 }, { from: "2024-10-05", amount: 953 }, { from: "2025-11-21", amount: 1029 }, { from: "2026-10-29", amount: 1090 }],
  "岩手": [{ from: "2021-10-02", amount: 821 }, { from: "2022-10-20", amount: 854 }, { from: "2023-10-04", amount: 893 }, { from: "2024-10-27", amount: 952 }, { from: "2025-12-01", amount: 1031 }, { from: "2026-12-01", amount: 1090 }],
  "宮城": [{ from: "2021-10-01", amount: 853 }, { from: "2022-10-01", amount: 883 }, { from: "2023-10-01", amount: 923 }, { from: "2024-10-01", amount: 973 }, { from: "2025-10-04", amount: 1038 }, { from: "2026-10-01", amount: 1098 }],
  "秋田": [{ from: "2021-10-01", amount: 822 }, { from: "2022-10-01", amount: 853 }, { from: "2023-10-01", amount: 897 }, { from: "2024-10-01", amount: 951 }, { from: "2026-03-31", amount: 1031 }, { from: "2026-10-14", amount: 1090 }],
  "山形": [{ from: "2021-10-02", amount: 822 }, { from: "2022-10-06", amount: 854 }, { from: "2023-10-14", amount: 900 }, { from: "2024-10-19", amount: 955 }, { from: "2025-12-23", amount: 1032 }, { from: "2026-10-30", amount: 1092 }],
  "福島": [{ from: "2021-10-01", amount: 828 }, { from: "2022-10-06", amount: 858 }, { from: "2023-10-01", amount: 900 }, { from: "2024-10-05", amount: 955 }, { from: "2026-01-01", amount: 1033 }, { from: "2026-10-16", amount: 1094 }],
  "東京": [{ from: "2021-10-01", amount: 1041 }, { from: "2022-10-01", amount: 1072 }, { from: "2023-10-01", amount: 1113 }, { from: "2024-10-01", amount: 1163 }, { from: "2025-10-03", amount: 1226 }, { from: "2026-10-01", amount: 1280 }],
  "茨城": [{ from: "2021-10-01", amount: 879 }, { from: "2022-10-01", amount: 911 }, { from: "2023-10-01", amount: 953 }, { from: "2024-10-01", amount: 1005 }, { from: "2025-10-12", amount: 1074 }, { from: "2026-10-18", amount: 1136 }],
  "栃木": [{ from: "2021-10-01", amount: 882 }, { from: "2022-10-01", amount: 913 }, { from: "2023-10-01", amount: 954 }, { from: "2024-10-01", amount: 1004 }, { from: "2025-10-01", amount: 1068 }, { from: "2026-10-01", amount: 1125 }],
  "群馬": [{ from: "2021-10-02", amount: 865 }, { from: "2022-10-08", amount: 895 }, { from: "2023-10-05", amount: 935 }, { from: "2024-10-04", amount: 985 }, { from: "2026-03-01", amount: 1063 }, { from: "2026-10-03", amount: 1120 }],
  "埼玉": [{ from: "2021-10-01", amount: 956 }, { from: "2022-10-01", amount: 987 }, { from: "2023-10-01", amount: 1028 }, { from: "2024-10-01", amount: 1078 }, { from: "2025-11-01", amount: 1141 }, { from: "2026-10-01", amount: 1196 }],
  "千葉": [{ from: "2021-10-01", amount: 953 }, { from: "2022-10-01", amount: 984 }, { from: "2023-10-01", amount: 1026 }, { from: "2024-10-01", amount: 1076 }, { from: "2025-10-03", amount: 1140 }, { from: "2026-10-01", amount: 1195 }],
  "神奈川": [{ from: "2021-10-01", amount: 1040 }, { from: "2022-10-01", amount: 1071 }, { from: "2023-10-01", amount: 1112 }, { from: "2024-10-01", amount: 1162 }, { from: "2025-10-04", amount: 1225 }, { from: "2026-10-01", amount: 1279 }],
  "新潟": [{ from: "2021-10-01", amount: 859 }, { from: "2022-10-01", amount: 890 }, { from: "2023-10-01", amount: 931 }, { from: "2024-10-01", amount: 985 }, { from: "2025-10-02", amount: 1050 }, { from: "2026-10-01", amount: 1108 }],
  "富山": [{ from: "2021-10-01", amount: 877 }, { from: "2022-10-01", amount: 908 }, { from: "2023-10-01", amount: 948 }, { from: "2024-10-01", amount: 998 }, { from: "2025-10-12", amount: 1062 }, { from: "2026-10-01", amount: 1119 }],
  "石川": [{ from: "2021-10-07", amount: 861 }, { from: "2022-10-08", amount: 891 }, { from: "2023-10-08", amount: 933 }, { from: "2024-10-05", amount: 984 }, { from: "2025-10-08", amount: 1054 }, { from: "2026-10-03", amount: 1113 }],
  "福井": [{ from: "2021-10-01", amount: 858 }, { from: "2022-10-02", amount: 888 }, { from: "2023-10-01", amount: 931 }, { from: "2024-10-05", amount: 984 }, { from: "2025-10-08", amount: 1053 }, { from: "2026-10-04", amount: 1112 }],
  "山梨": [{ from: "2021-10-01", amount: 866 }, { from: "2022-10-20", amount: 898 }, { from: "2023-10-01", amount: 938 }, { from: "2024-10-01", amount: 988 }, { from: "2025-12-01", amount: 1052 }, { from: "2026-11-01", amount: 1113 }],
  "長野": [{ from: "2021-10-01", amount: 877 }, { from: "2022-10-01", amount: 908 }, { from: "2023-10-01", amount: 948 }, { from: "2024-10-01", amount: 998 }, { from: "2025-10-03", amount: 1061 }, { from: "2026-10-02", amount: 1117 }],
  "岐阜": [{ from: "2021-10-01", amount: 880 }, { from: "2022-10-01", amount: 910 }, { from: "2023-10-01", amount: 950 }, { from: "2024-10-01", amount: 1001 }, { from: "2025-10-18", amount: 1065 }, { from: "2026-10-01", amount: 1121 }],
  "静岡": [{ from: "2021-10-02", amount: 913 }, { from: "2022-10-05", amount: 944 }, { from: "2023-10-01", amount: 984 }, { from: "2024-10-01", amount: 1034 }, { from: "2025-11-01", amount: 1097 }, { from: "2026-10-15", amount: 1154 }],
  "愛知": [{ from: "2021-10-01", amount: 955 }, { from: "2022-10-01", amount: 986 }, { from: "2023-10-01", amount: 1027 }, { from: "2024-10-01", amount: 1077 }, { from: "2025-10-18", amount: 1140 }, { from: "2026-10-01", amount: 1195 }],
  "京都": [{ from: "2021-10-01", amount: 937 }, { from: "2022-10-09", amount: 968 }, { from: "2023-10-06", amount: 1008 }, { from: "2024-10-01", amount: 1058 }, { from: "2025-11-21", amount: 1122 }, { from: "2026-11-16", amount: 1180 }],
  "大阪": [{ from: "2021-10-01", amount: 992 }, { from: "2022-10-01", amount: 1023 }, { from: "2023-10-01", amount: 1064 }, { from: "2024-10-01", amount: 1114 }, { from: "2025-10-16", amount: 1177 }, { from: "2026-10-01", amount: 1231 }],
  "三重": [{ from: "2021-10-01", amount: 902 }, { from: "2022-10-01", amount: 933 }, { from: "2023-10-01", amount: 973 }, { from: "2024-10-01", amount: 1023 }, { from: "2025-11-21", amount: 1087 }, { from: "2026-10-01", amount: 1143 }],
  "滋賀": [{ from: "2021-10-01", amount: 896 }, { from: "2022-10-06", amount: 927 }, { from: "2023-10-01", amount: 967 }, { from: "2024-10-01", amount: 1017 }, { from: "2025-10-05", amount: 1080 }, { from: "2026-10-03", amount: 1136 }],
  "兵庫": [{ from: "2021-10-01", amount: 928 }, { from: "2022-10-01", amount: 960 }, { from: "2023-10-01", amount: 1001 }, { from: "2024-10-01", amount: 1052 }, { from: "2025-10-04", amount: 1116 }, { from: "2026-10-01", amount: 1172 }],
  "奈良": [{ from: "2021-10-01", amount: 866 }, { from: "2022-10-01", amount: 896 }, { from: "2023-10-01", amount: 936 }, { from: "2024-10-01", amount: 986 }, { from: "2025-11-16", amount: 1051 }, { from: "2026-10-04", amount: 1107 }],
  "和歌山": [{ from: "2021-10-01", amount: 859 }, { from: "2022-10-01", amount: 889 }, { from: "2023-10-01", amount: 929 }, { from: "2024-10-01", amount: 980 }, { from: "2025-11-01", amount: 1045 }, { from: "2026-10-03", amount: 1101 }],
  "鳥取": [{ from: "2021-10-06", amount: 821 }, { from: "2022-10-06", amount: 854 }, { from: "2023-10-05", amount: 900 }, { from: "2024-10-05", amount: 957 }, { from: "2025-10-04", amount: 1030 }, { from: "2026-10-03", amount: 1090 }],
  "島根": [{ from: "2021-10-02", amount: 824 }, { from: "2022-10-05", amount: 857 }, { from: "2023-10-06", amount: 904 }, { from: "2024-10-12", amount: 962 }, { from: "2025-11-17", amount: 1033 }, { from: "2026-10-10", amount: 1092 }],
  "岡山": [{ from: "2021-10-02", amount: 862 }, { from: "2022-10-01", amount: 892 }, { from: "2023-10-01", amount: 932 }, { from: "2024-10-02", amount: 982 }, { from: "2025-12-01", amount: 1047 }, { from: "2026-10-02", amount: 1104 }],
  "広島": [{ from: "2021-10-01", amount: 899 }, { from: "2022-10-01", amount: 930 }, { from: "2023-10-01", amount: 970 }, { from: "2024-10-01", amount: 1020 }, { from: "2025-11-01", amount: 1085 }, { from: "2026-10-11", amount: 1141 }],
  "山口": [{ from: "2021-10-01", amount: 857 }, { from: "2022-10-13", amount: 888 }, { from: "2023-10-01", amount: 928 }, { from: "2024-10-01", amount: 979 }, { from: "2025-10-16", amount: 1043 }, { from: "2026-10-08", amount: 1101 }],
  "徳島": [{ from: "2021-10-01", amount: 824 }, { from: "2022-10-06", amount: 855 }, { from: "2023-10-01", amount: 896 }, { from: "2024-11-01", amount: 980 }, { from: "2026-01-01", amount: 1046 }, { from: "2026-11-01", amount: 1103 }],
  "香川": [{ from: "2021-10-01", amount: 848 }, { from: "2022-10-01", amount: 878 }, { from: "2023-10-01", amount: 918 }, { from: "2024-10-02", amount: 970 }, { from: "2025-10-18", amount: 1036 }, { from: "2026-10-01", amount: 1092 }],
  "愛媛": [{ from: "2021-10-01", amount: 821 }, { from: "2022-10-05", amount: 853 }, { from: "2023-10-06", amount: 897 }, { from: "2024-10-13", amount: 956 }, { from: "2025-12-01", amount: 1033 }, { from: "2026-11-01", amount: 1093 }],
  "高知": [{ from: "2021-10-02", amount: 820 }, { from: "2022-10-09", amount: 853 }, { from: "2023-10-08", amount: 897 }, { from: "2024-10-09", amount: 952 }, { from: "2025-12-01", amount: 1023 }, { from: "2026-10-29", amount: 1086 }],
  "福岡": [{ from: "2021-10-01", amount: 870 }, { from: "2022-10-08", amount: 900 }, { from: "2023-10-06", amount: 941 }, { from: "2024-10-05", amount: 992 }, { from: "2025-11-16", amount: 1057 }, { from: "2026-10-04", amount: 1114 }],
  "佐賀": [{ from: "2021-10-06", amount: 821 }, { from: "2022-10-02", amount: 853 }, { from: "2023-10-14", amount: 900 }, { from: "2024-10-17", amount: 956 }, { from: "2025-11-21", amount: 1030 }, { from: "2026-11-15", amount: 1095 }],
  "長崎": [{ from: "2021-10-02", amount: 821 }, { from: "2022-10-08", amount: 853 }, { from: "2023-10-13", amount: 898 }, { from: "2024-10-12", amount: 953 }, { from: "2025-12-01", amount: 1031 }, { from: "2026-11-02", amount: 1087 }],
  "大分": [{ from: "2021-10-06", amount: 822 }, { from: "2022-10-05", amount: 854 }, { from: "2023-10-06", amount: 899 }, { from: "2024-10-05", amount: 954 }, { from: "2026-01-01", amount: 1035 }, { from: "2026-11-01", amount: 1096 }],
  "熊本": [{ from: "2021-10-01", amount: 821 }, { from: "2022-10-01", amount: 853 }, { from: "2023-10-08", amount: 898 }, { from: "2024-10-05", amount: 952 }, { from: "2026-01-01", amount: 1034 }, { from: "2026-12-01", amount: 1092 }],
  "宮崎": [{ from: "2021-10-06", amount: 821 }, { from: "2022-10-06", amount: 853 }, { from: "2023-10-06", amount: 897 }, { from: "2024-10-05", amount: 952 }, { from: "2025-11-16", amount: 1023 }, { from: "2026-10-24", amount: 1085 }],
  "鹿児島": [{ from: "2021-10-02", amount: 821 }, { from: "2022-10-06", amount: 853 }, { from: "2023-10-06", amount: 897 }, { from: "2024-10-05", amount: 953 }, { from: "2025-11-01", amount: 1026 }, { from: "2026-10-25", amount: 1090 }],
  "沖縄": [{ from: "2021-10-08", amount: 820 }, { from: "2022-10-06", amount: 853 }, { from: "2023-10-08", amount: 896 }, { from: "2024-10-09", amount: 952 }, { from: "2025-12-01", amount: 1023 }, { from: "2026-12-02", amount: 1086 }],
};
