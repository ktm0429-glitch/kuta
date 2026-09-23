import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProfile } from '../profile'
import { completeTraining, listQuestions } from '../api'
import type { CompleteTrainingResponse } from '../api'
import type { AnswerScore, QuizQuestion } from '../types'
import { buildAnswerScore } from '../scoring'
import { SpeechToText, isSpeechRecognitionSupported } from '../media/speechToText'
import { VoiceAnalyzer } from '../media/voiceAnalyzer'
import { getUnsupportedReason } from '../media/browserSupport'

const QUESTIONS_PER_CHALLENGE = 5
const MAX_RECORD_MS = 30000
const MIN_RECORD_MS = 3000

function pickRandomQuestions(all: QuizQuestion[], count: number): QuizQuestion[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

type Phase = 'intro' | 'permission-error' | 'recording' | 'scoring' | 'result'

export default function Training() {
  const navigate = useNavigate()
  const profile = loadProfile()

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loadError, setLoadError] = useState('')

  const [stepIndex, setStepIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('intro')
  const [scores, setScores] = useState<Record<string, AnswerScore>>({})
  const [liveTranscript, setLiveTranscript] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [permissionErrorMsg, setPermissionErrorMsg] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CompleteTrainingResponse | null>(null)
  const [submitError, setSubmitError] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const speechRef = useRef<SpeechToText | null>(null)
  const voiceRef = useRef<VoiceAnalyzer | null>(null)
  const startedAtRef = useRef<number>(0)
  const maxTimerRef = useRef<number | null>(null)
  const tickTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    // ページを離れる時は必ずマイクを解放する
    return () => stopMediaTracks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopMediaTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current)
    if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current)
  }

  if (!profile) {
    navigate('/')
    return null
  }

  const unsupportedReason = getUnsupportedReason()
  if (unsupportedReason) {
    return (
      <div className="page">
        <h1>接客力向上トレーニング</h1>
        <p className="error">{unsupportedReason}</p>
        <button className="link-button" onClick={() => navigate('/modules')}>
          研修メニューに戻る
        </button>
      </div>
    )
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
  const currentScore = scores[currentQuestion.id]

  async function handleStartRecording() {
    setPermissionErrorMsg('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setPhase('permission-error')
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPermissionErrorMsg(
          'この端末にマイクが見つかりませんでした。マイクが内蔵・接続された端末(スマホやノートPCなど)でお試しください。',
        )
      } else {
        setPermissionErrorMsg(
          'マイクへのアクセスが許可されませんでした。ブラウザの設定で許可してから、もう一度お試しください。',
        )
      }
      return
    }

    streamRef.current = stream

    const speech = new SpeechToText()
    speech.start((full, interim) => setLiveTranscript((full + interim).trim()))
    speechRef.current = speech

    const voice = new VoiceAnalyzer()
    voice.start(stream)
    voiceRef.current = voice

    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setLiveTranscript('')
    setPhase('recording')

    tickTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current)
    }, 250)
    maxTimerRef.current = window.setTimeout(() => {
      finishRecording()
    }, MAX_RECORD_MS)
  }

  function finishRecording() {
    setPhase('scoring')
    const transcript = speechRef.current?.stop() ?? ''
    const voiceStats = voiceRef.current?.stop() ?? { avgVolume: 0, pitchStdDev: 0 }
    stopMediaTracks()

    const score = buildAnswerScore(
      currentQuestion,
      transcript,
      voiceStats,
      isSpeechRecognitionSupported(),
    )
    setScores((prev) => ({ ...prev, [currentQuestion.id]: score }))
    setPhase('result')
  }

  function handleStopRecording() {
    if (Date.now() - startedAtRef.current < MIN_RECORD_MS) return
    finishRecording()
  }

  async function handleNext() {
    if (!isLastStep) {
      setStepIndex((i) => i + 1)
      setPhase('intro')
      setLiveTranscript('')
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const quizAnswers = Object.values(scores).map((s) => ({
        quizId: s.quizId,
        passed: s.passed,
        contentScore: s.contentScore,
        voiceScore: s.voiceScore,
        transcript: s.transcript,
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

  if (result) {
    return (
      <div className="page">
        <h1>接客力向上トレーニング</h1>
        {result.success ? (
          <div className="result-card success">
            {result.alreadyCompleted ? (
              <p>お疲れ様でした!ただし、本日分の1ptはすでに獲得済みのため、追加のポイントはありません(1日1ptが上限です)。</p>
            ) : (
              <p>5問に回答しました!本日分の1ptを獲得しました。</p>
            )}
            <p>参考: 合格の目安を満たした問題数 {result.correctCount} / {result.total}</p>
            {typeof result.totalPoints === 'number' && (
              <p>現在の保有ポイント: {result.totalPoints} pt</p>
            )}
          </div>
        ) : (
          <div className="result-card retry">
            <p>
              送信は完了しましたが、ポイントの付与に失敗しました。バックエンド(Apps Script)が
              最新版になっていない可能性があります。担当者にご確認のうえ、もう一度お試しください。
            </p>
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

        {phase === 'intro' && (
          <>
            <p className="daily-note" style={{ margin: '0 0 1rem' }}>
              下のボタンを押すと、ブラウザが「マイクの使用を許可しますか?」と聞いてきます。
              「許可」を選ぶと録音が始まります。実際にお客様に話しかけるつもりで声に出して
              答えてください。話した内容を中心に採点します(音声は保存されません)。
            </p>
            <button className="button" onClick={handleStartRecording}>
              マイクで回答する
            </button>
          </>
        )}

        {phase === 'permission-error' && (
          <>
            <p className="error">{permissionErrorMsg}</p>
            <button className="button" onClick={handleStartRecording}>
              もう一度試す
            </button>
          </>
        )}

        {(phase === 'recording' || phase === 'scoring') && (
          <div className="recording-box">
            <p className="recording-indicator">
              ● 録音中です。話し終えたら下のボタンを押してください({Math.floor(elapsedMs / 1000)}秒経過)
              {phase === 'scoring' && '(採点中...)'}
            </p>
            {liveTranscript && <p className="live-transcript">認識中の発話: {liveTranscript}</p>}
            <button
              className="button"
              onClick={handleStopRecording}
              disabled={phase === 'scoring' || elapsedMs < MIN_RECORD_MS}
            >
              {phase === 'scoring'
                ? '採点中...'
                : elapsedMs < MIN_RECORD_MS
                  ? `もう少しお待ちください(あと${Math.ceil((MIN_RECORD_MS - elapsedMs) / 1000)}秒)`
                  : '回答を終える'}
            </button>
          </div>
        )}

        {phase === 'result' && currentScore && (
          <div className="score-box">
            <p className="recognized-transcript">
              ✓ 回答を受け付けました。認識された発話:「
              {currentScore.transcript || '(聞き取れませんでした)'}
              」
            </p>
            <div className="score-bars">
              <ScoreBar label="内容" value={currentScore.contentScore} />
              <ScoreBar label="声のトーン" value={currentScore.voiceScore} />
            </div>
            <p className={`overall-score${currentScore.passed ? ' pass' : ' fail'}`}>
              総合スコア: {currentScore.overallScore}点 {currentScore.passed ? '(合格)' : '(あと一歩)'}
            </p>
            {currentScore.goodPoints.length > 0 && (
              <div className="point-list good">
                <p className="point-list-title">良かった点</p>
                <ul>
                  {currentScore.goodPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {currentScore.improvePoints.length > 0 && (
              <div className="point-list improve">
                <p className="point-list-title">改善点</p>
                <ul>
                  {currentScore.improvePoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {submitError && <p className="error">{submitError}</p>}

      {phase === 'result' && (
        <button className="button" onClick={handleNext} disabled={submitting}>
          {submitting ? '送信中...' : isLastStep ? '研修を完了する' : '次へ'}
        </button>
      )}
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-bar-row">
      <span className="score-bar-label">{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${Math.max(4, value)}%` }} />
      </div>
      <span className="score-bar-value">{value}</span>
    </div>
  )
}
