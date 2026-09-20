import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getModuleById, getModuleQuestions } from '../data/trainingContent'
import { loadProfile } from '../profile'
import { completeTraining } from '../api'
import type { CompleteTrainingResponse } from '../api'

export default function Training() {
  const { moduleId } = useParams()
  const navigate = useNavigate()
  const profile = loadProfile()
  const module = useMemo(() => (moduleId ? getModuleById(moduleId) : undefined), [moduleId])
  const questions = useMemo(() => (module ? getModuleQuestions(module) : []), [module])

  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CompleteTrainingResponse | null>(null)
  const [submitError, setSubmitError] = useState('')

  if (!profile) {
    navigate('/')
    return null
  }
  if (!module) {
    return (
      <div className="page">
        <p>研修が見つかりませんでした。</p>
      </div>
    )
  }

  // ステップ0は解説(tip)、以降は questions を1問ずつ表示する
  const totalSteps = 1 + questions.length
  const isLessonStep = stepIndex === 0
  const currentQuestion = isLessonStep ? undefined : questions[stepIndex - 1]
  const isLastStep = stepIndex === totalSteps - 1

  function handleChoice(quizId: string, choiceId: string) {
    setAnswers((prev) => ({ ...prev, [quizId]: choiceId }))
    setRevealed((prev) => ({ ...prev, [quizId]: true }))
  }

  async function handleNext() {
    if (!isLastStep) {
      setStepIndex((i) => i + 1)
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const quizAnswers = Object.entries(answers).map(([quizId, choiceId]) => ({
        quizId,
        choiceId,
      }))
      const res = await completeTraining({
        storeId: profile!.storeId,
        storeName: profile!.storeName,
        staffId: profile!.staffId,
        displayName: profile!.displayName,
        moduleId: module!.id,
        answers: quizAnswers,
      })
      setResult(res)
    } catch {
      setSubmitError('送信に失敗しました。通信環境を確認してもう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  function handleRetry() {
    setResult(null)
    setStepIndex(0)
    setAnswers({})
    setRevealed({})
  }

  if (result) {
    return (
      <div className="page">
        <h1>{module.title}</h1>
        {result.success ? (
          <div className="result-card success">
            {result.alreadyCompleted ? (
              <p>この研修はすでに完了済みです。ポイントは付与済みのため、追加のポイントはありません。</p>
            ) : (
              <p>研修を完了しました!1pt獲得しました。</p>
            )}
            <p>正解数: {result.correctCount} / {result.total}</p>
            {typeof result.totalPoints === 'number' && (
              <p>現在の保有ポイント: {result.totalPoints} pt</p>
            )}
          </div>
        ) : (
          <div className="result-card retry">
            <p>
              惜しい!正解数 {result.correctCount} / {result.total} でした。もう一度学び直してから再挑戦してください。
            </p>
            <button onClick={handleRetry}>もう一度学ぶ</button>
          </div>
        )}
        <button className="link-button" onClick={() => navigate('/modules')}>
          研修メニューに戻る
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>{module.title}</h1>
      <p className="step-indicator">
        {stepIndex + 1} / {totalSteps}
      </p>

      {isLessonStep || !currentQuestion ? (
        <div className="lesson-card">
          <h2>ポイント</h2>
          <p>{module.tip}</p>
        </div>
      ) : (
        <div className="quiz-card">
          <p className="situation">{currentQuestion.situation}</p>
          <p className="customer-line">お客様「{currentQuestion.customerLine}」</p>
          <div className="choices">
            {currentQuestion.choices.map((choice) => {
              const selected = answers[currentQuestion.id] === choice.id
              const showFeedback = revealed[currentQuestion.id] && selected
              return (
                <div key={choice.id}>
                  <button
                    className={`choice-button${selected ? ' selected' : ''}`}
                    onClick={() => handleChoice(currentQuestion.id, choice.id)}
                    disabled={revealed[currentQuestion.id]}
                  >
                    {choice.label}
                  </button>
                  {showFeedback && (
                    <p className={`feedback${choice.isBest ? ' best' : ''}`}>
                      {choice.feedback}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {submitError && <p className="error">{submitError}</p>}

      <button
        className="button"
        onClick={handleNext}
        disabled={
          submitting || (!!currentQuestion && !answers[currentQuestion.id])
        }
      >
        {submitting ? '送信中...' : isLastStep ? '研修を完了する' : '次へ'}
      </button>
    </div>
  )
}
