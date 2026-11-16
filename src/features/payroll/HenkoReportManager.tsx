/**
 * 「住所・氏名の変更届」の画面
 * ・健康保険・厚生年金保険 被保険者住所変更届（国民年金第3号被保険者住所変更届）
 * ・健康保険・厚生年金保険 被保険者氏名変更（訂正）届
 * マイナンバーと基礎年金番号が結びついている人は、原則、届けは要らない（住民票の住所・氏名で変わる）。結びついていない人などの
 * 届書の内容を出して印刷する（電子申請用のファイルの形がないので、紙の届書に書き写すか、e-Gov の画面で入れる）。
 * 新しい住所・氏名は、先に従業員の画面で直しておく（変更前の氏名は、この画面で入れる）。作り方は utils/printForms.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { addressChangeForm, nameChangeForm } from "../../utils/printForms";
import { parseHealthDependents } from "../../utils/healthDependents";
import { useShahoFile } from "./useShahoFile";
import { PrintFormSheet } from "./PrintFormSheet";
import { card, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, title } from "./ShahoFilePanel";

interface Props {
  db: Database;
  staffList: any[];
}

const PRINT_ID = "henko-report-print";

export default function HenkoReportManager({ db, staffList }: Props) {
  const file = useShahoFile(db);
  const today = dayjs().format("YYYY-MM-DD");
  const [kind, setKind] = useState<"address" | "name">("address");
  const [staffId, setStaffId] = useState("");
  const [submittedOn, setSubmittedOn] = useState(today);
  const [changedOn, setChangedOn] = useState("");
  const [remark, setRemark] = useState("");
  const [oldName, setOldName] = useState("");
  const [withSpouse, setWithSpouse] = useState(false);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);

  const staff = staffList.find((s) => String(s.id) === staffId);
  // 同居の被扶養配偶者（第3号被保険者）の住所も一緒に変える
  const spouse = staff ? parseHealthDependents(staff.health_dependents).find((d) => d.spouse && !d.until) : undefined;
  const form = !staff ? null : kind === "address"
    ? addressChangeForm({
      staff, submittedOn, changedOn, remark, myNumber: false,
      spouse: withSpouse && spouse ? { name: spouse.name, kana: spouse.kana, birthday: spouse.birthday, together: spouse.together, zip: spouse.zip, address: spouse.address } : null,
    })
    : nameChangeForm({ staff, submittedOn, oldName, remark, myNumber: false });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, false)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>住所変更届・氏名変更（訂正）届（健康保険・厚生年金保険）</h3>
        <p style={note}>
          マイナンバーと基礎年金番号が結びついている人は、住所・氏名が変わっても、原則、届けは要りません（住民票の住所・氏名で変わります）。
          結びついていない人・協会けんぽの健康保険だけに入っている人・海外に住んでいる人・短期在留の外国人・住民票以外の居所を登録する人などは、事業主が届けます。
          先に従業員の画面で新しい住所（郵便番号・フリガナ）・氏名を直してから、ここで届書の内容を出してください。
          この届書は電子申請用のファイルの形がないので、紙の届書に書き写すか、e-Gov の画面で入れます（マイナンバーを書くときは、届書に手で書きます）。
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>届書</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as "address" | "name")} style={input}>
              <option value="address">被保険者住所変更届</option>
              <option value="name">被保険者氏名変更（訂正）届</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>従業員</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ ...input, minWidth: 200 }}>
              <option value="">選んでください</option>
              {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>提出日</span>
            <input type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} style={input} />
          </label>
          {kind === "address" ? (
            <>
              <label style={fieldStyle}>
                <span style={labelStyle}>住所が変わった日</span>
                <input type="date" value={changedOn} onChange={(e) => setChangedOn(e.target.value)} style={input} />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>備考</span>
                <select value={remark} onChange={(e) => setRemark(e.target.value)} style={input}>
                  <option value="">—</option>
                  <option value="短期在留">短期在留</option>
                  <option value="海外居住">海外居住</option>
                  <option value="住民票住所以外の居所">住民票住所以外の居所</option>
                </select>
              </label>
              {spouse && (
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
                  <input type="checkbox" checked={withSpouse} onChange={(e) => setWithSpouse(e.target.checked)} />
                  被扶養配偶者（{spouse.name}）の住所も変える
                </label>
              )}
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                <span style={labelStyle}>変更前の氏名</span>
                <input value={oldName} placeholder="姓 名" onChange={(e) => setOldName(e.target.value)} style={input} />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>備考</span>
                <input value={remark} onChange={(e) => setRemark(e.target.value)} style={input} />
              </label>
            </>
          )}
          <button onClick={() => setPrintRequest((n) => n + 1)} disabled={!form}
            style={{ padding: "8px 14px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", cursor: "pointer", backgroundColor: form ? "#2563eb" : "#94a3b8" }}>
            印刷する
          </button>
        </div>
      </div>
      <div id={PRINT_ID} style={card}>
        {form ? <PrintFormSheet form={form} office={file.office.values} /> : <div style={small}>従業員を選んでください。</div>}
      </div>
    </div>
  );
}
