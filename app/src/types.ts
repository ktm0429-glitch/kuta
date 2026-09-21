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
