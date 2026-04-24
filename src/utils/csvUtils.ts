export const generateAttendanceCSV = (data: any[]) => {
    // データの中に staff_name や work_type があるかどうかでヘッダーを切り替える
    const isFull = data[0] && "work_type" in data[0];

    const header = isFull 
        ? ["スタッフID", "名前", "日付", "出勤", "退勤", "休憩始", "休憩終", "外出", "戻り", "区分", "有給h", "実働時間", "深夜時間", "備考"]
        : ["スタッフID", "日付", "出勤", "退勤", "休憩始", "休憩終", "外出", "戻り"];

    const rows = data.map(row => {
        const base = [
            row.staff_id,
            ...(isFull ? [row.staff_name] : []), // Fullの時だけ名前を入れる
            row.work_date,
            row.entry_time || "",
            row.exit_time || "",
            row.break_start || "",
            row.break_end || "",
            row.out_time || "",
            row.return_time || ""
        ];

        if (isFull) {
            base.push(
                row.work_type || "normal",
                row.paid_leave_hours || 0,
                row.work_hours || 0,
                row.night_hours || 0,
                row.memo || ""
            );
        }
        return base.join(",");
    });

    return [header.join(","), ...rows].join("\n");
};

export const parseAttendanceCSV = (csvText: string) => {
    // 1. 文頭のBOMを削除し、改行で分割
    const cleanText = csvText.replace(/^\uFEFF/, ''); 
    const lines = cleanText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // 2. ヘッダーを取得し、ダブルクォーテーションと前後の空白を徹底除去
    const headers = lines[0].split(',').map(h => 
        h.replace(/^["']|["']$/g, '').trim()
    );

    // 3. データ行をオブジェクトに変換
    return lines.slice(1).map(line => {
        // カンマ分割（引用符内のカンマを考慮）
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => 
            v.replace(/^["']|["']$/g, '').trim() // 前後の引用符を消す
        );

        const row: any = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || "";
        });
        return row;
    });
};