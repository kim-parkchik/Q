/**
 * 都道府県マスター (JISコード準拠)
 */
export const PREFECTURE_MASTER = [
  { code: 1, name: "北海道", name0: "北海道", kana: "ホッカイドウ" },
  { code: 2, name: "青森県", name0: "青森", kana: "アオモリケン" },
  { code: 3, name: "岩手県", name0: "岩手", kana: "イワテケン" },
  { code: 4, name: "宮城県", name0: "宮城", kana: "ミヤギケン" },
  { code: 5, name: "秋田県", name0: "秋田", kana: "アキタケン" },
  { code: 6, name: "山形県", name0: "山形", kana: "ヤマガタケン" },
  { code: 7, name: "福島県", name0: "福島", kana: "フクシマケン" },
  { code: 8, name: "茨城県", name0: "茨城", kana: "イバラキケン" },
  { code: 9, name: "栃木県", name0: "栃木", kana: "トチギケン" },
  { code: 10, name: "群馬県", name0: "群馬", kana: "グンマケン" },
  { code: 11, name: "埼玉県", name0: "埼玉", kana: "サイタマケン" },
  { code: 12, name: "千葉県", name0: "千葉", kana: "チバケン" },
  { code: 13, name: "東京都", name0: "東京", kana: "トウキョウト" },
  { code: 14, name: "神奈川県", name0: "神奈川", kana: "カナガワケン" },
  { code: 15, name: "新潟県", name0: "新潟", kana: "ニイガタケン" },
  { code: 16, name: "富山県", name0: "富山", kana: "トヤマケン" },
  { code: 17, name: "石川県", name0: "石川", kana: "イシカワケン" },
  { code: 18, name: "福井県", name0: "福井", kana: "フクイケン" },
  { code: 19, name: "山梨県", name0: "山梨", kana: "ヤマナシケン" },
  { code: 20, name: "長野県", name0: "長野", kana: "ナガノケン" },
  { code: 21, name: "岐阜県", name0: "岐阜", kana: "ギフケン" },
  { code: 22, name: "静岡県", name0: "静岡", kana: "シズオカケン" },
  { code: 23, name: "愛知県", name0: "愛知", kana: "アイチケン" },
  { code: 24, name: "三重県", name0: "三重", kana: "ミエケン" },
  { code: 25, name: "滋賀県", name0: "滋賀", kana: "シガケン" },
  { code: 26, name: "京都府", name0: "京都", kana: "キョウトフ" },
  { code: 27, name: "大阪府", name0: "大阪", kana: "オオサカフ" },
  { code: 28, name: "兵庫県", name0: "兵庫", kana: "ヒョウゴケン" },
  { code: 29, name: "奈良県", name0: "奈良", kana: "ナラケン" },
  { code: 30, name: "和歌山県", name0: "和歌山", kana: "ワカヤマケン" },
  { code: 31, name: "鳥取県", name0: "鳥取", kana: "トットリケン" },
  { code: 32, name: "島根県", name0: "島根", kana: "シマネケン" },
  { code: 33, name: "岡山県", name0: "岡山", kana: "オカヤマケン" },
  { code: 34, name: "広島県", name0: "広島", kana: "ヒロシマケン" },
  { code: 35, name: "山口県", name0: "山口", kana: "ヤマグチケン" },
  { code: 36, name: "徳島県", name0: "徳島", kana: "トクシマケン" },
  { code: 37, name: "香川県", name0: "香川", kana: "カガワケン" },
  { code: 38, name: "愛媛県", name0: "愛媛", kana: "エヒメケン" },
  { code: 39, name: "高知県", name0: "高知", kana: "コウチケン" },
  { code: 40, name: "福岡県", name0: "福岡", kana: "フクオカケン" },
  { code: 41, name: "佐賀県", name0: "佐賀", kana: "サガケン" },
  { code: 42, name: "長崎県", name0: "長崎", kana: "ナガサキケン" },
  { code: 43, name: "熊本県", name0: "熊本", kana: "クマモトケン" },
  { code: 44, name: "大分県", name0: "大分", kana: "オオイタケン" },
  { code: 45, name: "宮崎県", name0: "宮崎", kana: "ミヤザキケン" },
  { code: 46, name: "鹿児島県", name0: "鹿児島", kana: "カゴシマケン" },
  { code: 47, name: "沖縄県", name0: "沖縄", kana: "オキナワケン" }
] as const;

export type Prefecture = (typeof PREFECTURE_MASTER)[number];
export type PrefectureCode = Prefecture['code'];
export type PrefectureName = Prefecture['name'];
// 💡 型定義にも追加しておくと親切です
export type PrefectureName0 = Prefecture['name0'];

/**
 * 都道府県名を協会けんぽ料率表の表記（「府・県」なし）に変換する
 * 例: "京都府" → "京都", "北海道" → "北海道", "京都" → "京都"
 * 見つからない場合は null を返す（勝手に別の県にしない）
 */
export const toKenpoPrefName = (name: string | null | undefined): PrefectureName0 | null => {
  if (!name) return null;
  const found = PREFECTURE_MASTER.find(p => p.name === name || p.name0 === name);
  return found ? found.name0 : null;
};
