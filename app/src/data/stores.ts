export interface Store {
  id: string
  name: string
}

// 店舗マスタ。店舗を追加・削除する場合はここを編集してください。
// storeId(半角英数字)はスプレッドシート上の記録と紐づいているため、
// 一度使い始めたら変更しないでください(変えると過去のポイントと別扱いになります)。
export const stores: Store[] = [
  { id: 'store01', name: '大宮店' },
  { id: 'store02', name: '谷在家店' },
  { id: 'store03', name: '大師店' },
  { id: 'store04', name: '平野店' },
  { id: 'store05', name: '鹿浜店' },
  { id: 'store06', name: '中尾店' },
  { id: 'store07', name: '新座店' },
  { id: 'store08', name: '三芳店' },
  { id: 'store09', name: '東高円寺店' },
  { id: 'store10', name: '草加店' },
  { id: 'store11', name: '上峰店' },
  { id: 'store12', name: '蓮沼店' },
]
