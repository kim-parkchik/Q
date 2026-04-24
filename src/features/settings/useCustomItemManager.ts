import { useState, useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";

export interface SalaryItem {
    id: number;
    name: string;
    type: "earning" | "deduction";
    category: "fixed" | "variable" | "formula";
    display_order: number;
}

interface Database {
    select<T>(query: string, bindValues?: any[]): Promise<T>;
    execute(query: string, bindValues?: any[]): Promise<any>;
}

export function useCustomItemManager(db: Database) {
    const [items, setItems] = useState<SalaryItem[]>([]);
    const [selectedStaffId, setSelectedStaffId] = useState<string>("");
    const [staffValues, setStaffValues] = useState<Record<number, number>>({});

    const [newItemName, setNewItemName] = useState("");
    const [newItemType, setNewItemType] = useState<"earning" | "deduction">("earning");
    const [newItemCategory, setNewItemCategory] = useState<"fixed" | "variable" | "formula">("fixed");
    const [activeTab, setActiveTab] = useState<"master" | "assignment">("master");

    useEffect(() => { 
        if (db) loadMasterItems(); 
    }, [db]);

    useEffect(() => { 
        if (selectedStaffId && db) loadStaffValues(selectedStaffId); 
    }, [selectedStaffId]);

    const loadMasterItems = async () => {
        try {
            const res = await db.select<SalaryItem[]>(
                "SELECT id, name, type, category, display_order FROM salary_item_master ORDER BY display_order ASC, id ASC"
            );
            setItems(res || []);
        } catch (e) {
            console.error("マスター読み込みエラー:", e);
        }
    };

    const loadStaffValues = async (staff_id: string) => {
        try {
            const res = await db.select<any[]>(
                "SELECT item_id, amount FROM staff_salary_values WHERE staff_id = ?",
                [staff_id]
            );

            const valueMap: Record<number, number> = {};
            if (res) {
                res.forEach((v) => {
                    valueMap[Number(v.item_id)] = Number(v.amount);
                });
            }
            setStaffValues(valueMap);
        } catch (e) {
            console.error("個別設定読み込みエラー:", e);
        }
    };

    const earnings = items.filter(i => i.type === 'earning');
    const deductions = items.filter(i => i.type === 'deduction');

    // 2. 並び替え関数
    const moveItem = async (id: number, direction: 'up' | 'down') => {
        // 1. 動かしたいアイテムとそのリストを特定
        const currentItem = items.find(i => i.id === id);
        if (!currentItem) return;
        
        // 同じタイプ（支給なら支給、控除なら控除）のリストだけを見る
        const sameTypeList = items
            .filter(i => i.type === currentItem.type)
            .sort((a, b) => a.display_order - b.display_order);

        const currentIndex = sameTypeList.findIndex(i => i.id === id);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (targetIndex < 0 || targetIndex >= sameTypeList.length) return;

        const targetItem = sameTypeList[targetIndex];

        // 2. display_order を入れ替える
        try {
            await db.execute("UPDATE salary_item_master SET display_order = ? WHERE id = ?", [targetItem.display_order, currentItem.id]);
            await db.execute("UPDATE salary_item_master SET display_order = ? WHERE id = ?", [currentItem.display_order, targetItem.id]);
            loadMasterItems();
        } catch (e) {
            console.error("並び替えに失敗しました", e);
        }
    };

    const addMasterItem = async () => {
        if (!newItemName.trim()) return;

        try {
            // 現在の最大順序値を取得（新しい項目を一番下に置くため）
            // 項目が一つもない場合は 0 になるように工夫します
            const currentMax = items.length > 0 
                ? Math.max(...items.map(i => i.display_order)) 
                : 0;

            await db.execute(
                "INSERT INTO salary_item_master (name, type, category, display_order) VALUES (?, ?, ?, ?)",
                [newItemName, newItemType, newItemCategory, currentMax + 10] // 10刻みで追加
            );

            // 入力欄をリセット
            setNewItemName("");
            // リストを再読み込み
            loadMasterItems();
        } catch (e) {
            console.error("項目の追加に失敗しました:", e);
            alert("項目の追加に失敗しました。");
        }
    };

    const deleteMasterItem = async (id: number) => {
        const ok = await ask(
            "この項目を削除しますか？\n（この項目に設定された個人別の金額データもすべて失われます）", 
            { 
                title: '項目の削除確認', 
                kind: 'warning',
                okLabel: '削除する',
                cancelLabel: 'キャンセル'
            }
        );

        if (!ok) return;

        try {
            await db.execute("DELETE FROM salary_item_master WHERE id = ?", [id]);
            loadMasterItems();
        } catch (e) {
            console.error(e);
            alert("削除に失敗しました。");
        }
    };

    const saveAmount = async (itemId: number, amount: number) => {
        if (!selectedStaffId) return;
        await db.execute(
            "INSERT OR REPLACE INTO staff_salary_values (staff_id, item_id, amount) VALUES (?, ?, ?)",
            [selectedStaffId, itemId, amount]
        );
        setStaffValues(prev => ({ ...prev, [itemId]: amount }));
    };

    return {
        // タブ管理の状態を追加
        activeTab, 
        setActiveTab,

        items, 
        earnings,
        deductions,
        selectedStaffId, 
        setSelectedStaffId, 
        staffValues,
        newItemName, 
        setNewItemName, 
        newItemType, 
        setNewItemType, 
        newItemCategory, 
        setNewItemCategory,
        addMasterItem, 
        deleteMasterItem, 
        saveAmount,
        moveItem
    };
}