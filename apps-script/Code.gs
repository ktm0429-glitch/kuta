/**
 * 接客力向上トレーニング用バックエンド(Google Apps Script)
 *
 * ■ 初めて設置するとき
 * 1. このファイルの中身をすべてコピーする
 * 2. スプレッドシートを開き、上部メニューの「拡張機能」→「Apps Script」を選ぶ
 * 3. エディタに最初から入っているコードを全部消して、コピーした内容を貼り付ける
 * 4. すぐ下にある ADMIN_KEY を、好きな文字列(合言葉)に変更する
 * 5. 画面右上の「デプロイ」→「新しいデプロイ」を選ぶ
 *    - 種類の選択(歯車アイコン)で「ウェブアプリ」を選ぶ
 *    - 「実行するユーザー」は「自分」のまま
 *    - 「アクセスできるユーザー」は「全員」にする
 *    - 「デプロイ」ボタンを押す
 * 6. 発行された「ウェブアプリのURL」をコピーし、app/src/config.ts の中の文字列に貼り付ける
 * 7. 必要なら applyReviewedQuestionsV4 を一度実行してサンプル問題だけ更新する
 *
 * ■ コードを更新するとき(すでに運用中の場合)
 * 貼り替えて保存したあと、「デプロイ」→「デプロイを管理」→ 鉛筆アイコン(編集)→
 * バージョンで「新バージョン」を選んで「デプロイ」を押す。
 * ※「新しいデプロイ」を選ぶとURLが変わり、アプリから接続できなくなるので注意。
 *
 * ■ シート
 * データはこのスプレッドシート自身に保存され、次のシートが自動で作られます。
 *   スタッフ / 完了記録 / 取り組み状況 / ポイント調整履歴 / 問題
 * 「問題」シートが以前の形式(選択肢1〜3の列がある形式)だった場合は、
 * 「問題(旧形式)」という名前に変えて残し、新しい形式の「問題」シートを作り直します。
 * 「完了記録」「取り組み状況」シートは日付順に追記される前提で、下(新しい行)から
 * 必要な分だけ読んでいます。並べ替えると1日1ptの判定などが正しく動かなくなるため、
 * 並べ替えないでください(見やすくしたい場合はフィルタ表示を使ってください)。
 *
 * ■ 研修の目的と問題の作り方
 * 目的は「接客によって、お客様に快適に遊技を続けてもらうこと(遊技時間の延長)」です。
 * 遊技中の不便・迷い(操作がわからない、音が気になる、休憩の仕方がわからない等)に
 * 気づいて解消する受け答えを正解にします。出玉や当たりを期待させる言い方、
 * 負けを取り返すようあおる言い方、やめたいお客様への無理な引き止めは正解にしません。
 *
 * 「問題」シートの列:
 *   ID / 年代(20代・30〜50代・60〜70代) / 場面 / お客様のセリフ / 模範解答 /
 *   確認ポイント1 / ポイント1の言い回し / 確認ポイント2 / ポイント2の言い回し /
 *   確認ポイント3 / ポイント3の言い回し / 解説 / 避けたい対応
 * 「言い回し」は、そのポイントができていると判断する言葉を「/」区切りで並べます
 * (例: ご説明しますね/説明/ご案内/お手伝い)。回答にどれか1つが含まれていれば
 * そのポイントは「確認できた」と判定されます。1つ目には、例として表示される
 * 自然な一言を書いてください。確認ポイントは2〜3個にします。
 *
 * ■ ポイントのルール
 * 挑戦するたびに5問(原則「遊技延長」4問＋「判断の境界」1問、任意の復習最大1問)が出題され、
 * 5問すべてに回答すると1pt。点数の良し悪しは問いません。1人1日1ptが上限です。
 * 採点はスタッフの端末(ブラウザ)で行い、音声そのものはどこにも送信・保存しません。
 * サーバー側では、出題された5問すべてに回答(空欄でない文章)があることを確認してから
 * ポイントを付与します。
 */

// ここを好きな文字列に変更してください(管理画面にログインするときの合言葉)
var ADMIN_KEY = 'CHANGE_ME_TO_YOUR_OWN_SECRET';

var SHEET_STAFF = 'スタッフ';
var SHEET_COMPLETIONS = '完了記録';
var SHEET_SESSIONS = '取り組み状況';
var SHEET_REDEMPTIONS = 'ポイント調整履歴';
var SHEET_QUESTIONS = '問題';
var SHEET_QUESTIONS_OLD = '問題(旧形式)';

var QUESTIONS_PER_CHALLENGE = 5;
var MIN_ANSWER_LENGTH = 4;

var STAFF_HEADERS = ['店舗ID', '店舗名', '氏名', '表示名', 'ポイント', '更新日時'];
var COMPLETION_HEADERS = [
  '店舗ID', '氏名', '出題した問題ID', '合格数', '問題数', '完了日時',
  '平均内容スコア', '平均声スコア(参考)', '回答内容(参考)', 'セッションID'
];
var SESSION_HEADERS = [
  'セッションID', '店舗ID', '店舗名', '氏名', '開始日時', '出題した問題ID',
  '回答数', '最終更新', '状態', '完了日時', '回答内容(参考)', '問題スナップショットJSON'
];
var REDEMPTION_HEADERS = ['店舗ID', '氏名', '消費ポイント', 'メモ', '日時'];
var QUESTION_HEADERS = [
  'ID', '年代', '場面', 'お客様のセリフ', '模範解答',
  '確認ポイント1', 'ポイント1の言い回し(/区切り)',
  '確認ポイント2', 'ポイント2の言い回し(/区切り)',
  '確認ポイント3', 'ポイント3の言い回し(/区切り)',
  '解説(遊技を続けてもらえる理由)', '避けたい対応', '目的区分（遊技延長／判断の境界）'
];
var QUESTION_COLS = QUESTION_HEADERS.length;
var JUDGMENT_IDS_ = {q08:true,q18:true,q19:true,q20:true,q22:true,q23:true,q24:true};

var AGE_BAND_LABEL_JA = { young: '20代', middle: '30〜50代', senior: '60〜70代' };
var AGE_BAND_FROM_JA = { '20代': 'young', '30〜50代': 'middle', '60〜70代': 'senior' };

// 「お客様の意向を確認する」ポイントで共通して使う言い回し
var ASK_PHRASES = 'よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか';
var ASK_POINT = ['お客様の意向を確認する', ASK_PHRASES];

// ---- 「問題」シートを初めて作るときに入れておく初期データ ----
// (すでに新しい形式のシートがある場合は使われません)
var DEFAULT_QUESTIONS = [
  { id: 'q01', age: 'young',
    situation: '新台で遊技中のお客様が、台のボタンを何度も押して首をかしげています。',
    line: '(ボタンを押しながら)「これ、どうやるんだろう…」',
    model: '「何かお困りですか?よろしければ、どのボタンか教えていただければご説明しますね」',
    points: [
      ['困っている点を確認する', '何かお困りですか/お困り/困って/こまって/どの/どちら/どこが/わかりにく/分かりにく/わかりづら/分かりづら'],
      ['説明・手助けを申し出る', 'ご説明しますね/説明/せつめい/ご案内/案内/お手伝い/手伝/一緒に/いっしょに/お教え/おしえ'],
      ASK_POINT
    ],
    explain: '操作がわからないままだと台を楽しめず、早めに席を立つきっかけになります。困っている点を聞いてすぐ説明すれば、安心して遊技を続けてもらえます。',
    ng: '「説明書に書いてあります」とだけ言って離れる/気づかないふりをする' },

  { id: 'q02', age: 'young',
    situation: '台の音が大きいのか、お客様が片耳を押さえて顔をしかめています。',
    line: '(片耳を押さえて顔をしかめている)',
    model: '「音が気になりますか?よろしければ、台の音量を調整する方法をご案内しますね」',
    points: [
      ['不快に気づいて声をかける', '音が気になりますか/音/おと/気になり/きになり/うるさ/大き/おおき'],
      ['解決方法を示す', '音量を調整する方法をご案内しますね/音量/おんりょう/ボリューム/調整/ちょうせい/下げ/さげ/小さく/ちいさく'],
      ASK_POINT
    ],
    explain: '音などの不快感を我慢したまま遊技を続けるのはつらく、早めに帰る原因になります。音量の調整方法を案内すれば、快適に遊技を続けてもらえます(調整できない台なら、空いている台への移動などを提案します)。',
    ng: '「そういう台なので」と取り合わない' },

  { id: 'q03', age: 'young',
    situation: '長く遊技しているお客様が、お腹をさすりながら時計を気にしています。',
    line: '「お腹すいたな…でも台を離れたくないな」',
    model: '「お食事休憩のルールをご案内しましょうか?お席を離れる間の扱いは、店舗のルールを確認してご案内します」',
    points: [
      ['休憩できることを伝える', '休憩のルールをご案内しましょうか/休憩/きゅうけい/食事/しょくじ'],
      ['離れる間の台の扱いを説明する', 'ルールを確認してご案内します/ルール/確認/休憩の手続き/札/時間内'],
      ASK_POINT
    ],
    explain: '休憩の方法を知らないと、無理をして遊技を続けるか、そのまま帰ってしまうことがあります。店舗の休憩ルールを案内すれば、食事の後に戻って遊技を続けてもらいやすくなります(ルールは必ず店舗の規定どおりに案内します)。',
    ng: 'ルールにない約束をする(「何時間でも取っておきます」など)/何も案内しない' },

  { id: 'q04', age: 'young',
    situation: '呼び出しランプが点灯しています。お客様は台のエラー表示を見ながら待っています。',
    line: '(呼び出しランプを押して待っている)',
    model: '「お待たせして申し訳ございません。すぐに確認いたします」',
    points: [
      ['待たせたことをお詫びする', 'お待たせして申し訳ございません/申し訳/もうしわけ/お待たせ/おまたせ/すみません/失礼/しつれい'],
      ['すぐに対応することを伝える', 'すぐに確認いたします/すぐ/ただいま/只今/確認/かくにん/対応/たいおう/直し/なおし']
    ],
    explain: '待たされる時間が長いと気持ちが冷め、遊技をやめるきっかけになります。お詫びとすばやい対応で、気持ちよく遊技に戻ってもらいます。',
    ng: '無言で作業を始める/「少々お待ちください」と言ったまま長く待たせる' },

  { id: 'q05', age: 'young',
    situation: 'お客様が腕をさすりながら、空調の吹き出し口の方を見ています。',
    line: '「なんか、ここ寒いな…」',
    model: '「寒くないですか?よろしければ、空調を確認してまいりますね」',
    points: [
      ['寒さに気づいて声をかける', '寒くないですか/寒/さむ/冷え/ひえ/温度/おんど'],
      ['対応を申し出る', '空調を確認してまいりますね/空調/くうちょう/エアコン/調整/ちょうせい/確認/かくにん/ひざ掛け/ひざかけ/ブランケット'],
      ASK_POINT
    ],
    explain: '寒さ・暑さの不快感は、遊技を切り上げる理由になりやすいものです。気づいてすぐ対応すれば、快適な環境で長く遊技を楽しんでもらえます。',
    ng: '「全体で決まっているので」と断るだけ' },

  { id: 'q06', age: 'young',
    situation: '新しく入った台の前で、お客様が画面をのぞき込んでいます。',
    line: '「これ、どういう台なんですか?」',
    model: '「新しく入った機種です。どの点が気になりましたか。よろしければ遊び方や演出をご説明しましょうか?」',
    points: [
      ['台の楽しさ(演出・遊び方)を紹介する', '遊び方や演出をご説明しましょうか/演出/えんしゅつ/遊び方/あそびかた/シリーズ/キャラクター/特徴/とくちょう'],
      ['説明を申し出る', '遊び方をご説明しましょうか/説明/せつめい/ご案内/案内/お教え'],
      ASK_POINT
    ],
    explain: '興味を持った台を気持ちよく遊び始めてもらうことが、長く楽しんでもらう第一歩です。紹介するのは演出や遊び方などの楽しさで、出玉や当たりやすさを期待させる言い方はしません(法令・業界ルール上、問題になるおそれがあります)。',
    ng: '「この台はよく出ますよ」など、出玉や当たりを期待させる' },

  { id: 'q07', age: 'middle',
      situation: "遊技中の常連客から、気に入った演出の話が出た",
      line: "今の演出、好きなんだよね。",
      model: "どんなところがお好きですか。よろしければ、同じキャラクターの別の演出についても確認してご紹介します。",
      points: [["好きな点を聞く","どんなところ/どこ/お気に入り"], ["楽しみの広がりを提案する","別の演出/ほかの演出/他の演出"], ["関心を確認する","よろしければ/ご興味/ご希望"]],
      explain: "好きな要素を具体的に聞き、確認可能な楽しみ方につなげます。雑談だけで終えず、関心がある場合に情報を添えます。",
      ng: "ご本人の希望を確認せず、一方的に勧める" },

  { id: 'q08', age: 'middle',
    situation: '出玉が伸びず、お客様が無言でイライラしている様子です。',
    line: '(台を見つめたまま、ため息をついている)',
    model: '「失礼いたします。何かございましたら、いつでもお声がけくださいね」(短く声をかけ、あとは少し距離を置いて見守る)',
    points: [
      ['控えめに声をかける', '失礼いたします/失礼/しつれい'],
      ['いつでも頼れることを伝える', '何かございましたら、いつでもお声がけください/何か/なにか/いつでも/お声がけ/おこえがけ/お呼び/お申し付け']
    ],
    explain: '気分がすぐれないときに話しかけすぎると逆効果です。短く声をかけて「必要なときは頼れる」と伝え、あとは適度な距離で見守ることで、落ち着いて遊技を続けてもらいやすくなります。「まだ行けますよ」のような出玉を期待させる励ましは、根拠がないうえ法令・業界ルール上も問題になるおそれがあります。',
    ng: '「この台まだ行けますよ」と出玉を期待させる/しつこく話しかける' },

  { id: 'q09', age: 'middle',
    situation: '台を移動しようと、空いている台を見て回っているお客様がいます。',
    line: '「どの台にしようかなあ…」',
    model: '「よろしければ、お好きな機種や演出のタイプを伺ってもよろしいですか?空いている台をご案内します」',
    points: [
      ['好みを聞く', 'お好きな機種を伺ってもよろしいですか/好み/このみ/お好き/おすき/どんな/タイプ/機種/きしゅ'],
      ['空いている台を案内する', '空いている台をご案内します/案内/あんない/空いて/あいて/空き'],
      ASK_POINT
    ],
    explain: '好みに合う台が見つからないと、そのまま帰ってしまうことがあります。好みを聞いて合う台を案内すれば、楽しい時間を長く過ごしてもらえます。台選びの基準はお客様の好み(機種・演出)で、出玉の期待で選ばせてはいけません。',
    ng: '「こっちの台の方が出ますよ」とすすめる' },

  { id: 'q10', age: 'middle',
      situation: "同じ機種をしばらく遊技中。お客様から飽きてきたと話しかけた",
      line: "いつも同じ遊び方で、ちょっと飽きてきたな。",
      model: "どんなところが単調に感じますか。よろしければ、この機種の演出モードの違いを確認してご説明しましょうか。",
      points: [["飽きた点を聞く","どんなところ/どの/単調/普段"], ["楽しみ方を具体的に提案する","演出モード/別の演出/モードの違い/別のモード"], ["案内の希望を確認する","よろしければ/ご希望/しましょうか"]],
      explain: "飽きの理由を聞き、実機にある演出モードなど楽しみ方の変化を提案します。モードで当たりやすくなるとは伝えません。",
      ng: "ご本人の希望を確認せず、一方的に勧める" },

  { id: 'q11', age: 'middle',
      situation: "台移動を考えているが、持ち玉の扱いがわからず迷っている",
      line: "別の台に移りたいけど、この玉はどうするの？",
      model: "別の台への移動をご希望ですね。移動先と持ち玉の取り扱いを確認して、手順をご案内します。",
      points: [["移動先・希望を確認する","移動先/どの台/移動をご希望"], ["持ち玉の扱いを確認する","持ち玉/玉の扱い/取り扱い"], ["手順を具体的に案内する","手順/ご案内/ご説明"]],
      explain: "台移動したい意思がある場面です。移動先の貸玉区分や店舗ルールを確認し、移動の不便を解消します。",
      ng: "ご本人の希望を確認せず、一方的に勧める" },

  { id: 'q12', age: 'middle',
      situation: "椅子の高さが合わず、遊びづらいと相談したお客様",
      line: "姿勢がつらくて、長く座れないな。",
      model: "姿勢がおつらいのですね。椅子の調整ができるか確認します。よろしければお手伝いしましょうか。",
      points: [["不便を聞く","姿勢/おつらい/高さ/合いませんか"], ["設備の改善を申し出る","椅子の調整/調整方法/調整ができる"], ["希望を確認する","よろしければ/しましょうか/ご希望"]],
      explain: "設備の調整で解消できる不便に対応します。痛みや体調不良が続く場合には休憩等を優先し、続行を促しません。",
      ng: "ご本人の希望を確認せず、一方的に勧める" },

  { id: 'q13', age: 'middle',
    situation: 'お客様がたばこを取り出し、きょろきょろと周りを見ています。',
    line: '「たばこ吸えるところって、どこだっけ?」',
    model: '「喫煙室はあちらです。ご案内しますね。席を離れる間の台のルールもご説明します」',
    points: [
      ['喫煙室を案内する', '喫煙室をご案内しますね/喫煙/きつえん/たばこ/煙草/案内/あんない'],
      ['席を離れる間の台の扱いを伝える', '席を離れる間の台のルールもご説明します/台/席/せき/そのまま/戻/もど/ルール/休憩/きゅうけい/札']
    ],
    explain: '店内の喫煙は決められた喫煙室だけです。喫煙室の場所と、席を離れる間の台の扱いを案内すれば、安心して一服してから遊技に戻ってもらえます。',
    ng: '「店内は禁煙です」とだけ言って離れる/遊技台の席で吸ってよいと言う' },

  { id: 'q14', age: 'middle',
    situation: '長時間遊技しているお客様が、のどを気にしています。',
    line: '「のど渇いたなあ…」',
    model: '「お飲み物でしたら、自動販売機の場所をご案内しますね」',
    points: [
      ['飲み物に気づいて声をかける', 'お飲み物でしたら/飲み物/のみもの/飲料/ドリンク/お水/おみず/自動販売機/自販機/じはんき'],
      ['場所・サービスを案内する', '場所をご案内しますね/案内/あんない/お持ち/おもち/ご用意/用意/場所/ばしょ']
    ],
    explain: 'のどの渇きや疲れは、遊技を切り上げるきっかけになります。飲み物の場所やサービスを案内すれば、ひと息ついて遊技を続けてもらいやすくなります(案内する内容は、店舗で提供しているサービスに合わせます)。',
    ng: '聞こえないふりをする' },

  { id: 'q15', age: 'middle',
    situation: '初めて来店したらしいお客様が、店内を見回しています。',
    line: '「ここ、初めて来たんですけど…」',
    model: '「ご来店ありがとうございます。わからないことがあれば、いつでもお声がけください。休憩所やお手洗いの場所もご案内しますね」',
    points: [
      ['来店への感謝', 'ご来店ありがとうございます/ありがとう/ようこそ'],
      ['頼れることを伝える', 'わからないことがあれば、いつでもお声がけください/わからない/分からない/何かあれば/なにかあれば/いつでも/お声がけ/お呼び'],
      ['店内の施設を案内する', '休憩所やお手洗いの場所もご案内しますね/案内/あんない/休憩/トイレ/お手洗い/おてあらい/場所/ばしょ']
    ],
    explain: '初めての店では勝手がわからず、落ち着かないまま早めに帰ってしまいがちです。頼れる店員がいて、休憩所などの場所もわかれば、安心して長く楽しんでもらえます。',
    ng: '「そうですか」とだけ返す' },

  { id: 'q16', age: 'senior',
    situation: '耳が少し遠いお客様に、台の操作方法を説明しています。',
    line: '「ん?何て言ったかね?」',
    model: '(正面から、低めの声でゆっくりと)「こちらの・ボタンを・押すと・始まります。わかりにくいところは、ありますか?」',
    points: [
      ['具体的に短く言い直す', 'こちらのボタンを押すと始まります/ボタン/押/おす/レバー/ハンドル/こちら/ここ'],
      ['伝わったか確認する', 'わかりにくいところはありますか/わかりにく/分かりにく/大丈夫/だいじょうぶ/よろしいですか/いかがですか/ありますか']
    ],
    explain: '説明が伝わらないままだと、遊技を楽しめず早めにやめてしまいます。正面から、低めの声でゆっくり、短く区切って言い直し、伝わったかを確認します(話し方は自動採点の対象外ですが、実際の接客ではとても大切です)。',
    ng: '同じ説明を同じ早さで繰り返す/離れた場所から大声で話す' },

  { id: 'q17', age: 'senior',
    situation: '年配のお客様が、台の画面の小さな文字に目を凝らしています。',
    line: '「字が小さくて、よく見えないねえ…」',
    model: '「見えにくいですよね。よろしければ、表示の内容をお読みしてご説明しますね」',
    points: [
      ['見えにくさに共感する', '見えにくいですよね/見えにく/みえにく/見づら/みづら/小さ/ちいさ'],
      ['読み上げ・説明を申し出る', '表示の内容をお読みしてご説明しますね/読/よみ/よん/説明/せつめい/ご案内'],
      ASK_POINT
    ],
    explain: '表示が読めないと不安になり、遊技を楽しめません。読み上げて説明すれば、安心して遊技を続けてもらえます。',
    ng: '「画面に書いてあります」とだけ言う' },

  { id: 'q18', age: 'senior',
    situation: '常連のお客様が、体の不調の話をしながらも楽しそうにしています。',
    line: '「最近ちょっと膝が痛くてね、でもここに来るのは楽しみでね」',
    model: '「膝、大丈夫ですか?無理なさらず、お体を優先してください。休憩場所をご案内しましょうか」',
    points: [
      ['体を気づかう', '膝、大丈夫ですか/大丈夫/だいじょうぶ/無理/むり/お大事/痛'],
      ['楽しみにしてくれる気持ちを受け止める', '休憩場所をご案内しましょうか/休憩/休め/お体を優先/ご案内']
    ],
    explain: '体を気づかう一言と「楽しみにしてくれている」気持ちを受け止めることで、居心地のよさが生まれます。無理のない範囲で休憩を促すのも、長く楽しんでもらうための配慮です。',
    ng: '「そうですか」とだけ返して台の説明を始める' },

  { id: 'q19', age: 'senior',
    situation: '車椅子のお客様が、通路からこちらを見上げています。',
    line: '(座ったまま、こちらを見上げている)',
    model: '(しゃがんで目線を合わせてから)「何かお手伝いできることはありますか?」',
    points: [
      ['手助けを申し出る', '何かお手伝いできることはありますか/お手伝い/おてつだい/手伝/何か/なにか'],
      ['意向を確認する', 'お手伝いしましょうか/ありますか/いかがですか/よろしいですか/しましょうか/よろしければ']
    ],
    explain: '目線を合わせて手助けを申し出ることで、安心して店内を移動し、遊技を楽しんでもらえます(目線を合わせる動作は自動採点の対象外ですが、大切なポイントです)。',
    ng: '立ったまま見下ろして話す/本人ではなく付き添いの方にだけ話す' },

  { id: 'q20', age: 'senior',
    situation: '荷物を運ぼうとしているお客様に手伝いを申し出たところ、少し強めに断られました。',
    line: '「自分でできるから、大丈夫だよ」',
    model: '「失礼いたしました。何かあれば、いつでもお声がけくださいね」',
    points: [
      ['お客様の意思を尊重する', '失礼いたしました/失礼/しつれい/かしこまりました/承知/しょうち'],
      ['いつでも頼れることを伝える', '何かあれば、いつでもお声がけくださいね/何かあれば/なにかあれば/いつでも/お声がけ/お呼び/お申し付け']
    ],
    explain: '手伝いを断られたときは、本人の意思を尊重して引き下がりつつ、「いつでも頼れる」と伝えます。押しつけない気配りが居心地のよさにつながり、気持ちよく遊技を続けてもらえます。',
    ng: '「危ないので私がやります」と強引に手伝う' },

  { id: 'q21', age: 'senior',
      situation: "貸玉区分が違う台への移動を、自分から希望している",
      line: "この台と同じ機種って、別の貸玉区分にもある？",
      model: "同じ機種をお探しですね。ご希望の貸玉区分を伺って、設置と空き状況を確認してご案内します。",
      points: [["希望の区分を聞く","ご希望/どちらの/どの区分"], ["設置を確認する","設置/あるか確認/空き状況"], ["移動の案内","ご案内/ご説明"]],
      explain: "本人が希望した台移動に対応します。予算に達して終了する人へ、継続させる目的で別の貸玉を勧める場面ではありません。",
      ng: "ご本人の希望を確認せず、一方的に勧める" },
  { id: 'q22', age: 'middle',
      situation: "帰宅する時刻を決めているお客様",
      line: "時間だから、もう帰るね。",
      model: "お時間なのですね。本日もありがとうございました。お気をつけてお帰りください。",
      points: [["意思を受け止める","時間/承知/かしこまり"], ["感謝を伝える","ありがとう"], ["気持ちよく見送る","お気をつけ/お帰り/またお待ち"]],
      explain: "帰宅の意思を尊重します。追加の遊技を提案しません。",
      ng: "もう少し遊 / もう少し打 / あと一回 / あと1回" },
  { id: 'q23', age: 'middle',
      situation: "自分で決めた予算に達したお客様",
      line: "予算まで使ったから、今日は終わりにする。",
      model: "承知しました。ありがとうございました。お帰りの手続きでお手伝いできることはございますか。",
      points: [["意思を尊重する","承知/かしこまり/本日もありがとう"], ["感謝を伝える","ありがとう"], ["終了を手助けする","手続き/精算/お手伝い/お帰り"]],
      explain: "予算の区切りを尊重します。別の台や低貸しへの移動も勧めません。",
      ng: "もう少し / あと一回 / あと1回 / 低貸しなら / 取り返せ / 取り戻せ" },
  { id: 'q24', age: 'middle',
      situation: "やめたいのに続けてしまうと相談された",
      line: "やめたいのに、つい使いすぎてしまう。",
      model: "お話しくださりありがとうございます。ご不安なのですね。相談に対応する担当者におつなぎしてもよろしいですか。",
      points: [["相談を受け止める","ありがとう/ご不安/お話しくださ"], ["相談先につなぐ","担当者/相談窓口/アドバイザー"], ["本人の希望を聞く","よろしい/よろしければ/ご希望"]],
      explain: "遊技継続は勧めず、本人の希望を聞いて店舗の担当者や相談窓口へつなぎます。診断はしません。",
      ng: "もう少し / 低貸しなら / 取り返せ / 取り戻せ / 大丈夫ですよ" }
];

// ---- スプレッドシート ----
// SpreadsheetApp.getActiveSpreadsheet() は呼び出しごとに実コストがかかるため、
// 1回の実行(1リクエスト)の中では使い回す。
var activeSpreadsheet_ = null;
function getSpreadsheet_() {
  if (!activeSpreadsheet_) {
    activeSpreadsheet_ = SpreadsheetApp.getActiveSpreadsheet();
  }
  return activeSpreadsheet_;
}

// doPost で書き込み用のロックを取得済みかどうか(同じ実行内で二重に取らないため)
var scriptLockHeld_ = false;
function withScriptLock_(fn) {
  if (scriptLockHeld_) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  scriptLockHeld_ = true;
  try {
    return fn();
  } finally {
    scriptLockHeld_ = false;
    lock.releaseLock();
  }
}

function ensureSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 列を後から追加した場合に、見出し行だけ最新にする
function ensureHeaders_(sheet, headers) {
  if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function isNewQuestionFormat_(sheet) {
  var header = sheet.getRange(1, 1, 1, QUESTION_COLS).getValues()[0];
  return String(header[5]).indexOf('確認ポイント') === 0;
}

function defaultQuestionRows_() {
  return DEFAULT_QUESTIONS.map(function (q) {
    var row = [q.id, AGE_BAND_LABEL_JA[q.age], q.situation, q.line, q.model];
    for (var i = 0; i < 3; i++) {
      var p = q.points[i];
      row.push(p ? p[0] : '', p ? p[1] : '');
    }
    row.push(q.explain, q.ng, JUDGMENT_IDS_[q.id] ? '判断の境界' : '遊技延長');
    return row;
  });
}

function createQuestionsSheet_(ss) {
  var sheet = ss.insertSheet(SHEET_QUESTIONS);
  var rows = defaultQuestionRows_();
  sheet.getRange(1, 1, 1, QUESTION_COLS).setValues([QUESTION_HEADERS]);
  sheet.getRange(2, 1, rows.length, QUESTION_COLS).setValues(rows);
  sheet.setFrozenRows(1);
  return sheet;
}

// 「問題」シートがない、または以前の形式なら、新しい形式で作り直す(以前のシートは残す)
function ensureQuestionsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_QUESTIONS);
  if (sheet && isNewQuestionFormat_(sheet)) { ensureHeaders_(sheet, QUESTION_HEADERS); return sheet; }
  return withScriptLock_(function () {
    var current = ss.getSheetByName(SHEET_QUESTIONS);
    if (current && isNewQuestionFormat_(current)) return current;
    if (current) {
      var backupName = SHEET_QUESTIONS_OLD;
      if (ss.getSheetByName(backupName)) {
        backupName += ' ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmm');
      }
      current.setName(backupName);
    }
    return createQuestionsSheet_(ss);
  });
}

// 各アクションが実際に使うシートだけにアクセスするよう、遅延読み込みにしている
function sheets_() {
  var cache = {};
  function lazy(key, factory) {
    Object.defineProperty(cache, key, {
      configurable: true,
      enumerable: true,
      get: function () {
        var value = factory();
        Object.defineProperty(cache, key, { value: value, enumerable: true, configurable: true });
        return value;
      }
    });
  }
  lazy('staff', function () { return ensureSheet_(SHEET_STAFF, STAFF_HEADERS); });
  lazy('completions', function () { return ensureSheet_(SHEET_COMPLETIONS, COMPLETION_HEADERS); });
  lazy('sessions', function () { return ensureSheet_(SHEET_SESSIONS, SESSION_HEADERS); });
  lazy('redemptions', function () { return ensureSheet_(SHEET_REDEMPTIONS, REDEMPTION_HEADERS); });
  lazy('questions', function () { return ensureQuestionsSheet_(); });
  return cache;
}

// ---- 問題データの読み取り ----
function splitPhrases_(value) {
  return String(value || '')
    .split(/[\/／、,，\n]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

function getQuestionsFromSheet_() {
  var sheet = sheets_().questions;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, QUESTION_COLS).getValues();
  var questions = [];
  var usedIds = {};
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var ageBand = AGE_BAND_FROM_JA[String(row[1] || '').trim()];
    var situation = String(row[2] || '').trim();
    var line = String(row[3] || '').trim();
    var model = String(row[4] || '').trim();
    if (!ageBand || !situation || !model) continue;

    // IDが空欄の行は行番号から作る(行を並べ替えると変わるため、IDは入れておくのがおすすめ)
    var id = String(row[0] || '').trim() || ('row' + (i + 2));
    if (usedIds[id]) id = id + '_' + (i + 2);
    usedIds[id] = true;

    var checkpoints = [];
    for (var p = 0; p < 3; p++) {
      var label = String(row[5 + p * 2] || '').trim();
      var phrases = splitPhrases_(row[6 + p * 2]);
      if (label && phrases.length > 0) checkpoints.push({ label: label, phrases: phrases });
    }

    questions.push({
      id: id,
      ageBand: ageBand,
      situation: situation,
      customerLine: line,
      modelAnswer: model,
      checkpoints: checkpoints,
      explanation: String(row[11] || '').trim(),
      ngExample: String(row[12] || '').trim(),
      category: String(row[13] || (JUDGMENT_IDS_[id] ? '判断の境界' : '遊技延長'))
    });
  }
  return questions;
}

// ---- 汎用ヘルパー ----
// 氏名は「山田 太郎」「山田太郎」「山田　太郎」のようにスペースの有無・全角半角が
// 違っても同じ人として扱う(別の端末で登録し直したときにポイントが分かれないようにするため)
function nameKey_(name) {
  return String(name || '').replace(/[\s　]/g, '');
}

function isSameStaff_(rowStoreId, rowStaffId, storeId, staffId) {
  return rowStoreId === storeId && nameKey_(rowStaffId) === nameKey_(staffId);
}

function findRowIndex_(sheet, storeIdColIdx, staffIdColIdx, storeId, staffId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (isSameStaff_(data[i][storeIdColIdx], data[i][staffIdColIdx], storeId, staffId)) {
      return i + 1; // シート上の行番号(1始まり)
    }
  }
  return -1;
}

// 「1日」の区切りは、スクリプトのタイムゾーン設定に左右されないよう常に日本時間で判定する
function dayKeyJst_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function formatJst_(date) {
  return date instanceof Date ? Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '';
}

// 記録用シートは日付順に追記されていくため、末尾から少しずつ読み、
// visit が true を返すか、読む範囲の上限に達したら打ち切る。
// こうすることで、記録が何万行に増えても読み込む量が増えず、通信が遅くならない。
var SCAN_CHUNK_ = 200;
function scanFromBottom_(sheet, numCols, maxRows, visit) {
  var lastRow = sheet.getLastRow();
  var end = lastRow;
  var scanned = 0;
  while (end >= 2 && scanned < maxRows) {
    var start = Math.max(2, end - SCAN_CHUNK_ + 1);
    var rows = sheet.getRange(start, 1, end - start + 1, numCols).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (visit(rows[i], start + i)) return;
    }
    scanned += rows.length;
    end = start - 1;
  }
}

// このスタッフが今日(日本時間)すでにポイントを獲得済みかどうか
function hasCompletedToday_(completionsSheet, storeId, staffId) {
  var todayKey = dayKeyJst_(new Date());
  var found = false;
  scanFromBottom_(completionsSheet, 6, 100000, function (row) {
    var completedAt = row[5];
    if (!(completedAt instanceof Date)) return false;
    var key = dayKeyJst_(completedAt);
    if (key < todayKey) return true;
    if (key === todayKey && isSameStaff_(row[0], row[1], storeId, staffId)) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

// 「取り組み状況」シートから、セッションIDの行を探す(最近の行から)
function findSession_(sessionsSheet, sessionId) {
  var result = null;
  scanFromBottom_(sessionsSheet, SESSION_HEADERS.length, 5000, function (row, rowIndex) {
    if (row[0] === sessionId) {
      result = { rowIndex: rowIndex, values: row };
      return true;
    }
    return false;
  });
  return result;
}

function sanitizeText_(value, maxLen) {
  if (typeof value !== 'string') return '';
  var trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, maxLen || 100);
}

function sanitizeIdList_(list, maxItems) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, maxItems).map(function (v) { return sanitizeText_(String(v), 40); })
    .filter(function (v) { return v !== ''; });
}

function answersSummary_(answers) {
  return sanitizeText_(answers.map(function (a) {
    return a.quizId + ': ' + a.transcript;
  }).join(' / '), 3000);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ---- 入り口 ----
// スプレッドシートへの「書き込み」を行うアクションだけ排他ロックをかける。
// 読み取り専用のアクションまでロックで順番待ちにすると、無駄に遅くなるため。
var WRITE_ACTIONS_ = { register: true, progress: true, complete: true, adminRedeem: true };

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ error: 'invalid request body' });
  }

  var lock = null;
  if (WRITE_ACTIONS_[body.action]) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return jsonResponse_({ error: '混み合っています。少し時間をおいてもう一度お試しください。' });
    }
    scriptLockHeld_ = true;
  }
  try {
    switch (body.action) {
      case 'register':
        return jsonResponse_(handleRegister_(body));
      case 'progress':
        return jsonResponse_(handleProgress_(body));
      case 'complete':
        return jsonResponse_(handleComplete_(body));
      case 'status':
        return jsonResponse_(handleStatus_(body));
      case 'listQuestions':
        return jsonResponse_(handleListQuestions_(body));
      case 'adminList':
        return jsonResponse_(handleAdminList_(body));
      case 'adminSessions':
        return jsonResponse_(handleAdminSessions_(body));
      case 'adminRedeem':
        return jsonResponse_(handleAdminRedeem_(body));
      default:
        return jsonResponse_({ error: 'unknown action' });
    }
  } catch (err) {
    // 想定外のエラーでもHTMLのエラーページではなくJSONで返し、アプリ側で案内を出せるようにする
    console.error(err);
    return jsonResponse_({ error: 'サーバーでエラーが発生しました。もう一度お試しください。' });
  } finally {
    if (lock) {
      scriptLockHeld_ = false;
      lock.releaseLock();
    }
  }
}

function doGet(e) {
  return jsonResponse_({ ok: true, message: 'このURLはアプリからのPOST通信専用です。' });
}

// ---- 各アクション ----
function handleRegister_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var staffId = sanitizeText_(body.staffId, 100);
  var displayName = sanitizeText_(body.displayName, 100);

  if (!storeId || !staffId) {
    return { error: 'storeId, staffId は必須です' };
  }

  var sheet = sheets_().staff;
  var rowIndex = findRowIndex_(sheet, 0, 2, storeId, staffId);
  var now = new Date();

  if (rowIndex === -1) {
    sheet.appendRow([storeId, storeName || storeId, staffId, displayName, 0, now]);
    return { points: 0 };
  }
  sheet.getRange(rowIndex, 2).setValue(storeName || storeId);
  sheet.getRange(rowIndex, 4).setValue(displayName);
  sheet.getRange(rowIndex, 6).setValue(now);
  var points = Number(sheet.getRange(rowIndex, 5).getValue()) || 0;
  return { points: points };
}

function handleListQuestions_(body) {
  return { questions: getQuestionsFromSheet_() };
}

function readAnswers_(body) {
  var list = Array.isArray(body.answers) ? body.answers.slice(0, 10) : [];
  return list.map(function (a) {
    a = a || {};
    return {
      quizId: sanitizeText_(String(a.quizId || ''), 40),
      transcript: sanitizeText_(a.transcript, 300),
      passed: a.passed === true,
      contentScore: typeof a.contentScore === 'number' ? a.contentScore : null,
      voiceScore: typeof a.voiceScore === 'number' ? a.voiceScore : null
    };
  });
}

// 研修の開始時と、1問答えるごとにアプリから送られてくる途中経過を記録する。
// 1回の研修(セッション)につき「取り組み状況」シートの1行を上書きしていく。
function handleProgress_(body) {
  var sessionId = sanitizeText_(body.sessionId, 60);
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var displayName = sanitizeText_(body.displayName || body.staffId, 100);
  var quizIds = sanitizeIdList_(body.quizIds, 10);
  if (!sessionId || !storeId || !displayName || quizIds.length!==5 || quizIds.filter(function(x,i){return quizIds.indexOf(x)===i;}).length!==5) return { error: 'invalid request' };

  var answers = readAnswers_(body).filter(function (a) {
    return a.transcript.length >= MIN_ANSWER_LENGTH;
  });
  var sheet = sheets_().sessions;
  ensureHeaders_(sheet, SESSION_HEADERS);
  var now = new Date();
  var session = findSession_(sheet, sessionId);
  if (session) {
    if (session.values[8] === '完了') return { ok: true };
    if(String(session.values[1])!==storeId || nameKey_(session.values[3])!==nameKey_(displayName)) return {error:'研修の登録情報が一致しません。'};
    if(answers.length < Number(session.values[6]||0)) return {ok:true};
    sheet.getRange(session.rowIndex, 7, 1, 5).setValues([[
      answers.length, now, '途中', '', answersSummary_(answers)
    ]]);
  } else {
    sheet.appendRow([
      sessionId, storeId, storeName || storeId, displayName, now, quizIds.join(','),
      answers.length, now, '途中', '', answersSummary_(answers), JSON.stringify(getQuestionsFromSheet_().filter(function(q){return quizIds.indexOf(q.id)>=0;}))
    ]);
  }
  return { ok: true };
}

function handleComplete_(body) {
  var sessionId = sanitizeText_(body.sessionId, 60);
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var staffId = sanitizeText_(body.staffId, 100);
  var displayName = sanitizeText_(body.displayName, 100);
  var answers = readAnswers_(body);

  if (!storeId || !staffId) return { error: 'invalid request' };

  // 出題された5問すべてに、空欄でない回答があることを確認する
  var uniqueQuizIds = [];
  answers.forEach(function (a) {
    if (a.quizId && uniqueQuizIds.indexOf(a.quizId) === -1) uniqueQuizIds.push(a.quizId);
  });
  if (uniqueQuizIds.length !== QUESTIONS_PER_CHALLENGE || answers.length !== QUESTIONS_PER_CHALLENGE) {
    return { error: QUESTIONS_PER_CHALLENGE + '問分の回答が必要です' };
  }
  var emptyAnswer = answers.some(function (a) { return a.transcript.length < MIN_ANSWER_LENGTH; });
  if (emptyAnswer) {
    return { error: '回答が空欄の問題があります。すべての問題に回答してから送信してください。' };
  }

  var sheetSet = sheets_();
  var session = sessionId ? findSession_(sheetSet.sessions, sessionId) : null;
  if (session) {
    if(String(session.values[1])!==storeId || nameKey_(session.values[3])!==nameKey_(staffId)) return {error:'研修の登録情報が一致しません。'};
    // 通信が途切れて同じ内容が2回送られた場合は、1回目の結果をそのまま返す
    if (session.values[8] === '完了') {
      var rowIdx = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
      return {
        success: true,
        alreadyCompleted: true,
        pointsAwarded: 0,
        correctCount: answers.filter(function (a) { return a.passed; }).length,
        total: QUESTIONS_PER_CHALLENGE,
        totalPoints: rowIdx === -1 ? 0 : Number(sheetSet.staff.getRange(rowIdx, 5).getValue()) || 0
      };
    }
    var issued = String(session.values[5] || '').split(',').filter(function (v) { return v !== ''; });
    var sameSet = issued.length === uniqueQuizIds.length && uniqueQuizIds.every(function (id) {
      return issued.indexOf(id) !== -1;
    });
    if (!sameSet) {
      return { error: '出題された問題と回答が一致しません。研修をやり直してください。' };
    }
  } else {
    // 開始時の記録が届いていなかった場合は、問題シートに存在する問題かを確認する
    var known = Object.create(null);
    getQuestionsFromSheet_().forEach(function (q) { known[q.id] = true; });
    var unknown = uniqueQuizIds.some(function (id) { return !known[id]; });
    if (unknown) {
      return { error: '出題された問題と回答が一致しません。研修をやり直してください。' };
    }
  }

  // 採点は端末(ブラウザ)側で行っており、サーバーでは点数を検証できないため、
  // 合否・スコアは参考情報として記録する(ポイントは点数に関係なく付与するので、
  // 点数を偽ってもポイントは増えない)。
  var correctCount = answers.filter(function (a) { return a.passed; }).length;
  function avg_(key) {
    var values = answers.map(function (a) { return a[key]; })
      .filter(function (v) { return typeof v === 'number'; });
    if (values.length === 0) return '';
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return Math.round(sum / values.length);
  }
  var now = new Date();
  var summary = answersSummary_(answers);

  // 1日1人1ptが上限。今日すでにポイントを獲得済みかどうかを判定する。
  var alreadyAwardedToday = hasCompletedToday_(sheetSet.completions, storeId, staffId);

  // 完了したこと自体は(ポイントの有無にかかわらず)毎回記録に残す。
  ensureHeaders_(sheetSet.completions, COMPLETION_HEADERS);
  sheetSet.completions.appendRow([
    storeId, staffId, uniqueQuizIds.join(','), correctCount, QUESTIONS_PER_CHALLENGE, now,
    avg_('contentScore'), avg_('voiceScore'), summary, sessionId
  ]);

  if (session) {
    sheetSet.sessions.getRange(session.rowIndex, 7, 1, 5).setValues([[
      QUESTIONS_PER_CHALLENGE, now, '完了', now, summary
    ]]);
  } else if (sessionId) {
    sheetSet.sessions.appendRow([
      sessionId, storeId, storeName || storeId, displayName || staffId, now, uniqueQuizIds.join(','),
      QUESTIONS_PER_CHALLENGE, now, '完了', now, summary
    ]);
  }

  var staffRowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  var totalPoints;
  if (staffRowIndex === -1) {
    totalPoints = alreadyAwardedToday ? 0 : 1;
    sheetSet.staff.appendRow([storeId, storeName || storeId, staffId, displayName, totalPoints, now]);
  } else {
    // 店舗名〜更新日時(2〜6列目)をまとめて1回で読み書きする
    var range = sheetSet.staff.getRange(staffRowIndex, 2, 1, 5);
    var values = range.getValues()[0];
    var currentPoints = Number(values[3]) || 0;
    totalPoints = alreadyAwardedToday ? currentPoints : currentPoints + 1;
    range.setValues([[
      storeName || values[0],
      values[1],
      displayName || values[2],
      totalPoints,
      now
    ]]);
  }

  return {
    success: true,
    alreadyCompleted: alreadyAwardedToday,
    pointsAwarded: alreadyAwardedToday ? 0 : 1,
    correctCount: correctCount,
    total: QUESTIONS_PER_CHALLENGE,
    totalPoints: totalPoints
  };
}

function handleStatus_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var staffId = sanitizeText_(body.staffId, 100);

  var sheetSet = sheets_();
  var staffRowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  var points = 0;
  if (staffRowIndex !== -1) {
    points = Number(sheetSet.staff.getRange(staffRowIndex, 5).getValue()) || 0;
  }
  var awardedToday = hasCompletedToday_(sheetSet.completions, storeId, staffId);
  return { points: points, awardedToday: awardedToday };
}

function checkAdminKey_(body) {
  return typeof body.adminKey === 'string' && body.adminKey === ADMIN_KEY;
}

function handleAdminList_(body) {
  if (!checkAdminKey_(body)) {
    return { error: 'unauthorized' };
  }
  var sheet = sheets_().staff;
  var data = sheet.getDataRange().getValues();
  var staff = [];
  for (var i = 1; i < data.length; i++) {
    staff.push({
      storeId: data[i][0],
      storeName: data[i][1],
      staffId: data[i][2],
      displayName: data[i][3],
      points: Number(data[i][4]) || 0
    });
  }
  staff.sort(function (a, b) {
    return b.points - a.points;
  });
  return { staff: staff };
}

// 直近7日間の研修の取り組み状況(途中でやめた人も含む)
var ADMIN_SESSION_DAYS = 7;
function handleAdminSessions_(body) {
  if (!checkAdminKey_(body)) {
    return { error: 'unauthorized' };
  }
  var since = new Date(Date.now() - ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000);
  var sessions = [];
  scanFromBottom_(sheets_().sessions, SESSION_HEADERS.length, 3000, function (row) {
    var startedAt = row[4];
    if (startedAt instanceof Date && startedAt < since) return true;
    var issued = String(row[5] || '').split(',').filter(function (v) { return v !== ''; });
    sessions.push({
      storeId: row[1],
      storeName: row[2],
      displayName: row[3],
      startedAt: formatJst_(startedAt),
      answered: Number(row[6]) || 0,
      total: issued.length || QUESTIONS_PER_CHALLENGE,
      updatedAt: formatJst_(row[7]),
      status: row[8] === '完了' ? '完了' : '途中'
    });
    return false;
  });
  return { sessions: sessions };
}

function handleAdminRedeem_(body) {
  if (!checkAdminKey_(body)) {
    return { error: 'unauthorized' };
  }
  var storeId = sanitizeText_(body.storeId, 50);
  var staffId = sanitizeText_(body.staffId, 100);
  var amount = Number(body.amount);
  var note = sanitizeText_(body.note, 200);

  if (!storeId || !staffId || !Number.isInteger(amount) || amount <= 0) {
    return { error: 'invalid request' };
  }

  var sheetSet = sheets_();
  var rowIndex = findRowIndex_(sheetSet.staff, 0, 2, storeId, staffId);
  if (rowIndex === -1) {
    return { error: 'スタッフが見つかりません' };
  }
  var currentPoints = Number(sheetSet.staff.getRange(rowIndex, 5).getValue()) || 0;
  if (currentPoints < amount) {
    return { error: 'ポイントが不足しています' };
  }
  var newPoints = currentPoints - amount;
  sheetSet.staff.getRange(rowIndex, 5).setValue(newPoints);
  sheetSet.staff.getRange(rowIndex, 6).setValue(new Date());
  sheetSet.redemptions.appendRow([storeId, staffId, amount, note, new Date()]);

  return { success: true, totalPoints: newPoints };
}

// Run once after deployment: adjust unchanged sample questions and add three decision cases.
function applyReviewedQuestionsV4() {
 return withScriptLock_(function(){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('REVIEWED_V4')==='done') return;
  var sheet=ensureQuestionsSheet_(); var data=sheet.getDataRange().getValues();
  var next=defaultQuestionRows_();
  var ids={};for(var i=1;i<data.length;i++){
   var id=String(data[i][0]);ids[id]=true;
   var revised=next.filter(function(r){return r[0]===id;})[0];
   var original=ORIGINAL_ROWS_V4_[id];
   if(revised && original && original.every(function(value,col){return String(data[i][col] == null ? '' : data[i][col])===String(value);})) sheet.getRange(i+1,1,1,QUESTION_COLS).setValues([revised]);
  }
  next.forEach(function(row){if(!ids[row[0]])sheet.appendRow(row);});
  props.setProperty('REVIEWED_V4','done');
 });
}
var ORIGINAL_ROWS_V4_ = {"q01":["q01","20代","新台で遊技中のお客様が、台のボタンを何度も押して首をかしげています。","(ボタンを押しながら)「これ、どうやるんだろう…」","「何かお困りですか?よろしければ、どのボタンか教えていただければご説明しますね」","困っている点を確認する","何かお困りですか/お困り/困って/こまって/どの/どちら/どこが/わかりにく/分かりにく/わかりづら/分かりづら","説明・手助けを申し出る","ご説明しますね/説明/せつめい/ご案内/案内/お手伝い/手伝/一緒に/いっしょに/お教え/おしえ","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","操作がわからないままだと台を楽しめず、早めに席を立つきっかけになります。困っている点を聞いてすぐ説明すれば、安心して遊技を続けてもらえます。","「説明書に書いてあります」とだけ言って離れる/気づかないふりをする"],"q02":["q02","20代","台の音が大きいのか、お客様が片耳を押さえて顔をしかめています。","(片耳を押さえて顔をしかめている)","「音が気になりますか?よろしければ、台の音量を調整する方法をご案内しますね」","不快に気づいて声をかける","音が気になりますか/音/おと/気になり/きになり/うるさ/大き/おおき","解決方法を示す","音量を調整する方法をご案内しますね/音量/おんりょう/ボリューム/調整/ちょうせい/下げ/さげ/小さく/ちいさく","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","音などの不快感を我慢したまま遊技を続けるのはつらく、早めに帰る原因になります。音量の調整方法を案内すれば、快適に遊技を続けてもらえます(調整できない台なら、空いている台への移動などを提案します)。","「そういう台なので」と取り合わない"],"q03":["q03","20代","長く遊技しているお客様が、お腹をさすりながら時計を気にしています。","「お腹すいたな…でも台を離れたくないな」","「お食事休憩のルールをご案内しましょうか?ルールの時間内でしたら、台はそのままでお戻りいただけます」","休憩できることを伝える","休憩のルールをご案内しましょうか/休憩/きゅうけい/食事/しょくじ","離れる間の台の扱いを説明する","台はそのままでお戻りいただけます/ルール/そのまま/戻/もど/確保/キープ/札/ふだ/時間内/じかんない","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","休憩の方法を知らないと、無理をして遊技を続けるか、そのまま帰ってしまうことがあります。店舗の休憩ルールを案内すれば、食事の後に戻って遊技を続けてもらいやすくなります(ルールは必ず店舗の規定どおりに案内します)。","ルールにない約束をする(「何時間でも取っておきます」など)/何も案内しない"],"q04":["q04","20代","呼び出しランプが点灯しています。お客様は台のエラー表示を見ながら待っています。","(呼び出しランプを押して待っている)","「お待たせして申し訳ございません。すぐに確認いたします」","待たせたことをお詫びする","お待たせして申し訳ございません/申し訳/もうしわけ/お待たせ/おまたせ/すみません/失礼/しつれい","すぐに対応することを伝える","すぐに確認いたします/すぐ/ただいま/只今/確認/かくにん/対応/たいおう/直し/なおし","","","待たされる時間が長いと気持ちが冷め、遊技をやめるきっかけになります。お詫びとすばやい対応で、気持ちよく遊技に戻ってもらいます。","無言で作業を始める/「少々お待ちください」と言ったまま長く待たせる"],"q05":["q05","20代","お客様が腕をさすりながら、空調の吹き出し口の方を見ています。","「なんか、ここ寒いな…」","「寒くないですか?よろしければ、空調を確認してまいりますね」","寒さに気づいて声をかける","寒くないですか/寒/さむ/冷え/ひえ/温度/おんど","対応を申し出る","空調を確認してまいりますね/空調/くうちょう/エアコン/調整/ちょうせい/確認/かくにん/ひざ掛け/ひざかけ/ブランケット","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","寒さ・暑さの不快感は、遊技を切り上げる理由になりやすいものです。気づいてすぐ対応すれば、快適な環境で長く遊技を楽しんでもらえます。","「全体で決まっているので」と断るだけ"],"q06":["q06","20代","新しく入った台の前で、お客様が画面をのぞき込んでいます。","「これ、どういう台なんですか?」","「今週入った新台で、演出が楽しいと好評なんですよ。よろしければ遊び方をご説明しましょうか?」","台の楽しさ(演出・遊び方)を紹介する","演出が楽しいと好評なんですよ/演出/えんしゅつ/新台/しんだい/遊び方/あそびかた/シリーズ/キャラクター/特徴/とくちょう/好評/人気","説明を申し出る","遊び方をご説明しましょうか/説明/せつめい/ご案内/案内/お教え","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","興味を持った台を気持ちよく遊び始めてもらうことが、長く楽しんでもらう第一歩です。紹介するのは演出や遊び方などの楽しさで、出玉や当たりやすさを期待させる言い方はしません(法令・業界ルール上、問題になるおそれがあります)。","「この台はよく出ますよ」など、出玉や当たりを期待させる"],"q07":["q07","20代","顔なじみのお客様が、仕事帰りに立ち寄ったと話してくれました。","「仕事帰りにちょっと寄ったんですよね」","「お仕事お疲れさまです。ゆっくりしていってくださいね。何かあればお声がけください」","ねぎらう","お仕事お疲れさまです/お疲れ/おつかれ/お仕事/おしごと","くつろいでもらう一言","ゆっくりしていってくださいね/ゆっくり/くつろ/楽しんで/たのしんで","頼れることを伝える","何かあればお声がけください/何かあれば/なにかあれば/お声がけ/おこえがけ/お呼び/お申し付け/おもうしつけ","疲れて立ち寄ったお客様にとって、ねぎらいの一言と「頼れる店員がいる」安心感は居心地のよさになります。居心地のよい店では、自然と滞在時間が長くなります。","無言で通り過ぎる/すぐに台の宣伝を始める"],"q08":["q08","30〜50代","出玉が伸びず、お客様が無言でイライラしている様子です。","(台を見つめたまま、ため息をついている)","「失礼いたします。何かございましたら、いつでもお声がけくださいね」(短く声をかけ、あとは少し距離を置いて見守る)","控えめに声をかける","失礼いたします/失礼/しつれい","いつでも頼れることを伝える","何かございましたら、いつでもお声がけください/何か/なにか/いつでも/お声がけ/おこえがけ/お呼び/お申し付け","","","気分がすぐれないときに話しかけすぎると逆効果です。短く声をかけて「必要なときは頼れる」と伝え、あとは適度な距離で見守ることで、落ち着いて遊技を続けてもらいやすくなります。「まだ行けますよ」のような出玉を期待させる励ましは、根拠がないうえ法令・業界ルール上も問題になるおそれがあります。","「この台まだ行けますよ」と出玉を期待させる/しつこく話しかける"],"q09":["q09","30〜50代","台を移動しようと、空いている台を見て回っているお客様がいます。","「どの台にしようかなあ…」","「よろしければ、お好きな機種や演出のタイプを伺ってもよろしいですか?空いている台をご案内します」","好みを聞く","お好きな機種を伺ってもよろしいですか/好み/このみ/お好き/おすき/どんな/タイプ/機種/きしゅ","空いている台を案内する","空いている台をご案内します/案内/あんない/空いて/あいて/空き","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","好みに合う台が見つからないと、そのまま帰ってしまうことがあります。好みを聞いて合う台を案内すれば、楽しい時間を長く過ごしてもらえます。台選びの基準はお客様の好み(機種・演出)で、出玉の期待で選ばせてはいけません。","「こっちの台の方が出ますよ」とすすめる"],"q10":["q10","30〜50代","いつも同じ機種で遊技している常連のお客様です。","(いつもの台に座り、こちらに軽く会釈した)","「いつもありがとうございます。この機種の、どんなところがお好きなんですか?」","感謝を伝える","いつもありがとうございます/ありがとう/いつも","質問で会話を広げる","どんなところがお好きなんですか/どんなところ/どういうところ/どこが/お好き/おすき/気に入/きにい","","","顔を覚えて話を聞いてくれる店員がいると、「居心地のいい店」になります。好きな台の話を楽しんでもらうことで店で過ごす時間の満足度が上がり、長く過ごしてもらえます。","「はい/いいえ」で終わる質問だけで会話を終える"],"q11":["q11","30〜50代","落ち着いた、ゆっくりした口調で話すお客様です。","「いやあ…最近、忙しくてね…なかなか来れなくて…」","(相手と同じくらいゆっくりと)「そうだったんですね。お忙しい中ありがとうございます。今日はゆっくりしていってくださいね」","話を受け止める","そうだったんですね/そうなんですね/そうでしたか/そうですか","来店への感謝","お忙しい中ありがとうございます/ありがとう","くつろいでもらう一言","今日はゆっくりしていってくださいね/ゆっくり/くつろ/楽しんで/たのしんで","相手の話す速さに合わせて話を受け止めると、安心感が生まれます。「今日はゆっくり」と伝えることで、久しぶりの来店を気持ちよく長く楽しんでもらえます。","早口で「今日は新台ありますよ!」と畳みかける"],"q12":["q12","30〜50代","なかなか当たらず、お客様が不満そうにつぶやいています。","「今日はほんとに当たらないなあ…」","「そうですよね、もどかしいですよね。お飲み物など、何かあればいつでもお声がけください」","気持ちを受け止める","もどかしいですよね/もどかし/そうですよね/残念/ざんねん/悔し/くやし/お気持ち/わかります/分かります","いつでも頼れることを伝える","何かあればいつでもお声がけください/何か/なにか/いつでも/お声がけ/お呼び/お申し付け","","","まず気持ちを受け止めると不満が和らぎ、落ち着いて遊技を楽しんでもらえます。「次は当たりますよ」「取り返せますよ」は根拠がなく、のめり込みをあおるおそれもあるため、絶対に言いません。","「次は当たりますよ」「取り返せますよ」と言う"],"q13":["q13","30〜50代","お客様がたばこを取り出し、きょろきょろと周りを見ています。","「たばこ吸えるところって、どこだっけ?」","「喫煙室はあちらです。ご案内しますね。席を離れる間の台のルールもご説明します」","喫煙室を案内する","喫煙室をご案内しますね/喫煙/きつえん/たばこ/煙草/案内/あんない","席を離れる間の台の扱いを伝える","席を離れる間の台のルールもご説明します/台/席/せき/そのまま/戻/もど/ルール/休憩/きゅうけい/札","","","店内の喫煙は決められた喫煙室だけです。喫煙室の場所と、席を離れる間の台の扱いを案内すれば、安心して一服してから遊技に戻ってもらえます。","「店内は禁煙です」とだけ言って離れる/遊技台の席で吸ってよいと言う"],"q14":["q14","30〜50代","長時間遊技しているお客様が、のどを気にしています。","「のど渇いたなあ…」","「お飲み物でしたら、自動販売機の場所をご案内しますね」","飲み物に気づいて声をかける","お飲み物でしたら/飲み物/のみもの/飲料/ドリンク/お水/おみず/自動販売機/自販機/じはんき","場所・サービスを案内する","場所をご案内しますね/案内/あんない/お持ち/おもち/ご用意/用意/場所/ばしょ","","","のどの渇きや疲れは、遊技を切り上げるきっかけになります。飲み物の場所やサービスを案内すれば、ひと息ついて遊技を続けてもらいやすくなります(案内する内容は、店舗で提供しているサービスに合わせます)。","聞こえないふりをする"],"q15":["q15","30〜50代","初めて来店したらしいお客様が、店内を見回しています。","「ここ、初めて来たんですけど…」","「ご来店ありがとうございます。わからないことがあれば、いつでもお声がけください。休憩所やお手洗いの場所もご案内しますね」","来店への感謝","ご来店ありがとうございます/ありがとう/ようこそ","頼れることを伝える","わからないことがあれば、いつでもお声がけください/わからない/分からない/何かあれば/なにかあれば/いつでも/お声がけ/お呼び","店内の施設を案内する","休憩所やお手洗いの場所もご案内しますね/案内/あんない/休憩/トイレ/お手洗い/おてあらい/場所/ばしょ","初めての店では勝手がわからず、落ち着かないまま早めに帰ってしまいがちです。頼れる店員がいて、休憩所などの場所もわかれば、安心して長く楽しんでもらえます。","「そうですか」とだけ返す"],"q16":["q16","60〜70代","耳が少し遠いお客様に、台の操作方法を説明しています。","「ん?何て言ったかね?」","(正面から、低めの声でゆっくりと)「こちらの・ボタンを・押すと・始まります。わかりにくいところは、ありますか?」","具体的に短く言い直す","こちらのボタンを押すと始まります/ボタン/押/おす/レバー/ハンドル/こちら/ここ","伝わったか確認する","わかりにくいところはありますか/わかりにく/分かりにく/大丈夫/だいじょうぶ/よろしいですか/いかがですか/ありますか","","","説明が伝わらないままだと、遊技を楽しめず早めにやめてしまいます。正面から、低めの声でゆっくり、短く区切って言い直し、伝わったかを確認します(話し方は自動採点の対象外ですが、実際の接客ではとても大切です)。","同じ説明を同じ早さで繰り返す/離れた場所から大声で話す"],"q17":["q17","60〜70代","年配のお客様が、台の画面の小さな文字に目を凝らしています。","「字が小さくて、よく見えないねえ…」","「見えにくいですよね。よろしければ、表示の内容をお読みしてご説明しますね」","見えにくさに共感する","見えにくいですよね/見えにく/みえにく/見づら/みづら/小さ/ちいさ","読み上げ・説明を申し出る","表示の内容をお読みしてご説明しますね/読/よみ/よん/説明/せつめい/ご案内","お客様の意向を確認する","よろしければ/宜しければ/よかったら/良かったら/しましょうか/ましょうか/いかがですか/如何ですか","表示が読めないと不安になり、遊技を楽しめません。読み上げて説明すれば、安心して遊技を続けてもらえます。","「画面に書いてあります」とだけ言う"],"q18":["q18","60〜70代","常連のお客様が、体の不調の話をしながらも楽しそうにしています。","「最近ちょっと膝が痛くてね、でもここに来るのは楽しみでね」","「膝、大丈夫ですか?無理なさらず、休憩しながらゆっくり楽しんでいってくださいね」","体を気づかう","膝、大丈夫ですか/大丈夫/だいじょうぶ/無理/むり/お大事/痛","楽しみにしてくれる気持ちを受け止める","ゆっくり楽しんでいってくださいね/楽しん/たのしん/ゆっくり/うれしい/嬉しい/ありがとう","","","体を気づかう一言と「楽しみにしてくれている」気持ちを受け止めることで、居心地のよさが生まれます。無理のない範囲で休憩を促すのも、長く楽しんでもらうための配慮です。","「そうですか」とだけ返して台の説明を始める"],"q19":["q19","60〜70代","車椅子のお客様が、通路からこちらを見上げています。","(座ったまま、こちらを見上げている)","(しゃがんで目線を合わせてから)「何かお手伝いできることはありますか?」","手助けを申し出る","何かお手伝いできることはありますか/お手伝い/おてつだい/手伝/何か/なにか","意向を確認する","お手伝いしましょうか/ありますか/いかがですか/よろしいですか/しましょうか/よろしければ","","","目線を合わせて手助けを申し出ることで、安心して店内を移動し、遊技を楽しんでもらえます(目線を合わせる動作は自動採点の対象外ですが、大切なポイントです)。","立ったまま見下ろして話す/本人ではなく付き添いの方にだけ話す"],"q20":["q20","60〜70代","荷物を運ぼうとしているお客様に手伝いを申し出たところ、少し強めに断られました。","「自分でできるから、大丈夫だよ」","「失礼いたしました。何かあれば、いつでもお声がけくださいね」","お客様の意思を尊重する","失礼いたしました/失礼/しつれい/かしこまりました/承知/しょうち","いつでも頼れることを伝える","何かあれば、いつでもお声がけくださいね/何かあれば/なにかあれば/いつでも/お声がけ/お呼び/お申し付け","","","手伝いを断られたときは、本人の意思を尊重して引き下がりつつ、「いつでも頼れる」と伝えます。押しつけない気配りが居心地のよさにつながり、気持ちよく遊技を続けてもらえます。","「危ないので私がやります」と強引に手伝う"],"q21":["q21","60〜70代","顔なじみの年配のお客様が、家族の話を始めました。","「今度、孫が遊びに来るんだよ」","「それは楽しみですね!お孫さんは、おいくつなんですか?」","喜びに共感する","それは楽しみですね/楽しみ/たのしみ/いいですね/良いですね/うれしい/嬉しい/よかった","質問で話を広げる","お孫さんはおいくつなんですか/おいくつ/何歳/なんさい/どちら/どんな/いつ","","","家族の話を楽しそうに聞いてくれる店員がいる店は、年配のお客様にとって居心地のよい場所になります。居心地のよさが、ゆっくり過ごしてもらうことにつながります。","「そうですか」とだけ返す/作業をしながら聞き流す"]};
