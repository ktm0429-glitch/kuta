// フロントエンドの src/data/trainingContent.ts に対応する採点用の正解データ。
// クイズの内容自体はフロントで管理し、ここでは「どのモジュールにどのクイズが
// 何問あり、正解の選択肢IDは何か」だけをサーバー側の正として持つ。
// フロントのコンテンツを変更した場合は、対応するクイズIDと正解IDもここに反映する。

export interface QuizAnswerKey {
  quizId: string
  correctChoiceId: string
}

export interface ModuleAnswerKey {
  moduleId: string
  quizzes: QuizAnswerKey[]
}

export const answerKeys: ModuleAnswerKey[] = [
  {
    moduleId: 'young-customer-basics',
    quizzes: [{ quizId: 'young-quiz-1', correctChoiceId: 'b' }],
  },
  {
    moduleId: 'middle-customer-conversation',
    quizzes: [{ quizId: 'middle-quiz-1', correctChoiceId: 'a' }],
  },
  {
    moduleId: 'senior-customer-conversation',
    quizzes: [
      { quizId: 'senior-quiz-1', correctChoiceId: 'b' },
      { quizId: 'senior-quiz-2', correctChoiceId: 'b' },
    ],
  },
]

export function getAnswerKey(moduleId: string): ModuleAnswerKey | undefined {
  return answerKeys.find((m) => m.moduleId === moduleId)
}
