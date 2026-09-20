import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveProfile } from '../profile'
import { registerStaffFn } from '../firebase'
import { stores } from '../data/stores'

export default function Login() {
  const navigate = useNavigate()
  const [storeId, setStoreId] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
      await registerStaffFn({
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
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? '登録中...' : 'はじめる'}
        </button>
      </form>
    </div>
  )
}
