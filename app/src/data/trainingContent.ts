import type { TrainingModule } from '../types'

// サンプル/たたき台コンテンツ。「遊技延長につながる会話力」をテーマに、
// 場面設定→選択式の問題を中心に構成しています。
// 実際の運用では管理者が店舗の実情に合わせて文言を差し替えることを想定しています。
//
// 設計方針:
// - 正解は「押しつけがましい引き止め」ではなく、気配り・情報提供による
//   自然な会話延長を選ぶ内容にしています。
// - クイズIDと正解の対応は functions/src/answerKeys.ts にサーバー側の
//   採点用データとして重複管理しています。内容を変更する場合は両方を更新してください。
export const trainingModules: TrainingModule[] = [
  {
    id: 'young-customer-basics',
    ageBand: 'young',
    title: '20代のお客様との会話問題',
    summary:
      '20代のお客様は長い会話を求めない傾向があります。短いやり取りの中で、もう一台・もう少し遊びたくなる一言を選ぶ練習です。',
    steps: [
      {
        type: 'lesson',
        id: 'young-lesson-1',
        title: 'ポイント',
        body: ['短く・的確に。情報が役立てば、会話が短くても延長のきっかけになります。'],
      },
      {
        type: 'quiz',
        id: 'young-quiz-1',
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
            feedback:
              '根拠のない励ましだけでは響きにくく、押しつけがましく感じられることもあります。',
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
        type: 'quiz',
        id: 'young-quiz-2',
        situation: 'お客様が席を立ち、帰り支度を始めました。',
        customerLine: '（無言でコートを着ている）',
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
    ],
  },
  {
    id: 'middle-customer-conversation',
    ageBand: 'middle',
    title: '30〜50代のお客様との会話問題',
    summary:
      'ちょっとした雑談や気配りのタイミングを逃さず、自然に長く楽しんでもらうための声かけを選ぶ練習です。',
    steps: [
      {
        type: 'lesson',
        id: 'middle-lesson-1',
        title: 'ポイント',
        body: ['「観察してひとこと」。困っているサインに気づいたら、押しつけずに選択肢を示します。'],
      },
      {
        type: 'quiz',
        id: 'middle-quiz-1',
        situation: '台を変えようか、このまま続けようか悩んでいる様子です。',
        customerLine: 'う〜ん、どうしようかな…',
        choices: [
          {
            id: 'a',
            label: '「よろしければ、最近人気の台をご案内できますよ」と選択肢を示す',
            isBest: true,
            feedback:
              '正解です。悩みに寄り添い選択肢を示すことで、席を立たずに続ける決め手になります。',
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
        type: 'quiz',
        id: 'middle-quiz-2',
        situation: '出玉が伸びず、少し不機嫌そうな表情です。',
        customerLine: '（無言でイライラした様子）',
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
            feedback:
              'こういう時こそさりげない気配りが効果的です。避けてしまうと機会を逃します。',
          },
          {
            id: 'c',
            label: '「この台まだ行けますよ」と根拠なく声をかける',
            isBest: false,
            feedback: '根拠のない声かけは信頼を損ねることがあります。',
          },
        ],
      },
    ],
  },
  {
    id: 'senior-customer-conversation',
    ageBand: 'senior',
    title: '60〜70代のお客様との会話問題',
    summary:
      '年配のお客様ほど会話の重要度が増します。安心感のある会話が「もう少しここにいたい」という気持ちにつながる練習です。',
    steps: [
      {
        type: 'lesson',
        id: 'senior-lesson-1',
        title: 'ポイント',
        body: [
          '聞き役に徹し、気にかけてもらえている実感を持ってもらうこと。急かす・聞き流す対応は信頼を損ないます。',
        ],
      },
      {
        type: 'quiz',
        id: 'senior-quiz-1',
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
        type: 'quiz',
        id: 'senior-quiz-2',
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
        type: 'quiz',
        id: 'senior-quiz-3',
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
              '正解です。個別の気遣いと次回への自然な期待を伝えられ、会話が生まれることでもう少し話したい・遊びたいという気持ちにつながります。',
          },
          {
            id: 'c',
            label: '「もう少し遊んでいってください」と引き止める',
            isBest: false,
            feedback: '直接的な引き止めは押しつけがましく感じられることがあります。',
          },
        ],
      },
    ],
  },
]

export function getModuleById(id: string): TrainingModule | undefined {
  return trainingModules.find((m) => m.id === id)
}
