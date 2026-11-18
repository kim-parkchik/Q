/**
 * 雇用保険適用事業所設置届・雇用保険事業主事業所各種変更届に書く内容（e-Gov の画面か紙に書き写す。印刷できる）
 *
 * 欄と書き方は、厚生労働省「雇用保険事務手続きの手引き【第１編】適用事業所編」（令和8年8月版）の「雇用保険適用事業所設置届の記入例」
 * 「雇用保険事業主事業所各種変更届の記入例」と手続の説明による（koyo-format/source/tebiki-1-tekiyou.pdf）。
 * ・設置届：適用事業に該当した（労働者を雇う事業を始めた）日の翌日から10日以内に、事業所の所在地のハローワークへ。
 *   労働保険 保険関係成立届の事業主控・登記事項証明書（法人番号を書けば省ける）・賃金台帳・労働者名簿・出勤簿を持っていき、
 *   資格取得届（または転勤届）を同時に出す。設置年月日は保険関係成立届の「成立年月日（雇用）」と同じ
 * ・各種変更届：事業所の所在地・名称、事業主の住所・名称・氏名、事業の種類が変わった日の翌日から10日以内。変更した欄だけ書き、
 *   所在地が変わったときは所在地をすべて書く。法人の代表者が変わっただけなら要らない。所在地が変わったときは、先に労働基準監督署へ
 *   「労働保険名称、所在地等変更届」を出し、その控を添えて出す（一元適用事業）
 * ・事業所の名称（カタカナ）はカタカナと「－」だけ。所在地（漢字）は都道府県名を書かず、1行目に市区町村、2行目に丁目・番地、3行目にビル名など
 * 会社設定・拠点・給与規定グループ・従業員から初めの値を出す（名称のカナ・事業の概要などは、この画面で入れる。残さない）
 */
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { formatWareki } from "../../utils/wareki";
import { card, input, labelStyle, fieldStyle, small, table, td, th, title, button } from "./ShahoFilePanel";

type FormKind = "secchi" | "henko";
type ChangeItem = "name" | "address" | "phone" | "laborNumber" | "business";

const CHANGE_LABELS: Record<ChangeItem, string> = {
  name: "事業所の名称", address: "事業所の所在地（郵便番号も）", phone: "事業所の電話番号", laborNumber: "労働保険番号", business: "事業の概要（事業内容が変わった）",
};

/** 所在地から都道府県名を除く（設置届・各種変更届の所在地（漢字）は都道府県名を書かない） */
export const addressWithoutPrefecture = (address: string): string =>
  address.trim().replace(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, "");

/** 提出期限：できごとの日の翌日から起算して10日以内 */
export const officeFormDeadline = (date: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? dayjs(date).add(10, "day").format("YYYY-MM-DD") : "");

export default function KoyoOfficeFormsPanel({ db, staffList }: { db: any; staffList: any[] }) {
  const [kind, setKind] = useState<FormKind>("secchi");
  const [company, setCompany] = useState<any>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [placeId, setPlaceId] = useState(0);
  const [date, setDate] = useState("");
  const [kana, setKana] = useState("");
  const [business, setBusiness] = useState("");
  const [section, setSection] = useState("");
  const [route, setRoute] = useState("");
  const [shaho, setShaho] = useState({ health: true, pension: true, rousai: true });
  const [changed, setChanged] = useState<Record<ChangeItem, boolean>>({ name: false, address: false, phone: false, laborNumber: false, business: false });

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select("SELECT * FROM company WHERE id = 1");
        setCompany(c?.[0] ?? {});
        setBranches((await db.select("SELECT * FROM branches ORDER BY id").catch(() => [])) ?? []);
        setGroups((await db.select("SELECT id, name, closing_day, payment_day, is_next_month FROM payroll_groups ORDER BY id").catch(() => [])) ?? []);
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
        setCompany({});
      }
    })();
  }, [db]);

  // 届ける事業所：本社（会社設定）か、雇用保険適用事業所番号が別の拠点
  const places = useMemo(() => {
    const own = branches.filter((b) => String(b.koyo_office_number ?? "").trim());
    return [{ id: 0, name: "本社（会社設定）" }, ...own.map((b) => ({ id: Number(b.id), name: String(b.name ?? "") }))];
  }, [branches]);
  const branch = branches.find((b) => Number(b.id) === placeId) ?? null;
  const c = company ?? {};
  const atPlace = (s: any) => (placeId === 0
    ? !branches.some((b) => Number(b.id) === Number(s.branch_id) && String(b.koyo_office_number ?? "").trim())
    : Number(s.branch_id) === placeId);
  const today = dayjs().format("YYYY-MM-DD");
  const on = date || today;
  const active = staffList.filter((s) => atPlace(s) && (!s.join_date || s.join_date <= on) && (!s.retirement_date || s.retirement_date >= on));
  const insured = active.filter((s) => Number(s.is_employment_ins_eligible ?? 1) === 1);
  const g = groups[0];
  const closing = g ? (Number(g.closing_day) === 99 ? "末日" : `${g.closing_day}日`) : "";
  const payment = g ? `${Number(g.is_next_month) === 1 ? "翌月" : "当月"}${Number(g.payment_day) === 99 ? "末日" : `${g.payment_day}日`}` : "";
  const name = String(branch?.name ? `${c.name ?? ""} ${branch.name}` : c.name ?? "");
  const zip = String(branch?.zip_code ?? c.zip_code ?? "");
  const address = String(branch?.address ?? c.address ?? "");
  const phone = String(branch?.phone ?? c.phone ?? "");
  const officeNumber = String(branch?.koyo_office_number ?? c.koyo_office_number ?? "");
  const laborNumber = String(branch?.labor_ins_num ?? c.labor_ins_num ?? "");
  const helloWork = String(branch?.koyo_hello_work ?? c.koyo_hello_work ?? "");

  const items: [string, string][] = kind === "secchi"
    ? [
      ["法人番号（個人事業は書かない）", String(c.corporate_number ?? "")],
      ["事業所の名称（カタカナ。カタカナと「－」だけ）", kana],
      ["事業所の名称（漢字）", name],
      ["郵便番号", zip],
      ["事業所の所在地（漢字。都道府県名は書かない）", addressWithoutPrefecture(address)],
      ["事業所の電話番号", phone],
      ["設置年月日（雇用保険の適用事業になった日。保険関係成立届の「成立年月日（雇用）」と同じ）", date ? formatWareki(date) : ""],
      ["労働保険番号（保険関係成立届の事業主控に書かれた番号）", laborNumber],
      ["事業主の住所（法人は主たる事務所の所在地）", String(c.address ?? "")],
      ["事業主の名称", String(c.name ?? "")],
      ["事業主の氏名（法人は代表者の職名と氏名）", String(c.representative ?? "")],
      ["事業の概要", business],
      ["常時使用労働者数", `${active.length}人`],
      ["雇用保険被保険者数", `一般 ${insured.length}人・日雇 0人`],
      ["賃金支払関係", g ? `賃金締切日 ${closing}・賃金支払日 ${payment}` : ""],
      ["雇用保険担当課名", section],
      ["社会保険加入状況", [shaho.health && "健康保険", shaho.pension && "厚生年金保険", shaho.rousai && "労災保険"].filter(Boolean).join("・")],
      ["最寄りの駅又はバス停から事業所への道順", route],
    ]
    : [
      ["変更年月日", date ? formatWareki(date) : ""],
      ["事業所番号", officeNumber],
      ["法人番号（個人事業は書かない）", String(c.corporate_number ?? "")],
      ...(changed.name ? [["変更後の事業所の名称（カタカナ）", kana], ["変更後の事業所の名称（漢字）", name]] as [string, string][] : []),
      ...(changed.address ? [["変更後の郵便番号", zip], ["変更後の事業所の所在地（漢字。都道府県名は書かない。所在地はすべて書く）", addressWithoutPrefecture(address)]] as [string, string][] : []),
      ...(changed.phone ? [["変更後の事業所の電話番号", phone]] as [string, string][] : []),
      ...(changed.laborNumber || changed.address ? [["労働保険番号（所在地の移転などで変わったとき。ほかのハローワークの管内から移ったときは、変わらなくても書く）", laborNumber]] as [string, string][] : []),
      ...(changed.business ? [["変更後の事業の概要（変更後の事業内容を具体的に）", business]] as [string, string][] : []),
    ];

  const deadline = officeFormDeadline(date);
  return (
    <div style={card}>
      <h3 style={{ ...title, fontSize: 15 }} className="no-print">雇用保険の事業所の届（設置届・各種変更届）</h3>
      <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setKind("secchi")} style={button(kind === "secchi" ? "#2563eb" : "#94a3b8")}>雇用保険適用事業所設置届</button>
          <button onClick={() => setKind("henko")} style={button(kind === "henko" ? "#2563eb" : "#94a3b8")}>雇用保険事業主事業所各種変更届</button>
        </div>
        <label style={fieldStyle}>
          <span style={labelStyle}>事業所</span>
          <select value={placeId} onChange={(e) => setPlaceId(Number(e.target.value))} style={input}>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>{kind === "secchi" ? "設置年月日" : "変更年月日"}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>事業所の名称（カタカナ）</span>
          <input value={kana} onChange={(e) => setKana(e.target.value)} placeholder="カブシキガイシャ ○○" style={{ ...input, width: 200 }} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>事業の概要</span>
          <input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="例：ソフトウェアの開発・販売" style={{ ...input, width: 220 }} />
        </label>
        {kind === "secchi" && (<>
          <label style={fieldStyle}>
            <span style={labelStyle}>雇用保険担当課名</span>
            <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="総務課" style={{ ...input, width: 120 }} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>最寄りの駅・バス停からの道順</span>
            <input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="○○駅から徒歩5分" style={{ ...input, width: 180 }} />
          </label>
          <div style={{ fontSize: 12, display: "flex", gap: 8 }}>
            {(["health", "pension", "rousai"] as const).map((k) => (
              <label key={k}><input type="checkbox" checked={shaho[k]} onChange={(e) => setShaho({ ...shaho, [k]: e.target.checked })} /> {k === "health" ? "健康保険" : k === "pension" ? "厚生年金保険" : "労災保険"}</label>
            ))}
          </div>
        </>)}
        {kind === "henko" && (
          <div style={{ fontSize: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>変わったもの：</span>
            {(Object.keys(CHANGE_LABELS) as ChangeItem[]).map((k) => (
              <label key={k}><input type="checkbox" checked={changed[k]} onChange={(e) => setChanged({ ...changed, [k]: e.target.checked })} /> {CHANGE_LABELS[k]}</label>
            ))}
          </div>
        )}
        <button onClick={() => window.print()} style={button("#2563eb")}>🖨 印刷・PDF保存</button>
      </div>
      <div className="no-print" style={{ ...small, marginBottom: 8, lineHeight: 1.7 }}>
        {kind === "secchi"
          ? "労働者を雇う事業を始めた日（適用事業に該当した日）の翌日から10日以内に、事業所の所在地のハローワークに出します。労働保険 保険関係成立届の事業主控・登記事項証明書（法人番号を書けば省けます）・賃金台帳・労働者名簿・出勤簿を持っていき、資格取得届（または転勤届）を同時に出します。"
          : "変わった日の翌日から10日以内に出します。変わった欄だけを書きます（所在地が変わったときは所在地をすべて）。法人の代表者が変わっただけなら要りません。所在地が変わったときは、先に労働基準監督署へ「労働保険名称、所在地等変更届」を出し、その控を添えます（会社設定の名称・所在地などは、先に新しい値に直してください）。"}
        {deadline && <b>　提出期限：{formatWareki(deadline)}</b>}
        {helloWork && <span>　あて先：{helloWork}公共職業安定所長</span>}
      </div>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>{kind === "secchi" ? "雇用保険適用事業所設置届" : "雇用保険事業主事業所各種変更届"}に書く内容</h2>
      <table style={{ ...table, maxWidth: 820 }}>
        <thead><tr><th style={{ ...th, width: 320 }}>欄</th><th style={th}>書くこと</th></tr></thead>
        <tbody>
          {items.map(([label, value]) => (
            <tr key={label}>
              <td style={td}>{label}</td>
              <td style={{ ...td, color: value ? undefined : "#b45309" }}>{value || "（入れてください）"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {kind === "henko" && !Object.values(changed).some(Boolean) && <div className="no-print" style={{ ...small, color: "#b45309", marginTop: 6 }}>変わったものに印を付けてください。</div>}
    </div>
  );
}
