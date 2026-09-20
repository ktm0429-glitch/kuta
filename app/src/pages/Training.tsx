import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getModuleById } from '../data/trainingContent'
import { loadProfile } from '../profile'
import { completeTrainingFn } from '../firebase'
import type { CompleteTrainingResponse } from '../firebase'

export default function Training() {
  const { moduleId } = useParams()
  const navigate = useNavigate()
  const profile = loadProfile()
  const module = useMemo(() => (moduleId ? getModuleById(moduleId) : undefined), [moduleId])

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

  const step = module.steps[stepIndex]
  const isLastStep = stepIndex === module.steps.length - 1

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
      const res = await completeTrainingFn({
        storeId: profile!.storeId,
        storeName: profile!.storeName,
        staffId: profile!.staffId,
        displayName: profile!.displayName,
        moduleId: module!.id,
        answers: quizAnswers,
      })
      setResult(res.data)
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
        {stepIndex + 1} / {module.steps.length}
      </p>

      {step.type === 'lesson' ? (
        <div className="lesson-card">
          <h2>{step.title}</h2>
          {step.body.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : (
        <div className="quiz-card">
          <p className="situation">{step.situation}</p>
          <p className="customer-line">お客様「{step.customerLine}」</p>
          <div className="choices">
            {step.choices.map((choice) => {
              const selected = answers[step.id] === choice.id
              const showFeedback = revealed[step.id] && selected
              return (
                <div key={choice.id}>
                  <button
                    className={`choice-button${selected ? ' selected' : ''}`}
                    onClick={() => handleChoice(step.id, choice.id)}
                    disabled={revealed[step.id]}
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
          submitting || (step.type === 'quiz' && !answers[step.id])
        }
      >
        {submitting ? '送信中...' : isLastStep ? '研修を完了する' : '次へ'}
      </button>
    </div>
  )
}
