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

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const region = 'asia-northeast1'

function functionsBaseUrl(): string {
  return `https://${region}-${projectId}.cloudfunctions.net`
}

export interface AdminStaffRow {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
  points: number
}

export async function fetchStaffList(adminKey: string): Promise<AdminStaffRow[]> {
  const res = await fetch(`${functionsBaseUrl()}/adminListStaff`, {
    headers: { 'x-admin-key': adminKey },
  })
  if (res.status === 401) {
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    throw new Error('failed to fetch')
  }
  const data = await res.json()
  return data.staff as AdminStaffRow[]
}

export async function redeemPoints(
  adminKey: string,
  storeId: string,
  staffId: string,
  amount: number,
  note: string,
): Promise<number> {
  const res = await fetch(`${functionsBaseUrl()}/adminRedeemPoints`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storeId, staffId, amount, note }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error ?? 'failed to redeem')
  }
  return data.totalPoints as number
}
