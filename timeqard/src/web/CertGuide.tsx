/**
 * 会社専用の証明書を、このパソコンに入れる（1回だけ。timeqard/DESIGN.md の 10）
 *
 * 入れると、このページを開いても、ブラウザが注意の画面を出さなくなる。
 * 入れ方は、パソコン・ブラウザの版によって、ボタンの名前が少し違うことがある（本物のパソコンで確かめる。DESIGN.md の 10.5）。
 */
import { useEffect, useState } from "react";
import { certInfo, errorText, type CertInfo } from "./api";

export default function CertGuide(props: { onBack: () => void }) {
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    certInfo().then(setInfo).catch((e) => setError(errorText(e)));
  }, []);

  return (
    <div className="w-page">
      <div className="w-header">
        <div className="w-company">会社専用の証明書</div>
        <button className="w-header-btn" onClick={props.onBack}>戻る</button>
      </div>
      <main className="w-main">
        <div className="w-card">
          <h1>このパソコンに、会社専用の証明書を入れる</h1>
          <p>
            このページとのやりとりは、暗号にしてあります。そのための証明書は、入口のパソコンの TimeQard が、この会社のためだけに作ったものです。
            各自のパソコンに1回だけ入れると、このページを開いても、ブラウザが注意の画面を出さなくなります。
            この証明書は、社内のアドレスのページにしか使えないようにしてあり、インターネットのほかのサイトには使えません。
          </p>
          {error && <div className="w-notice ng">{error}</div>}
          {info && (
            <>
              <table className="w-table w-auto">
                <tbody>
                  <tr><th>名前</th><td>{info.caName}</td></tr>
                  <tr><th>指紋（SHA-256）</th><td className="w-mono">{info.sha256}</td></tr>
                  <tr><th>指紋（SHA-1）</th><td className="w-mono">{info.sha1}</td></tr>
                </tbody>
              </table>
              <p className="w-muted">
                入れる前に、入口のパソコンの管理の画面（「ブラウザ版」）に出ている指紋と同じかを見比べてください。ちがうときは入れずに、管理者に伝えてください。
              </p>
              <div className="w-actions">
                <a className="w-btn" href="/cert/TimeQard-CA.cer" download={info.fileName}>証明書をダウンロードする（{info.fileName}）</a>
              </div>
            </>
          )}

          <h2>入れ方</h2>
          <p className="w-muted">パソコン・ブラウザの版によって、ボタンの名前が少し違うことがあります。わからないときは、管理者に聞いてください。</p>

          <details className="w-details" open>
            <summary>Windows（Edge・Chrome）</summary>
            <ol>
              <li>上の「証明書をダウンロードする」を押し、ダウンロードしたファイル（TimeQard-CA.cer）を開きます。</li>
              <li>「証明書のインストール」を押します。</li>
              <li>「現在のユーザー」を選んで、「次へ」を押します。</li>
              <li>「証明書をすべて次のストアに配置する」を選び、「参照」から「信頼されたルート証明機関」を選んで、「次へ」→「完了」を押します。</li>
              <li>「この証明書をインストールしますか？」と聞かれたら、拇印が上の「指紋（SHA-1）」と同じかを確かめて、「はい」を押します。</li>
              <li>ブラウザをいったん全部閉じて、開き直します。</li>
            </ol>
          </details>

          <details className="w-details">
            <summary>Mac（Safari・Chrome）</summary>
            <ol>
              <li>上の「証明書をダウンロードする」を押し、ダウンロードしたファイル（TimeQard-CA.cer）を開きます。「キーチェーンアクセス」が開いたら、「ログイン」に追加します。</li>
              <li>キーチェーンアクセスで、名前が上の「名前」の証明書を探して、開きます。</li>
              <li>「信頼」を開き、「この証明書を使用するとき」を「常に信頼」にします。</li>
              <li>窓を閉じると、Mac のパスワードを聞かれるので、入れます。</li>
              <li>ブラウザを開き直します。</li>
            </ol>
          </details>

          <details className="w-details">
            <summary>Firefox（Windows・Mac・Ubuntu）</summary>
            <p>Firefox は、パソコンの設定とは別に、自分の中に証明書を持っています。</p>
            <ol>
              <li>上の「証明書をダウンロードする」を押して、ファイルを保存します。</li>
              <li>Firefox の「設定」→「プライバシーとセキュリティ」→「証明書」の「証明書を表示...」を開きます。</li>
              <li>「認証局証明書」を開き、「インポート...」で、保存したファイルを選びます。</li>
              <li>「この認証局によるウェブサイトの識別を信頼する」に印を付けて、「OK」を押します。</li>
            </ol>
          </details>

          <details className="w-details">
            <summary>Ubuntu（Chrome・Chromium）</summary>
            <ol>
              <li>上の「証明書をダウンロードする」を押して、ファイルを保存します。</li>
              <li>Chrome の「設定」→「プライバシーとセキュリティ」→「セキュリティ」→「証明書を管理」を開きます。</li>
              <li>「認証局」を開き、「インポート」で、保存したファイルを選びます。</li>
              <li>「この証明書をウェブサイトの識別に使用する」に印を付けて、「OK」を押します。</li>
            </ol>
          </details>

          <p className="w-muted">
            入れたあとも注意の画面が出るときは、開いたアドレスが、入口のパソコンの管理の画面に出ているアドレスと同じかを確かめてください
            （入口のパソコンのアドレスが変わったときは、新しいアドレスで開きます。証明書を入れ直す必要はありません）。
          </p>
          <div className="w-actions">
            <button className="w-btn plain" onClick={props.onBack}>戻る</button>
          </div>
        </div>
      </main>
    </div>
  );
}
