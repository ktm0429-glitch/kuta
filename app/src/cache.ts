// 通信時間短縮のための簡易キャッシュ(stale-while-revalidate)。
// 前回取得した値を端末内(localStorage)に保存しておき、次回はまずそれを
// 即座に表示し、裏側で最新のデータを取得してキャッシュを更新する。

const PREFIX = 'kuta-cache:'

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export interface CachedStatus {
  points: number
  awardedToday: boolean
}

export function statusCacheKey(storeId: string, staffId: string): string {
  return `status:${storeId}:${staffId}`
}

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 端末側でlocalStorageが使えない場合は、キャッシュなしで動作を継続する
  }
}
