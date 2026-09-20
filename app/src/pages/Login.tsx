import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveProfile } from '../profile'
import { registerStaffFn } from '../firebase'
import { stores } from '../data/stores'

export default function Login() {
  const navigate = useNavigate()
  const [storeId, setStoreId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const idPattern = /^[A-Za-z0-9_-]{1,64}$/

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!storeId) {
      setError('店舗を選択してください。')
      return
    }
    if (!idPattern.test(staffId)) {
      setError('スタッフIDは半角英数字・ハイフン・アンダースコアのみで入力してください。')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const store = stores.find((s) => s.id === storeId)
      const storeName = store?.name ?? storeId
      await registerStaffFn({ storeId, storeName, staffId, displayName })
      saveProfile({ storeId, storeName, staffId, displayName })
      navigate('/modules')
    } catch {
      setError('IDの登録に失敗しました。通信環境を確認してもう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>接客力向上トレーニング</h1>
      <p className="lead">
        店舗を選択し、スタッフIDを入力してスタートしてください。研修を最後まで終えると1ptを獲得できます。
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
          スタッフID(社員番号など)
          <input
            value={staffId}
            onChange={(e) => setStaffId(e.target.value.trim())}
            placeholder="例: A1234"
            required
          />
        </label>
        <label>
          お名前(任意・ニックネーム可)
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: たなか"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? '登録中...' : 'はじめる'}
        </button>
      </form>
    </div>
  )
}
