# 労務の書類（労働条件通知書・36協定届・外国人雇用状況届出書・社会保険のそのほかの届書・労災・雇用状況報告・毎月勤労統計）の元データ

Q の次の画面で使う、書類の欄・決まり・数の出どころです。

- 労働条件通知書（`src/utils/laborConditions.ts`）・36協定（`src/utils/kyotei36.ts`）・外国人雇用状況届出書（`src/utils/gaikokujinReport.ts`）
- 社会保険のそのほかの届書（`src/utils/shahoOtherForms.ts`・`src/utils/kaigoExempt.ts`）・労災の書類（`src/utils/rousaiForms.ts`）
- 高年齢者・障害者の雇用状況報告（`src/utils/employmentStatus.ts`）・毎月勤労統計調査（`src/utils/maikin.ts`）

数（36協定の上限・障害者雇用率・障害者雇用状況報告の週の所定労働時間の区分と数え方・高年齢者雇用状況等報告の年齢の区分）は、
下の条文の XML と PDF から、スクリプトで読み取って `src/constants/roumu.ts` に作っています（手で書き写していません）。
法定労働時間（週40時間・1日8時間）・週44時間の特例（特例措置対象事業場）・フレックスタイム制の清算期間（3か月）と週平均50時間は、
労働基準法の全文と施行規則25条の2の XML から `src/constants/workHours.ts` に作っています（給与の計算・会社設定の支店リスト。`src/utils/weekly44.ts`）。
割増賃金の率の最低（時間外・休日・1か月60時間超・深夜）・深夜の時間・中小事業主にも60時間超の率を使い始めた日・時間単位の年次有給休暇の上限の日数は、
労働基準法の全文と割増賃金令の XML から `src/constants/laborStandards.ts` に作っています（`src/utils/premiumRates.ts`・`src/constants/labor.ts`）。
育児休業等の期間中の社会保険料の免除の「十四日以上」「一月以下」と、その決まりを使い始めた日（令和4年10月1日）は、健康保険法159条・
厚生年金保険法81条の2・健康保険法の全文の XML から `src/constants/insurance/childcareExemption.ts` に作っています（`src/utils/leaveExemption.ts`）。
書類の欄の並びと名前は、それぞれの様式・記入例・記入要領で確かめました。

## 出典

2026年11月18日に取得しました（ユーザーの許しを得て取得）。labor-standards-act.xml と labor-standards-rule-25-2.xml は、2026年11月21日に取得しました（ユーザーの許しを得て取得）。
wage-premium-order.xml・health-insurance-act-159.xml・employees-pension-act-81-2.xml・source/health-insurance-act.xml は、2026年11月25日に取得しました（ユーザーの許しを得て取得）。
PDF と Word と、健康保険法の全文（source/health-insurance-act.xml）は大きいので、リポジトリには入れていません（`source/` は .gitignore）。
法令の条文の XML（e-Gov 法令API）は、法令は著作権の対象にならないので、このフォルダに入れています。

| 置く場所 | 内容 | 入手元 | 大きさ（バイト） | SHA-256 |
|---|---|---|---|---|
| labor-standards-act-36.xml | 労働基準法 第36条（時間外及び休日の労働） | https://laws.e-gov.go.jp/api/1/articles;lawId=322AC0000000049;article=36 | 11,115 | 0e710ea4cbe62071a5684e012cc3cba510ef2ba1ce7d7c5e1faa3bbfc0dfb667 |
| disability-employment-order-9.xml | 障害者の雇用の促進等に関する法律施行令 第9条（障害者雇用率） | https://laws.e-gov.go.jp/api/1/articles;lawId=335CO0000000292;article=9 | 743 | f465720cdf2585aab39c9e869f34f59aa2c948417b26a45eaf3cfb07d51fc6e7 |
| labor-standards-act.xml | 労働基準法（全文。32条・32条の3・37条・39条・56条・60条・61条・別表第一・附則を読む） | https://laws.e-gov.go.jp/api/1/lawdata/322AC0000000049 | 431,309 | `7ff8d8701deac403bccf47636e6f220d226d69568e0c6ba458dd46efd6e197d0` |
| labor-standards-rule-25-2.xml | 労働基準法施行規則 第25条の2（週44時間の特例） | https://laws.e-gov.go.jp/api/1/articles;lawId=322M40000100023;article=25の2 | 5,830 | `730484b373d15e9798fbd7fcb773d7e64586debc3fa2ab56b85049f5fe0a1718` |
| wage-premium-order.xml | 労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令（平成六年政令第五号。全文） | https://laws.e-gov.go.jp/api/1/lawdata/406CO0000000005 | 3,192 | `90442057b982e16e8393fa6e97d94ec3fda09557064156e09551c110f51cd04a` |
| health-insurance-act-159.xml | 健康保険法 第159条（育児休業等の期間中の保険料の免除） | https://laws.e-gov.go.jp/api/1/articles;lawId=211AC0000000070;article=159 | 3,016 | `e5c4688e5a1e9bd6ac9adf94decacd6300fa786c97152cfd68b7f07f0c6ef652` |
| employees-pension-act-81-2.xml | 厚生年金保険法 第81条の2（育児休業期間中の保険料の徴収の特例） | https://laws.e-gov.go.jp/api/1/articles;lawId=329AC0000000115;article=81の2 | 3,640 | `49476696c8f1288dd334043921c43dfa4d5196f40ce4772b85baf3ade70788e8` |
| source/health-insurance-act.xml | 健康保険法（全文。附則（令和3年6月11日法律第66号）を読む） | https://laws.e-gov.go.jp/api/1/lawdata/211AC0000000070 | 1,468,140 | `5f17ce52e03d52203f72630f7de6de6a93816b7faaac88ef8c5a4b3418e093a0` |
| source/roudoujouken-ippan.docx | 厚生労働省 モデル労働条件通知書【一般労働者用】常用、有期雇用型（令和8年10月1日以降の様式） | https://www.mhlw.go.jp/content/11200000/001697541.docx | 57,127 | d6b941fb84627273ea4e5ed795dcacbc7f8e2e60ccedc05573ab5732e163baed |
| source/roudoujouken-tanjikan.docx | 同【短時間労働者用】常用、有期雇用型 | https://www.mhlw.go.jp/content/11200000/001697546.docx | 54,640 | 029ca18cc3e3d248f7ae6cd53ddbef4c9260063f24fbe722577c32abcb6fc6e7 |
| source/36-youshiki9.docx | 時間外労働・休日労働に関する協定届 様式第9号（一般条項） | https://www.mhlw.go.jp/content/11200000/001695822.docx | 72,942 | 105ad6086a97d7331a20e7943e52b240ee1690971464ed991539f95671fab039 |
| source/36-youshiki9-2.docx | 同 様式第9号の2（特別条項） | https://www.mhlw.go.jp/content/11200000/001695823.docx | 86,525 | 71fca1fd8b7b28830308ddb0a538e43b787277db5760c64cf429fb8ff0c005af |
| source/36-pamphlet.pdf | 36協定届の記載例のパンフレット | https://www.mhlw.go.jp/content/11200000/001738076.pdf | 1,156,796 | cf5cf52f3961275fc06c93d5b810f8180a15653ac9f7b2e2f42f16e1235bb500 |
| source/gaikokujin-youshiki3-r080614.pdf | 外国人雇用状況届出書（様式第3号。令和8年6月14日から） | https://www.mhlw.go.jp/content/001059771.pdf | 106,043 | 4cb2266d66cfc8be25a7235204870e5517663ed473056539a3a900492b60600f |
| source/gaikokujin-youshiki3-r090401.pdf | 同（令和9年4月1日から） | https://www.mhlw.go.jp/content/001721933.pdf | 94,367 | 8f96a0c6b53fb8c825b8af5d7fe1ff786d0101f2079932ed45aaf7bf95d4c5d0 |
| source/gaikokujin-qa.pdf | 外国人雇用状況の届出 Ｑ＆Ａ | https://www.mhlw.go.jp/content/001502565.pdf | 568,241 | ff8cb1e7a1649c585595ac7b4696ee6b9b07f011fffb0d6b367d30975a447e0a |
| source/romaji-kinyurei.pdf | 日本年金機構 厚生年金保険被保険者 ローマ字氏名届（記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/sonota/20150204.files/0000022168fWkpvxAkoN.pdf | 200,311 | 87f7944393e38a4e088b1081b2d57e49e3f93a8572e1200e05b15749f633679b |
| source/nijou-kinyurei.pdf | 同 被保険者所属選択／二以上事業所勤務届（記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/hihokensha/20140820-03.files/0000002458r.pdf | 389,396 | 20ace724a0ab2f39a478a3ef5559a4c54b105ceb6b033976f470ef90d3f015d5 |
| source/kubun-kinyurei.pdf | 同 被保険者区分変更届／70歳以上被用者区分変更届（記入例。令和8年10月からの形） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/kankeitodoke/tanjikan.files/04.pdf | 329,004 | 3da42a29f360618bf5ce1d61a517f91c819c18db9e616cc5a16b0510dfe6bcc2 |
| source/kubun-shousai.pdf | 同 区分変更の詳細説明（ケース3-4） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/kankeitodoke/tanjikan.files/01.pdf | 127,509 | ec333b2470c481cbf25404d50b40c59ebf3cfc0c1c55c88a64e51ff34d46a28d |
| source/kaigo-kinyurei1.pdf | 同 介護保険 適用除外等該当・非該当届（被保険者用記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/sonota/20120314-04.files/7-4kinyurei1.pdf | 226,322 | a0ae97610fe1bc9999c0f25eeab0e44da6bf67c8fe36bfa0235e3b7cc6309d94 |
| source/kaigo-kinyurei2.pdf | 同（被扶養者用記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/sonota/20120314-04.files/7-4kinyurei2.pdf | 227,754 | 46edc987520d45c4f81d4e005bda096827c455aa37dfa92b21ba60df7f0eeae9 |
| source/kaigo-shousai.pdf | 同 詳細説明（ケース7-4） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/sonota/20120314-04.files/0000008555.pdf | 127,184 | 3787dd8b0f48e5b17882b0a30f1e8c36ff120f8faaa0b8fb701204e7f6f6a1cc |
| source/shinki-kinyurei.pdf | 同 新規適用届（記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/jigyosho/20141205.files/20160928.pdf | 227,702 | 655a64314078c87f2957f5e9b73ab92f05f7f2f6d9eda98303b44d9a05014502 |
| source/jigyosho-henko-kinyurei.pdf | 同 事業所関係変更（訂正）届（記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/jigyosho/20150212.files/9115-3.pdf | 276,479 | b0668c1f39f07f81558a41ca5696e30fc9241ededc263205b2db60f34944da0b |
| source/meisho-kannai-kinyurei.pdf | 同 適用事業所名称／所在地変更（訂正）届（管轄内・記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/jigyosho/20141203-01.files/00000240003QuBBCK89Fr.pdf | 262,659 | dec2e863185f5d2a861f9eedba2c00148d8f9e649b2a2720e546acc64e9df54e |
| source/meisho-kangai-kinyurei.pdf | 同（管轄外・記入例） | https://www.nenkin.go.jp/shinsei/kounen/tekiyo/jigyosho/20141203-02.files/20160805.pdf | 207,703 | ee2ee67abb20a872fba9413ae05bc1e7ed7abbc189130edf330e97ce1816761c |
| source/ninkei-kinyurei.pdf | 全国健康保険協会 任意継続被保険者資格取得申出書（手書き用記入例。2026.6） | https://www.kyoukaikenpo.or.jp/assets/n_shutoku_guide2607.pdf | 2,179,414 | 5c8b6d9306c28c09d299f79b537abd819acd4d16ce188aa3c179f3d2bbc8b0a7 |
| source/rousai-youshiki8.pdf | 休業補償給付支給請求書（様式第8号）と別紙1（平均賃金算定内訳）・別紙2 | https://www.mhlw.go.jp/content/11200000/001095739.pdf | 1,783,100 | 8a3f90d6e3a953879f47258996438e46c84986705974f261511252b2ed766b52 |
| source/rousai-kyugyo-leaflet.pdf | 休業（補償）等給付の請求手続のリーフレット | https://www.mhlw.go.jp/content/11200000/001743917.pdf | 4,438,558 | aa82fed35f68f8ea95ee98958bf333ad5e110b5640f10f14a8196df0c7ebdb57 |
| source/rousai-youshiki5.pdf | 療養補償給付たる療養の給付請求書（様式第5号） | https://www.mhlw.go.jp/content/11200000/001481221.pdf | 512,744 | ebd8872dd9d71c13e8065d4ee7084dffe9747bb4b0abd68b1b17363190e3051a |
| source/shishobyo-youshiki.pdf | 労働者死傷病報告（令和7年1月1日からの様式。休業4日以上） | https://www.mhlw.go.jp/content/11200000/001347561.pdf | 189,294 | 89217df92e078d786aead94921f5729af86989a7dbbf636d0002551ba0d9f4c3 |
| source/shishobyo-code.pdf | 労働者死傷病報告のコードの記入 | https://www.mhlw.go.jp/content/11200000/001625992.pdf | 2,325,174 | 27ebe44f8c62e95b9ff21c5f4ca0e26537e4d1edd3638d9d41e8b061b97ca2b9 |
| source/shishobyo-leaflet.pdf | 労働者死傷病報告の報告事項の改正と電子申請の義務化のリーフレット | https://www.mhlw.go.jp/content/11200000/001292236.pdf | 905,569 | cbc2d02df1964b546a076c1bfa0fd7789b1bb11f82590349389325e71ba137fa |
| source/koyoujoukyou-kinyuyouryou.pdf | 高年齢者雇用状況等報告書及び障害者雇用状況報告書 記入要領（令和8年6月） | https://www.mhlw.go.jp/content/001492400.pdf | 5,765,835 | 247cb4bb49be50ce7bd248f88bcbd607798ed43c73aa6ba27fe994346e45d0da |
| source/koyoujoukyou-seigo.pdf | 同 正誤表 | https://www.mhlw.go.jp/content/001701982.pdf | 699,670 | 3ee7953b81abf24004ad2721c34821dfb90395bd3bff2178bb13bf818b398f40 |
| source/koyoujoukyou-qa.pdf | 令和8年高年齢者雇用状況等報告の記入方法に関するＱ＆Ａ | https://www.mhlw.go.jp/content/001496259.pdf | 354,345 | 43a7ad53f02cb8e770d1a9b2d1cb13035dae8495d91987fb06cdcc15a64f5e45 |
| source/shougai-youshiki6.pdf | 障害者雇用状況報告書（様式第6号） | https://www.mhlw.go.jp/content/000940558.pdf | 141,923 | f35700e657753e58374f524f1be952502a43cc8e85314c87859d5055183dba94 |
| source/shougai-kinyuyouryou.pdf | 障害者雇用状況報告記入要領（令和8年6月1日現在の報告） | https://www.mhlw.go.jp/content/001100468.pdf | 3,448,559 | c8f5aa65e60af2deeb2de3c659fe185d3b2bcfdd32ed88282a592e499d57d14e |
| source/maikin-kinyuyouryou.pdf | 毎月勤労統計調査 全国調査及び地方調査 調査票の記入要領（令和8年7月。全体版） | https://www.mhlw.go.jp/toukei/list/dl/30-1e.pdf | 6,421,216 | 24c44b142d88af9bd86af2603c8903f02f998b2dd9a9d145458f2fd578d9ddc2 |
| source/setagaya-kirikae.pdf | 世田谷区「特別区民税・都民税・森林環境税 特別徴収への切替申請書」（市区町村の切替申請書の例。2026年11月18日に取得） | https://www.city.setagaya.lg.jp/documents/233/kirikaesinnseisyo_2.pdf | 342,692 | 90e856de7309851c66cb45b84062192f625235c998aaec50c9487ea843b9000f |

毎月勤労統計調査の記入要領と、高年齢者雇用状況等報告書の正誤表・様式の絵のページは、字が「字の形の線」で描かれていて PDFKit で字を取り出せないので、
macOS の文字認識（`scripts/pdf_ocr.swift`）で読みました。

## データの作り方

追加のインストールは要りません（Python の標準ライブラリと、macOS の PDFKit・Vision（`scripts/pdf_to_text.swift`・`scripts/pdf_ocr.swift`）だけで動きます）。

```
python3 -I scripts/import_roumu_tables.py roumu-forms src/constants/roumu.ts
python3 -I scripts/import_work_hours.py roumu-forms src/constants/workHours.ts
python3 -I scripts/import_labor_standards.py roumu-forms src/constants/laborStandards.ts
python3 -I scripts/import_childcare_exemption.py roumu-forms src/constants/insurance/childcareExemption.ts
```

`import_work_hours.py` は、リポジトリの中の XML（labor-standards-act.xml・labor-standards-rule-25-2.xml）だけで動きます。
労働基準法32条の「一週間について四十時間」「一日について八時間」、32条の3の清算期間「三箇月以内」と「五十時間」、
施行規則25条の2の1項（別表第一の号・「映画の製作の事業を除く」・「常時十人未満」・「四十四時間」「八時間」）、3項（44時間・「一箇月以内」）、
4項（「清算期間が一箇月を超える」・第三十二条の四・第三十二条の五）を読み、別表第一の号の事業の名前を引きます。
1項と3項の44時間・施行規則と法の8時間が違う、清算期間の1か月がそろわない、別表第一に号がない・除く事業がその号の名前にないときは止まります。

`import_labor_standards.py` も、リポジトリの中の XML（labor-standards-act.xml・wage-premium-order.xml）だけで動きます。
労働基準法37条1項の「二割五分以上五割以下の範囲内でそれぞれ政令で定める率」と、ただし書の「一箇月について六十時間」「五割以上」、
4項の「午後十時から午前五時まで」「二割五分以上」、39条4項2号の「五日以内」、附則（平成30年法律第71号）1条3号の
「第一条中労働基準法第百三十八条の改正規定 令和五年四月一日」（中小事業主には60時間超の率を使わないとしていた附則138条を削った日）と、
割増賃金令の「二割五分」（時間外）・「三割五分」（休日）を読みます。政令の率が37条1項の範囲の外にある、60時間超の率が時間外の率より低い、
附則138条がまだあるときは止まります。
18歳未満の人（年少者）の決まりとして、56条1項の「満十五歳に達した日以後の最初の三月三十一日」、60条1項の「満十八才に満たない者」
（32条の2〜32条の5・36条・40条・41条の2を使わない）、3項の「満十五歳以上で満十八歳に満たない者」と1号の「四時間以内」「十時間まで」、
61条1項の「満十八才に満たない者を午後十時から午前五時までの間において使用してはならない」・ただし書の「満十六才以上の男性」、
4項の「別表第一第六号、第七号若しくは第十三号に掲げる事業若しくは電話交換の業務」も読み、別表第一の号の事業の名前を引きます。
60条・61条の年齢がそろわない、56条と60条3項の15歳が違う、61条1項の深夜の時間が37条4項と違うときも止まります。

`import_childcare_exemption.py` は、health-insurance-act-159.xml・employees-pension-act-81-2.xml と、取得して source/ に置いた健康保険法の全文を読みます。
2つの条の1項の「一月以下」（賞与の保険料を免除しない育児休業等の期間）と2号の「十四日以上」、健康保険法の附則（令和3年法律第66号）1条3号の
施行の日「令和四年十月一日」と3条3項（改正後の159条は、その日以後に開始する育児休業等に使う）を読みます。2つの条で日数・月数が違う、
全文の159条が、159条だけの XML と違うときは止まります。厚生年金保険法81条の2も、同じ法律の附則5条で、同じ日以後に開始する育児休業等に使います
（e-Gov 法令API の厚生年金保険法の全文をブラウザで読んで確かめました。全文は約3.2MB と大きいので、取得していません）。

読むところと、止まるとき（作らないとき）は、スクリプトの初めの説明に書いてあります。主なもの：

- 労働基準法36条の4項〜6項の言い回し（限度時間 45時間・360時間、3か月を超える1年単位の変形労働時間制は 42時間・320時間、特別条項の 100時間未満・720時間・6か月、
  実際の時間の 100時間未満と、直前の1〜5か月を加えた2〜6か月の平均 80時間）が見つからない・大きさが合わない
- 施行令9条の「障害者雇用率は、百分の○・○とする。」が見つからない
- 様式第6号の数え方の式（「イ+(ロ×0.5)」「(ホ×2)+ヘ+ト+((チ+リ)×0.5)」「レ+ソ+(ツ×0.5)」など）・端数の決まり・裏面の法定雇用率「100分の2.5」が見つからない、
  様式の率が施行令9条の率より大きい
- 障害者雇用状況報告記入要領の、常用雇用労働者（20時間以上・1年を超えて雇用）・短時間労働者（20〜30時間）・特定短時間労働者（10〜20時間）の決まりと、
  障害者のカウントの表が見つからないか、様式第6号の式と合わない。報告する事業主の規模（40.0人以上）が法定雇用率の逆数と合わない
- 高年齢者雇用状況等報告書の記入要領の「常用労働者」（20時間以上）が見つからない、様式第2号の⑮の年齢の区分がつながっていない
- 様式第6号のＤ欄「障害者の雇用の促進等に関する法律別表に掲げる種類別の身体障害者数」の種類が、第1号〜第5号の順に読めない

切替申請書（setagaya-kirikae.pdf）はスクリプトでは読みません。市区町村ごとに様式が違うので、市区町村の切替申請書に共通する欄の例として見て、
Q の「特別徴収への切替申請書」の書く内容（`src/features/payroll/ResidentTaxKirikaePanel.tsx`）を決めました。

## 気をつけること

- 障害者雇用率は、令和8年7月1日から 2.7%（施行令9条）。令和8年6月1日現在の報告までは様式第6号の 2.5% を使います（`src/utils/employmentStatus.ts` の disabilityRateFor）。
- 除外率（施行規則別表第4）は表を読んでいません。除外率設定業種の会社は、画面で率を入れます。
- 労働者死傷病報告の事業の種類・職種・傷病名・部位・国籍・在留資格のコードは、コード表を読んで Q に入れてはいません（帳票入力支援サービスのプルダウンで選びます）。
- 厚生年金保険の種別変更届（坑内員など）は、いまの様式が日本年金機構のページになかったので、作っていません。
