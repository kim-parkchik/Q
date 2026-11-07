/**
 * 会社の印・カードの番号・QR コードの中身（くわしくは timeqard/DESIGN.md の 5.2・5.4・付録 C）
 *
 * ・文字は A〜Z と 2〜7 だけ（Base32。RFC 4648 の文字）。0 と O、1 と I のような見間違えやすい文字がなく、
 *   QR コードの「英数字だけの形」に入るので、QR コードが小さくてすむ。
 *   USB の QR コード読み取り機はキーボードのように打ち込むので、記号を使わないほうが化けにくい。
 * ・会社の印は8文字（40ビット）。秘密ではなく、ほかの会社のファイルと取り違えないためのもの。
 * ・カードの番号は26文字（130ビット）の、でたらめな値。ID を知っていてもカードは作れない。
 * ・従業員ファイルには、カードの番号そのものではなく、確かめ用の値（SHA-256）だけを入れる。
 */

export const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const COMPANY_MARK_LENGTH = 8;
export const CARD_NUMBER_LENGTH = 26;
/** QR コードの中身の初め（TimeQard の打刻カードの1つ目の形） */
export const CARD_PAYLOAD_PREFIX = "TQ1";
export const CARD_PAYLOAD_LENGTH = CARD_PAYLOAD_PREFIX.length + COMPANY_MARK_LENGTH + CARD_NUMBER_LENGTH;

/** でたらめなバイトを作る（テストでは決まった値を渡す） */
export type RandomBytes = (length: number) => Uint8Array;
const cryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/**
 * でたらめな文字列を作る。1バイト（0〜255）の下の5ビットで32文字から選ぶ（256 は 32 で割り切れるので、どの文字も同じ確からしさ）
 */
export const randomCode = (length: number, random: RandomBytes = cryptoRandom) => {
  const bytes = random(length);
  if (bytes.length < length) throw new Error("でたらめな値を作れませんでした");
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
};

export const newCompanyMark = (random?: RandomBytes) => randomCode(COMPANY_MARK_LENGTH, random);
export const newCardNumber = (random?: RandomBytes) => randomCode(CARD_NUMBER_LENGTH, random);

export const isCompanyMark = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Z2-7]{8}$/.test(s);

export const isCardNumber = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Z2-7]{26}$/.test(s);

/** QR コードの中身（「TQ1」＋会社の印＋カードの番号の37文字） */
export const cardPayload = (companyMark: string, cardNumber: string) => {
  if (!isCompanyMark(companyMark)) throw new Error(`会社の印の形ではありません: ${companyMark}`);
  if (!isCardNumber(cardNumber)) throw new Error("カードの番号の形ではありません");
  return CARD_PAYLOAD_PREFIX + companyMark + cardNumber;
};

/** 読み取った文字を、比べられる形にする（全角・小文字・空白・改行が混ざっても読む） */
const cleanScanned = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

/** TimeQard のカードを読み取ったように見えるか（「TQ」で始まる）。ID を入れる欄にカードを読ませたときに使う */
export const looksLikeCardPayload = (text: string) => cleanScanned(text).startsWith("TQ");

/** QR コードの中身を読む（TimeQard のカードの形でなければ null） */
export const parseCardPayload = (text: string): { companyMark: string; cardNumber: string } | null => {
  const s = cleanScanned(text);
  if (s.length !== CARD_PAYLOAD_LENGTH || !s.startsWith(CARD_PAYLOAD_PREFIX)) return null;
  const companyMark = s.slice(CARD_PAYLOAD_PREFIX.length, CARD_PAYLOAD_PREFIX.length + COMPANY_MARK_LENGTH);
  const cardNumber = s.slice(CARD_PAYLOAD_PREFIX.length + COMPANY_MARK_LENGTH);
  if (!isCompanyMark(companyMark) || !isCardNumber(cardNumber)) return null;
  return { companyMark, cardNumber };
};

/** 文字列の SHA-256（16進数の64文字） */
export const sha256Hex = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/** カードの確かめ用の値（カードの番号の SHA-256。元の番号には戻せない） */
export const cardHash = (cardNumber: string) => {
  if (!isCardNumber(cardNumber)) throw new Error("カードの番号の形ではありません");
  return sha256Hex(cardNumber);
};

export const isCardHash = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** 画面に出すときに、会社の印を4文字ずつに区切る（「K7M3 QP2X」） */
export const companyMarkLabel = (mark: string) => (isCompanyMark(mark) ? `${mark.slice(0, 4)} ${mark.slice(4)}` : mark);
