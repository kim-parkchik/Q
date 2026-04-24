import { useEffect, useState } from "react";

export function useUserManager(db: any) {
  const [users, setUsers] = useState<any[]>([]);

  const fetchUsers = async () => {
    try {
      const res = await db.select("SELECT id, login_id, display_name, role, last_login FROM users");
      setUsers(res);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [db]); // dbが変わった際も再取得できるように

  const deleteUser = (loginId: string) => {
    if (loginId === 'admin') return;
    alert(`${loginId} の削除機能は開発中です！`);
  };

  const addUser = () => {
    alert("新規ユーザー追加機能は開発中です！");
  };

  return {
    users,
    deleteUser,
    addUser
  };
}