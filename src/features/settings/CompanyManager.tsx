// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import {
    Building2,
    FileText,
    MapPin,
    Calculator,
    ShieldCheck
} from 'lucide-react';
import { useCompanyManager } from "./useCompanyManager";
import { subTabStyle } from './CompanyManager.styles';
import InitialSetupForm from "./company/InitialSetupForm";
import CompanyInfoTab from "./company/CompanyInfoTab";
import PayrollGroupTab from "./company/PayrollGroupTab";
import SocialInsuranceTab from "./company/SocialInsuranceTab";
import BranchTab from "./company/BranchTab";
import RoundingTab from "./company/RoundingTab";

interface Props {
    db: Database;
    onSetupComplete?: () => void;
}

export default function CompanyManager({ db, onSetupComplete }: Props) {
    const cm = useCompanyManager({ db, onSetupComplete });
    const { activeSubTab, setActiveSubTab, hasSavedOnce } = cm;

    return (
        <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "30px", paddingBottom: "100px" }}>
        
            {/* --- 1. 未保存（初回）ならタブを出さずに「会社情報」だけ表示 --- */}
            {!hasSavedOnce ? (
                <InitialSetupForm cm={cm} />
            ) : (

                /* --- 2. 保存済みなら「設定タブ」を表示して多機能に切り替え --- */
                <>
                    <div>
                        <div style={{ display: "flex", borderBottom: "1px solid #ddd", gap: "5px" }}>
                            <button onClick={() => setActiveSubTab("info")} style={subTabStyle(activeSubTab === "info")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Building2 size={16} /> 基本情報
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("payroll")} style={subTabStyle(activeSubTab === "payroll")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <FileText size={16} /> 給与規定グループ
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("social")} style={subTabStyle(activeSubTab === "social")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <ShieldCheck size={16} /> 社会保険規定
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("branches")} style={subTabStyle(activeSubTab === "branches")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <MapPin size={16} /> 支店リスト
                                </div>
                            </button>
                            <button onClick={() => setActiveSubTab("rounding")} style={subTabStyle(activeSubTab === "rounding")}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Calculator size={16} /> 端数処理
                                </div>
                            </button>
                        </div>
                    </div>

                    {activeSubTab === "info" && <CompanyInfoTab cm={cm} />}

                    {activeSubTab === "payroll" && <PayrollGroupTab cm={cm} />}
                    {activeSubTab === "social" && <SocialInsuranceTab cm={cm} />}

                    {activeSubTab === "branches" && <BranchTab cm={cm} />}

                    {activeSubTab === "rounding" && <RoundingTab cm={cm} />}
                </>
            )}
        </div>
    );
}
