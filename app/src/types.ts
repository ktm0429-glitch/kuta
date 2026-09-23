export type AgeBand = 'young' | 'middle' | 'senior'

export interface QuizChoice {
  id: string
  label: string
  isBest: boolean
  feedback: string
}

export interface QuizQuestion {
  id: string
  ageBand: AgeBand
  situation: string
  customerLine: string
  choices: QuizChoice[]
}

// 1問分の回答を採点した結果
export interface AnswerScore {
  quizId: string
  transcript: string
  contentScore: number // 0-100
  voiceScore: number // 0-100(テキスト入力モードでは未評価)
  overallScore: number // 0-100
  passed: boolean
  goodPoints: string[]
  improvePoints: string[]
  // 'voice': マイクで録音し、音声認識+声のトーンで採点
  // 'text': テキスト入力(iPhone等、音声認識非対応ブラウザ向けの代替手段)で内容のみ採点
  mode: 'voice' | 'text'
}
