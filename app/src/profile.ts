export interface LoginProfile {
  storeId: string
  storeName: string
  staffId: string
  displayName: string
}

const STORAGE_KEY = 'sekkyaku-training-profile'

export function saveProfile(profile: LoginProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

export function loadProfile(): LoginProfile | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LoginProfile
  } catch {
    return null
  }
}

export function clearProfile() {
  localStorage.removeItem(STORAGE_KEY)
}
