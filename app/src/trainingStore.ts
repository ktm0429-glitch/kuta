import type { AnswerScore, QuizQuestion } from './types'

// 研修の途中経過・復習リスト・最近出た問題を、端末(ブラウザ)内に保存する。
// 画面を閉じたり再読み込みしたりしても、同じ日のうちなら続きから再開できるようにするため。

export interface SavedProgress {
  sessionId: string
  day: string
  questionIds: string[]
  reviewId: string | null
  stepIndex: number
  scores: Record<string, AnswerScore>
  reviewMarks: Record<string, boolean>
}

const MAX_REVIEW = 20
const MAX_RECENT = 10

function storageKey(kind: string, storeId: string, staffId: string): string {
  return `sekkyaku-${kind}:${storeId}:${staffId}`
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できない端末では、途中再開・復習の機能なしで動作を続ける
  }
}

export function todayJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function loadProgress(storeId: string, staffId: string): SavedProgress | null {
  const saved = readJson<SavedProgress>(storageKey('progress', storeId, staffId))
  return saved && saved.day === todayJst() ? saved : null
}

export function saveProgress(storeId: string, staffId: string, progress: SavedProgress): void {
  writeJson(storageKey('progress', storeId, staffId), progress)
}

export function clearProgress(storeId: string, staffId: string): void {
  try {
    localStorage.removeItem(storageKey('progress', storeId, staffId))
  } catch {
    // 何もしない
  }
}

export function loadReviewList(storeId: string, staffId: string): string[] {
  return readJson<string[]>(storageKey('review', storeId, staffId)) ?? []
}

function loadRecent(storeId: string, staffId: string): string[] {
  return readJson<string[]>(storageKey('recent', storeId, staffId)) ?? []
}

// 研修を終えたときに、復習リストと「最近出た問題」を更新する
export function recordFinishedSession(
  storeId: string,
  staffId: string,
  questionIds: string[],
  reviewMarks: Record<string, boolean>,
): void {
  const review = loadReviewList(storeId, staffId).filter((id) => !questionIds.includes(id))
  questionIds.forEach((id) => {
    if (reviewMarks[id]) review.push(id)
  })
  writeJson(storageKey('review', storeId, staffId), review.slice(-MAX_REVIEW))

  const recent = loadRecent(storeId, staffId).filter((id) => !questionIds.includes(id))
  writeJson(storageKey('recent', storeId, staffId), [...recent, ...questionIds].slice(-MAX_RECENT))
}

function shuffle<T>(list: T[]): T[] {
  const result = [...list]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// 復習リストの問題を1問(あれば)+ 最近出ていない問題を優先して残りを選ぶ
export function pickQuestions(
  pool: QuizQuestion[],
  count: number,
  storeId: string,
  staffId: string,
): { questions: QuizQuestion[]; reviewId: string | null } {
  const reviewId = loadReviewList(storeId, staffId).find((id) => pool.some((q) => q.id === id)) ?? null
  const recent = loadRecent(storeId, staffId)
  const rest = pool.filter((q) => q.id !== reviewId)
  const fresh = shuffle(rest.filter((q) => !recent.includes(q.id)))
  const seen = shuffle(rest.filter((q) => recent.includes(q.id)))
  const reviewQuestion = pool.find((q) => q.id === reviewId)
  const others = [...fresh, ...seen].slice(0, reviewQuestion ? count - 1 : count)
  return {
    questions: reviewQuestion ? [reviewQuestion, ...others] : others,
    reviewId: reviewQuestion ? reviewQuestion.id : null,
  }
}
