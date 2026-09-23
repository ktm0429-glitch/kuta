import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProfile } from '../profile'
import { completeTraining, listQuestions } from '../api'
import { readCache, statusCacheKey, writeCache } from '../cache'
import type { CachedStatus } from '../cache'
import type { CompleteTrainingResponse } from '../api'
import type { AnswerScore, QuizQuestion } from '../types'
import { buildAnswerScore, buildTextAnswerScore } from '../scoring'
import { SpeechToText } from '../media/speechToText'
import { VoiceAnalyzer } from '../media/voiceAnalyzer'
import { isVoiceModeSupported, isIOS } from '../media/browserSupport'

const QUESTIONS_PER_CHALLENGE = 5
const QUESTIONS_CACHE_KEY = 'questions'
const MAX_RECORD_MS = 30000
const MIN_RECORD_MS = 3000
const MIN_TEXT_LENGTH = 2

// Fisher-Yatesシャッフル(sort+Math.randomは並びに偏りが出るため使わない)
function pickRandomQuestions(all: QuizQuestion[], count: number): QuizQuestion[] {
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, count)
}

type Phase = 'intro' | 'permission-error' | 'recording' | 'scoring' | 'result'
type AnswerMode = 'voice' | 'text'

export default function Training() {
  const navigate = useNavigate()
  const profile = loadProfile()

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loadError, setLoadError] = useState('')

  const [stepIndex, setStepIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('intro')
  // マイクで録音できる端末かどうかで、初期の回答方法を自動選択する
  // (音声認識に対応していないiPhone/iPad等では、テキスト入力に自動で切り替わる)
  const [answerMode, setAnswerMode] = useState<AnswerMode>(() =>
    isVoiceModeSupported() ? 'voice' : 'text',
  )
  const voiceCapable = isVoiceModeSupported()
  const [scores, setScores] = useState<Record<string, AnswerScore>>({})
  const [liveTranscript, setLiveTranscript] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [permissionErrorMsg, setPermissionErrorMsg] = useState('')
  const [textAnswer, setTextAnswer] = useState('')
  const [textError, setTextError] = useState('')

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
    // 前回取得した問題一覧がキャッシュにあれば、通信を待たずにすぐ出題する
    // (問題はスプレッドシート側の担当者操作でしか変わらないため、多少古くても
    // 実害はない)。裏側では常に最新の問題一覧を取得し、次回のためにキャッシュを
    // 更新する。
    const cached = readCache<QuizQuestion[]>(QUESTIONS_CACHE_KEY)
    if (cached && cached.length >= QUESTIONS_PER_CHALLENGE) {
      setQuestions(pickRandomQuestions(cached, QUESTIONS_PER_CHALLENGE))
      setLoadError('')
    } else {
      setQuestions(null)
      setLoadError('')
    }
    listQuestions()
      .then((res) => {
        if (res.questions.length < QUESTIONS_PER_CHALLENGE) {
          if (!cached) setLoadError('出題できる問題数が足りません。問題を追加してから再度お試しください。')
          return
        }
        writeCache(QUESTIONS_CACHE_KEY, res.questions)
        if (!cached) {
          setQuestions(pickRandomQuestions(res.questions, QUESTIONS_PER_CHALLENGE))
        }
      })
      .catch(() => {
        if (!cached) setLoadError('研修問題の取得に失敗しました。通信環境を確認してもう一度お試しください。')
      })
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

  function switchToTextMode() {
    stopMediaTracks()
    setAnswerMode('text')
    setPhase('intro')
    setPermissionErrorMsg('')
  }

  function switchToVoiceMode() {
    setAnswerMode('voice')
    setPhase('intro')
    setTextError('')
  }

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
          'この端末にマイクが見つかりませんでした。マイクが内蔵・接続された端末(スマホやノートPCなど)でお試しいただくか、下の「文字で回答する」をお使いください。',
        )
      } else {
        setPermissionErrorMsg(
          'マイクへのアクセスが許可されませんでした。ブラウザの設定で許可してからもう一度お試しいただくか、下の「文字で回答する」をお使いください。',
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

    const score = buildAnswerScore(currentQuestion, transcript, voiceStats, true)
    setScores((prev) => ({ ...prev, [currentQuestion.id]: score }))
    setPhase('result')
  }

  function handleStopRecording() {
    if (Date.now() - startedAtRef.current < MIN_RECORD_MS) return
    finishRecording()
  }

  function handleSubmitText() {
    const trimmed = textAnswer.trim()
    if (trimmed.length < MIN_TEXT_LENGTH) {
      setTextError('お客様に伝える言葉を入力(またはキーボードのマイクで音声入力)してください。')
      return
    }
    setTextError('')
    const score = buildTextAnswerScore(currentQuestion, trimmed)
    setScores((prev) => ({ ...prev, [currentQuestion.id]: score }))
    setTextAnswer('')
    setPhase('result')
  }

  function handleRetry() {
    setPhase('intro')
    setLiveTranscript('')
    setTextAnswer('')
    setTextError('')
  }

  async function handleNext() {
    if (!isLastStep) {
      setStepIndex((i) => i + 1)
      setPhase('intro')
      setLiveTranscript('')
      setTextAnswer('')
      setTextError('')
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
      // 研修メニューに戻った時に、古いポイント数が一瞬表示されないようにする
      if (res.success && typeof res.totalPoints === 'number') {
        writeCache<CachedStatus>(statusCacheKey(profile!.storeId, profile!.staffId), {
          points: res.totalPoints,
          awardedToday: true,
        })
      }
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

        {phase === 'intro' && answerMode === 'voice' && (
          <>
            <p className="daily-note" style={{ margin: '0 0 1rem' }}>
              下のボタンを押すと、ブラウザが「マイクの使用を許可しますか?」と聞いてきます。
              「許可」を選ぶと録音が始まります。実際にお客様に話しかけるつもりで声に出して
              答えてください。話した内容を中心に採点します(音声は保存されません)。
            </p>
            <button className="button" onClick={handleStartRecording}>
              マイクで回答する
            </button>
            <button className="link-button" onClick={switchToTextMode}>
              うまく録音できない場合は、文字で回答する
            </button>
          </>
        )}

        {phase === 'intro' && answerMode === 'text' && (
          <>
            <p className="daily-note" style={{ margin: '0 0 1rem' }}>
              お客様に話しかけるつもりで、下の欄に言葉を入力してください。
              {isIOS()
                ? ' 入力欄をタップし、キーボードのマイクのアイコンを押すと、声で入力することもできます。'
                : ' お使いの端末に音声入力機能があれば、それを使って入力することもできます。'}
            </p>
            <textarea
              className="text-answer"
              rows={4}
              maxLength={500}
              value={textAnswer}
              placeholder="お客様に話しかけるつもりで、言葉を入力してください"
              onChange={(e) => setTextAnswer(e.target.value)}
            />
            {textError && <p className="error">{textError}</p>}
            <button className="button" onClick={handleSubmitText}>
              回答する
            </button>
            {voiceCapable && (
              <button className="link-button" onClick={switchToVoiceMode}>
                マイクで話して回答する方法に切り替える
              </button>
            )}
          </>
        )}

        {phase === 'permission-error' && (
          <>
            <p className="error">{permissionErrorMsg}</p>
            <button className="button" onClick={handleStartRecording}>
              もう一度試す
            </button>
            <button className="link-button" onClick={switchToTextMode}>
              文字で回答する
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
              ✓ 回答を受け付けました。{currentScore.mode === 'voice' ? '認識された発話' : '入力された内容'}:「
              {currentScore.transcript || '(聞き取れませんでした)'}
              」
            </p>
            <div className="score-bars">
              <ScoreBar label="内容" value={currentScore.contentScore} />
              {currentScore.mode === 'voice' && (
                <ScoreBar label="声のトーン" value={currentScore.voiceScore} />
              )}
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
        <>
          <button className="button" onClick={handleNext} disabled={submitting}>
            {submitting ? '送信中...' : isLastStep ? '研修を完了する' : '次へ'}
          </button>
          <button className="link-button" onClick={handleRetry} disabled={submitting}>
            模範解答を参考に、もう一度答える
          </button>
        </>
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
