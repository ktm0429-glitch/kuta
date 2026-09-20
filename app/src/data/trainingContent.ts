import type { TrainingModule } from '../types'

// サンプル/たたき台コンテンツ。実際の運用では管理者が店舗の実情に合わせて
// 文言を差し替えることを想定しています。
export const trainingModules: TrainingModule[] = [
  {
    id: 'young-customer-basics',
    ageBand: 'young',
    title: '20代のお客様への接客基礎',
    summary:
      '20代のお客様は長い会話を求めていないことが多いです。テンポの良さと的確さで「感じの良い店」という印象を残すことを目指します。',
    steps: [
      {
        type: 'lesson',
        id: 'young-lesson-1',
        title: 'ポイントは「早い・簡潔・感じが良い」',
        body: [
          '20代のお客様は雑談よりも、必要な情報がすぐ得られることを重視する傾向があります。',
          '声かけは短く、要件がわかる一言から。長い前置きは不要です。',
          '会話が短くても、笑顔とアイコンタクトで「歓迎されている」感覚は十分に伝わります。',
        ],
      },
      {
        type: 'quiz',
        id: 'young-quiz-1',
        situation: '新台の話題を軽く振ったところ、お客様の反応が薄めでした。',
        customerLine: '（会話にあまり乗り気ではなさそうな様子）',
        choices: [
          {
            id: 'a',
            label: '会話を広げようと、さらに新台の詳しい説明を続ける',
            isBest: false,
            feedback:
              '反応が薄いのに会話を伸ばすと、かえって負担に感じられることがあります。',
          },
          {
            id: 'b',
            label: '「ごゆっくりどうぞ」と一言添えてサッと切り上げる',
            isBest: true,
            feedback:
              '正解です。相手のペースを尊重して短く切り上げることが、心地よい距離感につながります。',
          },
          {
            id: 'c',
            label: '無言でその場を離れる',
            isBest: false,
            feedback:
              'ひと言添えるだけで印象が大きく変わります。無言で離れるのはもったいないです。',
          },
        ],
      },
    ],
  },
  {
    id: 'middle-customer-conversation',
    ageBand: 'middle',
    title: '30〜50代のお客様との会話力',
    summary:
      'このお客様層は、ちょっとした雑談や気配りをきっかけに常連化しやすい層です。無理のない会話のきっかけ作りを学びます。',
    steps: [
      {
        type: 'lesson',
        id: 'middle-lesson-1',
        title: '「観察→ひとこと」の型',
        body: [
          'いきなり質問攻めにするのではなく、まず観察したことをひとこと伝えるところから始めます。',
          '例:「今日は寒いですね」「その台、最近人気なんですよ」など、お客様が答えやすい軽い話題が有効です。',
          '返答が短ければ深追いせず、必要なサポート（台の説明・呼び出しボタンの案内など）に自然に移ります。',
        ],
      },
      {
        type: 'quiz',
        id: 'middle-quiz-1',
        situation: '常連ではないお客様が、少し長めに台を眺めて悩んでいる様子です。',
        customerLine: 'う〜ん、どれにしようかな…',
        choices: [
          {
            id: 'a',
            label: '「よろしければ、最近人気の台をご案内できますよ」と声をかける',
            isBest: true,
            feedback:
              '正解です。困っている様子に気づいて、押しつけずに選択肢を提示するのは良い会話のきっかけです。',
          },
          {
            id: 'b',
            label: 'そっとしておく',
            isBest: false,
            feedback:
              '声をかけるだけの状況でした。困っているサインを見逃さないようにしましょう。',
          },
          {
            id: 'c',
            label: '「早く決めてください」と促す',
            isBest: false,
            feedback:
              'お客様を急かす声かけは不快感につながります。',
          },
        ],
      },
    ],
  },
  {
    id: 'senior-customer-conversation',
    ageBand: 'senior',
    title: '60〜70代のお客様との会話力',
    summary:
      '年配のお客様ほど会話の重要度が増します。単なる雑談で終わらせず、安心感と信頼関係につながる会話力を身につけます。',
    steps: [
      {
        type: 'lesson',
        id: 'senior-lesson-1',
        title: '会話が「また来たい」につながる理由',
        body: [
          '年配のお客様にとって、顔なじみのスタッフとの会話そのものが来店の楽しみのひとつになることがあります。',
          '前回の会話や好みの台を覚えておき、「〇〇さん、今日もいらしたんですね」と一言添えるだけで安心感が生まれます。',
          '聞き役に徹すること、相手の話を遮らないことも大切です。',
          '大切なのは「気にかけてもらえている」という実感です。急かしたり、聞き流したりする対応は信頼を損ないます。',
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
            feedback:
              '会話を大切にしたい層に対して、話を切り上げすぎるのはもったいない対応です。',
          },
          {
            id: 'b',
            label: '「膝、大丈夫ですか？ゆっくりしていってくださいね」と気遣いを言葉にする',
            isBest: true,
            feedback:
              '正解です。相手の話をきちんと受け止め、気遣いを言葉にすることで信頼関係が深まります。',
          },
          {
            id: 'c',
            label: '自分の話に切り替える',
            isBest: false,
            feedback:
              'まずは相手の話をしっかり受け止めることが優先です。',
          },
        ],
      },
      {
        type: 'quiz',
        id: 'senior-quiz-2',
        situation: 'お客様が席を立とうか迷っている様子です。',
        customerLine: 'そろそろ帰ろうかな、でもこの台好きなんだよな…。',
        choices: [
          {
            id: 'a',
            label: '無言でそのまま見送る',
            isBest: false,
            feedback:
              'ひとこと添えるだけで、次回来店の動機につながる機会を逃しています。',
          },
          {
            id: 'b',
            label: '「今日もありがとうございました。また同じ台空けておきますね」と声をかける',
            isBest: true,
            feedback:
              '正解です。個別の気遣いと次回来店への自然な期待を伝えられています。無理な引き止めではなく、また来たいと思ってもらえる声かけが目的です。',
          },
          {
            id: 'c',
            label: '「もう少し遊んでいってください」と引き止める',
            isBest: false,
            feedback:
              '直接的な引き止めは押しつけがましく感じられることがあります。あくまで自然な気遣いを心がけましょう。',
          },
        ],
      },
    ],
  },
]

export function getModuleById(id: string): TrainingModule | undefined {
  return trainingModules.find((m) => m.id === id)
}
