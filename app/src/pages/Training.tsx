import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProfile } from '../profile'
import { completeTraining, listQuestions } from '../api'
import type { CompleteTrainingResponse } from '../api'
import type { QuizQuestion } from '../types'

const QUESTIONS_PER_CHALLENGE = 5

function pickRandomQuestions(all: QuizQuestion[], count: number): QuizQuestion[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

export default function Training() {
  const navigate = useNavigate()
  const profile = loadProfile()

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loadError, setLoadError] = useState('')

  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CompleteTrainingResponse | null>(null)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    setQuestions(null)
    setLoadError('')
    listQuestions()
      .then((res) => {
        if (res.questions.length < QUESTIONS_PER_CHALLENGE) {
          setLoadError('出題できる問題数が足りません。問題を追加してから再度お試しください。')
          return
        }
        setQuestions(pickRandomQuestions(res.questions, QUESTIONS_PER_CHALLENGE))
      })
      .catch(() => setLoadError('研修問題の取得に失敗しました。通信環境を確認してもう一度お試しください。'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!profile) {
    navigate('/')
    return null
  }

  if (loadError) {
    return (
      <div className="page">
        <p className="error">{loadError}</p>
        <button className="link-button" onClick={() => navigate('/modules')}>
          研修メニューに戻る
        </button>
      </div>
    )
  }

  if (!questions) {
    return (
      <div className="page">
        <p>読み込み中...</p>
      </div>
    )
  }

  const currentQuestion = questions[stepIndex]
  const isLastStep = stepIndex === questions.length - 1

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
    setQuestions(null)
    listQuestions()
      .then((res) => setQuestions(pickRandomQuestions(res.questions, QUESTIONS_PER_CHALLENGE)))
      .catch(() => setLoadError('研修問題の取得に失敗しました。通信環境を確認してもう一度お試しください。'))
  }

  if (result) {
    return (
      <div className="page">
        <h1>接客力向上トレーニング</h1>
        {result.success ? (
          <div className="result-card success">
            {result.alreadyCompleted ? (
              <p>お疲れ様でした!ただし、本日分の1ptはすでに獲得済みのため、追加のポイントはありません(1日1ptが上限です)。</p>
            ) : (
              <p>5問すべて正解しました!本日分の1ptを獲得しました。</p>
            )}
            <p>正解数: {result.correctCount} / {result.total}</p>
            {typeof result.totalPoints === 'number' && (
              <p>現在の保有ポイント: {result.totalPoints} pt</p>
            )}
          </div>
        ) : (
          <div className="result-card retry">
            <p>
              惜しい!正解数 {result.correctCount} / {result.total} でした。5問すべて正解でポイント獲得です。もう一度挑戦してください。
            </p>
            <button onClick={handleRetry}>もう一度挑戦する</button>
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
      <h1>接客力向上トレーニング</h1>
      <p className="step-indicator">
        {stepIndex + 1} / {questions.length}
      </p>

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

      {submitError && <p className="error">{submitError}</p>}

      <button
        className="button"
        onClick={handleNext}
        disabled={submitting || !answers[currentQuestion.id]}
      >
        {submitting ? '送信中...' : isLastStep ? '研修を完了する' : '次へ'}
      </button>
    </div>
  )
}
