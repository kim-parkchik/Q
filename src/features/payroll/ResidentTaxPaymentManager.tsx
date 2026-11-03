/**
 * 住民税の納入：選んだ月（給与を支給した月）に引いた住民税を、納付先の市区町村ごとに合計し、納期限を出す
 * きまりと出典は utils/residentTaxPayment.ts。納付先は年度ごと（utils/residentTax.ts）
 */
import { useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { localGovByCode, localGovLabel } from "../../utils/localGov";
import type { MunicipalitySetting, PaymentGroup } from "../../utils/residentTaxPayment";
import { useResidentTaxPaymentManager } from "./useResidentTaxPaymentManager";

interface Props {
  db: Database;
  staffList: any[];
}

type Z = ReturnType<typeof useResidentTaxPaymentManager>;

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12, color: "#1e293b", padding: "7px 8px", borderBottom: "1px solid #f1f5f9" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };
const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontFamily: "monospace", width: 130 };
const select: React.CSSProperties = { padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 };

const yen = (n: number) => n.toLocaleString();
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const dateJa = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日（${WEEK[new Date(y, m - 1, day).getDay()]}）`;
};

/** 欄を離れたら保存する入力（保存できなければ元に戻す） */
function SettingInput({ label, saved, placeholder, save }: { label: string; saved: string; placeholder: string; save: (v: string) => Promise<boolean> }) {
  const [value, setValue] = useState(saved);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
      {label}
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={async () => { if (!(await save(value))) setValue(saved); }} placeholder={placeholder} style={input} />
    </label>
  );
}

function GroupCard({ g, z }: { g: PaymentGroup; z: Z }) {
  const unset = !g.code;
  const s: MunicipalitySetting = g.setting;
  const special = s.specialDue;
  return (
    <div style={{ ...card, borderLeft: unset ? "4px solid #f59e0b" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: unset ? "#b45309" : "#1e293b" }}>
          {unset ? "納付先が未設定" : localGovLabel(g.municipality) || `団体コード ${g.code}`}
          {!unset && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: "normal", marginLeft: 8 }}>団体コード {g.code}</span>}
        </div>
        {!unset && (
          <>
            <SettingInput key={`d:${g.code}:${s.designation}`} label="指定番号" saved={s.designation} placeholder="通知書の番号" save={(v) => z.saveSetting(g.code, { designation: v })} />
            <SettingInput key={`a:${g.code}:${s.atena}`} label="宛名番号" saved={s.atena} placeholder="通知書の番号" save={(v) => z.saveSetting(g.code, { atena: v })} />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#475569" }}>
              <input type="checkbox" checked={special} onChange={(e) => z.saveSetting(g.code, { specialDue: e.target.checked })} />
              納期の特例の承認を受けている
            </label>
          </>
        )}
      </div>
      {unset && <p style={{ ...note, color: "#b45309" }}>従業員の画面の「住民税（特別徴収）」で、市区町村か、年度の納付先を選んでください。</p>}

      <div style={{ display: "flex", gap: 24, alignItems: "baseline", marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#1e293b" }}>
          {special ? `${g.months[0][0]}年${g.months[0][1]}月分〜${g.months[5][0]}年${g.months[5][1]}月分（確定した分）` : `${g.months[0][0]}年${g.months[0][1]}月分`}
          ：<b style={{ fontSize: 16 }}>{yen(g.total)}円</b>（{g.people.length}人）
        </div>
        <div style={{ fontSize: 13, color: "#1e293b" }}>
          納期限：<b>{dateJa(g.due)}</b>
          {g.due !== g.statutoryDue && <span style={{ fontSize: 11, color: "#64748b" }}>（{dateJa(g.statutoryDue)}が休日のため）</span>}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr>
            <th style={th}>氏名</th>
            {g.months.map(([y, m]) => <th key={`${y}-${m}`} style={{ ...th, textAlign: "right" }}>{m === 1 || m === 12 || g.months.length === 1 ? `${y}年` : ""}{m}月分</th>)}
            {special && <th style={{ ...th, textAlign: "right" }}>合計</th>}
          </tr>
        </thead>
        <tbody>
          {g.people.map((p) => (
            <tr key={p.staffId}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{p.name}</td>
              {p.byMonth.map((v, i) => <td key={i} style={{ ...num, color: v === null ? "#cbd5e1" : undefined }}>{v === null ? "－" : yen(v)}</td>)}
              {special && <td style={{ ...num, fontWeight: "bold" }}>{yen(p.total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResidentTaxPaymentManager({ db, staffList }: Props) {
  const z = useResidentTaxPaymentManager(db, staffList);
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
  const total = z.summary.groups.reduce((s, g) => s + g.total, 0);
  const anySpecial = z.summary.groups.some((g) => g.setting.specialDue);

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#475569" }}>給与を支給した月（住民税を引いた月）</span>
          <select value={z.year} onChange={(e) => z.setYearMonth([Number(e.target.value), z.month])} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={z.month} onChange={(e) => z.setYearMonth([z.year, Number(e.target.value)])} style={select}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={note}>
          給与から引いた住民税を、納付先の市区町村ごとにまとめます。額は、確定した給与明細の住民税です（退職する人の一括徴収も入ります）。
          <br />・引いた月の翌月10日までに、その市区町村に納めます（地方税法321条の5第1項）。10日が土曜日・日曜日・祝日なら、次の平日までです（同法20条の5第2項・施行令6条の18）。
          <br />・給与を受ける人が常に10人未満の事務所で、市区町村の承認を受けていれば、6月〜11月分を12月10日まで、12月〜翌年5月分を6月10日までにまとめて納められます（納期の特例。同法321条の5の2）。
          承認を受けた市区町村は「納期の特例の承認を受けている」に印を付けてください。承認を受けた期間は、承認を受けた月からの分です。
          <br />・納付先は、その年度の通知をした市区町村です（従業員の画面の「住民税（特別徴収）」で、年度ごとに選べます。「住民税の取り込み」で取り込むと、通知の市区町村が入ります）。
          <br />・納入書・eLTAX で納めるときに、指定番号と宛名番号を使います（市区町村から届いた通知書に書いてあります）。
        </p>
      </div>

      {z.summary.pending.length > 0 && (
        <div style={{ ...card, fontSize: 12, color: "#b45309", lineHeight: 1.7 }}>
          <div style={{ fontWeight: "bold" }}>⚠ {z.year}年{z.month}月の給与がまだ確定していない人（住民税を引く予定の人）：{z.summary.pending.length}人</div>
          {z.summary.pending.map((p) => (
            <div key={p.staffId}>・{p.name}：{yen(p.expected)}円（{p.code ? localGovLabel(localGovByCode(p.code)) || p.code : "納付先が未設定"}）</div>
          ))}
          <div style={{ color: "#64748b" }}>給与を確定すると、下の額に入ります。</div>
        </div>
      )}

      {z.summary.groups.length === 0 ? (
        <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>{z.year}年{z.month}月に支給した給与で引いた住民税はありません。</div>
      ) : (
        <>
          <div style={{ ...card, fontSize: 13, color: "#1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div>
                納める額の合計：<b>{yen(total)}円</b>（{z.summary.groups.length}か所）
                {anySpecial && <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>納期の特例の市区町村は、期間の6か月の合計です</span>}
              </div>
              <button
                type="button"
                onClick={z.exportPaymentCsv}
                style={{ padding: "9px 16px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: "pointer", backgroundColor: "#27ae60", marginLeft: "auto" }}
              >
                eLTAX の納付情報の CSV を書き出す（{z.year}年{z.month}月分）
              </button>
            </div>
            <p style={note}>
              eLTAX の PCdesk の「納付情報発行依頼」（個人住民税（特別徴収））で取り込むファイルです。形式は、地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」です。
              毎月納める市区町村の、この月の分を書きます。納期の特例の市区町村は入れないので、PCdesk で入れてください。
            </p>
          </div>
          {z.summary.groups.map((g) => <GroupCard key={g.code || "unset"} g={g} z={z} />)}
        </>
      )}
    </div>
  );
}
