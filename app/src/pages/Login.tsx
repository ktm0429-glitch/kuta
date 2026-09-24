import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProfile, saveProfile } from '../profile'
import { registerStaff } from '../api'
import { stores } from '../data/stores'

export default function Login() {
  const navigate = useNavigate()
  const [storeId, setStoreId] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 一度登録したスタッフは、次回以降はログイン画面を出さず
  // 研修メニューに直接進む(端末に登録情報が残っている間のみ)。
  useEffect(() => {
    if (loadProfile()) {
      navigate('/modules', { replace: true })
    }
  }, [navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!storeId) {
      setError('店舗を選択してください。')
      return
    }
    const trimmedName = fullName.trim()
    if (!trimmedName) {
      setError('お名前(フルネーム)を入力してください。')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const store = stores.find((s) => s.id === storeId)
      const storeName = store?.name ?? storeId
      await registerStaff({
        storeId,
        storeName,
        staffId: trimmedName,
        displayName: trimmedName,
      })
      saveProfile({ storeId, storeName, staffId: trimmedName, displayName: trimmedName })
      navigate('/modules')
    } catch {
      setError('登録に失敗しました。通信環境を確認してもう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadProfile()) {
    return null
  }

  return (
    <div className="page">
      <h1>接客力向上トレーニング</h1>
      <p className="lead">
        店舗を選択し、お名前(フルネーム)を入力してスタートしてください。研修を最後まで終えると1ptを獲得できます。
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          店舗
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            required
          >
            <option value="" disabled>
              選択してください
            </option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          お名前(フルネーム)
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="例: 山田 太郎"
            required
          />
        </label>
        <p className="daily-note" style={{ margin: 0 }}>
          機種変更などで別の端末から使うときも、同じ店舗・同じお名前を入力すれば、
          これまでのポイントがそのまま引き継がれます。
        </p>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? '登録中...' : 'はじめる'}
        </button>
      </form>
    </div>
  )
}
