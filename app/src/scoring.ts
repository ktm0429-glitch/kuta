import type { AnswerScore, QuizQuestion } from './types'

// 表記ゆれを減らすため、全角半角・カタカナ/ひらがな・記号・空白の違いをそろえる
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。,.!?「」『』()・…~〜"'“”:;]/g, '')
}

// 出玉や当たりを期待させる・負けを取り返すようあおる・遊技を続けるよう直接せかす表現。
// 法令や業界ルール(のめり込み防止を含む)上問題になるおそれがあるため、
// 回答に含まれていたら注意を出し、合格の目安にしない。
export const NG_PHRASES = [
  '出ます', '出る台', '出そう', '出やすい', 'よく出', '当たります', '当たりそう', '当たりやすい',
  'あたります', 'あたりそう', 'よく当', '次は当', 'もうすぐ当', 'よく動', '高設定', '設定がいい',
  '設定が良', '設定入', 'まだいけ', 'まだ行け', '取り返', 'とりかえせ', '爆発',
  'もう少し遊んで', 'もうちょっと遊んで', 'もう少し打って', 'もうちょっと打って', 'もう少し続け',
  'まだ帰らないで', 'やめないで', '帰らないで',
]

// ---- 確認ポイントが登録されていない問題用の予備の採点 ----
// (文字2つずつの組の重なり具合で、模範解答との近さを見る簡易的な方法)
function bigrams(text: string): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}

function diceSimilarity(a: string, b: string): number {
  const setA = bigrams(normalizeText(a))
  const setB = bigrams(normalizeText(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let overlap = 0
  setA.forEach((g) => {
    if (setB.has(g)) overlap++
  })
  return (2 * overlap) / (setA.size + setB.size)
}

function similarityToModel(text: string, modelAnswer: string): number {
  const spoken = [...modelAnswer.matchAll(/「([^」]+)」/g)].map((m) => m[1])
  return Math.max(...[modelAnswer, ...spoken].map((r) => diceSimilarity(text, r)))
}

export interface VoiceStats {
  avgVolume: number // 0-1 目安のRMS平均
  pitchStdDev: number // Hz。声の抑揚(ばらつき)
}

export function scoreVoice(stats: VoiceStats): number {
  // 小さすぎず・うるさすぎない声量: 0.04〜0.35あたりを良好とみなす
  const volumeScore =
    stats.avgVolume < 0.015
      ? (stats.avgVolume / 0.015) * 50
      : Math.max(0, 100 - Math.abs(stats.avgVolume - 0.15) * 220)
  // 抑揚(ピッチの標準偏差)。棒読みに近いほど低い値になる
  const pitchScore = Math.min(100, (stats.pitchStdDev / 35) * 100)
  const score = volumeScore * 0.45 + pitchScore * 0.55
  return Math.max(0, Math.min(100, Math.round(score)))
}

// 確認ポイントが3つなら2つ以上、2つなら2つとも確認できれば合格の目安
export const PASS_THRESHOLD = 60
const NG_SCORE_CAP = 30

export function scoreAnswer(
  question: QuizQuestion,
  text: string,
  mode: 'voice' | 'text',
  voiceStats?: VoiceStats,
): AnswerScore {
  const normalized = normalizeText(text)
  const matched: string[] = []
  const missing: { label: string; example: string }[] = []

  let contentScore: number
  if (question.checkpoints.length > 0) {
    for (const cp of question.checkpoints) {
      const hit = cp.phrases.some((p) => {
        const np = normalizeText(p)
        return np !== '' && normalized.includes(np)
      })
      if (hit) matched.push(cp.label)
      else missing.push({ label: cp.label, example: cp.phrases[0] ?? '' })
    }
    contentScore = Math.round((100 * matched.length) / question.checkpoints.length)
  } else {
    contentScore = Math.min(100, Math.round(similarityToModel(text, question.modelAnswer) * 200))
  }

  const ngHits = NG_PHRASES.filter((p) => normalized.includes(normalizeText(p)))
  if (ngHits.length > 0) contentScore = Math.min(contentScore, NG_SCORE_CAP)

  return {
    quizId: question.id,
    transcript: text,
    contentScore,
    voiceScore: mode === 'voice' && voiceStats ? scoreVoice(voiceStats) : null,
    passed: ngHits.length === 0 && contentScore >= PASS_THRESHOLD,
    matched,
    missing,
    ngHits,
    mode,
  }
}
