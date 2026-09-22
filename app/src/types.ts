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

// 1問分の「音声・表情での回答」を採点した結果
export interface AnswerScore {
  quizId: string
  transcript: string
  contentScore: number // 0-100
  expressionScore: number // 0-100
  voiceScore: number // 0-100
  overallScore: number // 0-100
  passed: boolean
  goodPoints: string[]
  improvePoints: string[]
}
