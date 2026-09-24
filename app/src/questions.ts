import type { AgeBand, Checkpoint, QuizQuestion } from './types'

interface LegacyChoice {
  label?: string
  isBest?: boolean
  feedback?: string
}

// サーバーから届いた問題を、アプリで使う形にそろえる。
// 以前の形式(選択肢1〜3に正解の○を付ける形式)で届いた場合も、
// 正解の選択肢を模範解答として扱い、文章の近さで採点する形に変換する。
export function normalizeQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  const id = typeof q.id === 'string' ? q.id : ''
  const situation = typeof q.situation === 'string' ? q.situation : ''
  if (!id || !situation) return null
  const base = {
    id,
    ageBand: (q.ageBand as AgeBand) ?? 'middle',
    situation,
    category: q.category === '判断の境界' ? '判断の境界' as const : '遊技延長' as const,
    customerLine: typeof q.customerLine === 'string' ? q.customerLine : '',
  }

  if (typeof q.modelAnswer === 'string') {
    const checkpoints = Array.isArray(q.checkpoints)
      ? (q.checkpoints as Checkpoint[]).filter(
          (c) => c && typeof c.label === 'string' && Array.isArray(c.phrases) && c.phrases.length > 0,
        )
      : []
    return {
      ...base,
      modelAnswer: q.modelAnswer,
      checkpoints,
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
      ngExample: typeof q.ngExample === 'string' ? q.ngExample : '',
    }
  }

  if (Array.isArray(q.choices)) {
    const choices = q.choices as LegacyChoice[]
    const best = choices.find((c) => c.isBest)
    if (!best?.label) return null
    return {
      ...base,
      modelAnswer: best.label,
      checkpoints: [],
      explanation: (best.feedback ?? '').replace(/^(正解です|不正解です)[。.]?\s*/, ''),
      ngExample: choices
        .filter((c) => !c.isBest && c.label)
        .map((c) => c.label)
        .join('/'),
    }
  }
  return null
}

export function normalizeQuestions(list: unknown): QuizQuestion[] {
  if (!Array.isArray(list)) return []
  return list.map(normalizeQuestion).filter((q): q is QuizQuestion => q !== null)
}
