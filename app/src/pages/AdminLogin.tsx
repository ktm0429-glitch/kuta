import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveAdminKey } from '../admin'

export default function AdminLogin() {
  const navigate = useNavigate()
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
        管理者用アクセスキーを入力してください(店舗責任者・本部担当者向け)。
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          アクセスキー
          <input
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
