export type AgeBand = 'young' | 'middle' | 'senior'

export interface QuizChoice {
  id: string
  label: string
  isBest: boolean
  feedback: string
}

export interface QuizStep {
  type: 'quiz'
  id: string
  situation: string
  customerLine: string
  choices: QuizChoice[]
}

export interface LessonStep {
  type: 'lesson'
  id: string
  title: string
  body: string[]
}

export type TrainingStep = LessonStep | QuizStep

export interface TrainingModule {
  id: string
  ageBand: AgeBand
  title: string
  summary: string
  steps: TrainingStep[]
}

export interface StaffProfile {
  staffId: string
  storeId: string
  storeName: string
  displayName: string
  points: number
  completedModuleIds: string[]
}
