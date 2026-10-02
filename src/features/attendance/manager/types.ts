/**
 * 勤怠画面（AttendanceManager）で使う型と定数
 */
import type { useAttendanceManager } from "../useAttendanceManager";

export interface Staff {
  id: number | string;
  name: string;
  status?: string;
  branch_id?: number;
  wage_type?: "hourly" | "monthly";
  base_wage?: number;
  calendar_pattern_id?: number;
}

export interface AttendanceManagerProps {
  db: any;
  staffList: Staff[];
  targetYear: number;
  setTargetYear: (year: number) => void;
  targetMonth: number;
  setTargetMonth: (month: number) => void;
}

// 在籍状態フィルタのボタン定義
export const STATUS_OPTIONS = [
  { label: "在籍", value: "active", color: "#2ecc71" },   // 緑
  { label: "休職", value: "on_leave", color: "#f1c40f" }, // 黄
  { label: "退職", value: "retired", color: "#e74c3c" },  // 赤
];

/** 画面の各部品に渡す「状態と操作」のまとめ（props ＋ useAttendanceManager の戻り値） */
export type AttendanceViewModel = AttendanceManagerProps &
    ReturnType<typeof useAttendanceManager> & {
        statusOptions: typeof STATUS_OPTIONS;
    };
