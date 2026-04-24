import * as S from "./UserManager.styles";
import { useUserManager } from "./useUserManager";

export default function UserManager({ db }: { db: any }) {
  const { users, deleteUser, addUser } = useUserManager(db);

  return (
    <div style={S.container}>
      <h2 style={S.title}>⚙️ ユーザー管理</h2>
      <p style={S.description}>システムを利用できるアカウントを管理します。</p>
      
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
      
      <button onClick={addUser} style={S.addBtn}>
        ＋ 新規ユーザーを追加
      </button>
    </div>
  );
}