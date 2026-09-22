import type { AnswerScore, QuizQuestion } from './types'

// ---- テキスト類似度(文字bigramのDice係数。日本語は分かち書きが難しいため、
//      形態素解析なしでも動く簡易な方式を採用している) ----
function bigrams(text: string): Set<string> {
  const cleaned = text.replace(/[\s、。,.!?！?「」『』()（）・\n]/g, '')
  const grams = new Set<string>()
  for (let i = 0; i < cleaned.length - 1; i++) {
    grams.add(cleaned.slice(i, i + 2))
  }
  return grams
}

function diceSimilarity(a: string, b: string): number {
  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let overlap = 0
  setA.forEach((g) => {
    if (setB.has(g)) overlap++
  })
  return (2 * overlap) / (setA.size + setB.size)
}

// 模範解答(正解の選択肢+解説)とどれだけ近い内容を話せていたかを 0-100 で採点する。
// 完全一致でなくても、近い言い回しであれば高めのスコアが出るよう緩めに増幅している。
export function scoreContent(transcript: string, question: QuizQuestion): number {
  const best = question.choices.find((c) => c.isBest)
  if (!best || !transcript.trim()) return 0
  const referenceText = `${best.label} ${best.feedback}`
  const similarity = diceSimilarity(transcript, referenceText)
  return Math.max(0, Math.min(100, Math.round(similarity * 260)))
}

export interface ExpressionSample {
  faceDetected: boolean
  smile: number // 0-1
}

export function scoreExpression(samples: ExpressionSample[]): number {
  if (samples.length === 0) return 0
  const faceRatio = samples.filter((s) => s.faceDetected).length / samples.length
  const avgSmile =
    samples.reduce((sum, s) => sum + (s.faceDetected ? s.smile : 0), 0) /
    Math.max(1, samples.filter((s) => s.faceDetected).length)
  const score = faceRatio * 40 + Math.min(1, avgSmile * 1.6) * 60
  return Math.max(0, Math.min(100, Math.round(score)))
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

const PASS_THRESHOLD = 55

export function buildAnswerScore(
  question: QuizQuestion,
  transcript: string,
  expression: ExpressionSample[],
  voice: VoiceStats,
  speechSupported: boolean,
): AnswerScore {
  const contentScore = speechSupported ? scoreContent(transcript, question) : 50
  const expressionScore = scoreExpression(expression)
  const voiceScore = scoreVoice(voice)

  const overallScore = speechSupported
    ? Math.round(contentScore * 0.5 + expressionScore * 0.25 + voiceScore * 0.25)
    : Math.round(expressionScore * 0.5 + voiceScore * 0.5)

  const best = question.choices.find((c) => c.isBest)
  const goodPoints: string[] = []
  const improvePoints: string[] = []

  if (speechSupported) {
    if (contentScore >= 55) {
      goodPoints.push(`会話の内容が良かったです。${best ? best.feedback : ''}`)
    } else {
      improvePoints.push(
        `この場面では、例えば「${best ? best.label : ''}」のような一言が効果的です。${
          best ? best.feedback : ''
        }`,
      )
    }
  } else {
    improvePoints.push(
      'このブラウザでは発話内容の自動読み取りに対応していないため、内容面は今回の採点に含まれていません(表情・声のみで判定しています)。',
    )
  }

  if (expressionScore >= 60) {
    goodPoints.push('表情が明るく、カメラにもしっかり顔が映っていました。')
  } else {
    improvePoints.push('表情が硬め、またはカメラに顔が映っていない時間が多いようです。少し口角を上げて、カメラの方を見て話してみましょう。')
  }

  if (voiceScore >= 60) {
    goodPoints.push('声の抑揚・声量がちょうど良く、聞き取りやすい話し方でした。')
  } else {
    improvePoints.push('声が単調だったり小さめだったりするようです。少しはっきりめに、抑揚をつけて話すとより伝わりやすくなります。')
  }

  return {
    quizId: question.id,
    transcript,
    contentScore,
    expressionScore,
    voiceScore,
    overallScore,
    passed: overallScore >= PASS_THRESHOLD,
    goodPoints,
    improvePoints,
  }
}
