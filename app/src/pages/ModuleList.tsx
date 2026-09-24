import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loadProfile, clearProfile } from '../profile'
import { getMyStatus } from '../api'
import { readCache, statusCacheKey, writeCache } from '../cache'
import type { CachedStatus } from '../cache'
import { isVoiceModeSupported } from '../media/browserSupport'
import { loadProgress } from '../trainingStore'

export default function ModuleList() {
  const navigate = useNavigate()
  const profile = loadProfile()
  // 前回表示したポイント状況がキャッシュにあれば、通信を待たずにすぐ表示する。
  // 裏側では常に最新の状況を取得し、届き次第画面を静かに更新する。
  const cacheKey = profile ? statusCacheKey(profile.storeId, profile.staffId) : null
  const cached = cacheKey ? readCache<CachedStatus>(cacheKey) : null

  const [points, setPoints] = useState<number | null>(cached?.points ?? null)
  const [awardedToday, setAwardedToday] = useState(cached?.awardedToday ?? false)
  const [loading, setLoading] = useState(!cached)
  const [loadError, setLoadError] = useState('')
  const [inProgress] = useState(() =>
    profile ? loadProgress(profile.storeId, profile.staffId) : null,
  )

  useEffect(() => {
    if (!profile) {
      navigate('/')
      return
    }
    getMyStatus({ storeId: profile.storeId, staffId: profile.staffId })
      .then((res) => {
        setPoints(res.points)
        setAwardedToday(res.awardedToday)
        setLoadError('')
        if (cacheKey) writeCache(cacheKey, { points: res.points, awardedToday: res.awardedToday })
      })
      .catch(() => {
        if (!cached) setLoadError('現在のポイント状況を取得できませんでした。ネットワーク環境をご確認ください。')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, profile])

  if (!profile) return null

  return (
    <div className="page">
      <div className="header-row">
        <div>
          <h1>研修メニュー</h1>
          <p className="lead">
            {profile.storeName || profile.storeId} / {profile.displayName || profile.staffId} さん
          </p>
        </div>
        <button
          className="link-button"
          onClick={() => {
            clearProfile()
            navigate('/')
          }}
        >
          ログアウト
        </button>
      </div>

      <div className="points-badge">
        {loading ? '読み込み中...' : loadError ? loadError : `現在の保有ポイント: ${points} pt`}
      </div>
      {!loading && !loadError && (
        <p className="daily-note">
          {awardedToday
            ? '本日分の1ptはすでに獲得済みです。また明日挑戦してください!'
            : '研修に挑戦して5問に回答すると、本日分の1ptを獲得できます(1日1ptが上限です)。'}
        </p>
      )}

      <div className="module-card">
        <h2>接客力向上トレーニング</h2>
        <p>
          遊技中のお客様への声かけをテーマにした問題が5問出題されます(前回「復習」に入れた問題があれば、そのうち1問を含みます)。
          {isVoiceModeSupported()
            ? 'マイクに向かって声に出して回答し、5問に答えると1pt獲得です。'
            : 'お客様に話しかけるつもりで言葉を入力(キーボードのマイクで音声入力も可)して回答し、5問に答えると1pt獲得です。'}
        </p>
        <Link to="/training" className="button">
          {inProgress ? '途中の研修を再開する' : '研修に挑戦する'}
        </Link>
        {inProgress && (
          <p className="daily-note" style={{ margin: '0.75rem 0 0' }}>
            今日の研修が途中になっています({Object.keys(inProgress.scores).length} / {inProgress.questionIds.length} 問回答済み)。続きから再開できます。
          </p>
        )}
      </div>
    </div>
  )
}
