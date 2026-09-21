import { API_URL } from './config'
import type { QuizQuestion } from './types'

interface ApiErrorBody {
  error?: string
}

async function callApi<TResponse>(
  action: string,
  payload: object,
): Promise<TResponse> {
  const res = await fetch(API_URL, {
    method: 'POST',
    // text/plain にすることで、ブラウザの事前確認通信(CORS preflight)が
    // 発生せず、Google Apps Script 側でもそのままJSONとして受け取れる。
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  })
  if (!res.ok) {
    throw new Error(`通信に失敗しました(status: ${res.status})`)
  }
  const data = (await res.json()) as TResponse & ApiErrorBody
  if (data && typeof data === 'object' && data.error) {
    throw new Error(data.error)
  }
  return data
}

export interface RegisterStaffRequest {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
}

export interface RegisterStaffResponse {
  points: number
}

export function registerStaff(req: RegisterStaffRequest): Promise<RegisterStaffResponse> {
  return callApi('register', req)
}

export interface CompleteTrainingRequest {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
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

export function completeTraining(
  req: CompleteTrainingRequest,
): Promise<CompleteTrainingResponse> {
  return callApi('complete', req)
}

export interface MyStatusRequest {
  storeId: string
  staffId: string
}

export interface MyStatusResponse {
  points: number
  awardedToday: boolean
}

export function getMyStatus(req: MyStatusRequest): Promise<MyStatusResponse> {
  return callApi('status', req)
}

export interface ListQuestionsResponse {
  questions: QuizQuestion[]
}

// 研修問題はコードには持たず、スプレッドシートの「問題」シートから
// 毎回取得する(担当者がシートに行を追加するだけで問題を増やせるようにするため)。
export function listQuestions(): Promise<ListQuestionsResponse> {
  return callApi('listQuestions', {})
}
