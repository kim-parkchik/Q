/**
 * 「労働者名簿の項目」：労働者名簿に書く項目のうち、ほかの欄にないもの（労働基準法107条・施行規則53条）
 * 従事する業務の種類（常時30人未満の事業では書かなくてよい）・履歴・退職の事由（解雇のときはその理由も）・死亡の年月日と原因。
 * 氏名・生年月日・性別・住所・入社日・退職日は、ほかの欄から書く。労働者名簿は「法定三帳簿」の画面で出す（utils/legalBooks.ts）
 */
import { BookUser } from "lucide-react";
import { inputStyle, labelStyle } from "../StaffManager.styles";
import type { StaffManagerState } from "../useStaffManager";

interface Props {
  cm: StaffManagerState;
}

/** 退職の事由の例（自由に書ける） */
const REASONS = ["自己都合による退職", "定年による退職", "契約期間の満了", "会社都合による退職", "解雇（理由：）", "死亡"];

export default function RosterSection({ cm }: Props) {
  const {
    targetStatus, targetJobType, setTargetJobType, targetCareerHistory, setTargetCareerHistory,
    targetRetirementReason, setTargetRetirementReason, targetDeathDate, setTargetDeathDate, targetDeathCause, setTargetDeathCause,
  } = cm;
  const retired = targetStatus === "retired";
  const died = targetRetirementReason.includes("死亡") || !!targetDeathDate || !!targetDeathCause;

  return (
    <div style={{ width: "100%" }}>
      <h4 style={{ borderLeft: "4px solid #7c3aed", paddingLeft: "10px", margin: "10px 0", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
        <BookUser size={14} /> 労働者名簿の項目
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div>
          <label style={labelStyle}>従事する業務の種類（常時30人未満の会社は書かなくてよい）</label>
          <input value={targetJobType} onChange={(e) => setTargetJobType(e.target.value)} style={inputStyle} placeholder="例：一般事務、営業、製造（組立）" />
        </div>
        <div>
          <label style={labelStyle}>履歴（学歴・職歴など）</label>
          <textarea value={targetCareerHistory} onChange={(e) => setTargetCareerHistory(e.target.value)} rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} placeholder={"例：2015年3月 ○○高校 卒業\n2015年4月 株式会社△△ 入社（営業）"} />
        </div>
        {retired && (
          <div>
            <label style={labelStyle}>退職の事由（解雇のときは、その理由も書きます）</label>
            <input value={targetRetirementReason} onChange={(e) => setTargetRetirementReason(e.target.value)} list="retirement-reasons" style={inputStyle} placeholder="例：自己都合による退職" />
            <datalist id="retirement-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
        )}
        {retired && died && (
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>死亡の年月日</label>
              <input type="date" value={targetDeathDate} onChange={(e) => setTargetDeathDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>死亡の原因</label>
              <input value={targetDeathCause} onChange={(e) => setTargetDeathCause(e.target.value)} style={inputStyle} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
