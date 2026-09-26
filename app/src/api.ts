import { API_URL } from './config'

interface ApiErrorBody {
  error?: string
}

async function callApi<TResponse>(
  action: string,
  payload: object,
): Promise<TResponse> {
  // 回線が途切れたままでも無期限に読み込み中にならないようにする。
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), action === 'complete' ? 30000 : 10000)
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      // text/plain にすることでCORSの事前確認通信を増やさない。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`通信に失敗しました(status: ${res.status})`)
    }
    const data = (await res.json()) as TResponse & ApiErrorBody
    if (data && typeof data === 'object' && data.error) {
      throw new Error(data.error)
    }
    return data
  } finally {
    window.clearTimeout(timeout)
  }
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

export interface AnswerRecord {
  quizId: string
  passed: boolean
  contentScore: number
  voiceScore: number | null
  transcript: string
}

export interface CompleteTrainingRequest {
  sessionId: string
  storeId: string
  storeName: string
  staffId: string
  displayName: string
  answers: AnswerRecord[]
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

export interface ProgressRequest {
  sessionId: string
  storeId: string
  storeName: string
  staffId: string
  displayName: string
  quizIds: string[]
  answers: { quizId: string; transcript: string }[]
}

// 研修開始時と3問回答時に、途中経過をサーバーに記録する。
// 画面の操作を待たせないよう、結果は待たずに送りっぱなしにする(失敗しても研修は続けられる)。
export function sendProgress(req: ProgressRequest): void {
  callApi('progress', req).catch(() => {})
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
  questions: unknown[]
}

// 研修問題はコードには持たず、スプレッドシートの「問題」シートから
// 毎回取得する(担当者がシートに行を追加するだけで問題を増やせるようにするため)。
export function listQuestions(): Promise<ListQuestionsResponse> {
  return callApi('listQuestions', {})
}
