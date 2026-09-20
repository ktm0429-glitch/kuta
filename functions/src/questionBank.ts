// app/src/data/questionBank.ts の採点用ミラー。
//
// ■ 新しい問題を追加したとき
// app 側に問題オブジェクトを追加したら、ここに
// { id, ageBand, correctChoiceId } を1行追加すること。
// 問題文や選択肢の文言はここには置かない(採点にのみ使うため)。

export type AgeBand = 'young' | 'middle' | 'senior'

interface AnswerKeyEntry {
  id: string
  ageBand: AgeBand
  correctChoiceId: string
}

export const answerKeyEntries: AnswerKeyEntry[] = [
  // young
  { id: 'young-01', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-02', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-03', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-04', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-05', ageBand: 'young', correctChoiceId: 'a' },
  { id: 'young-06', ageBand: 'young', correctChoiceId: 'a' },
  // middle
  { id: 'middle-01', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-02', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-03', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-04', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-05', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-06', ageBand: 'middle', correctChoiceId: 'a' },
  { id: 'middle-07', ageBand: 'middle', correctChoiceId: 'a' },
  // senior
  { id: 'senior-01', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-02', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-03', ageBand: 'senior', correctChoiceId: 'b' },
  { id: 'senior-04', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-05', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-06', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-07', ageBand: 'senior', correctChoiceId: 'a' },
  { id: 'senior-08', ageBand: 'senior', correctChoiceId: 'a' },
]

// モジュールID(app/src/data/trainingContent.ts と一致させること)と年代の対応。
// 新しい年代区分のモジュールを追加したときはここにも追記する。
const MODULE_AGE_BAND: Record<string, AgeBand> = {
  'young-customer-basics': 'young',
  'middle-customer-conversation': 'middle',
  'senior-customer-conversation': 'senior',
}

export interface ModuleAnswerKey {
  moduleId: string
  quizzes: { quizId: string; correctChoiceId: string }[]
}

export function getAnswerKey(moduleId: string): ModuleAnswerKey | undefined {
  const ageBand = MODULE_AGE_BAND[moduleId]
  if (!ageBand) return undefined
  const quizzes = answerKeyEntries
    .filter((q) => q.ageBand === ageBand)
    .map((q) => ({ quizId: q.id, correctChoiceId: q.correctChoiceId }))
  return { moduleId, quizzes }
}
