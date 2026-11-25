// このファイルは scripts/import_childcare_exemption.py で作る（手で書き換えない）
// 健康保険法 第159条（roumu-forms/health-insurance-act-159.xml SHA-256 e5c4688e5a1e9bd6ac9adf94decacd6300fa786c97152cfd68b7f07f0c6ef652）
// 厚生年金保険法 第81条の2（roumu-forms/employees-pension-act-81-2.xml SHA-256 49476696c8f1288dd334043921c43dfa4d5196f40ce4772b85baf3ade70788e8）
// 健康保険法（全文。roumu-forms/source/health-insurance-act.xml SHA-256 5f17ce52e03d52203f72630f7de6de6a93816b7faaac88ef8c5a4b3418e093a0）の附則（令和3年6月11日法律第66号）1条3号・3条3項

/**
 * 育児休業等の期間中の、健康保険・厚生年金保険の保険料の免除（健康保険法159条1項・厚生年金保険法81条の2第1項。2つの条文で同じ）
 * ・sameMonthMinDays：育児休業等を開始した日の月と、終了する日の翌日の月が同じとき、その月の育児休業等の日数（厚生労働省令で数える）が
 *   この日数以上なら、その月の保険料を免除する（1項2号）
 * ・bonusMonths：育児休業等の期間がこの月数以下の人は、標準報酬月額に係る保険料だけを免除する（賞与の保険料は免除しない。1項のかっこ書）
 */
export const CHILDCARE_EXEMPTION = { sameMonthMinDays: 14, bonusMonths: 1 } as const;

/**
 * 上の決まり（令和4年10月の改正）を使う育児休業等の開始日。この日以後に開始した育児休業等に使い、この日より前に開始したものは
 * 前の決まりによる（健康保険法の附則（令和3年6月11日法律第66号）1条3号の施行の日・3条3項）
 */
export const CHILDCARE_RULE_2022_START = "2022-10-01";
