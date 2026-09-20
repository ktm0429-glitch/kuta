import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { trainingModules } from '../data/trainingContent'
import { loadProfile, clearProfile } from '../profile'
import { getMyStatus } from '../api'

const ageBandLabel: Record<string, string> = {
  young: '20代のお客様向け',
  middle: '30〜50代のお客様向け',
  senior: '60〜70代のお客様向け',
}

export default function ModuleList() {
  const navigate = useNavigate()
  const profile = loadProfile()
  const [points, setPoints] = useState<number | null>(null)
  const [completedIds, setCompletedIds] = useState<string[]>([])
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
        setCompletedIds(res.completedModuleIds)
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

      <ul className="module-list">
        {trainingModules.map((m) => {
          const done = completedIds.includes(m.id)
          return (
            <li key={m.id} className="module-card">
              <div className="module-card-header">
                <span className="age-band-tag">{ageBandLabel[m.ageBand]}</span>
                {done && <span className="done-tag">完了済み</span>}
              </div>
              <h2>{m.title}</h2>
              <p>{m.summary}</p>
              <Link to={`/training/${m.id}`} className="button">
                {done ? 'もう一度学ぶ' : 'この研修をはじめる'}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
