/**
 * 「社会保険のそのほかの届書」の画面（作り方は utils/shahoOtherForms.ts）
 * ローマ字氏名届・二以上事業所勤務届・区分変更届・介護保険適用除外等該当・非該当届・任意継続の申出書（資格喪失証明欄）と、
 * 会社の届書（新規適用届・事業所関係変更（訂正）届・名称／所在地変更（訂正）届）の内容を出して印刷する。
 * 介護保険の届を「保存して印刷」すると、被保険者の適用除外の期間を残し、その月の分から介護保険料をかけない（utils/kaigoExempt.ts）。
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { parseHealthDependents } from "../../utils/healthDependents";
import { KAIGO_EXEMPT_REASONS, parseKaigoExempt, recordKaigoExempt, stringifyKaigoExempt, type KaigoExemptReason } from "../../utils/kaigoExempt";
import {
  COMPANY_FORM_FIELDS, COMPANY_FORM_TITLES, companyForm, companyFormDefaults, kaigoForm, kubunForm, KUBUN_LABELS, ninkeiForm, nijouForm, romajiForm,
  type CompanyFormKind, type KubunAfter, type NijouOffice,
} from "../../utils/shahoOtherForms";
import { formatWareki } from "../../utils/wareki";
import { PrintFormSheet } from "./PrintFormSheet";
import { card, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, title } from "./ShahoFilePanel";
import { useShahoFile } from "./useShahoFile";

const PRINT_ID = "shaho-other-print";

type Kind = "romaji" | "nijou" | "kubun" | "kaigo" | "ninkei" | CompanyFormKind;
const KIND_LABELS: Record<Kind, string> = {
  romaji: "厚生年金保険被保険者 ローマ字氏名届",
  nijou: "被保険者所属選択／二以上事業所勤務届",
  kubun: "被保険者区分変更届（通常の労働者・短時間労働者・特定減額特例対象者）",
  kaigo: "介護保険 適用除外等該当・非該当届",
  ninkei: "任意継続被保険者資格取得申出書（協会けんぽ。資格喪失証明欄）",
  shinki: COMPANY_FORM_TITLES.shinki,
  henko: COMPANY_FORM_TITLES.henko,
  meisho: COMPANY_FORM_TITLES.meisho,
};
const isCompanyKind = (k: Kind): k is CompanyFormKind => k === "shinki" || k === "henko" || k === "meisho";

const emptyOffice = (): NijouOffice => ({ symbol: "", insuredNumber: "", name: "", address: "", acquiredOn: "", lostOn: "", currency: null, inKind: null, fund: "" });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={fieldStyle}><span style={labelStyle}>{label}</span>{children}</label>;
}

export default function ShahoOtherManager({ db, staffList }: { db: Database; staffList: any[] }) {
  const file = useShahoFile(db);
  const toast = useToast();
  const dialog = useMessageDialog();
  const today = dayjs().format("YYYY-MM-DD");
  const [kind, setKind] = useState<Kind>("romaji");
  const [staffId, setStaffId] = useState("");
  const [submittedOn, setSubmittedOn] = useState(today);
  const [myNumber, setMyNumber] = useState(false);
  // ローマ字氏名届
  const [resident, setResident] = useState<"" | "無" | "有">("");
  const [usedName, setUsedName] = useState<"romaji" | "kanji" | "common">("romaji");
  const [kanjiName, setKanjiName] = useState("");
  const [commonName, setCommonName] = useState("");
  const [reason, setReason] = useState("");
  // 二以上事業所勤務届
  const [oursSelected, setOursSelected] = useState(true);
  const [other, setOther] = useState<NijouOffice>(emptyOffice());
  // 区分変更届
  const [after, setAfter] = useState<KubunAfter>("1");
  const [changedOn, setChangedOn] = useState("");
  const [remarks, setRemarks] = useState("");
  // 介護保険
  const [dependentId, setDependentId] = useState("");
  const [kaigoKind, setKaigoKind] = useState<"該当" | "非該当">("該当");
  const [kaigoReason, setKaigoReason] = useState<KaigoExemptReason>("1");
  const [kaigoDate, setKaigoDate] = useState("");
  const [lastAddress, setLastAddress] = useState("");
  const [facility, setFacility] = useState("");
  const [facilityAddress, setFacilityAddress] = useState("");
  // 会社の届書
  const [ctx, setCtx] = useState<{ company: any; groups: any[]; allowanceNames: string[]; unionNames: string[] } | null>(null);
  const [companyValues, setCompanyValues] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const [company] = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
        const groups = await db.select<any[]>("SELECT closing_day, is_next_month, payment_day FROM payroll_groups WHERE is_active = 1");
        const items = await db.select<any[]>("SELECT name FROM salary_item_master WHERE type = 'earning' AND category = 'fixed' ORDER BY display_order, id");
        const unions = await db.select<any[]>("SELECT name FROM social_insurance_groups WHERE type = 'union' AND is_active = 1");
        setCtx({ company: company ?? {}, groups: groups ?? [], allowanceNames: (items ?? []).map((r) => String(r.name)), unionNames: (unions ?? []).map((r) => String(r.name)) });
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  // 会社の届書を選んだら、初めの値を入れ直す
  useEffect(() => {
    if (!ctx || !isCompanyKind(kind)) return;
    setCompanyValues(companyFormDefaults(kind, { ...ctx, staffList, today }));
  }, [kind, ctx]);

  const staff = staffList.find((s) => String(s.id) === staffId);
  const dependents = staff ? parseHealthDependents(staff.health_dependents).filter((d) => !d.until) : [];
  const dependent = dependents.find((d) => d.id === dependentId) ?? null;
  const company = ctx?.company ?? {};

  const ours = useMemo((): NijouOffice => ({
    symbol: [company.shaho_office_symbol].filter(Boolean).join(""), insuredNumber: String(staff?.pension_num ?? ""),
    name: String(company.name ?? ""), address: String(company.address ?? ""), acquiredOn: String(staff?.join_date ?? ""), lostOn: "",
    currency: staff ? Number(staff.standard_remuneration) || null : null, inKind: null, fund: "",
  }), [company, staff]);

  const form = useMemo(() => {
    if (isCompanyKind(kind)) return ctx ? companyForm(kind, companyValues, company) : null;
    if (!staff) return null;
    switch (kind) {
      case "romaji":
        return romajiForm({ staff, submittedOn, resident, usedName, kanjiName, kanjiKana: "", commonName, commonKana: "", reason });
      case "nijou":
        return nijouForm({ staff, submittedOn, myNumber, oursSelected, ours, other });
      case "kubun":
        return kubunForm({ staff, submittedOn, myNumber, after, changedOn, remarks });
      case "kaigo":
        return kaigoForm({
          staff, submittedOn, kind: kaigoKind, reason: kaigoReason, date: kaigoDate, lastAddress, facility, facilityAddress, remarks,
          dependent: dependent ? { name: dependent.name, kana: dependent.kana, relation: dependent.relation, birthday: dependent.birthday, zip: dependent.zip, address: dependent.address } : null,
        });
      case "ninkei":
        return ninkeiForm({ staff, company, certifiedOn: submittedOn, dependents: dependents.map((d) => ({ name: d.name, kana: d.kana, relation: d.relation, birthday: d.birthday })) });
    }
    return null;
  }, [kind, staff, submittedOn, resident, usedName, kanjiName, commonName, reason, myNumber, oursSelected, ours, other, after, changedOn, remarks,
    kaigoKind, kaigoReason, kaigoDate, lastAddress, facility, facilityAddress, dependent, ctx, companyValues, company]);

  const saveKaigo = async () => {
    if (!staff || !kaigoDate) return;
    try {
      const next = recordKaigoExempt(staff.kaigo_exempt, kaigoKind, kaigoDate, kaigoReason, facility, facilityAddress);
      const json = stringifyKaigoExempt(next);
      await db.execute("UPDATE staff SET kaigo_exempt = ? WHERE id = ?", [json, String(staff.id)]);
      staff.kaigo_exempt = json;
      toast.success("介護保険の適用除外の期間を残しました");
      window.print();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };
  const periods = staff ? parseKaigoExempt(staff.kaigo_exempt) : [];
  const office = isCompanyKind(kind) && kind === "shinki" ? [] : file.office.values;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, false)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>社会保険のそのほかの届書</h3>
        <p style={note}>
          電子申請用のファイルの形がない健康保険・厚生年金保険の届書の、書く内容を出して印刷します（紙の届書に書き写すか、e-Gov の画面で入れます）。
          マイナンバーは印刷しません（書くときは、事務取扱担当者が届書に書きます）。
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="届書">
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ ...input, minWidth: 320 }}>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          {!isCompanyKind(kind) && (
            <>
              <Field label="従業員">
                <select value={staffId} onChange={(e) => { setStaffId(e.target.value); setDependentId(""); }} style={{ ...input, minWidth: 200 }}>
                  <option value="">選んでください</option>
                  {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.id} {s.name}{(s.status || "active") === "retired" ? "（退職）" : ""}</option>)}
                </select>
              </Field>
              <Field label={kind === "ninkei" ? "証明日" : "提出日"}>
                <input type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} style={input} />
              </Field>
            </>
          )}
          {(kind === "nijou" || kind === "kubun") && (
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={myNumber} onChange={(e) => setMyNumber(e.target.checked)} /> 個人番号（マイナンバー）を書く
            </label>
          )}
        </div>

        {kind === "romaji" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <Field label="住民登録の有無">
              <select value={resident} onChange={(e) => setResident(e.target.value as "" | "無" | "有")} style={input}>
                <option value="">選ぶ</option><option value="有">有</option><option value="無">無</option>
              </select>
            </Field>
            <Field label="資格取得届などに使っている氏名">
              <select value={usedName} onChange={(e) => setUsedName(e.target.value as "romaji" | "kanji" | "common")} style={input}>
                <option value="romaji">ローマ字氏名</option><option value="kanji">漢字氏名</option><option value="common">通称名</option>
              </select>
            </Field>
            <Field label="漢字氏名（住民票にあれば。任意）"><input value={kanjiName} onChange={(e) => setKanjiName(e.target.value)} style={input} /></Field>
            <Field label="通称名（住民票にあれば。任意）"><input value={commonName} onChange={(e) => setCommonName(e.target.value)} style={input} /></Field>
            <Field label="ローマ字氏名を持たない理由">
              <select value={reason} onChange={(e) => setReason(e.target.value)} style={input}>
                <option value="">（ローマ字氏名がある）</option>
                <option>短期在留者であるため</option>
                <option>海外に住所を有している者であるため</option>
                <option>在留カード（または特別永住者証明書）にローマ字氏名が記載されていないため</option>
              </select>
            </Field>
          </div>
        )}

        {kind === "nijou" && (
          <div style={{ marginTop: 10 }}>
            <Field label="選択事業所（主たる事業所）">
              <select value={oursSelected ? "ours" : "other"} onChange={(e) => setOursSelected(e.target.value === "ours")} style={input}>
                <option value="ours">この会社を選ぶ</option><option value="other">もう1つの事業所を選ぶ</option>
              </select>
            </Field>
            <div style={{ fontSize: 12, fontWeight: "bold", margin: "8px 0 4px" }}>もう1つの事業所</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Field label="事業所整理記号"><input value={other.symbol} onChange={(e) => setOther({ ...other, symbol: e.target.value })} style={input} /></Field>
              <Field label="被保険者整理番号"><input value={other.insuredNumber} onChange={(e) => setOther({ ...other, insuredNumber: e.target.value })} style={input} /></Field>
              <Field label="事業所名称"><input value={other.name} onChange={(e) => setOther({ ...other, name: e.target.value })} style={input} /></Field>
              <Field label="事業所所在地"><input value={other.address} onChange={(e) => setOther({ ...other, address: e.target.value })} style={{ ...input, minWidth: 260 }} /></Field>
              <Field label="資格取得年月日"><input type="date" value={other.acquiredOn} onChange={(e) => setOther({ ...other, acquiredOn: e.target.value })} style={input} /></Field>
              <Field label="報酬月額（通貨。円）"><input type="number" value={other.currency ?? ""} onChange={(e) => setOther({ ...other, currency: e.target.value === "" ? null : Number(e.target.value) })} style={input} /></Field>
              <Field label="報酬月額（現物。円）"><input type="number" value={other.inKind ?? ""} onChange={(e) => setOther({ ...other, inKind: e.target.value === "" ? null : Number(e.target.value) })} style={input} /></Field>
            </div>
            <div style={{ ...small, marginTop: 4 }}>この会社の報酬月額の初めの値は、いまの標準報酬月額です（届書には、実際の報酬月額を書きます）。</div>
          </div>
        )}

        {kind === "kubun" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <Field label="変更後区分">
              <select value={after} onChange={(e) => setAfter(e.target.value as KubunAfter)} style={input}>
                {(Object.keys(KUBUN_LABELS) as KubunAfter[]).map((k) => <option key={k} value={k}>{KUBUN_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="変更年月日"><input type="date" value={changedOn} onChange={(e) => setChangedOn(e.target.value)} style={input} /></Field>
            <Field label="備考"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} style={input} /></Field>
          </div>
        )}

        {kind === "kaigo" && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Field label="だれの届か">
                <select value={dependentId} onChange={(e) => setDependentId(e.target.value)} style={input}>
                  <option value="">被保険者本人</option>
                  {dependents.map((d) => <option key={d.id} value={d.id}>被扶養者：{d.name}（{d.relation}）</option>)}
                </select>
              </Field>
              <Field label="該当・非該当">
                <select value={kaigoKind} onChange={(e) => setKaigoKind(e.target.value as "該当" | "非該当")} style={input}>
                  <option value="該当">該当（理由に該当した）</option><option value="非該当">非該当（理由がなくなった）</option>
                </select>
              </Field>
              <Field label="適用除外等の理由">
                <select value={kaigoReason} onChange={(e) => setKaigoReason(e.target.value as KaigoExemptReason)} style={input}>
                  {(Object.keys(KAIGO_EXEMPT_REASONS) as KaigoExemptReason[]).map((k) => <option key={k} value={k}>{k}．{KAIGO_EXEMPT_REASONS[k]}</option>)}
                </select>
              </Field>
              <Field label={`${kaigoKind}の年月日`}><input type="date" value={kaigoDate} onChange={(e) => setKaigoDate(e.target.value)} style={input} /></Field>
              <Field label="国外へ転居したときの最後の住所"><input value={lastAddress} onChange={(e) => setLastAddress(e.target.value)} style={{ ...input, minWidth: 240 }} /></Field>
              {kaigoReason === "2" && (
                <>
                  <Field label="入居施設の名称"><input value={facility} onChange={(e) => setFacility(e.target.value)} style={input} /></Field>
                  <Field label="入居施設の所在地"><input value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} style={input} /></Field>
                </>
              )}
              <Field label="備考"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} style={input} /></Field>
            </div>
            {staff && periods.length > 0 && (
              <div style={{ ...small, marginTop: 6 }}>
                残してある適用除外の期間：{periods.map((p) => `${formatWareki(p.from)}〜${p.to ? formatWareki(p.to) : ""}（${KAIGO_EXEMPT_REASONS[p.reason]}）`).join("、")}
              </div>
            )}
          </div>
        )}

        {isCompanyKind(kind) && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 6, marginTop: 10 }}>
            {COMPANY_FORM_FIELDS[kind].map((f) => (
              <label key={f.key} style={{ display: "contents" }}>
                <span style={{ fontSize: 12, color: "#334155", paddingTop: 6 }}>{f.label}</span>
                <input type={f.key === "submittedOn" || f.key.endsWith("On") ? "date" : "text"} value={companyValues[f.key] ?? ""}
                  onChange={(e) => setCompanyValues({ ...companyValues, [f.key]: e.target.value })} style={input} />
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {kind === "kaigo" && !dependent ? (
            <button onClick={saveKaigo} disabled={!form || !kaigoDate}
              style={{ padding: "8px 14px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", cursor: "pointer", backgroundColor: form && kaigoDate ? "#16a085" : "#94a3b8" }}>
              期間を残して印刷する（介護保険料に反映）
            </button>
          ) : null}
          <button onClick={() => window.print()} disabled={!form}
            style={{ padding: "8px 14px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", cursor: "pointer", backgroundColor: form ? "#2563eb" : "#94a3b8" }}>
            印刷する
          </button>
        </div>
      </div>
      <div id={PRINT_ID} style={card}>
        {form ? <PrintFormSheet form={form} office={office} /> : <div style={small}>{isCompanyKind(kind) ? "読み込んでいます…" : "従業員を選んでください。"}</div>}
      </div>
    </div>
  );
}
