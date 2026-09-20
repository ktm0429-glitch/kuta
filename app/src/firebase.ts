import { initializeApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const functions = getFunctions(app, 'asia-northeast1')

export interface CompleteTrainingRequest {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
  moduleId: string
  answers: { quizId: string; choiceId: string }[]
}

export interface CompleteTrainingResponse {
  success: boolean
  alreadyCompleted: boolean
  pointsAwarded: number
  correctCount: number
  total: number
  totalPoints?: number
}

export const completeTrainingFn = httpsCallable<
  CompleteTrainingRequest,
  CompleteTrainingResponse
>(functions, 'completeTraining')

export interface MyStatusRequest {
  storeId: string
  staffId: string
}

export interface MyStatusResponse {
  points: number
  completedModuleIds: string[]
}

export const getMyStatusFn = httpsCallable<MyStatusRequest, MyStatusResponse>(
  functions,
  'getMyStatus',
)
