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

export interface TrainingModule {
  id: string
  ageBand: AgeBand
  title: string
  summary: string
  tip: string
}

export interface StaffProfile {
  staffId: string
  storeId: string
  storeName: string
  displayName: string
  points: number
  completedModuleIds: string[]
}
