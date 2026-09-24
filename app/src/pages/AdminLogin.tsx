import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { saveAdminKey } from '../admin'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const wrongKey = (location.state as { wrongKey?: boolean } | null)?.wrongKey === true
  const [key, setKey] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    saveAdminKey(key)
    navigate('/admin')
  }

  return (
    <div className="page">
      <h1>管理者ログイン</h1>
      <p className="lead">
        管理者用の合言葉を入力してください(店舗責任者・本部担当者向け)。
      </p>
      {wrongKey && <p className="error">合言葉が違います。もう一度入力してください。</p>}
      <form onSubmit={handleSubmit} className="form">
        <label htmlFor="admin-key">
          合言葉
          <input
            id="admin-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
        </label>
        <button type="submit">ログイン</button>
      </form>
    </div>
  )
}
