/**
 * 接客力向上トレーニング用バックエンド(Google Apps Script)
 *
 * ■ 使い方
 * 1. このファイルの中身をすべてコピーする
 * 2. スプレッドシートを開き、上部メニューの「拡張機能」→「Apps Script」を選ぶ
 * 3. エディタに最初から入っているコードを全部消して、コピーした内容を貼り付ける
 * 4. すぐ下にある ADMIN_KEY を、好きな文字列(合言葉)に変更する
 * 5. 画面右上の「デプロイ」→「新しいデプロイ」を選ぶ(初めて設置するときのみ。
 *    すでに使っているコードを更新するときは、下の「■ コードを更新するとき」を参照)
 *    - 種類の選択(歯車アイコン)で「ウェブアプリ」を選ぶ
 *    - 「実行するユーザー」は「自分」のまま
 *    - 「アクセスできるユーザー」は「全員」にする
 *    - 「デプロイ」ボタンを押す
 * 6. 発行された「ウェブアプリのURL」をコピーし、
 *    app/src/config.ts の中の文字列に貼り付ける
 *
 * ■ コードを更新するとき(すでに運用中の場合)
 * 貼り替えて保存したあと、「デプロイ」→「デプロイを管理」→ 鉛筆アイコン(編集)→
 * バージョンで「新バージョン」を選んで「デプロイ」を押す。
 * ※「新しいデプロイ」を選ぶとURLが変わり、アプリから接続できなくなるので注意。
 *
 * データはこのスプレッドシート自身に保存されます。実行すると
 * 「スタッフ」「完了記録」「ポイント調整履歴」「問題」という4つのシートが
 * 自動的に作られます(手動で列を用意する必要はありません)。
 *
 * ■ 研修問題を追加・変更したいとき
 * コードは一切触らず、「問題」シートに直接行を追加・編集してください。
 * 列の意味:
 *   ID(空欄でも自動でつきます) / 年代(20代・30〜50代・60〜70代のいずれか) /
 *   場面 / お客様のセリフ / 選択肢1 / 正解1(正解なら "○") / 解説1 /
 *   選択肢2 / 正解2 / 解説2 / 選択肢3 / 正解3 / 解説3
 * 各問題は選択肢を3つ持ち、そのうち1つだけ「正解」の列に "○" を入れてください。
 * 保存すればすぐに反映されます(再デプロイは不要です)。
 * 【採点精度を上げるコツ】正解の選択肢には、実際にお客様に言うセリフを
 * 「」で囲んで書いてください(例: 「今日もありがとうございました」と声をかける)。
 * スタッフの回答は主にこの「」内のセリフと比べて採点されます。「」がない
 * 説明文だけの選択肢(例: さりげなく声かけをする)だと、正しい回答でも
 * 点数が低く出やすくなります。
 *
 * ■ 出題・ポイントのルール
 * スタッフが研修に挑戦すると、「問題」シートの中からランダムに5問が出題されます。
 * スタッフは選択肢から選ぶのではなく、自分の言葉で回答します。「問題」シートの
 * 選択肢1〜3は画面には表示されず、正解(○)の文言が「模範解答」、それ以外が「NG例」
 * として採点に使われます。採点はスタッフの端末(ブラウザ)側で行われ、音声そのものは
 * サーバーに送信・保存されません。
 * **5問に回答する(最後まで挑戦する)と1pt獲得できます。** 各問題の内容・声のトーンの
 * 出来はスコアとして記録・表示されますが、点数の高低にかかわらず5問答えれば1ptです。
 * ポイントは1日1人1ptが上限で、同じ日に何回挑戦しても2pt以上にはなりません。
 *
 * ■ 採点についての注意
 * 発話内容・声のトーンの解析と合否判定は、Apps Script側(サーバー)ではなく
 * スタッフの端末(ブラウザ)側で行われ、その判定結果(合否・スコア・発話テキスト)を
 * このスクリプトに送信しています。「完了記録」シートには参考情報として平均スコアと
 * 発話内容の要約を記録します。採点結果をサーバー側で検証することはできませんが、
 * ポイントは点数に関係なく「5問に回答したこと」で付与されるため、点数を偽っても
 * ポイントを増やすことはできません。
 * Android・パソコンはマイクで声で回答(内容+声のトーンで採点)、iPhone/iPadは
 * 文字入力(キーボードの音声入力も可)で回答(内容のみで採点)します。
 */

// ここを好きな文字列に変更してください(第三者に推測されにくいものを推奨します)
var ADMIN_KEY = 'CHANGE_ME_TO_YOUR_OWN_SECRET';

var SHEET_STAFF = 'スタッフ';
var SHEET_COMPLETIONS = '完了記録';
var SHEET_REDEMPTIONS = 'ポイント調整履歴';
var SHEET_QUESTIONS = '問題';

var STAFF_HEADERS = ['店舗ID', '店舗名', '氏名', '表示名', 'ポイント', '更新日時'];
var COMPLETION_HEADERS = [
  '店舗ID', '氏名', '出題した問題ID', '合格数', '問題数', '完了日時',
  '平均内容スコア', '平均声スコア', '発話内容(監査用・参考)'
];
var REDEMPTION_HEADERS = ['店舗ID', '氏名', '消費ポイント', 'メモ', '日時'];
var QUESTION_HEADERS = [
  'ID(空欄可)', '年代', '場面', 'お客様のセリフ',
  '選択肢1', '正解1(○)', '解説1',
  '選択肢2', '正解2(○)', '解説2',
  '選択肢3', '正解3(○)', '解説3'
];

var AGE_BAND_LABEL_JA = { young: '20代', middle: '30〜50代', senior: '60〜70代' };
var AGE_BAND_FROM_JA = { '20代': 'young', '30〜50代': 'middle', '60〜70代': 'senior' };

// ---- 「問題」シートを初めて作るときに入れておく初期データ ----
// (すでにシートにデータがある場合は使われません)
var DEFAULT_QUESTIONS = [
  { ageBand: 'young', situation: '大当たりが続かず、席を離れようか迷っている様子です。', line: 'うーん、今日はこの台厳しいかもな…',
    choices: [
      ['「実はこの台、この時間帯からよく動くんですよ」と一言だけ添える', true, '正解です。短く役立つ情報を添えることで、もう少し様子を見てみようという気持ちにつながります。'],
      ['「まだ全然いけますよ、頑張ってください」と励ますだけ', false, '根拠のない励ましだけでは響きにくく、押しつけがましく感じられることもあります。'],
      ['特に声はかけず離れる', false, 'ひとこと添えるだけで結果が変わる場面でした。']
    ] },
  { ageBand: 'young', situation: 'お客様が席を立ち、帰り支度を始めました。', line: '(無言でコートを着ている)',
    choices: [
      ['「今日もありがとうございました、またお待ちしています」と短く声をかける', true, '正解です。短くても声をかけることで印象が残り、次回の来店や「もう少しだけ」につながりやすくなります。'],
      ['呼び止めて長々とお礼を伝える', false, '20代のお客様には長い会話はかえって負担になりがちです。'],
      ['何も言わず見送る', false, '短い一言のチャンスを逃しています。']
    ] },
  { ageBand: 'young', situation: '台の調子が気になる様子で、軽くコンコンと叩いています。', line: '(無言で台を軽く叩いている)',
    choices: [
      ['「もしよろしければ、確認いたしましょうか?」と声をかける', true, '正解です。「もしよろしければ」はクッション言葉の一つで、声をかけられる側の心理的なハードルを下げてくれます。'],
      ['「壊れてませんよ、大丈夫です」と決めつけて答える', false, '確認もせずに決めつけると、不信感につながることがあります。'],
      ['気づかないふりをする', false, '気になっているサインを見逃さないことが大切です。']
    ] },
  { ageBand: 'young', situation: '新台の前で少し様子を見ている、あまり見かけないお客様です。', line: '「これ、結構人気なんですか?」',
    choices: [
      ['「はい、今週から入った新台で、SNSでも話題になっているんですよ」と話す', true, '正解です。趣味・娯楽の話題は初対面でも広がりやすく、雑談のきっかけとして有効です(FORDの法則のR=Recreation)。'],
      ['「さあ、よくわからないです」とだけ答える', false, 'せっかく話しかけてもらえた機会を活かせていません。'],
      ['質問に気づかず通り過ぎる', false, '声をかけてもらえた時は会話のチャンスです。']
    ] },
  { ageBand: 'young', situation: 'お客様が仕事帰りに立ち寄ったことを軽く話してくれました。', line: '「仕事帰りにちょっと寄ったんですよね」',
    choices: [
      ['「そうなんですね、お疲れ様です」と短く相槌を打つ', true, '正解です。「あいづち」は傾聴の基本テクニックの一つで、短い言葉でも相手は話を受け止めてもらえたと感じます。'],
      ['無言でうなずくだけ', false, '相槌の言葉を添えると、より気持ちが伝わりやすくなります。'],
      ['話を遮って台の説明を始める', false, '相手の話を最後まで受け止めることが傾聴の基本です。']
    ] },
  { ageBand: 'young', situation: '出玉が思ったより出ず、軽く声を漏らしています。', line: '「あ〜、全然出ないな…」',
    choices: [
      ['「そうですよね、見ていてこちらもハラハラしちゃいます」と短く共感を伝える', true, '正解です。相手の感情の温度に合わせて短く共感を返すことで、余計な負担をかけずに寄り添えます。'],
      ['「まだいけますよ、頑張ってください」と根拠なく励ます', false, '気持ちを受け止めずに励ますだけでは響きにくいことがあります。'],
      ['聞こえないふりをする', false, '短い共感の一言が言えるタイミングでした。']
    ] },

  { ageBand: 'middle', situation: '台を変えようか、このまま続けようか悩んでいる様子です。', line: 'う〜ん、どうしようかな…',
    choices: [
      ['「よろしければ、最近人気の台をご案内できますよ」と選択肢を示す', true, '正解です。悩みに寄り添い選択肢を示すことで、席を立たずに続ける決め手になります。'],
      ['そっとしておく', false, '声をかけるタイミングを逃しています。'],
      ['「そろそろ決めてください」と急かす', false, '急かす声かけは不快感につながり、逆効果です。']
    ] },
  { ageBand: 'middle', situation: '出玉が伸びず、少し不機嫌そうな表情です。', line: '(無言でイライラした様子)',
    choices: [
      ['「お飲み物のおかわりはいかがですか?灰皿もお取り替えしますね」とさりげなく声をかけて様子を伺う', true, '正解です。さりげない気配りが緊張をほぐし、もう少し続けてみようという気持ちの余裕につながります。'],
      ['機嫌が悪そうなので近づかない', false, 'こういう時こそさりげない気配りが効果的です。避けると機会を逃します。'],
      ['「この台まだ行けますよ」と根拠なく声をかける', false, '根拠のない声かけは信頼を損ねることがあります。']
    ] },
  { ageBand: 'middle', situation: '初めて来店したような様子のお客様が、台の近くで少し落ち着かない様子です。', line: '「ここ、初めて来たんですけど、賑わってますね」',
    choices: [
      ['「ありがとうございます、お仕事帰りですか?」と気軽に話しかける', true, '正解です。仕事の話題(FORDの法則のO=Occupation)は初対面でも聞きやすく、会話の糸口になります。'],
      ['「そうですね」とだけ返す', false, 'せっかくの会話のきっかけを広げられていません。'],
      ['特に反応せず離れる', false, '話しかけてもらえたタイミングを活かせていません。']
    ] },
  { ageBand: 'middle', situation: 'どの台にするか決めかねている様子です。', line: '「どれがいいかなあ…」',
    choices: [
      ['「差し支えなければ、好みの傾向を伺ってもよろしいですか?」と尋ねる', true, '正解です。「差し支えなければ」というクッション言葉を使うことで、踏み込んだ質問でも答えやすい雰囲気になります。'],
      ['「早く決めたほうがいいですよ」と急かす', false, '急かす言葉は押しつけがましく感じられます。'],
      ['何も聞かずにおすすめを一方的に伝える', false, '相手の好みを確認せずに勧めると、ミスマッチが起きやすくなります。']
    ] },
  { ageBand: 'middle', situation: '落ち着いたゆっくりとした口調で話すお客様です。', line: '「いやあ…最近、忙しくてね…なかなか来れなくて…」',
    choices: [
      ['相手と同じくらいゆっくりとしたペースで「そうだったんですね、お忙しい中ありがとうございます」と返す', true, '正解です。相手の話す速さやトーンに合わせる「ミラーリング」は、安心感を生み会話を続けやすくします。'],
      ['早口で「そうなんですね!今日は新台ありますよ!」と畳みかける', false, '相手のペースを無視した早口の応対は、落ち着いて話したい相手には負担になります。'],
      ['相槌を打たず黙って聞く', false, 'ペースを合わせつつも、相槌で反応を返すことが大切です。']
    ] },
  { ageBand: 'middle', situation: '特定の台をいつも利用している常連のお客様です。', line: '(いつもこの台に座っている)',
    choices: [
      ['「この台、いつも選ばれてますよね。どんなところが気に入ってるんですか?」と尋ねる', true, '正解です。「はい/いいえ」で終わらないオープンクエスチョンは、相手が自由に話しやすく会話が広がります。'],
      ['「この台好きなんですか?」とだけ聞く', false, '「はい」で終わってしまいやすく、会話が広がりにくい聞き方です。'],
      ['特に何も聞かない', false, '常連のお客様との会話を深める良い機会でした。']
    ] },
  { ageBand: 'middle', situation: 'なかなか当たらず、少し不満そうな様子です。', line: '「今日はほんとに当たらないなあ…」',
    choices: [
      ['「そうですよね、もどかしいですよね」と気持ちをまず受け止めてから様子を見る', true, '正解です。不満の言葉に対してはまず気持ちを受け止めることが基本です。否定や言い訳から入らないことが信頼につながります。'],
      ['「そういう時もありますよ」と軽く流す', false, '気持ちを受け止めずに流してしまうと、不満が募ることがあります。'],
      ['反応せずその場を離れる', false, '不満のサインを見逃さず、まず受け止める対応が大切です。']
    ] },

  { ageBand: 'senior', situation: '常連のお客様が最近の体調や趣味の話を始めました。', line: '最近ちょっと膝が痛くてね、でもここに来るのは楽しみでね。',
    choices: [
      ['「そうですか」とだけ返し、すぐに台の説明に移る', false, '会話を大切にしたい層に対して、話を切り上げすぎるのはもったいない対応です。'],
      ['「膝、大丈夫ですか?ゆっくりしていってくださいね」と気遣いを言葉にする', true, '正解です。話をきちんと受け止め気遣いを言葉にすることで、居心地の良さが生まれ長く楽しんでもらえます。'],
      ['自分の話に切り替える', false, 'まずは相手の話をしっかり受け止めることが優先です。']
    ] },
  { ageBand: 'senior', situation: '負けが込んでいて、そろそろやめようか迷っている様子です。', line: 'う〜ん、今日はこの辺でやめておこうかな…でもこの台好きなんだよな。',
    choices: [
      ['「そうですね、無理せずいきましょう」とだけ言って離れる', false, '間違いではありませんが、好きな台だという言葉を受け止められておらず、会話の機会を活かせていません。'],
      ['「この台お好きなんですね、次にいらした時にまたご案内しますね」と会話を広げる', true, '正解です。好きという気持ちを受け止めて会話を広げることで、今日もう少し、あるいは次回また楽しみに来てもらえます。無理な引き止めではなく自然な会話延長です。'],
      ['「もう少し遊んでいってください」とだけ引き止める', false, '直接的な引き止めは押しつけがましく感じられることがあります。']
    ] },
  { ageBand: 'senior', situation: 'お客様が席を立とうか迷っている様子です。', line: 'そろそろ帰ろうかな…。',
    choices: [
      ['無言でそのまま見送る', false, 'ひとこと添えるだけで、次回来店や会話延長のきっかけを逃しています。'],
      ['「今日もありがとうございました。また同じ台空けておきますね」と声をかける', true, '正解です。個別の気遣いと次回への自然な期待を伝えられ、もう少し話したい・遊びたい気持ちにつながります。'],
      ['「もう少し遊んでいってください」と引き止める', false, '直接的な引き止めは押しつけがましく感じられることがあります。']
    ] },
  { ageBand: 'senior', situation: '耳が少し遠いお客様に、台の操作方法を説明することになりました。', line: '「ん?何て言ったかね?」',
    choices: [
      ['正面から向き合い、低めの声でゆっくりと「こちらのボタンを押すと始まりますよ」とはっきり話す', true, '正解です。高齢のお客様には高い声や早口が聞き取りにくいことがあります。低めの声でゆっくり、口の動きが見える正面から話すと伝わりやすくなります。'],
      ['声のトーンや速さは変えずに、同じ説明を繰り返す', false, '同じ話し方を繰り返すだけでは伝わらないことがあります。話し方そのものを調整することが大切です。'],
      ['少し離れた場所から大声で話す', false, '大声よりも、近づいて低めの声でゆっくり話す方が聞き取りやすく、失礼にもなりません。']
    ] },
  { ageBand: 'senior', situation: '車椅子を利用しているお客様に話しかける場面です。', line: '(座ったまま、こちらを見上げている)',
    choices: [
      ['しゃがんで目線の高さを合わせてから「何かお手伝いできることはありますか?」と話しかける', true, '正解です。相手と同じ目線の高さに合わせることで、聞き取りやすくなるだけでなく、安心感も伝わります。'],
      ['立ったまま見下ろす形で話す', false, '見下ろす形での会話は、威圧的な印象を与えてしまうことがあります。'],
      ['目を合わせずに手元の作業をしながら話す', false, '目線を合わせることは、相手を大切に思う気持ちを伝える基本です。']
    ] },
  { ageBand: 'senior', situation: 'お客様が昔の話を、ゆっくりと繰り返し話しています。', line: '「昔はこの辺りも随分違ったんだよ…」(と、ゆっくり話し続ける)',
    choices: [
      ['「そうだったんですね」と相づちを打ちながら、急かさず最後まで落ち着いて耳を傾ける', true, '正解です。傾聴の基本は、相手の話すペースを尊重し、最後まで真摯に耳を傾けることです。'],
      ['「それで、結論は何ですか」と話を急がせる', false, '話を急がせると、話しにくさを感じさせてしまいます。'],
      ['途中で別の話題に変える', false, '相手が話している内容をまず受け止めることが大切です。']
    ] },
  { ageBand: 'senior', situation: '何か手伝おうとした際に、お客様から少し強めの反応がありました。', line: '「自分でできるから、大丈夫だよ」',
    choices: [
      ['「失礼いたしました、何かあればいつでもお声がけくださいね」と伝え、見守る', true, '正解です。高齢のお客様も一人の対等な個人として接し、必要以上に手を貸そうとしないことも大切な配慮です。'],
      ['「危ないので私がやります」と強引に手伝う', false, '本人の意思を尊重せずに手を貸すのは、対等な個人として接する姿勢に反します。'],
      ['何も言わずにその場を離れる', false, '一言添えることで、見守っている安心感を伝えられます。']
    ] },
  { ageBand: 'senior', situation: 'お孫さんの話を始めました。', line: '「今度、孫が遊びに来るんだよ」',
    choices: [
      ['「それは楽しみですね、おいくつになられたんですか?」と話を広げる', true, '正解です。家族の話題(FORDの法則のF=Family)は信頼関係を深めやすく、年配のお客様との会話では特に喜ばれやすいテーマです。'],
      ['「そうですか」とだけ返す', false, 'せっかくの話題を広げるチャンスを逃しています。'],
      ['聞こえないふりをして作業を続ける', false, '話しかけてくれた際は、手を止めて向き合うことが大切です。']
    ] }
];

// ---- シート初期化 ----
// SpreadsheetApp.getActiveSpreadsheet() は呼び出しごとに実コストがかかるため、
// 1回の実行(1リクエスト)の中では使い回す。
var activeSpreadsheet_ = null;
function getSpreadsheet_() {
  if (!activeSpreadsheet_) {
    activeSpreadsheet_ = SpreadsheetApp.getActiveSpreadsheet();
  }
  return activeSpreadsheet_;
}

function ensureSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureQuestionsSheet_() {
  var sheet = ensureSheet_(SHEET_QUESTIONS, QUESTION_HEADERS);
  if (sheet.getLastRow() < 2) {
    DEFAULT_QUESTIONS.forEach(function (q) {
      var row = [
        '',
        AGE_BAND_LABEL_JA[q.ageBand],
        q.situation,
        q.line
      ];
      q.choices.forEach(function (c) {
        row.push(c[0], c[1] ? '○' : '', c[2]);
      });
      sheet.appendRow(row);
    });
  }
  return sheet;
}

// 各アクションが実際に使うシートだけにアクセスするよう、遅延読み込みにしている。
// (例えば status アクションは staff と completions しか使わないのに、
//  毎回4シート全部にアクセスしていたのが応答の遅さの一因だったため)
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
  lazy('redemptions', function () { return ensureSheet_(SHEET_REDEMPTIONS, REDEMPTION_HEADERS); });
  lazy('questions', function () { return ensureQuestionsSheet_(); });
  return cache;
}

// ---- 問題データの読み取り ----
function getQuestionsFromSheet_() {
  var sheet = sheets_().questions;
  var data = sheet.getDataRange().getValues();
  var questions = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var ageBandJa = String(row[1] || '').trim();
    var ageBand = AGE_BAND_FROM_JA[ageBandJa];
    var situation = String(row[2] || '').trim();
    var line = String(row[3] || '').trim();
    if (!ageBand || !situation) continue;

    var id = String(row[0] || '').trim() || ('q' + (i + 1));
    var choices = [];
    var slots = [
      { label: row[4], best: row[5], fb: row[6], id: 'a' },
      { label: row[7], best: row[8], fb: row[9], id: 'b' },
      { label: row[10], best: row[11], fb: row[12], id: 'c' }
    ];
    slots.forEach(function (s) {
      var label = String(s.label || '').trim();
      if (!label) return;
      choices.push({
        id: s.id,
        label: label,
        isBest: String(s.best || '').trim() !== '',
        feedback: String(s.fb || '').trim()
      });
    });
    if (choices.length === 0) continue;

    questions.push({ id: id, ageBand: ageBand, situation: situation, customerLine: line, choices: choices });
  }
  return questions;
}

// ---- 汎用ヘルパー ----
// 氏名は「山田 太郎」「山田太郎」「山田　太郎」のようにスペースの有無・全角半角が
// 違っても同じ人として扱う(別の端末で登録し直したときにポイントが分かれないようにするため)
function nameKey_(name) {
  return String(name || '').replace(/[\s\u3000]/g, '');
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

// このスタッフが今日(日本時間)すでにポイントを獲得済みかどうか。
// 「完了記録」シートは日付順に追記されていくため、末尾から少しずつ読み、
// 今日より前の日付の行に到達した時点で打ち切る。こうすることで、記録が
// 何万行に増えても読み込む量は「今日の分」だけで済み、通信が遅くならない。
var COMPLETION_SCAN_CHUNK_ = 200;
function hasCompletedToday_(completionsSheet, storeId, staffId) {
  var todayKey = dayKeyJst_(new Date());
  var lastRow = completionsSheet.getLastRow();
  var end = lastRow;
  while (end >= 2) {
    var start = Math.max(2, end - COMPLETION_SCAN_CHUNK_ + 1);
    var rows = completionsSheet.getRange(start, 1, end - start + 1, 6).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      var completedAt = rows[i][5];
      if (!(completedAt instanceof Date)) continue;
      var key = dayKeyJst_(completedAt);
      if (key < todayKey) return false;
      if (key === todayKey && isSameStaff_(rows[i][0], rows[i][1], storeId, staffId)) return true;
    }
    end = start - 1;
  }
  return false;
}

function sanitizeText_(value, maxLen) {
  if (typeof value !== 'string') return '';
  var trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, maxLen || 100);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ---- 入り口 ----
// スプレッドシートへの「書き込み」を行うアクションだけ排他ロックをかける。
// status・listQuestions・adminList のような読み取り専用アクションまで同じ
// ロックで直列化すると、書き込み処理の完了を待たされて無駄に遅くなるため。
var WRITE_ACTIONS_ = { register: true, complete: true, adminRedeem: true };

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
  }
  try {
    switch (body.action) {
      case 'register':
        return jsonResponse_(handleRegister_(body));
      case 'complete':
        return jsonResponse_(handleComplete_(body));
      case 'status':
        return jsonResponse_(handleStatus_(body));
      case 'listQuestions':
        return jsonResponse_(handleListQuestions_(body));
      case 'adminList':
        return jsonResponse_(handleAdminList_(body));
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
    if (lock) lock.releaseLock();
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

var QUESTIONS_PER_CHALLENGE = 5;

function handleComplete_(body) {
  var storeId = sanitizeText_(body.storeId, 50);
  var storeName = sanitizeText_(body.storeName, 100);
  var staffId = sanitizeText_(body.staffId, 100);
  var displayName = sanitizeText_(body.displayName, 100);
  var answers = Array.isArray(body.answers) ? body.answers : [];

  // 送られてきた回答に重複がないかも確認する(同じ問題を2回答えて
  // 水増しすることを防ぐ)。
  var uniqueQuizIds = [];
  answers.forEach(function (a) {
    if (uniqueQuizIds.indexOf(a.quizId) === -1) uniqueQuizIds.push(a.quizId);
  });
  if (uniqueQuizIds.length !== QUESTIONS_PER_CHALLENGE) {
    return { error: QUESTIONS_PER_CHALLENGE + '問分の回答が必要です' };
  }

  // 採点はスタッフの端末(ブラウザ)側で行っており、サーバー側では回答内容を検証
  // できないため、各問題の合否(passed)はクライアントの計算結果をそのまま記録する。
  // ポイントは合否に関係なく付与するので、合否を偽ってもポイントは増えない。
  // (同じ理由で、問題IDが「問題」シートに存在するかの照合も省略して通信を速くしている)
  var correctCount = 0;
  var contentScores = [];
  var voiceScores = [];
  var transcriptParts = [];
  answers.forEach(function (a) {
    if (a.passed === true) correctCount++;
    if (typeof a.contentScore === 'number') contentScores.push(a.contentScore);
    if (typeof a.voiceScore === 'number') voiceScores.push(a.voiceScore);
    var t = sanitizeText_(a.transcript, 200);
    if (t) transcriptParts.push(t);
  });
  var total = QUESTIONS_PER_CHALLENGE;

  function avg_(arr) {
    if (arr.length === 0) return '';
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return Math.round(sum / arr.length);
  }
  var avgContent = avg_(contentScores);
  var avgVoice = avg_(voiceScores);
  var transcriptSummary = sanitizeText_(transcriptParts.join(' / '), 2000);

  // ポイントは「5問に回答したこと」自体で付与する(合格数は目安として記録・表示するのみ)。
  var sheetSet = sheets_();
  var now = new Date();
  var quizIdsLabel = uniqueQuizIds.join(',');

  // 1日1人1ptが上限。今日すでにポイントを獲得済みかどうかを判定する。
  var alreadyAwardedToday = hasCompletedToday_(sheetSet.completions, storeId, staffId);

  // 完了したこと自体は(ポイントの有無にかかわらず)毎回記録に残す。
  sheetSet.completions.appendRow([
    storeId, staffId, quizIdsLabel, correctCount, total, now,
    avgContent, avgVoice, transcriptSummary
  ]);

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
    total: total,
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
