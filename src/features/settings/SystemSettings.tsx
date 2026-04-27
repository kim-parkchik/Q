import { useState } from "react";
import * as S from "./SystemSettings.styles";
import { useSystemSettings } from "./useSystemSettings";
import { Users, DatabaseZap, Settings, Calendar, FileUp } from "lucide-react";


export default function SystemSettings({ db }: { db: any }) {
    // 🆕 Hookからすべて受け取る
    const { 
        users, deleteUser, addUser, 
        holidaySource, holidayUrl, updateHolidaySource, downloadSampleCsv,
        searchMode, updateSearchMode, // 🆕 追加
        apiKey, updateApiKey             // 🆕 追加
    } = useSystemSettings(db);

    // 🆕 ユーザー追加モーダル用の State
    const [showAddModal, setShowAddModal] = useState(false);
    const [newLoginId, setNewLoginId] = useState("");
    const [newDisplayName, setNewDisplayName] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
    const [newRole, setNewRole] = useState("staff");

    // 🆕 登録実行ボタン
    const handleAddSubmit = async () => {
        if (!newLoginId || !newDisplayName || !newPassword) {
            alert("すべての項目を入力してください");
            return;
        }

        if (newPassword !== newPasswordConfirm) {
            alert("パスワードが一致しません");
            return;
        }

        // 🆕 addUser の戻り値を受け取る
        const success = await addUser(newLoginId, newDisplayName, newPassword, newRole);
        
        // 🆕 成功した時だけ、モーダルを閉じて入力をリセットする
        if (success) {
            setShowAddModal(false);
            setNewLoginId("");
            setNewDisplayName("");
            setNewPassword("");
            setNewPasswordConfirm(""); // これも忘れずにリセット
            setNewRole("staff");
        }
        // 失敗(success === false)なら、ここで何もしないのでモーダルは開いたままになります
    };

    const [activeTab, setActiveTab] = useState<"users" | "maintenance">("users");

    return (
        <div style={S.container}>
            {/* --- タブメニュー --- */}
            <div style={S.tabContainer}>
                <div 
                    style={S.tabItem(activeTab === "users")} 
                    onClick={() => setActiveTab("users")}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Users size={18} /> ユーザー管理
                    </div>
                </div>
                <div 
                    style={S.tabItem(activeTab === "maintenance")} 
                    onClick={() => setActiveTab("maintenance")}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <DatabaseZap size={18} /> データ更新・保守
                    </div>
                </div>
            </div>

        {/* --- コンテンツエリア --- */}
        {activeTab === "users" ? (
            <div>
                <table style={S.table}>
                    <thead>
                        <tr>
                            <th style={S.th}>ログインID</th>
                            <th style={S.th}>表示名</th>
                            <th style={S.th}>権限</th>
                            <th style={S.th}>最終ログイン</th>
                            <th style={S.th}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user.id} style={S.tr}>
                                <td style={S.td}>{user.login_id}</td>
                                <td style={S.td}>{user.display_name}</td>
                                <td style={S.td}>
                                    <span style={S.roleBadge(user.role)}>
                                        {user.role}
                                    </span>
                                </td>
                                <td style={{ ...S.td, ...S.lastLogin }}>
                                    {user.last_login || "未ログイン"}
                                </td>
                                <td style={S.td}>
                                    <button 
                                        disabled={user.login_id === 'admin'} 
                                        onClick={() => deleteUser(user.login_id)}
                                        style={{ cursor: user.login_id === 'admin' ? "not-allowed" : "pointer" }}
                                    >
                                        削除
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            
                <button onClick={() => setShowAddModal(true)} style={S.addBtn}>
                    ＋ 新規ユーザーを追加
                </button>
            </div>
        ) : (
            <div style={S.maintenanceSection}>
                {/* 法人番号検索の設定 */}
                <div style={S.settingGroup}>
                    <label style={S.label}>
                        <Settings size={16} style={{ verticalAlign: "middle", marginRight: "5px" }} />
                        法人番号取得モード
                    </label>

                    {/* セレクトと注釈を横並びに */}
                    <div style={S.inlineGroup}>
                        <select 
                            value={searchMode}
                            onChange={(e) => updateSearchMode(e.target.value)}
                            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "240px" }}
                        >
                            <option value="scraping">スクレイピング (標準)</option>
                            <option value="api">gBizINFO API (推奨)</option>
                        </select>
              
                        {/* 右側に注釈を表示 */}
                        <p style={S.subInfo}>
                            ※APIモードを使用するには経済産業省のgBizINFO APIキーが必要です。
                        </p>
                    </div>

                    {/* APIキー入力欄は一段下に（APIモード時のみ） */}
                    {searchMode === 'api' && (
                        <div style={{ marginTop: "15px", padding: "15px", backgroundColor: "#f9f9f9", borderRadius: "4px" }}>
                            <label style={{ ...S.label, fontSize: "13px" }}>gBizINFO APIキー</label>
                            <input 
                                type="password" 
                                placeholder="ここにAPIキーを入力してください"
                                value={apiKey}
                                onChange={(e) => updateApiKey(e.target.value)}
                                style={{ padding: "8px", width: "100%", maxWidth: "450px", borderRadius: "4px", border: "1px solid #ccc" }}
                            />
                        </div>
                    )}
                </div>

                {/* 郵便番号データの更新 */}
                <div style={S.settingGroup}>
                    <label style={S.label}>
                        <DatabaseZap size={16} style={{ verticalAlign: "middle", marginRight: "5px" }} />
                        郵便番号マスタの更新
                    </label>
                    <button style={S.addBtn}>
                        最新データを取得して更新
                    </button>
                    <p style={S.infoText}>
                        日本郵便から最新のCSVデータをダウンロードし、ローカルデータベースを再構築します。<br />
                        (完了まで数分かかる場合があります)
                    </p>
                </div>

                <div style={S.settingGroup}>
                    <label style={S.label}>
                        <Calendar size={16} style={{ verticalAlign: "middle", marginRight: "5px" }} />
                        祝日データの取得方法
                    </label>
            
                    <div style={S.inlineGroup}>
                        <label style={{ fontSize: "14px", cursor: "pointer" }}>
                            <input 
                                type="radio" 
                                name="holidaySource"
                                checked={holidaySource === "url"} 
                                // handleSourceChange を updateHolidaySource に書き換える
                                onChange={() => updateHolidaySource("url")} 
                            /> 
                            オンライン取得（推奨）
                        </label>

                        <label style={{ fontSize: "14px", cursor: "pointer", marginLeft: "15px" }}>
                            <input 
                                type="radio" 
                                name="holidaySource"
                                checked={holidaySource === "file"} 
                                // handleSourceChange を updateHolidaySource に書き換える
                                onChange={() => updateHolidaySource("file")} 
                            /> 
                            ローカルファイルから読込
                        </label>
                    </div>

                    {/* --- 💡 ここから表示の出し分け --- */}
                    {holidaySource === "url" ? (
                        <div style={{ marginTop: "15px", padding: "15px", backgroundColor: "#ebf5fb", borderRadius: "4px" }}>
                            <label style={{ fontSize: "13px", color: "#2980b9", display: "block", marginBottom: "4px", fontWeight: "bold" }}>
                                接続先URL（システム標準）
                            </label>
                            <input 
                                type="text" 
                                value={holidayUrl} 
                                disabled 
                                style={{ 
                                    padding: "8px", width: "100%", maxWidth: "500px", borderRadius: "4px", 
                                    border: "1px solid #3498db", backgroundColor: "#fff", color: "#2c3e50",
                                    cursor: "not-allowed"
                                }} 
                            />
                            <p style={{ fontSize: "11px", color: "#34495e", marginTop: "5px" }}>
                                ※内閣府が公表している最新の祝日データ(CSV)を自動的に取得します。
                            </p>
                        </div>
                    ) : (
                        <div style={{ marginTop: "15px", padding: "15px", backgroundColor: "#f4fcf9", borderRadius: "4px", border: "1px dashed #27ae60" }}>
                            <p style={{ fontSize: "13px", color: "#27ae60", fontWeight: "bold", marginBottom: "4px", marginTop: 0 }}>
                                ローカルファイル読み込みモード
                            </p>
                            <p style={{ fontSize: "11px", color: "#2c3e50", marginBottom: "10px", marginTop: 0 }}>
                                カレンダー画面からCSVをアップロードして更新します。
                            </p>
                
                            <button 
                                onClick={downloadSampleCsv}
                                style={{ 
                                    fontSize: "11px", padding: "5px 10px", borderRadius: "4px", 
                                    border: "1px solid #27ae60", backgroundColor: "#fff", color: "#27ae60",
                                    cursor: "pointer", display: "flex", alignItems: "center", gap: "5px"
                                }}
                            >
                                <FileUp size={13} /> インポート用サンプルCSVを保存
                            </button>
                        </div>
                    )}
                </div>
            </div>
      )}
      {/* 🆕 ユーザー追加用モーダル (JSXの最後に置く) */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000
        }}>
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px', width: '380px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>新規ユーザー登録</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>ログインID</label>
                {/* ログインID */}
                <input 
                  style={{ width: '100%', padding: '8px' }}
                  value={newLoginId} 
                  onChange={e => setNewLoginId(e.target.value)} 
                  placeholder="半角英数字"
                  autoComplete="one-time-code" // または "off"
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>表示名</label>
                {/* 表示名 */}
                <input 
                  style={{ width: '100%', padding: '8px' }}
                  value={newDisplayName} 
                  onChange={e => setNewDisplayName(e.target.value)} 
                  placeholder="例：山田 太郎"
                  autoComplete="off"
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>パスワード</label>
                {/* パスワード */}
                <input 
                  type="password" 
                  style={{ width: '100%', padding: '8px' }}
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)} 
                  autoComplete="new-password" // 🆕 「これは新しいパスワードだよ」と教える
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>パスワード（確認）</label>
                {/* パスワード（確認） */}
                <input 
                  type="password" 
                  style={{ width: '100%', padding: '8px' }}
                  value={newPasswordConfirm} 
                  onChange={e => setNewPasswordConfirm(e.target.value)} 
                  autoComplete="new-password" // 🆕 これも新しいパスワードの一部
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>権限（ロール）</label>
                <select style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                  value={newRole} onChange={e => setNewRole(e.target.value)}>
                  <option value="admin">管理者（admin）</option>
                  <option value="staff">一般（staff）</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '10px' }}>
              <button onClick={handleAddSubmit} 
                style={{ flex: 1, padding: '10px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                登録
              </button>
              <button onClick={() => setShowAddModal(false)} 
                style={{ flex: 1, padding: '10px', backgroundColor: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}