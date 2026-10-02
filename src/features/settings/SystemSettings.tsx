import { useState } from "react";
import * as S from "./SystemSettings.styles";
import { useSystemSettings } from "./useSystemSettings";
import { Users, DatabaseZap, Settings, Calendar, FileUp } from "lucide-react";
import DevMessagePreview from "../../components/DevMessagePreview";

// propsに currentUser を追加
export default function SystemSettings({ db, currentUser }: { db: any, currentUser: { login_id: string, role: string } }) {
  // currentUserがない場合のガード
  if (!currentUser) return null;

  const { 
    users, deleteUser, addUser, updatePassword,
    holidaySource, holidayUrl, updateHolidaySource, downloadSampleCsv,
    searchMode, updateSearchMode, apiKey, updateApiKey,
    backupGenerations, updateBackupGenerations
  } = useSystemSettings(db);

  // 権限判定用の変数
  const isAdmin = currentUser.role === 'admin';

  // ユーザー追加モーダル等のState
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLoginId, setNewLoginId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newRole, setNewRole] = useState("staff");

  const [showPassModal, setShowPassModal] = useState(false);
  const [targetUser, setTargetUser] = useState<{login_id: string, display_name: string} | null>(null);
  const [changePassword, setChangePassword] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");

  const [activeTab, setActiveTab] = useState<"users" | "maintenance" | "backup">("users");

  // ✅ スタッフなら自分のみを表示するフィルタリング
  const displayUsers = isAdmin 
    ? users 
    : users.filter(u => u.login_id === currentUser.login_id);

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

  const handleChangePassSubmit = async () => {
    if (!changePassword) return alert("新しいパスワードを入力してください");
    if (changePassword !== changePasswordConfirm) return alert("パスワードが一致しません");

    if (targetUser) {
      const success = await updatePassword(targetUser.login_id, changePassword);
      if (success) {
        setShowPassModal(false);
        setChangePassword("");
        setChangePasswordConfirm("");
      }
    }
  };

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

        {/* ✅ 管理者のみ「データ更新・保守」タブを表示 */}
        {isAdmin && (
          <>
            <div 
              style={S.tabItem(activeTab === "maintenance")} 
              onClick={() => setActiveTab("maintenance")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <DatabaseZap size={18} /> データ更新・保守
              </div>
            </div>

            {/* 🆕 バックアップ設定タブを追加 */}
            <div 
              style={S.tabItem(activeTab === "backup")} 
              onClick={() => setActiveTab("backup")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Settings size={18} /> バックアップ設定
              </div>
            </div>
          </>
        )}
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
              {/* ✅ users.map ではなく、フィルタリングした displayUsers.map を使う */}
              {displayUsers.map(user => (
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
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button 
                        onClick={() => {
                          setTargetUser({ login_id: user.login_id, display_name: user.display_name });
                          setShowPassModal(true);
                        }}
                        style={{ cursor: "pointer", padding: "2px 8px" }}
                      >
                        パスワード変更
                      </button>
                      
                      {/* ✅ 削除ボタンの制御: 管理者でない、または自分自身のID、またはadmin固定ユーザーなら無効化 */}
                      <button 
                        disabled={!isAdmin || user.login_id === 'admin'} 
                        onClick={() => deleteUser(user.login_id)}
                        style={{ 
                          cursor: (!isAdmin || user.login_id === 'admin') ? "not-allowed" : "pointer",
                          color: (!isAdmin || user.login_id === 'admin') ? "#ccc" : "#e74c3c"
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        
          {/* ✅ 管理者のみ「新規ユーザーを追加」ボタンを表示 */}
          {isAdmin && (
            <button onClick={() => setShowAddModal(true)} style={S.addBtn}>
              ＋ 新規ユーザーを追加
            </button>
          )}
        </div>
      ) : activeTab === "maintenance" ? (
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
      ) : (
        /* 🆕 バックアップ設定画面 */
        <div style={S.maintenanceSection}>
          <div style={S.settingGroup}>
            <label style={S.label}>
              <DatabaseZap size={16} style={{ verticalAlign: "middle", marginRight: "5px" }} />
              自動バックアップ世代管理
            </label>
            <p style={S.infoText}>
              アプリ終了時、またはデータを閉じる際に自動的にバックアップを作成します。<br />
              保存する過去の世代数を指定してください（古いものから自動削除されます）。
            </p>
            
            <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
              <input 
                type="number" 
                min="0" // 0を許可する
                max="99"
                value={backupGenerations}
                onChange={(e) => updateBackupGenerations(parseInt(e.target.value) || 0)}
                style={S.numberInput}
              />
              <span style={{ fontSize: "14px", color: backupGenerations === 0 ? "#e74c3c" : "#2c3e50" }}>
                {backupGenerations === 0 
                  ? "自動バックアップを行わない（非推奨）" 
                  : `${backupGenerations} 世代分を保持する（最大 99）`}
              </span>
            </div>
            
            <p style={{ ...S.subInfo, color: "#e67e22", marginTop: "10px" }}>
              ※世代数を増やすと、その分ディスク容量を消費します。通常は 10〜20 程度を推奨します。
            </p>
          </div>
        </div>
      )}
      {/* 🆕 ユーザー追加用モーダル（右側のはみ出しを修正） */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000
        }}>
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px', width: '360px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>新規ユーザー登録</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 各入力フィールド共通のスタイルを適用 */}
              {[
                { label: "ログインID", val: newLoginId, set: setNewLoginId, type: "text", ph: "半角英数字", auto: "one-time-code" },
                { label: "表示名", val: newDisplayName, set: setNewDisplayName, type: "text", ph: "例：山田 太郎", auto: "off" },
                { label: "パスワード", val: newPassword, set: setNewPassword, type: "password", ph: "", auto: "new-password" },
                { label: "パスワード（確認）", val: newPasswordConfirm, set: setNewPasswordConfirm, type: "password", ph: "", auto: "new-password" }
              ].map((field, idx) => (
                <div key={idx}>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>{field.label}</label>
                  <input 
                    type={field.type}
                    style={{ 
                      width: '100%', 
                      padding: '8px', 
                      boxSizing: 'border-box', // 👈 これで右端が揃います
                      borderRadius: '4px',
                      border: '1px solid #ccc'
                    }}
                    value={field.val} 
                    onChange={e => field.set(e.target.value)} 
                    placeholder={field.ph}
                    autoComplete={field.auto}
                  />
                </div>
              ))}

              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>権限（ロール）</label>
                <select 
                  style={{ 
                    width: '100%', 
                    padding: '8px', 
                    boxSizing: 'border-box', // 👈 selectも忘れずに
                    borderRadius: '4px', 
                    border: '1px solid #ccc' 
                  }}
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value)}
                >
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
      {/* 🆕 パスワード変更用モーダル（幅を調整） */}
      {showPassModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000
        }}>
          <div style={{ 
            backgroundColor: 'white', 
            padding: '24px', 
            borderRadius: '8px', 
            width: '350px', // 全体の幅を少しスリムに
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)' 
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '10px' }}>パスワードの変更</h3>
            <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
              対象ユーザー: <strong>{targetUser?.display_name}</strong>
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>新しいパスワード</label>
                <input 
                  type="password" 
                  style={{ 
                    width: '100%',           // 親要素の幅いっぱいに広げる
                    boxSizing: 'border-box', // 👈 これが重要！paddingを含めた合計幅を100%にする
                    padding: '10px',         // 少し厚めにすると入力しやすくなります
                    borderRadius: '4px',
                    border: '1px solid #ccc'
                  }}
                  value={changePassword} 
                  onChange={e => setChangePassword(e.target.value)} 
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>新しいパスワード（確認）</label>
                <input 
                  type="password" 
                  style={{ 
                    width: '100%',           // 親要素の幅いっぱいに広げる
                    boxSizing: 'border-box', // 👈 これが重要！paddingを含めた合計幅を100%にする
                    padding: '10px',         // 少し厚めにすると入力しやすくなります
                    borderRadius: '4px',
                    border: '1px solid #ccc'
                  }}
                  value={changePasswordConfirm} 
                  onChange={e => setChangePasswordConfirm(e.target.value)} 
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '10px' }}>
              <button onClick={handleChangePassSubmit} 
                style={{ flex: 1, padding: '10px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                更新実行
              </button>
              <button 
                onClick={() => {
                  setShowPassModal(false);
                  setChangePassword("");
                  setChangePasswordConfirm("");
                }} 
                style={{ flex: 1, padding: '10px', backgroundColor: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 開発モードのときだけ表示されるテスト用パネル */}
      {import.meta.env.DEV && <DevMessagePreview />}
    </div>
  );
}
