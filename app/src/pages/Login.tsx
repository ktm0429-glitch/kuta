import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveProfile } from '../profile'

export default function Login() {
  const navigate = useNavigate()
  const [storeId, setStoreId] = useState('')
  const [storeName, setStoreName] = useState('')
  const [staffId, setStaffId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')

  const idPattern = /^[A-Za-z0-9_-]{1,64}$/

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!idPattern.test(storeId) || !idPattern.test(staffId)) {
      setError('店舗IDとスタッフIDは半角英数字・ハイフン・アンダースコアのみで入力してください。')
      return
    }
    saveProfile({ storeId, storeName, staffId, displayName })
    navigate('/modules')
  }

  return (
    <div className="page">
      <h1>接客力向上トレーニング</h1>
      <p className="lead">
        店舗IDとスタッフIDを入力してスタートしてください。研修を最後まで終えると1ptを獲得できます。
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          店舗ID(店舗から配布されたID)
          <input
            value={storeId}
            onChange={(e) => setStoreId(e.target.value.trim())}
            placeholder="例: store01"
            required
          />
        </label>
        <label>
          店舗名(任意)
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="例: 〇〇店"
          />
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
        <button type="submit">はじめる</button>
      </form>
    </div>
  )
}
