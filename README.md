# kuta

保存用(既存のMQL5関連ファイルはそのまま保管しています)

## 接客力向上トレーニングアプリ

アルバイトスタッフが勤務時間外に取り組む、遊技延長につながる会話力・接客力向上のための
研修アプリです。研修(場面設定に沿った選択式の問題)を最後まで完了すると1ptが付与されます。
全店舗のスタッフを「店舗 + フルネーム」で登録・管理し、誰が今何ポイント持っているかを
管理ダッシュボードから外部の人間(店舗責任者・本部担当者)でも確認できます。

### 構成

- `app/` : スタッフ用フロントエンド(Vite + React + TypeScript)
  - `/` ログイン(店舗はプルダウンから選択、お名前(フルネーム)を入力するとその場で登録される)。
    **登録は初回のみ**。一度登録すると、その端末のブラウザに情報が保存され、次回以降は
    ログイン画面を出さずに研修メニューへ直接進む(スマホの別ブラウザや別端末では再登録が必要)
  - `app/src/data/stores.ts` : 店舗マスタ(店舗ID・店舗名の一覧)。実際の店舗名に差し替えてください
  - `app/src/data/questionBank.ts` : **研修問題本体(現在21問)**。新しい問題は
    ファイル内のコメントの手順に従ってオブジェクトを1件追加するだけでよい
  - `app/src/data/trainingContent.ts` : 年代別モジュールの定義(タイトル・概要・冒頭の解説のみ。
    出題される問題は `questionBank.ts` から ageBand に応じて自動的に集められる)
  - `/modules` 研修メニュー(年代別: 20代 / 30〜50代 / 60〜70代)、保有ポイント表示
  - `/training/:moduleId` 研修本編(遊技延長につながる場面設定 + 選択式の問題)
  - `/admin/login`, `/admin` 管理ダッシュボード(全店舗のポイント一覧・CSV出力)
- `functions/` : Firebase Cloud Functions(Node.js / TypeScript)
  - `functions/src/questionBank.ts` : `app/src/data/questionBank.ts` の採点用ミラー
    (問題文は持たず、id・年代・正解の選択肢IDのみ)
  - `registerStaff` : ログイン時にスタッフ(フルネーム)を登録(既存の場合はポイントを変更せず表示名等のみ更新)
  - `completeTraining` : 研修完了時にサーバー側で採点し、ポイントを1回だけ付与(二重付与防止)
  - `getMyStatus` : スタッフ本人の保有ポイント・完了状況の取得
  - `adminListStaff` : 管理者向け、全スタッフのポイント一覧取得(`x-admin-key` ヘッダーで認証)
  - `adminRedeemPoints` : 管理者向け、ポイントを手動で消費する処理(景品交換等に利用する場合)
- `firestore.rules` : クライアントからの直接読み書きをすべて禁止し、Cloud Functions経由のみ許可
- `firebase.json`, `.firebaserc` : Firebase Hosting / Functions / Firestore の設定

### なぜこの構成か(設計メモ)

- ポイントの不正付与を防ぐため、クイズの採点とポイント加算は必ずCloud Functions側で行い、
  Firestoreへのクライアント直接書き込みは禁止しています。
- 同じ研修を何度実行してもポイントが増えないよう、`completions` コレクションで
  完了済みかどうかを判定してから加算しています。
- 管理ダッシュボードはFirebase Authのアカウント発行を省略し、`x-admin-key` による
  簡易認証としています。関係者以外に管理画面のURLとキーが漏れないよう運用面での
  注意が必要です(本格運用する場合はFirebase Authでの管理者アカウント方式への
  切り替えを推奨します)。
- スタッフのログインは店舗選択+フルネーム入力のみの簡易方式です(社員番号のような
  IDは求めない設計)。悪意のある不正利用のリスクが低い社内向け研修ツールとしての
  割り切りです。厳密ななりすまし防止が必要な場合は、PINコード追加やFirebase Authの
  匿名認証+スタッフ台帳との突合などの強化を検討してください。
- 同姓同名のスタッフが同じ店舗にいる場合、現状は同一人物として扱われます(入力された
  フルネームがそのまま識別子になるため)。運用上問題になる場合は、フルネームに加えて
  生年月日の下4桁などの補助情報を追加する拡張を検討してください。
- 研修問題(`app/src/data/questionBank.ts`)はサンプル/たたき台です。「傾聴」「雑談の
  FORDの法則(Family/Occupation/Recreation/Dreams)」「クッション言葉」「高齢者との
  コミュニケーションの基本」など、一般的に知られている接客・コミュニケーション手法を
  基にしています。実際の接客方針に合わせて店舗側・専務側で文言を調整してください。
  正解は `functions/src/questionBank.ts` にサーバー側の正として重複管理しているため、
  問題を追加・変更した場合は両方を更新してください(app側に追加したら、functions側にも
  `{ id, ageBand, correctChoiceId }` を1行追加する)。
- 問題の正解は、押しつけがましい引き止めではなく気配り・情報提供による自然な
  会話延長を選ぶ内容にしています。無理な引き止めや、困っているお客様に付け込む
  ような文言にならないよう、コンテンツを追加・変更する際もこの方針を維持してください。
- ログイン(=`registerStaff`呼び出し)の時点でスタッフが登録され、管理ダッシュボードには
  研修未完了でも「0pt」でその氏名が表示されます。誰が登録済みかを事前に把握しやすくする
  ための仕様です。

### セットアップ手順

1. **Firebaseプロジェクトを作成**([Firebase Console](https://console.firebase.google.com/)から新規プロジェクト作成)
2. Firestore(Native mode)とHosting、Cloud Functionsを有効化
3. `.firebaserc` の `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` を実際のプロジェクトIDに書き換える
4. `app/.env.example` を `app/.env` にコピーし、Firebaseコンソールの「プロジェクトの設定」から
   Webアプリの設定値を入力する
5. 管理者用アクセスキーを設定する(ランダムな文字列を推奨)
   ```
   firebase functions:secrets:set ADMIN_KEY
   ```
6. 依存パッケージのインストール
   ```
   cd app && npm install
   cd ../functions && npm install
   ```
7. ローカル動作確認(任意、Firebase CLIが必要)
   ```
   npm install -g firebase-tools
   firebase login
   cd app && npm run dev   # フロントの動作確認
   ```

### デプロイ手順

```
# フロントをビルド
cd app && npm run build

# Firebaseにログインし、対象プロジェクトを選択
cd ..
firebase login
firebase use REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID

# Firestoreルール・Functions・Hostingを一括デプロイ
firebase deploy
```

デプロイ後、Firebase Hostingが発行するURL(`https://<project-id>.web.app`)を
スタッフに共有してください。管理ダッシュボードは `https://<project-id>.web.app/#/admin/login`
からアクセスできます(URLに `#` が入るのは下記「自社ホームページへの設置」と方式を
統一しているためです)。独自ドメインを使いたい場合はFirebase Hostingのカスタムドメイン
設定から設定できます。

### 自社ホームページ(WordPress等)への設置

Firebase Hostingを使わず、既存のホームページのフォルダにアップロードして使うことも
できます。データ(ポイント管理)は引き続きFirebase(Firestore / Cloud Functions)を
使うので、上記の「セットアップ手順」「デプロイ手順」の `firebase deploy` のうち
Functions・Firestoreルールのデプロイ(`firebase deploy --only functions,firestore`)は
同様に必要ですが、画面(フロントエンド)だけを自社サイトに置く形になります。

1. `app/.env` にFirebaseの設定値を入力した状態で `cd app && npm run build` を実行する
2. `app/dist/` フォルダの中身一式(`index.html` や `assets/` フォルダなど)を、
   FTPやレンタルサーバーのファイルマネージャーで、公開フォルダの中に作った
   任意のフォルダ(例: `public_html/training/`)にそのままアップロードする
3. `https://自社ドメイン/training/` にアクセスすると動作する。管理ダッシュボードは
   `https://自社ドメイン/training/#/admin/login`

WordPress本体とは別のただの静的ファイル置き場として動くため、WordPressのプラグイン
インストールなどは不要です。ページ内のリンクはすべて `#` を使った形式(例:
`.../training/#/modules`)になっており、レンタルサーバー側で特別なリライト設定
(.htaccess等)をしなくてもそのまま動くようにしてあります。

研修問題の内容やお知らせなど、更新のたびに再度ビルド(`npm run build`)して
アップロードし直す必要があります。

### 今後の拡張案

- スタッフごとのPINコード・簡易認証の強化(なりすまし防止をより厳密にしたい場合)
- 研修コンテンツの管理画面からの編集機能(現状はコード直接編集)
- 店舗別・月別のランキング表示
