import { useState, useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { executeBatch } from "../../utils/dbBatch";
import { toAverageWageKind, type AverageWageKind } from "../../utils/averageWage";

export interface SalaryItem {
  id: number;
  name: string;
  type: "earning" | "deduction";
  category: "fixed" | "variable" | "formula";
  display_order: number;
  /** 支給項目を残業代の時給（割増賃金の基礎）に入れるか（1: 入れる / 0: 入れない） */
  in_overtime_base: number;
  /** 支給項目の平均賃金での扱い（設定がなければ、固定なら月で決まる賃金、変動なら日・時間で決まる賃金。utils/averageWage.ts） */
  average_wage: AverageWageKind;
}

interface Database {
  /** Database.load に渡した "sqlite:…"（まとめて保存するときに使う。utils/dbBatch.ts） */
  path: string;
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
        "SELECT id, name, type, category, display_order, COALESCE(in_overtime_base, 1) AS in_overtime_base, average_wage FROM salary_item_master ORDER BY display_order ASC, id ASC"
      );
      // 平均賃金での扱いが入っていない項目は、固定なら月で決まる賃金、変動なら日・時間で決まる賃金として出す
      setItems((res || []).map(i => ({ ...i, average_wage: toAverageWageKind(i.average_wage, i.category) })));
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
    
    const sameTypeList = items
      .filter(i => i.type === currentItem.type)
      .sort((a, b) => a.display_order - b.display_order);

    const currentIndex = sameTypeList.findIndex(i => i.id === id);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= sameTypeList.length) return;

    const targetItem = sameTypeList[targetIndex];

    // 2. display_order を入れ替える
    // 2つの UPDATE を1つのトランザクションでまとめて行う（途中で失敗したら、どちらも元のまま。utils/dbBatch.ts）
    try {
      await executeBatch(db, [
        // Aさんの順序をBさんのものにする
        { sql: "UPDATE salary_item_master SET display_order = ? WHERE id = ?", values: [targetItem.display_order, currentItem.id] },
        // Bさんの順序をAさんのものにする
        { sql: "UPDATE salary_item_master SET display_order = ? WHERE id = ?", values: [currentItem.display_order, targetItem.id] },
      ]);

      // 画面上のリストを再読み込み
      loadMasterItems();

    } catch (e) {
      console.error("並び替えに失敗しました", e);
      alert("並び替え中にエラーが発生しました（並びは元のままです）。");
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

  // 支給項目を、残業代の時給（割増賃金の基礎）に入れるかを切り替える
  const setOvertimeBase = async (id: number, include: boolean) => {
    try {
      await db.execute("UPDATE salary_item_master SET in_overtime_base = ? WHERE id = ?", [include ? 1 : 0, id]);
      setItems(prev => prev.map(i => i.id === id ? { ...i, in_overtime_base: include ? 1 : 0 } : i));
    } catch (e) {
      console.error("残業代の時給に入れるかの保存に失敗しました:", e);
      alert("保存に失敗しました。");
    }
  };

  // 支給項目の、平均賃金での扱い（月で決まる・日や時間で決まる・入れない）を変える
  const setAverageWage = async (id: number, kind: AverageWageKind) => {
    try {
      await db.execute("UPDATE salary_item_master SET average_wage = ? WHERE id = ?", [kind, id]);
      setItems(prev => prev.map(i => i.id === id ? { ...i, average_wage: kind } : i));
    } catch (e) {
      console.error("平均賃金での扱いの保存に失敗しました:", e);
      alert("保存に失敗しました。");
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
    setOvertimeBase,
    setAverageWage,
    moveItem
  };
}