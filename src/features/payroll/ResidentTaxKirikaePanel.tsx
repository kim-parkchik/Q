/**
 * 住民税の特別徴収への切替申請書に書く内容（市区町村ごとに様式が違い、eLTAX にも全国共通の様式がないので、市区町村の様式に書き写す。印刷できる）
 *
 * 欄は、市区町村の切替申請書に共通する項目（例：世田谷区「特別区民税・都民税・森林環境税 特別徴収への切替申請書」。
 * roumu-forms/source/setagaya-kirikae.pdf）：
 * ・給与支払者（特別徴収義務者）：所在地・名称とフリガナ・代表者職氏名・法人番号・特別徴収義務者指定番号（新規なら納入書の要・不要）・担当者と連絡先
 * ・給与所得者：氏名とフリガナ・生年月日・1月1日現在の住所・現在の住所、届出理由（入社した日・その他）
 * ・普通徴収の切替期別（何期以降を特別徴収に切り替えるか。納期限を過ぎた期は切り替えられない）・特別徴収開始予定月（何月分（何月何日納期分）から）、
 *   月割額の通知が要る日、受給者番号（任意）
 * ・添付書類：普通徴収の納付書（納期が来ていない、未納付のもの。口座振替の人と納付済みのものは要らない）
 * 指定番号は住民税の市区町村の設定、担当者は給与支払報告書の総括表の連絡者から初めの値を出す。入れたものは残さない
 */
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { localGovByCode, localGovLabel } from "../../utils/localGov";
import { formatWareki } from "../../utils/wareki";
import * as S from "./reportStyles";

export default function ResidentTaxKirikaePanel({ db, staffList }: { db: any; staffList: any[] }) {
  const today = dayjs().format("YYYY-MM-DD");
  const [staffId, setStaffId] = useState("");
  const [company, setCompany] = useState<any>({});
  const [contact, setContact] = useState({ kana: "", dept: "", name: "", phone: "" });
  const [designations, setDesignations] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    submittedOn: today, reason: "join" as "join" | "other", reasonText: "", term: "2", startMonth: dayjs().add(1, "month").format("YYYY-MM"),
    noticeBy: "", receiverNumber: "", needSlip: "要",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select("SELECT name, address, corporate_number, representative, phone FROM company WHERE id = 1");
        setCompany(c?.[0] ?? {});
        const p = await db.select("SELECT payer_kana, contact_dept, contact_section, contact_name, contact_phone FROM salary_report_settings WHERE id = 1").catch(() => []);
        setContact({
          kana: String(p?.[0]?.payer_kana ?? ""), dept: [p?.[0]?.contact_dept, p?.[0]?.contact_section].filter(Boolean).join(" "),
          name: String(p?.[0]?.contact_name ?? ""), phone: String(p?.[0]?.contact_phone || c?.[0]?.phone || ""),
        });
        const m = await db.select("SELECT code, designation_number FROM resident_tax_municipalities").catch(() => []);
        setDesignations(Object.fromEntries((m ?? []).map((x: any) => [String(x.code), String(x.designation_number ?? "").trim()])));
      } catch (e) {
        console.error("切替申請書の読み込みエラー:", e);
      }
    })();
  }, [db]);

  // 入社した人（退職していない人）を新しい順に
  const people = useMemo(
    () => [...staffList].filter((s) => !s.retirement_date).sort((a, b) => String(b.join_date ?? "").localeCompare(String(a.join_date ?? ""))),
    [staffList],
  );
  const staff = staffList.find((s) => String(s.id) === staffId);
  const muniCode = String(staff?.resident_tax_municipality ?? "");
  const muni = localGovLabel(localGovByCode(muniCode));
  const designation = designations[muniCode] ?? "";
  const [sy, sm] = v.startMonth.split("-").map(Number);
  // 特別徴収の納期：その月分の給与から引いた税額を、翌月10日までに納める
  const dueOf = sy && sm ? dayjs(`${v.startMonth}-01`).add(1, "month").date(10).format("YYYY-MM-DD") : "";

  const items: [string, string][] = staff ? [
    ["提出日・あて先", `${formatWareki(v.submittedOn)}　${muni ? `${muni}長あて` : "（住民税の市区町村を、従業員の画面で入れてください）"}`],
    ["給与支払者（特別徴収義務者）の所在地", String(company.address ?? "")],
    ["名称（フリガナ）", `${company.name ?? ""}（${contact.kana}）`],
    ["代表者の職氏名", String(company.representative ?? "")],
    ["法人番号", String(company.corporate_number ?? "")],
    ["特別徴収義務者指定番号", designation || `新規（納入書：${v.needSlip}）`],
    ["担当者（係・氏名・連絡先）", [contact.dept, contact.name, contact.phone].filter(Boolean).join("　")],
    ["給与所得者の氏名（フリガナ）", `${staff.name ?? ""}（${staff.furigana ?? ""}）`],
    ["生年月日", formatWareki(String(staff.birthday ?? ""))],
    ["1月1日現在の住所", "（本人に確かめて書きます。住民税の納税通知書の住所）"],
    ["現在の住所", `〒${staff.zip_code ?? ""} ${staff.address ?? ""}`],
    ["届出理由", v.reason === "join" ? `入社（${formatWareki(String(staff.join_date ?? ""))}）したため` : `その他（${v.reasonText}）`],
    ["普通徴収の切替期別", `${v.term}期以降を切替希望`],
    ["特別徴収開始予定月", sy && sm ? `${sm}月分（${formatWareki(dueOf)}納期分）から特別徴収を開始` : ""],
    ["月割額の連絡（必要なときだけ）", v.noticeBy ? `${formatWareki(v.noticeBy)}までに通知書が必要` : ""],
    ["受給者番号（任意）", v.receiverNumber || String(staff.id ?? "")],
    ["添付書類", "普通徴収の納付書（納期が来ていない、まだ払っていないもの。口座振替の人と、払った納付書は要りません）"],
  ] : [];

  return (
    <div style={S.card}>
      <h3 className="no-print" style={{ margin: "0 0 8px", fontSize: 15 }}>住民税の特別徴収への切替申請書</h3>
      <div className="no-print" style={{ ...S.note, marginBottom: 8 }}>
        入社した人などの住民税を、本人が納める普通徴収から、給与から引く特別徴収に切り替えるときに、その人の住所の市区町村に出します。
        様式は市区町村ごとに違うので、ここに出した内容を、市区町村の様式（ホームページなどから取る）に書き写します。
        納期限を過ぎた普通徴収の期は切り替えられないので、本人が納めるように伝えます。税額の通知が届くまで数週間かかるので、余裕のある開始月にします。
      </div>
      <div className="no-print" style={S.controls}>
        <label style={S.field}>
          <span style={S.label}>従業員</span>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={S.input}>
            <option value="">選んでください</option>
            {people.map((s) => <option key={s.id} value={String(s.id)}>{s.name}{s.join_date ? `（${formatWareki(s.join_date)}入社）` : ""}</option>)}
          </select>
        </label>
        <label style={S.field}><span style={S.label}>提出日</span><input type="date" value={v.submittedOn} onChange={(e) => set({ submittedOn: e.target.value })} style={S.input} /></label>
        <label style={S.field}>
          <span style={S.label}>届出理由</span>
          <select value={v.reason} onChange={(e) => set({ reason: e.target.value as "join" | "other" })} style={S.input}>
            <option value="join">入社したため</option><option value="other">その他</option>
          </select>
        </label>
        {v.reason === "other" && <label style={S.field}><span style={S.label}>その他の理由</span><input value={v.reasonText} onChange={(e) => set({ reasonText: e.target.value })} style={S.input} /></label>}
        <label style={S.field}>
          <span style={S.label}>普通徴収の何期以降を切り替えるか</span>
          <select value={v.term} onChange={(e) => set({ term: e.target.value })} style={S.input}>
            {["1", "2", "3", "4"].map((t) => <option key={t} value={t}>{t}期以降</option>)}
          </select>
        </label>
        <label style={S.field}><span style={S.label}>特別徴収を始める月分</span><input type="month" value={v.startMonth} onChange={(e) => set({ startMonth: e.target.value })} style={S.input} /></label>
        <label style={S.field}><span style={S.label}>月割額の通知が要る日（なくてもよい）</span><input type="date" value={v.noticeBy} onChange={(e) => set({ noticeBy: e.target.value })} style={S.input} /></label>
        <label style={S.field}><span style={S.label}>受給者番号（任意。初めは社員番号）</span><input value={v.receiverNumber} onChange={(e) => set({ receiverNumber: e.target.value })} style={{ ...S.input, width: 120 }} /></label>
        {!designation && staff && (
          <label style={S.field}>
            <span style={S.label}>新規のとき納入書</span>
            <select value={v.needSlip} onChange={(e) => set({ needSlip: e.target.value })} style={S.input}><option>要</option><option>不要</option></select>
          </label>
        )}
        <button onClick={() => window.print()} disabled={!staff} style={S.button("#2563eb", !staff)}>🖨 印刷</button>
      </div>
      {staff && (
        <>
          <h2 style={{ fontSize: 15, margin: "10px 0 6px" }}>特別徴収への切替申請書に書く内容（{staff.name}）</h2>
          <table style={S.table}>
            <tbody>
              {items.map(([label, value]) => (
                <tr key={label}><td style={{ ...S.td, width: "32%", backgroundColor: "#f8fafc" }}>{label}</td><td style={S.td}>{value}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
