import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProfile } from '../profile'
import { completeTraining, listQuestions, sendProgress } from '../api'
import type { AnswerRecord, CompleteTrainingResponse } from '../api'
import type { AnswerScore, QuizQuestion } from '../types'
import { scoreAnswer } from '../scoring'
import type { VoiceStats } from '../scoring'
import { normalizeQuestions } from '../questions'
import { readCache, statusCacheKey, writeCache } from '../cache'
import type { CachedStatus } from '../cache'
import { defaultQuestions } from '../defaultQuestions'
import {
  clearProgress,
  loadProgress,
  newSessionId,
  pickQuestions,
  recordFinishedSession,
  saveProgress,
  todayJst,
} from '../trainingStore'
import { SpeechToText } from '../media/speechToText'
import { VoiceAnalyzer } from '../media/voiceAnalyzer'
import { isVoiceModeSupported, isIOS } from '../media/browserSupport'

const QUESTIONS_PER_CHALLENGE = 5
const QUESTIONS_CACHE_KEY = 'questions'
const MAX_RECORD_MS = 30000
const MIN_RECORD_MS = 3000
const MIN_TEXT_LENGTH = 4

type Phase = 'intro' | 'permission-error' | 'recording' | 'confirm' | 'result'
type AnswerMode = 'voice' | 'text'

interface Session {
  sessionId: string
  questions: QuizQuestion[]
  reviewId: string | null
  resumed: boolean
}

function toRecord(score: AnswerScore): AnswerRecord {
  return {
    quizId: score.quizId,
    passed: score.passed,
    contentScore: score.contentScore,
    voiceScore: score.voiceScore,
    transcript: score.transcript,
  }
}

export default function Training() {
  const navigate = useNavigate()
  const [profile] = useState(() => loadProfile())

  const [session, setSession] = useState<Session | null>(null)
  const [loadError, setLoadError] = useState('')

  const [stepIndex, setStepIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('intro')
  // マイクで録音できる端末かどうかで、初期の回答方法を自動選択する
  const [answerMode, setAnswerMode] = useState<AnswerMode>(() =>
    isVoiceModeSupported() ? 'voice' : 'text',
  )
  const voiceCapable = isVoiceModeSupported()
  const [scores, setScores] = useState<Record<string, AnswerScore>>({})
  const [reviewMarks, setReviewMarks] = useState<Record<string, boolean>>({})
  const [liveTranscript, setLiveTranscript] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [permissionErrorMsg, setPermissionErrorMsg] = useState('')
  const [textAnswer, setTextAnswer] = useState('')
  const [textError, setTextError] = useState('')
  const [recognizedEmpty, setRecognizedEmpty] = useState(false)
  const [stopping, setStopping] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CompleteTrainingResponse | null>(null)
  const [submitError, setSubmitError] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const speechRef = useRef<SpeechToText | null>(null)
  const voiceRef = useRef<VoiceAnalyzer | null>(null)
  const voiceStatsRef = useRef<VoiceStats | undefined>(undefined)
  const startedAtRef = useRef<number>(0)
  const maxTimerRef = useRef<number | null>(null)
  const tickTimerRef = useRef<number | null>(null)
  const sessionStartedRef = useRef(false)
  const poolRef = useRef<QuizQuestion[]>([])
  const sessionQuestionIdsRef = useRef<string[]>([])
  const answeredCountRef = useRef(0)
  const resumedRef = useRef(false)
  const finishingRef = useRef(false)

  // 新しい研修(5問)を始める。途中経過はリセットする
  function beginNewSession(pool: QuizQuestion[]) {
    if (!profile) return
    const { storeId, staffId } = profile
    speechRef.current?.stop()
    voiceRef.current?.stop()
    stopMediaTracks()
    clearProgress(storeId, staffId)
    const picked = pickQuestions(pool, QUESTIONS_PER_CHALLENGE, storeId, staffId)
    const sessionId = newSessionId()
    sessionQuestionIdsRef.current = picked.questions.map((q) => q.id)
    answeredCountRef.current = 0
    resumedRef.current = false
    setSession({ sessionId, questions: picked.questions, reviewId: picked.reviewId, resumed: false })
    setStepIndex(0)
    setScores({})
    setReviewMarks({})
    setPhase('intro')
    setSubmitError('')
    setLiveTranscript('')
    setTextAnswer('')
    setTextError('')
    setRecognizedEmpty(false)
    sendProgress({
      sessionId,
      storeId,
      storeName: profile.storeName,
      staffId,
      displayName: profile.displayName,
      quizIds: sessionQuestionIdsRef.current,
      answers: [],
    })
  }

  useEffect(() => {
    if (!profile) return

    // 同じ日の途中の研修が残っていれば、開始時に保存しておいた5問のまま続きから再開する
    function resumeSaved(pool: QuizQuestion[]): boolean {
      const saved = loadProgress(profile!.storeId, profile!.staffId)
      if (!saved) return false
      const questions =
        saved.questions?.length === QUESTIONS_PER_CHALLENGE
          ? saved.questions
          : saved.questionIds.map((id) => pool.find((q) => q.id === id))
      if (questions.length !== QUESTIONS_PER_CHALLENGE || !questions.every((q) => q)) return false
      const list = questions as QuizQuestion[]
      sessionQuestionIdsRef.current = saved.questionIds
      answeredCountRef.current = Object.keys(saved.scores).length
      resumedRef.current = true
      setSession({ sessionId: saved.sessionId, questions: list, reviewId: saved.reviewId, resumed: true })
      setStepIndex(saved.stepIndex)
      setScores(saved.scores)
      setReviewMarks(saved.reviewMarks)
      setPhase(saved.scores[list[saved.stepIndex].id] ? 'result' : 'intro')
      return true
    }

    function startSession(pool: QuizQuestion[]) {
      if (pool.length >= QUESTIONS_PER_CHALLENGE) poolRef.current = pool
      if (sessionStartedRef.current) return
      if (resumeSaved(pool)) {
        sessionStartedRef.current = true
        return
      }
      if (pool.length < QUESTIONS_PER_CHALLENGE) return
      sessionStartedRef.current = true
      beginNewSession(pool)
    }

    // 通信を待たずにすぐ始める。前回取得した問題一覧(なければ画面に同梱の問題)を使い、
    // 裏側で最新の問題一覧を取得して、まだ答えていない問題は最新の内容に差し替える。
    const usable = (list: unknown) => normalizeQuestions(list).filter((q) => q.checkpoints.length > 0)
    const cached = usable(readCache<unknown[]>(QUESTIONS_CACHE_KEY))
    startSession(cached.length >= QUESTIONS_PER_CHALLENGE ? cached : defaultQuestions)
    listQuestions()
      .then((res) => {
        const fresh = usable(res.questions)
        if (fresh.length < QUESTIONS_PER_CHALLENGE) {
          if (!sessionStartedRef.current) setLoadError('出題できる問題数が足りません。本社にご連絡ください。')
          return
        }
        writeCache(QUESTIONS_CACHE_KEY, res.questions)
        if (!sessionStartedRef.current) {
          startSession(fresh)
          return
        }
        poolRef.current = fresh
        // 途中から再開した研修は、開始時の5問のまま続ける
        if (resumedRef.current || answeredCountRef.current > 0) return
        // 古い問題一覧で始めていた場合: 問題がもう無ければ最新の問題で始め直し、
        // 残っていれば内容だけ最新にする(問題シートの修正をすぐ反映するため)
        const byId = new Map(fresh.map((q) => [q.id, q]))
        if (sessionQuestionIdsRef.current.some((id) => !byId.has(id))) {
          beginNewSession(fresh)
          return
        }
        setSession((prev) =>
          prev ? { ...prev, questions: prev.questions.map((q) => byId.get(q.id) ?? q) } : prev,
        )
      })
      .catch(() => {
        if (!sessionStartedRef.current) setLoadError('問題を取得できませんでした。通信を確認して再度お試しください。')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 途中経過を端末に保存する(画面を閉じても、同じ日のうちなら続きから再開できる)
  useEffect(() => {
    if (!profile || !session || result) return
    saveProgress(profile.storeId, profile.staffId, {
      sessionId: session.sessionId,
      day: todayJst(),
      questionIds: session.questions.map((q) => q.id),
      questions: session.questions,
      reviewId: session.reviewId,
      stepIndex,
      scores,
      reviewMarks,
    })
  }, [profile, session, stepIndex, scores, reviewMarks, result])

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

  useEffect(() => {
    if (!profile) navigate('/')
  }, [profile, navigate])

  if (!profile) return null

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

  if (!session) {
    return (
      <div className="page">
        <p>読み込み中...</p>
      </div>
    )
  }

  const { questions } = session
  const currentQuestion = questions[stepIndex]
  const isLastStep = stepIndex === questions.length - 1
  const currentScore = scores[currentQuestion.id]

  function resetAnswerInput() {
    setLiveTranscript('')
    setTextAnswer('')
    setTextError('')
    setRecognizedEmpty(false)
    voiceStatsRef.current = undefined
  }

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

    resetAnswerInput()
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setPhase('recording')

    tickTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current)
    }, 250)
    maxTimerRef.current = window.setTimeout(() => {
      finishRecording()
    }, MAX_RECORD_MS)
  }

  // 録音を終えたら、すぐに採点せず、認識された文章を確認・修正してもらう。
  // 音声認識は止めてから最後の言葉が届くまで少し時間がかかるため、それを待ってから表示する。
  async function finishRecording() {
    if (finishingRef.current) return
    finishingRef.current = true
    setStopping(true)
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current)
    voiceStatsRef.current = voiceRef.current?.stop()
    const transcript = (await speechRef.current?.stop()) ?? ''
    finishingRef.current = false
    setStopping(false)
    stopMediaTracks()
    setTextAnswer(transcript)
    setRecognizedEmpty(transcript.trim().length === 0)
    setTextError('')
    setPhase('confirm')
  }

  function handleStopRecording() {
    if (Date.now() - startedAtRef.current < MIN_RECORD_MS) return
    finishRecording()
  }

  function submitAnswer(mode: AnswerMode) {
    const trimmed = textAnswer.trim()
    if (trimmed.length < MIN_TEXT_LENGTH) {
      setTextError(
        mode === 'voice'
          ? '回答が空欄です。もう一度録音するか、欄に文字で入力してください。'
          : 'お客様に伝える言葉を入力(またはキーボードのマイクで音声入力)してください。',
      )
      return
    }
    const score = scoreAnswer(currentQuestion, trimmed, mode, mode === 'voice' ? voiceStatsRef.current : undefined)
    const nextScores = { ...scores, [currentQuestion.id]: score }
    answeredCountRef.current = Object.keys(nextScores).length
    setScores(nextScores)
    setReviewMarks((prev) => ({ ...prev, [currentQuestion.id]: prev[currentQuestion.id] ?? false }))
    setTextError('')
    setPhase('result')
    // 通信の回数を減らすため、途中経過は開始時と3問目の回答時だけ送る(完了時に5問分をまとめて送る)
    if (answeredCountRef.current !== 3) return
    sendProgress({
      sessionId: session!.sessionId,
      storeId: profile!.storeId,
      storeName: profile!.storeName,
      staffId: profile!.staffId,
      displayName: profile!.displayName,
      quizIds: questions.map((q) => q.id),
      answers: questions
        .filter((q) => nextScores[q.id])
        .map((q) => ({ quizId: q.id, transcript: nextScores[q.id].transcript })),
    })
  }

  function handleRetry() {
    resetAnswerInput()
    setPhase('intro')
  }

  async function handleNext() {
    if (!isLastStep) {
      setStepIndex((i) => i + 1)
      resetAnswerInput()
      setPhase('intro')
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await completeTraining({
        sessionId: session!.sessionId,
        storeId: profile!.storeId,
        storeName: profile!.storeName,
        staffId: profile!.staffId,
        displayName: profile!.displayName,
        answers: questions.map((q) => toRecord(scores[q.id])),
      })
      setResult(res)
      if (res.success) {
        clearProgress(profile!.storeId, profile!.staffId)
        recordFinishedSession(
          profile!.storeId,
          profile!.staffId,
          questions.map((q) => q.id),
          reviewMarks,
        )
        // 研修メニューに戻った時に、古いポイント数が一瞬表示されないようにする
        if (typeof res.totalPoints === 'number') {
          writeCache<CachedStatus>(statusCacheKey(profile!.storeId, profile!.staffId), {
            points: res.totalPoints,
            awardedToday: true,
          })
        }
      }
    } catch (err) {
      // サーバーからの案内(日本語)があればそのまま表示する
      const message = err instanceof Error ? err.message : ''
      setSubmitError(
        /[぀-ヿ一-龯]/.test(message) && !message.startsWith('通信に失敗')
          ? message
          : '送信に失敗しました。通信環境を確認して、もう一度「研修を完了する」を押してください(回答内容はこの端末に保存されています)。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    const reviewCount = questions.filter((q) => reviewMarks[q.id]).length
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
            {reviewCount > 0 && <p>「復習」に入れた問題は、次回の研修で1問ずつ出題されます。</p>}
            {typeof result.totalPoints === 'number' && (
              <p>現在の保有ポイント: {result.totalPoints} pt</p>
            )}
          </div>
        ) : (
          <div className="result-card retry">
            <p>
              送信は完了しましたが、ポイントの付与に失敗しました。担当者にご確認のうえ、もう一度お試しください。
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
        {currentQuestion.id === session.reviewId && <span className="review-tag">復習</span>}
      </p>
      {session.resumed && stepIndex > 0 && phase === 'intro' && (
        <p className="daily-note" style={{ margin: '-0.5rem 0 1rem' }}>
          前回の続きから再開しています。
        </p>
      )}

      <div className="quiz-card">
        <p className="situation">
          <span className="review-tag category-tag">{currentQuestion.category || '遊技延長'}</span>{' '}
          {currentQuestion.situation}
        </p>
        <p className="customer-line">
          お客様
          {/[「(（]/.test(currentQuestion.customerLine)
            ? ` ${currentQuestion.customerLine}`
            : `「${currentQuestion.customerLine}」`}
        </p>

        {phase === 'intro' && answerMode === 'voice' && (
          <>
            <p className="daily-note" style={{ margin: '0 0 1rem' }}>
              下のボタンを押すと、ブラウザが「マイクの使用を許可しますか?」と聞いてきます。
              「許可」を選ぶと録音が始まります。実際にお客様に話しかけるつもりで声に出して
              答えてください。話し終えたら、聞き取った文章を確認してから採点します(音声は保存されません)。
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
              id="text-answer"
              aria-label="回答"
              className="text-answer"
              rows={4}
              maxLength={300}
              value={textAnswer}
              placeholder="お客様に話しかけるつもりで、言葉を入力してください"
              onChange={(e) => setTextAnswer(e.target.value)}
            />
            {textError && <p className="error">{textError}</p>}
            <button className="button" onClick={() => submitAnswer('text')}>
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

        {phase === 'recording' && (
          <div className="recording-box">
            <p className="recording-indicator">
              ● 録音中です。話し終えたら下のボタンを押してください({Math.floor(elapsedMs / 1000)}秒経過)
            </p>
            {liveTranscript && <p className="live-transcript">聞き取り中: {liveTranscript}</p>}
            <button
              className="button"
              onClick={handleStopRecording}
              disabled={stopping || elapsedMs < MIN_RECORD_MS}
            >
              {stopping
                ? '聞き取り中...'
                : elapsedMs < MIN_RECORD_MS
                ? `もう少しお待ちください(あと${Math.ceil((MIN_RECORD_MS - elapsedMs) / 1000)}秒)`
                : '話し終えた'}
            </button>
          </div>
        )}

        {phase === 'confirm' && (
          <>
            {recognizedEmpty ? (
              <p className="error" style={{ marginTop: 0 }}>
                うまく聞き取れませんでした。「録り直す」を押してもう一度話すか、下の欄に文字で入力してください。
              </p>
            ) : (
              <p className="daily-note" style={{ margin: '0 0 0.75rem' }}>
                聞き取った内容です。言い間違いや、聞き取りの間違いがあれば直してから「この内容で採点する」を押してください。
              </p>
            )}
            <textarea
              id="confirm-answer"
              aria-label="聞き取った回答(修正できます)"
              className="text-answer"
              rows={4}
              maxLength={300}
              value={textAnswer}
              placeholder="話した内容をここに入力できます"
              onChange={(e) => {
                setTextAnswer(e.target.value)
                setTextError('')
              }}
            />
            {textError && <p className="error">{textError}</p>}
            <button
              className="button"
              onClick={() => submitAnswer('voice')}
              disabled={textAnswer.trim().length < MIN_TEXT_LENGTH}
            >
              この内容で採点する
            </button>
            <button className="link-button" onClick={handleStartRecording}>
              録り直す
            </button>
          </>
        )}

        {phase === 'result' && currentScore && (
          <ResultView
            question={currentQuestion}
            score={currentScore}
            reviewMarked={reviewMarks[currentQuestion.id] ?? false}
            onToggleReview={(checked) =>
              setReviewMarks((prev) => ({ ...prev, [currentQuestion.id]: checked }))
            }
          />
        )}
      </div>

      {submitError && (
        <>
          <p className="error">{submitError}</p>
          {submitError.includes('やり直') && (
            <button className="link-button" onClick={() => beginNewSession(poolRef.current)}>
              最初からやり直す
            </button>
          )}
        </>
      )}

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

function ResultView({
  question,
  score,
  reviewMarked,
  onToggleReview,
}: {
  question: QuizQuestion
  score: AnswerScore
  reviewMarked: boolean
  onToggleReview: (checked: boolean) => void
}) {
  return (
    <div className="score-box">
      <p className="recognized-transcript">
        ✓ 回答を受け付けました:「{score.transcript}」
      </p>
      <div className="score-bars">
        <ScoreBar label="内容" value={score.contentScore} />
      </div>
      <p className={`overall-score${score.passed ? ' pass' : ' fail'}`}>
        スコア: {score.contentScore}点 {score.passed ? '(合格の目安に達しました)' : '(あと一歩)'}
      </p>

      {score.ngHits.length > 0 && (
        <div className="point-list caution">
          <p className="point-list-title">注意</p>
          <p className="point-text">
            出玉や当たりを期待させる言い方(「出ますよ」「次は当たりますよ」など)、負けを取り返すよう
            あおる言い方、遊技を続けるよう直接すすめる言い方(「もう少し遊んでいってください」など)が
            含まれています。法令や業界のルール上、問題になるおそれがあるため使わないでください。
            遊技を続けてもらうのは、不便の解消や快適さの提供によってです。
          </p>
        </div>
      )}

      {score.matched.length > 0 && (
        <div className="point-list good">
          <p className="point-list-title">確認できたポイント</p>
          <ul>
            {score.matched.map((label) => (
              <li key={label}>✓ {label}</li>
            ))}
          </ul>
        </div>
      )}

      {score.missing.length > 0 && (
        <div className="point-list improve">
          <p className="point-list-title">自動では確認できなかったポイント</p>
          <ul>
            {score.missing.map((m) => (
              <li key={m.label}>
                {m.label}
                {m.example && <>(例:「{m.example}」)</>}
              </li>
            ))}
          </ul>
          <p className="point-note">言い方によっては、できていても自動では確認できないことがあります。</p>
        </div>
      )}

      <div className="point-list model">
        <p className="point-list-title">模範解答の例</p>
        <p className="point-text">{question.modelAnswer}</p>
        {question.explanation && <p className="point-text muted">{question.explanation}</p>}
        {question.ngExample && <p className="point-text muted">避けたい対応: {question.ngExample}</p>}
      </div>

      {score.voiceScore !== null && (
        <p className="voice-note">
          参考: 声の大きさ・抑揚 {score.voiceScore}点(スコアには含みません)
        </p>
      )}

      <label className="review-toggle" htmlFor={`review-${question.id}`}>
        <input
          id={`review-${question.id}`}
          type="checkbox"
          checked={reviewMarked}
          onChange={(e) => onToggleReview(e.target.checked)}
        />
        次回の研修で、この問題を復習として出題する
      </label>
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
