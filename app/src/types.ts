export type AgeBand = 'young' | 'middle' | 'senior'

// 採点の基準となる「確認ポイント」。phrases のどれか1つが回答に含まれていれば確認できたとみなす
export interface Checkpoint {
  label: string
  phrases: string[]
}

export interface QuizQuestion {
  id: string
  ageBand: AgeBand
  category?: '遊技延長' | '判断の境界'
  situation: string
  customerLine: string
  modelAnswer: string
  checkpoints: Checkpoint[]
  explanation: string
  ngExample: string
}

// 1問分の回答を採点した結果
export interface AnswerScore {
  quizId: string
  transcript: string
  contentScore: number // 0-100(全端末共通で、回答内容だけで採点)
  voiceScore: number | null // 声の大きさ・抑揚(マイク回答時の参考値。点数には含めない)
  passed: boolean
  matched: string[] // 確認できたポイント
  missing: { label: string; example: string }[] // 自動では確認できなかったポイント
  ngHits: string[] // 含まれていた注意すべき表現
  mode: 'voice' | 'text'
}
