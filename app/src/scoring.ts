import type { AnswerScore, QuizQuestion } from './types'

// ---- テキスト類似度(文字bigramのDice係数。日本語は分かち書きが難しいため、
//      形態素解析なしでも動く簡易な方式を採用している) ----
function bigrams(text: string): Set<string> {
  const cleaned = text.replace(/[\s、。,.!?！？「」『』()（）・\n]/g, '')
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

// 内容(発話の中身)を重視し、声のトーンは補助的な位置づけにする
const CONTENT_WEIGHT = 0.75
const VOICE_WEIGHT = 0.25
const PASS_THRESHOLD = 55
// 内容だけで合格ラインに届いていれば、声のトーンが多少弱くても合格にする
// (「内容が正しければ通したい」という運用方針のため)
const CONTENT_ONLY_PASS_THRESHOLD = 70

function contentFeedback(question: QuizQuestion, contentScore: number): {
  good: string[]
  improve: string[]
} {
  const best = question.choices.find((c) => c.isBest)
  if (contentScore >= 55) {
    return { good: [`会話の内容が良かったです。${best ? best.feedback : ''}`], improve: [] }
  }
  return {
    good: [],
    // best.feedback は「正解を選んだ人向けの解説」として書かれているため、
    // ここに混ぜると「正解です」等の文言が低い点数と矛盾して見えてしまう。
    // そのため改善点では模範解答の言い回し(label)のみを提示する。
    improve: [`この場面では、例えば「${best ? best.label : ''}」のような一言が効果的です。`],
  }
}

export function buildAnswerScore(
  question: QuizQuestion,
  transcript: string,
  voice: VoiceStats,
  speechSupported: boolean,
): AnswerScore {
  const contentScore = speechSupported ? scoreContent(transcript, question) : 0
  const voiceScore = scoreVoice(voice)

  const overallScore = Math.round(contentScore * CONTENT_WEIGHT + voiceScore * VOICE_WEIGHT)

  const content = contentFeedback(question, contentScore)
  const goodPoints = [...content.good]
  const improvePoints = [...content.improve]

  if (voiceScore >= 60) {
    goodPoints.push('声の抑揚・声量がちょうど良く、聞き取りやすい話し方でした。')
  } else {
    improvePoints.push('声が単調だったり小さめだったりするようです。少しはっきりめに、抑揚をつけて話すとより伝わりやすくなります。')
  }

  const passed = overallScore >= PASS_THRESHOLD || contentScore >= CONTENT_ONLY_PASS_THRESHOLD

  return {
    quizId: question.id,
    transcript,
    contentScore,
    voiceScore,
    overallScore,
    passed,
    goodPoints,
    improvePoints,
    mode: 'voice',
  }
}

// テキスト入力での回答(音声認識非対応ブラウザ向けの代替手段)を採点する。
// 声のトーンは評価しようがないため、内容スコアのみで合否を判定する。
export function buildTextAnswerScore(question: QuizQuestion, text: string): AnswerScore {
  const contentScore = scoreContent(text, question)
  const content = contentFeedback(question, contentScore)

  return {
    quizId: question.id,
    transcript: text,
    contentScore,
    voiceScore: 0,
    overallScore: contentScore,
    passed: contentScore >= PASS_THRESHOLD,
    goodPoints: content.good,
    improvePoints: content.improve,
    mode: 'text',
  }
}
