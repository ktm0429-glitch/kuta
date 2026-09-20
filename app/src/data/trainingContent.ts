import type { TrainingModule } from '../types'

// 年代別モジュールの定義(タイトル・概要・冒頭の解説のみ)。
// 実際に出題される問題は、Googleスプレッドシートの「問題」シートから
// ageBand に応じて取得する(app/src/api.ts の listQuestions を参照)。
export const trainingModules: TrainingModule[] = [
  {
    id: 'young-customer-basics',
    ageBand: 'young',
    title: '20代のお客様との会話問題',
    summary:
      '20代のお客様は長い会話を求めない傾向があります。短いやり取りの中で、もう一台・もう少し遊びたくなる一言を選ぶ練習です。',
    tip: '短く・的確に。情報が役立てば、会話が短くても延長のきっかけになります。',
  },
  {
    id: 'middle-customer-conversation',
    ageBand: 'middle',
    title: '30〜50代のお客様との会話問題',
    summary:
      '自然に長く楽しんでもらうための声かけのタイミングを選ぶ練習です。雑談のきっかけ作り(FORDの法則)やクッション言葉も扱います。',
    tip: '「観察してひとこと」。困っているサインに気づいたら、押しつけずに選択肢を示します。',
  },
  {
    id: 'senior-customer-conversation',
    ageBand: 'senior',
    title: '60〜70代のお客様との会話問題',
    summary:
      '安心感のある会話が「もう少しここにいたい」気持ちにつながる練習です。話し方や目線の合わせ方など、高齢のお客様への配慮も扱います。',
    tip: '聞き役に徹し、気にかけてもらえている実感を持ってもらうこと。急かす・聞き流す対応は信頼を損ないます。',
  },
]

export function getModuleById(id: string): TrainingModule | undefined {
  return trainingModules.find((m) => m.id === id)
}
