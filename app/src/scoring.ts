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
  // 出玉・当たり・設定を期待させる
  '出ます', '出る台', '出そう', '出やすい', 'よく出', '当たります', '当たりそう', '当たりやすい',
  'あたります', 'あたりそう', 'よく当', '次は当', 'もうすぐ当', 'よく動', '高設定', '設定がいい',
  '設定が良', '設定入', 'まだいけ', 'まだ行け', '爆発', '必ず勝てます', '絶対勝てます',
  // 負けを取り返すようあおる
  '取り返', 'とりかえせ', '取り戻せ',
  // 遊技を続けるよう直接すすめる・引き止める
  'もう少し遊んで', 'もうちょっと遊んで', 'もう少し打って', 'もうちょっと打って', 'もう少し続け',
  'まだ帰らないで', 'やめないで', '帰らないで',
  // 確約できない約束
  '空けておきます', '確保しておきます',
]
function phrasePresent(text:string,phrase:string):boolean {
 const key=normalizeText(phrase)
 if(!key)return false
 return String(text).split(/[。！？!?\n]/).some(sentence=>{
  const s=normalizeText(sentence);let from=0
  while(from<=s.length){const pos=s.indexOf(key,from);if(pos<0)return false
   const tail=s.slice(pos+key.length,pos+key.length+14)
   if(!/^(?:は|を|も|が|に)?(?:いたしません|しません|できません|出来ません|しない|できない|出来ない|不要|お断り)/.test(tail))return true
   from=pos+key.length
  }
  return false
 })
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

// 2番目の確認ポイント（解決・提案）を40点、他を各30点とする
export const PASS_THRESHOLD = 70
const NG_SCORE_CAP = 30

export function scoreAnswer(
  question: QuizQuestion,
  text: string,
  mode: 'voice' | 'text',
  voiceStats?: VoiceStats,
): AnswerScore {
  const matched: string[] = []
  const missing: { label: string; example: string }[] = []

  let contentScore: number
  if (question.checkpoints.length > 0) {
    for (const cp of question.checkpoints) {
      const hit = cp.phrases.some((p) => phrasePresent(text,p))
      if (hit) matched.push(cp.label)
      else missing.push({ label: cp.label, example: cp.phrases[0] ?? '' })
    }
    const weight = question.checkpoints.map((_,i)=>i===1?40:30)
    contentScore = Math.round(100*question.checkpoints.reduce((sum,cp,i)=>sum+(matched.includes(cp.label)?weight[i]:0),0)/weight.reduce((x,y)=>x+y,0))
  } else {
    contentScore = 0 // 基準のない問題は自動採点しない。問題シートで設定する
  }

  const ngHits = NG_PHRASES.filter((p) => phrasePresent(text,p))
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
