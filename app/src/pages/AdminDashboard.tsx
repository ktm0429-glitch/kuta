import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearAdminKey,
  fetchStaffList,
  loadAdminKey,
  redeemPoints,
} from '../admin'
import type { AdminStaffRow } from '../admin'

function toCsv(rows: AdminStaffRow[]): string {
  const header = ['store_id', 'store_name', 'staff_id', 'display_name', 'points']
  const lines = rows.map((r) =>
    [r.storeId, r.storeName, r.staffId, r.displayName, r.points]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AdminStaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [redeemState, setRedeemState] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const adminKey = loadAdminKey()

  function load() {
    setLoading(true)
    setError('')
    fetchStaffList(adminKey)
      .then(setRows)
      .catch((e) => {
        if (e.message === 'unauthorized') {
          clearAdminKey()
          navigate('/admin/login')
        } else {
          setError('データの取得に失敗しました。')
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!adminKey) {
      navigate('/admin/login')
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function rowKey(r: AdminStaffRow) {
    return `${r.storeId}__${r.staffId}`
  }

  async function handleRedeem(r: AdminStaffRow) {
    const key = rowKey(r)
    const amountStr = redeemState[key]
    const amount = Number(amountStr)
    if (!Number.isInteger(amount) || amount <= 0) {
      alert('正しい交換ポイント数を入力してください。')
      return
    }
    if (amount > r.points) {
      alert('保有ポイントを超えています。')
      return
    }
    if (!confirm(`${r.displayName || r.staffId} さんの ${amount}pt を消費します。よろしいですか?`)) {
      return
    }
    setBusyKey(key)
    try {
      await redeemPoints(adminKey, r.storeId, r.staffId, amount, '景品交換')
      setRedeemState((prev) => ({ ...prev, [key]: '' }))
      load()
    } catch {
      alert('ポイント消費処理に失敗しました。')
    } finally {
      setBusyKey(null)
    }
  }

  function handleDownloadCsv() {
    const csv = toCsv(rows)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `staff_points_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page wide">
      <div className="header-row">
        <h1>スタッフ ポイント管理ダッシュボード</h1>
        <div>
          <button className="link-button" onClick={handleDownloadCsv} disabled={rows.length === 0}>
            CSVダウンロード
          </button>
          <button
            className="link-button"
            onClick={() => {
              clearAdminKey()
              navigate('/admin/login')
            }}
          >
            ログアウト
          </button>
        </div>
      </div>

      {loading && <p>読み込み中...</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>店舗</th>
              <th>スタッフID</th>
              <th>氏名</th>
              <th>保有ポイント</th>
              <th>景品交換</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(r)
              return (
                <tr key={key}>
                  <td>{r.storeName}</td>
                  <td>{r.staffId}</td>
                  <td>{r.displayName || '-'}</td>
                  <td>{r.points} pt</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={r.points}
                      placeholder="pt"
                      value={redeemState[key] ?? ''}
                      onChange={(e) =>
                        setRedeemState((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      style={{ width: '4rem', marginRight: '0.5rem' }}
                    />
                    <button
                      onClick={() => handleRedeem(r)}
                      disabled={busyKey === key || r.points === 0}
                    >
                      交換処理
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
