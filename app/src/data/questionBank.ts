import type { AgeBand, QuizQuestion } from '../types'

/**
 * 研修問題バンク。
 *
 * ■ 新しい問題を後から追加する方法
 * 1. 下の配列の最後に、テンプレート(ファイル末尾を参照)をコピーしてオブジェクトを1つ追加する
 * 2. id は他の問題と重複しないユニークな文字列にする(例: "senior-009")
 * 3. ageBand は "young" | "middle" | "senior" のいずれか
 *    (この値によって、どの年代別モジュールに出題されるかが自動的に決まる)
 * 4. choices は2〜4個。正解は isBest: true を1つだけ設定する
 * 5. 追加したら functions/src/questionBank.ts にも
 *    { id, ageBand, correctChoiceId } を1行追加すること
 *    (採点はサーバー側で行うため、フロントとサーバーの両方に同じ内容が必要)
 *
 * 内容は「傾聴」「雑談のFORD法則(Family/Occupation/Recreation/Dreams)」
 * 「クッション言葉」「高齢者とのコミュニケーションの基本」など、
 * 一般的に知られている接客・コミュニケーション手法を基にしたサンプル/たたき台です。
 * 実際の接客方針に合わせて文言を調整してください。
 */
export const questionBank: QuizQuestion[] = [
  // ---- young: 20代のお客様向け ----
  {
    id: 'young-01',
    ageBand: 'young',
    situation: '大当たりが続かず、席を離れようか迷っている様子です。',
    customerLine: 'うーん、今日はこの台厳しいかもな…',
    choices: [
      {
        id: 'a',
        label: '「実はこの台、この時間帯からよく動くんですよ」と一言だけ添える',
        isBest: true,
        feedback:
          '正解です。短く役立つ情報を添えることで、もう少し様子を見てみようという気持ちにつながります。',
      },
      {
        id: 'b',
        label: '「まだ全然いけますよ、頑張ってください」と励ますだけ',
        isBest: false,
        feedback: '根拠のない励ましだけでは響きにくく、押しつけがましく感じられることもあります。',
      },
      {
        id: 'c',
        label: '特に声はかけず離れる',
        isBest: false,
        feedback: 'ひとこと添えるだけで結果が変わる場面でした。',
      },
    ],
  },
  {
    id: 'young-02',
    ageBand: 'young',
    situation: 'お客様が席を立ち、帰り支度を始めました。',
    customerLine: '(無言でコートを着ている)',
    choices: [
      {
        id: 'a',
        label: '「今日もありがとうございました、またお待ちしています」と短く声をかける',
        isBest: true,
        feedback:
          '正解です。短くても声をかけることで印象が残り、次回の来店や「もう少しだけ」につながりやすくなります。',
      },
      {
        id: 'b',
        label: '呼び止めて長々とお礼を伝える',
        isBest: false,
        feedback: '20代のお客様には長い会話はかえって負担になりがちです。',
      },
      {
        id: 'c',
        label: '何も言わず見送る',
        isBest: false,
        feedback: '短い一言のチャンスを逃しています。',
      },
    ],
  },
  {
    id: 'young-03',
    ageBand: 'young',
    situation: '台の調子が気になる様子で、軽くコンコンと叩いています。',
    customerLine: '(無言で台を軽く叩いている)',
    choices: [
      {
        id: 'a',
        label: '「もしよろしければ、確認いたしましょうか?」と声をかける',
        isBest: true,
        feedback:
          '正解です。「もしよろしければ」はクッション言葉の一つで、声をかけられる側の心理的なハードルを下げてくれます。',
      },
      {
        id: 'b',
        label: '「壊れてませんよ、大丈夫です」と決めつけて答える',
        isBest: false,
        feedback: '確認もせずに決めつけると、不信感につながることがあります。',
      },
      {
        id: 'c',
        label: '気づかないふりをする',
        isBest: false,
        feedback: '気になっているサインを見逃さないことが大切です。',
      },
    ],
  },
  {
    id: 'young-04',
    ageBand: 'young',
    situation: '新台の前で少し様子を見ている、あまり見かけないお客様です。',
    customerLine: '「これ、結構人気なんですか?」',
    choices: [
      {
        id: 'a',
        label: '「はい、今週から入った新台で、SNSでも話題になっているんですよ」と話す',
        isBest: true,
        feedback:
          '正解です。趣味・娯楽の話題は初対面でも広がりやすく、雑談のきっかけとして有効です(FORDの法則のR=Recreation)。',
      },
      {
        id: 'b',
        label: '「さあ、よくわからないです」とだけ答える',
        isBest: false,
        feedback: 'せっかく話しかけてもらえた機会を活かせていません。',
      },
      {
        id: 'c',
        label: '質問に気づかず通り過ぎる',
        isBest: false,
        feedback: '声をかけてもらえた時は会話のチャンスです。',
      },
    ],
  },
  {
    id: 'young-05',
    ageBand: 'young',
    situation: 'お客様が仕事帰りに立ち寄ったことを軽く話してくれました。',
    customerLine: '「仕事帰りにちょっと寄ったんですよね」',
    choices: [
      {
        id: 'a',
        label: '「そうなんですね、お疲れ様です」と短く相槌を打つ',
        isBest: true,
        feedback:
          '正解です。「あいづち」は傾聴の基本テクニックの一つで、短い言葉でも相手は話を受け止めてもらえたと感じます。',
      },
      {
        id: 'b',
        label: '無言でうなずくだけ',
        isBest: false,
        feedback: '相槌の言葉を添えると、より気持ちが伝わりやすくなります。',
      },
      {
        id: 'c',
        label: '話を遮って台の説明を始める',
        isBest: false,
        feedback: '相手の話を最後まで受け止めることが傾聴の基本です。',
      },
    ],
  },
  {
    id: 'young-06',
    ageBand: 'young',
    situation: '出玉が思ったより出ず、軽く声を漏らしています。',
    customerLine: '「あ〜、全然出ないな…」',
    choices: [
      {
        id: 'a',
        label: '「そうですよね、見ていてこちらもハラハラしちゃいます」と短く共感を伝える',
        isBest: true,
        feedback:
          '正解です。相手の感情の温度に合わせて短く共感を返すことで、余計な負担をかけずに寄り添えます。',
      },
      {
        id: 'b',
        label: '「まだいけますよ、頑張ってください」と根拠なく励ます',
        isBest: false,
        feedback: '気持ちを受け止めずに励ますだけでは響きにくいことがあります。',
      },
      {
        id: 'c',
        label: '聞こえないふりをする',
        isBest: false,
        feedback: '短い共感の一言が言えるタイミングでした。',
      },
    ],
  },

  // ---- middle: 30〜50代のお客様向け ----
  {
    id: 'middle-01',
    ageBand: 'middle',
    situation: '台を変えようか、このまま続けようか悩んでいる様子です。',
    customerLine: 'う〜ん、どうしようかな…',
    choices: [
      {
        id: 'a',
        label: '「よろしければ、最近人気の台をご案内できますよ」と選択肢を示す',
        isBest: true,
        feedback: '正解です。悩みに寄り添い選択肢を示すことで、席を立たずに続ける決め手になります。',
      },
      {
        id: 'b',
        label: 'そっとしておく',
        isBest: false,
        feedback: '声をかけるタイミングを逃しています。',
      },
      {
        id: 'c',
        label: '「そろそろ決めてください」と急かす',
        isBest: false,
        feedback: '急かす声かけは不快感につながり、逆効果です。',
      },
    ],
  },
  {
    id: 'middle-02',
    ageBand: 'middle',
    situation: '出玉が伸びず、少し不機嫌そうな表情です。',
    customerLine: '(無言でイライラした様子)',
    choices: [
      {
        id: 'a',
        label: 'さりげなくドリンクや灰皿交換の声かけをして様子を伺う',
        isBest: true,
        feedback:
          '正解です。さりげない気配りが緊張をほぐし、もう少し続けてみようという気持ちの余裕につながります。',
      },
      {
        id: 'b',
        label: '機嫌が悪そうなので近づかない',
        isBest: false,
        feedback: 'こういう時こそさりげない気配りが効果的です。避けると機会を逃します。',
      },
      {
        id: 'c',
        label: '「この台まだ行けますよ」と根拠なく声をかける',
        isBest: false,
        feedback: '根拠のない声かけは信頼を損ねることがあります。',
      },
    ],
  },
  {
    id: 'middle-03',
    ageBand: 'middle',
    situation: '初めて来店したような様子のお客様が、台の近くで少し落ち着かない様子です。',
    customerLine: '「ここ、初めて来たんですけど、賑わってますね」',
    choices: [
      {
        id: 'a',
        label: '「ありがとうございます、お仕事帰りですか?」と気軽に話しかける',
        isBest: true,
        feedback:
          '正解です。仕事の話題(FORDの法則のO=Occupation)は初対面でも聞きやすく、会話の糸口になります。',
      },
      {
        id: 'b',
        label: '「そうですね」とだけ返す',
        isBest: false,
        feedback: 'せっかくの会話のきっかけを広げられていません。',
      },
      {
        id: 'c',
        label: '特に反応せず離れる',
        isBest: false,
        feedback: '話しかけてもらえたタイミングを活かせていません。',
      },
    ],
  },
  {
    id: 'middle-04',
    ageBand: 'middle',
    situation: 'どの台にするか決めかねている様子です。',
    customerLine: '「どれがいいかなあ…」',
    choices: [
      {
        id: 'a',
        label: '「差し支えなければ、好みの傾向を伺ってもよろしいですか?」と尋ねる',
        isBest: true,
        feedback:
          '正解です。「差し支えなければ」というクッション言葉を使うことで、踏み込んだ質問でも答えやすい雰囲気になります。',
      },
      {
        id: 'b',
        label: '「早く決めたほうがいいですよ」と急かす',
        isBest: false,
        feedback: '急かす言葉は押しつけがましく感じられます。',
      },
      {
        id: 'c',
        label: '何も聞かずにおすすめを一方的に伝える',
        isBest: false,
        feedback: '相手の好みを確認せずに勧めると、ミスマッチが起きやすくなります。',
      },
    ],
  },
  {
    id: 'middle-05',
    ageBand: 'middle',
    situation: '落ち着いたゆっくりとした口調で話すお客様です。',
    customerLine: '「いやあ…最近、忙しくてね…なかなか来れなくて…」',
    choices: [
      {
        id: 'a',
        label: '相手と同じくらいゆっくりとしたペースで「そうだったんですね、お忙しい中ありがとうございます」と返す',
        isBest: true,
        feedback:
          '正解です。相手の話す速さやトーンに合わせる「ミラーリング」は、安心感を生み会話を続けやすくします。',
      },
      {
        id: 'b',
        label: '早口で「そうなんですね!今日は新台ありますよ!」と畳みかける',
        isBest: false,
        feedback: '相手のペースを無視した早口の応対は、落ち着いて話したい相手には負担になります。',
      },
      {
        id: 'c',
        label: '相槌を打たず黙って聞く',
        isBest: false,
        feedback: 'ペースを合わせつつも、相槌で反応を返すことが大切です。',
      },
    ],
  },
  {
    id: 'middle-06',
    ageBand: 'middle',
    situation: '特定の台をいつも利用している常連のお客様です。',
    customerLine: '(いつもこの台に座っている)',
    choices: [
      {
        id: 'a',
        label: '「この台、いつも選ばれてますよね。どんなところが気に入ってるんですか?」と尋ねる',
        isBest: true,
        feedback:
          '正解です。「はい/いいえ」で終わらないオープンクエスチョンは、相手が自由に話しやすく会話が広がります。',
      },
      {
        id: 'b',
        label: '「この台好きなんですか?」とだけ聞く',
        isBest: false,
        feedback: '「はい」で終わってしまいやすく、会話が広がりにくい聞き方です。',
      },
      {
        id: 'c',
        label: '特に何も聞かない',
        isBest: false,
        feedback: '常連のお客様との会話を深める良い機会でした。',
      },
    ],
  },
  {
    id: 'middle-07',
    ageBand: 'middle',
    situation: 'なかなか当たらず、少し不満そうな様子です。',
    customerLine: '「今日はほんとに当たらないなあ…」',
    choices: [
      {
        id: 'a',
        label: '「そうですよね、もどかしいですよね」と気持ちをまず受け止めてから様子を見る',
        isBest: true,
        feedback:
          '正解です。不満の言葉に対してはまず気持ちを受け止めることが基本です。否定や言い訳から入らないことが信頼につながります。',
      },
      {
        id: 'b',
        label: '「そういう時もありますよ」と軽く流す',
        isBest: false,
        feedback: '気持ちを受け止めずに流してしまうと、不満が募ることがあります。',
      },
      {
        id: 'c',
        label: '反応せずその場を離れる',
        isBest: false,
        feedback: '不満のサインを見逃さず、まず受け止める対応が大切です。',
      },
    ],
  },

  // ---- senior: 60〜70代のお客様向け ----
  {
    id: 'senior-01',
    ageBand: 'senior',
    situation: '常連のお客様が最近の体調や趣味の話を始めました。',
    customerLine: '最近ちょっと膝が痛くてね、でもここに来るのは楽しみでね。',
    choices: [
      {
        id: 'a',
        label: '「そうですか」とだけ返し、すぐに台の説明に移る',
        isBest: false,
        feedback: '会話を大切にしたい層に対して、話を切り上げすぎるのはもったいない対応です。',
      },
      {
        id: 'b',
        label: '「膝、大丈夫ですか?ゆっくりしていってくださいね」と気遣いを言葉にする',
        isBest: true,
        feedback:
          '正解です。話をきちんと受け止め気遣いを言葉にすることで、居心地の良さが生まれ長く楽しんでもらえます。',
      },
      {
        id: 'c',
        label: '自分の話に切り替える',
        isBest: false,
        feedback: 'まずは相手の話をしっかり受け止めることが優先です。',
      },
    ],
  },
  {
    id: 'senior-02',
    ageBand: 'senior',
    situation: '負けが込んでいて、そろそろやめようか迷っている様子です。',
    customerLine: 'う〜ん、今日はこの辺でやめておこうかな…でもこの台好きなんだよな。',
    choices: [
      {
        id: 'a',
        label: '「そうですね、無理せずいきましょう」とだけ言って離れる',
        isBest: false,
        feedback:
          '間違いではありませんが、好きな台だという言葉を受け止められておらず、会話の機会を活かせていません。',
      },
      {
        id: 'b',
        label: '「この台お好きなんですね、次にいらした時にまたご案内しますね」と会話を広げる',
        isBest: true,
        feedback:
          '正解です。好きという気持ちを受け止めて会話を広げることで、今日もう少し、あるいは次回また楽しみに来てもらえます。無理な引き止めではなく自然な会話延長です。',
      },
      {
        id: 'c',
        label: '「もう少し遊んでいってください」とだけ引き止める',
        isBest: false,
        feedback: '直接的な引き止めは押しつけがましく感じられることがあります。',
      },
    ],
  },
  {
    id: 'senior-03',
    ageBand: 'senior',
    situation: 'お客様が席を立とうか迷っている様子です。',
    customerLine: 'そろそろ帰ろうかな…。',
    choices: [
      {
        id: 'a',
        label: '無言でそのまま見送る',
        isBest: false,
        feedback: 'ひとこと添えるだけで、次回来店や会話延長のきっかけを逃しています。',
      },
      {
        id: 'b',
        label: '「今日もありがとうございました。また同じ台空けておきますね」と声をかける',
        isBest: true,
        feedback:
          '正解です。個別の気遣いと次回への自然な期待を伝えられ、もう少し話したい・遊びたい気持ちにつながります。',
      },
      {
        id: 'c',
        label: '「もう少し遊んでいってください」と引き止める',
        isBest: false,
        feedback: '直接的な引き止めは押しつけがましく感じられることがあります。',
      },
    ],
  },
  {
    id: 'senior-04',
    ageBand: 'senior',
    situation: '耳が少し遠いお客様に、台の操作方法を説明することになりました。',
    customerLine: '「ん?何て言ったかね?」',
    choices: [
      {
        id: 'a',
        label: '正面から向き合い、低めの声でゆっくりはっきりと話す',
        isBest: true,
        feedback:
          '正解です。高齢のお客様には高い声や早口が聞き取りにくいことがあります。低めの声でゆっくり、口の動きが見える正面から話すと伝わりやすくなります。',
      },
      {
        id: 'b',
        label: '声のトーンや速さは変えずに、同じ説明を繰り返す',
        isBest: false,
        feedback: '同じ話し方を繰り返すだけでは伝わらないことがあります。話し方そのものを調整することが大切です。',
      },
      {
        id: 'c',
        label: '少し離れた場所から大声で話す',
        isBest: false,
        feedback: '大声よりも、近づいて低めの声でゆっくり話す方が聞き取りやすく、失礼にもなりません。',
      },
    ],
  },
  {
    id: 'senior-05',
    ageBand: 'senior',
    situation: '車椅子を利用しているお客様に話しかける場面です。',
    customerLine: '(座ったまま、こちらを見上げている)',
    choices: [
      {
        id: 'a',
        label: 'しゃがんで相手と目線の高さを合わせてから話す',
        isBest: true,
        feedback:
          '正解です。相手と同じ目線の高さに合わせることで、聞き取りやすくなるだけでなく、安心感も伝わります。',
      },
      {
        id: 'b',
        label: '立ったまま見下ろす形で話す',
        isBest: false,
        feedback: '見下ろす形での会話は、威圧的な印象を与えてしまうことがあります。',
      },
      {
        id: 'c',
        label: '目を合わせずに手元の作業をしながら話す',
        isBest: false,
        feedback: '目線を合わせることは、相手を大切に思う気持ちを伝える基本です。',
      },
    ],
  },
  {
    id: 'senior-06',
    ageBand: 'senior',
    situation: 'お客様が昔の話を、ゆっくりと繰り返し話しています。',
    customerLine: '「昔はこの辺りも随分違ったんだよ…」(と、ゆっくり話し続ける)',
    choices: [
      {
        id: 'a',
        label: '急かさず、最後まで落ち着いて耳を傾ける',
        isBest: true,
        feedback: '正解です。傾聴の基本は、相手の話すペースを尊重し、最後まで真摯に耳を傾けることです。',
      },
      {
        id: 'b',
        label: '「それで、結論は何ですか」と話を急がせる',
        isBest: false,
        feedback: '話を急がせると、話しにくさを感じさせてしまいます。',
      },
      {
        id: 'c',
        label: '途中で別の話題に変える',
        isBest: false,
        feedback: '相手が話している内容をまず受け止めることが大切です。',
      },
    ],
  },
  {
    id: 'senior-07',
    ageBand: 'senior',
    situation: '何か手伝おうとした際に、お客様から少し強めの反応がありました。',
    customerLine: '「自分でできるから、大丈夫だよ」',
    choices: [
      {
        id: 'a',
        label: '「失礼いたしました、何かあればいつでもお声がけくださいね」と伝え、見守る',
        isBest: true,
        feedback:
          '正解です。高齢のお客様も一人の対等な個人として接し、必要以上に手を貸そうとしないことも大切な配慮です。',
      },
      {
        id: 'b',
        label: '「危ないので私がやります」と強引に手伝う',
        isBest: false,
        feedback: '本人の意思を尊重せずに手を貸すのは、対等な個人として接する姿勢に反します。',
      },
      {
        id: 'c',
        label: '何も言わずにその場を離れる',
        isBest: false,
        feedback: '一言添えることで、見守っている安心感を伝えられます。',
      },
    ],
  },
  {
    id: 'senior-08',
    ageBand: 'senior',
    situation: 'お孫さんの話を始めました。',
    customerLine: '「今度、孫が遊びに来るんだよ」',
    choices: [
      {
        id: 'a',
        label: '「それは楽しみですね、おいくつになられたんですか?」と話を広げる',
        isBest: true,
        feedback:
          '正解です。家族の話題(FORDの法則のF=Family)は信頼関係を深めやすく、年配のお客様との会話では特に喜ばれやすいテーマです。',
      },
      {
        id: 'b',
        label: '「そうですか」とだけ返す',
        isBest: false,
        feedback: 'せっかくの話題を広げるチャンスを逃しています。',
      },
      {
        id: 'c',
        label: '聞こえないふりをして作業を続ける',
        isBest: false,
        feedback: '話しかけてくれた際は、手を止めて向き合うことが大切です。',
      },
    ],
  },

  // ---- ここに新しい問題を追加する(テンプレート) ----
  // {
  //   id: 'young-07',
  //   ageBand: 'young',
  //   situation: '(場面の説明)',
  //   customerLine: '(お客様のセリフ)',
  //   choices: [
  //     { id: 'a', label: '(選択肢A)', isBest: false, feedback: '(解説)' },
  //     { id: 'b', label: '(選択肢B)', isBest: true, feedback: '(解説)' },
  //     { id: 'c', label: '(選択肢C)', isBest: false, feedback: '(解説)' },
  //   ],
  // },
]

export function getQuestionsByAgeBand(ageBand: AgeBand): QuizQuestion[] {
  return questionBank.filter((q) => q.ageBand === ageBand)
}
