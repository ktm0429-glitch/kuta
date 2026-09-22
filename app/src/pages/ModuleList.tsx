import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loadProfile, clearProfile } from '../profile'
import { getMyStatus } from '../api'

export default function ModuleList() {
  const navigate = useNavigate()
  const profile = loadProfile()
  const [points, setPoints] = useState<number | null>(null)
  const [awardedToday, setAwardedToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!profile) {
      navigate('/')
      return
    }
    getMyStatus({ storeId: profile.storeId, staffId: profile.staffId })
      .then((res) => {
        setPoints(res.points)
        setAwardedToday(res.awardedToday)
      })
      .catch(() => setLoadError('現在のポイント状況を取得できませんでした。ネットワーク環境をご確認ください。'))
      .finally(() => setLoading(false))
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
            : '研修に挑戦して5問すべて合格基準を満たすと、本日分の1ptを獲得できます(1日1ptが上限です)。'}
        </p>
      )}

      <div className="module-card">
        <h2>接客力向上トレーニング</h2>
        <p>
          お客様との会話をテーマにした問題が、全体の中からランダムに5問出題されます。
          マイクに向かって声に出して回答し、5問すべてで合格基準を満たすと1pt獲得です。
        </p>
        <Link to="/training" className="button">
          研修に挑戦する
        </Link>
      </div>
    </div>
  )
}
