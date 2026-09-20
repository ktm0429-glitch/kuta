export interface Store {
  id: string
  name: string
}

// 店舗マスタ。実際の店舗名・店舗IDに差し替えてください。
// storeIdは半角英数字・ハイフン・アンダースコアのみ使用できます。
export const stores: Store[] = [
  { id: 'store01', name: '〇〇店' },
  { id: 'store02', name: '△△店' },
  { id: 'store03', name: '□□店' },
]
