// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useStaffManager } from "./useStaffManager";
import { cardStyle, btnStyle } from './StaffManager.styles';
import BasicInfoSection from "./staff/BasicInfoSection";
import InsuranceSection from "./staff/InsuranceSection";
import EmploymentSection from "./staff/EmploymentSection";
import WageSection from "./staff/WageSection";
import WorkPatternSection from "./staff/WorkPatternSection";
import StaffFilterBar from "./staff/StaffFilterBar";
import StaffTable from "./staff/StaffTable";

interface Props {
    db: Database;
    onDataChange: () => void;
    staffList: any[];
}

export default function StaffManager({ db, onDataChange, staffList }: Props) {
    const cm = useStaffManager({ db, onDataChange, staffList });
    const { showForm, setShowForm, editingId, isSaving, setDeletingId, clearForm, canSave, saveStaff, isFirstRun, isFormVisible } = cm;

    return (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "20px" }}>
                {/* 💡 最初の1人が登録済みの場合のみ、開閉ボタンを表示する */}
                {!isFirstRun && (
                    <button 
                        onClick={() => { setDeletingId(null); if(showForm) clearForm(); setShowForm(!showForm); }} 
                        style={{ backgroundColor: showForm ? "#95a5a6" : "#3498db", color: "white", border: "none", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                    >
                        {showForm ? "✖ 閉じる" : "＋ 新規登録"}
                    </button>
                )}
            </div>

            {/* 💡 初回登録時は「まずはここから」というメッセージを出すと親切です */}
            {isFirstRun && (
                <div style={{ backgroundColor: "#e3f2fd", padding: "15px", borderRadius: "8px", marginBottom: "20px", borderLeft: "5px solid #2196f3" }}>
                    <p style={{ margin: 0, fontWeight: "bold", color: "#1976d2" }}>
                        ✨ はじめての登録：まずは一人目の従業員を登録してください。
                    </p>
                </div>
            )}

            {/* showForm ではなく isFormVisible (初回 or 表示中) で判定 */}
            {isFormVisible && (
                <section style={{ ...cardStyle, border: editingId ? "2px solid #f1c40f" : "1px solid #3498db" }}>
                    <h3 style={{ marginTop: 0, fontSize: "18px" }}>{editingId ? "📝 従業員情報の編集" : "✨ 新規従業員登録"}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <BasicInfoSection cm={cm} />

                            <InsuranceSection cm={cm} />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <EmploymentSection cm={cm} />

                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", width: "100%" }}>
                                <WageSection cm={cm} />

                                <WorkPatternSection cm={cm} />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px", marginTop: "25px" }}>
                        <button onClick={saveStaff} disabled={!canSave()} style={{ ...btnStyle, flex: 2, backgroundColor: isSaving ? "#3498db" : (canSave() ? (editingId ? "#f1c40f" : "#2ecc71") : "#cbd5e1") }}>
                            {isSaving ? "✅ 保存中..." : (editingId ? "更新を保存" : "新規登録")}
                        </button>
                        <button onClick={() => { clearForm(); setShowForm(false); }} style={{ ...btnStyle, flex: 1, backgroundColor: "#94a3b8" }}>キャンセル</button>
                    </div>
                </section>
            )}

            {/* 💡 スタッフがいて、かつフォームを閉じてる時だけリストを表示 */}
            {!isFirstRun && !showForm && (
                <StaffFilterBar cm={cm} />
            )}
            {!isFirstRun && !showForm && (
            <StaffTable cm={cm} />
            )}
        </div>
    );
}
