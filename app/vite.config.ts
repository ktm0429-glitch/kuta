import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig({
  // JS/CSSを外部ファイルに分けず、index.html 1枚にすべて埋め込む。
  // 「コードを貼り付ける欄」しかないホームページ編集画面でも、
  // このindex.htmlの中身をそのまま貼り付ければ動くようにするため。
  plugins: [react(), viteSingleFile()],
  base: './',
})
