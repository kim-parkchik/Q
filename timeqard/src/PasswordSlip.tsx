/**
 * はじめのパスワードを渡す紙（入口のパソコンの管理の画面と、ブラウザの管理の画面で同じもの。印刷するときは、この紙だけを出す）
 */
import { MIN_PASSWORD_LENGTH } from "./passwordRules";
import "./slip.css";

export interface Slip {
  companyName: string;
  staffId: string;
  name: string;
  password: string;
  expiresLabel: string;
  /** 各自のパソコンのブラウザで開くアドレス */
  urls: string[];
}

/** はじめのパスワードを渡す紙（画面と印刷で同じもの） */
export default function PasswordSlip({ slip }: { slip: Slip }) {
  return (
    <div className="print-slip">
      <h2>ブラウザで押すための、はじめのパスワード</h2>
      <table className="slip-table">
        <tbody>
          <tr><td>会社</td><td>{slip.companyName}</td></tr>
          <tr><td>名前</td><td>{slip.name} さん（スタッフID {slip.staffId}）</td></tr>
          <tr><td>はじめのパスワード</td><td className="slip-password">{slip.password}</td></tr>
          <tr><td>期限</td><td>{slip.expiresLabel} まで（過ぎたら、管理者に作り直してもらってください）</td></tr>
          <tr><td>開くアドレス</td><td>{slip.urls.length > 0 ? slip.urls.map((u) => <div key={u} className="mono">{u}</div>) : "（管理者に聞いてください）"}</td></tr>
        </tbody>
      </table>
      <ol className="slip-steps">
        <li>自分のパソコンのブラウザで、上のアドレスを開きます。</li>
        <li>スタッフID と、このはじめのパスワードでログインします。</li>
        <li>自分だけのパスワード（{MIN_PASSWORD_LENGTH}文字以上）に変えます。変えるまで、押せません。</li>
        <li>変えたら、この紙は捨ててください。パスワードは、ほかの人に教えないでください。</li>
      </ol>
      <p className="slip-note">
        開いたときにブラウザが注意の画面を出すときは、会社専用の証明書を、そのパソコンにまだ入れていません。管理者に聞いてください。
        ログインしたままにはなりません。押したら、ログアウトになります。
      </p>
    </div>
  );
}
