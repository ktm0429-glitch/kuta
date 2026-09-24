import { API_URL } from './config'

const ADMIN_KEY_STORAGE = 'sekkyaku-training-admin-key'

export function saveAdminKey(key: string) {
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key)
}

export function loadAdminKey(): string {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? ''
}

export function clearAdminKey() {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE)
}

export interface AdminStaffRow {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
  points: number
}

export async function fetchStaffList(adminKey: string): Promise<AdminStaffRow[]> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'adminList', adminKey }),
  })
  if (!res.ok) {
    throw new Error('failed to fetch')
  }
  const data = await res.json()
  if (data.error === 'unauthorized') {
    throw new Error('unauthorized')
  }
  if (data.error) {
    throw new Error(data.error)
  }
  return data.staff as AdminStaffRow[]
}

export async function redeemPoints(
  adminKey: string,
  storeId: string,
  staffId: string,
  amount: number,
  note: string,
): Promise<number> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'adminRedeem', adminKey, storeId, staffId, amount, note }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error ?? 'failed to redeem')
  }
  return data.totalPoints as number
}

export interface AdminSessionRow {
  storeId: string
  storeName: string
  displayName: string
  startedAt: string
  answered: number
  total: number
  updatedAt: string
  status: '完了' | '途中'
}

// 直近7日間の研修の取り組み状況(途中でやめた人も含む)。
// サーバーのコードが古く未対応の場合は空の一覧を返す。
export async function fetchSessions(adminKey: string): Promise<AdminSessionRow[]> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'adminSessions', adminKey }),
  })
  if (!res.ok) throw new Error('failed to fetch')
  const data = await res.json()
  if (data.error === 'unauthorized') throw new Error('unauthorized')
  if (data.error) return []
  return (data.sessions ?? []) as AdminSessionRow[]
}
