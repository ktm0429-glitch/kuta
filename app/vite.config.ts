import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 既存のホームページのサブディレクトリ(例: https://example.com/training/)に
  // そのまま配置できるよう、生成されるHTMLからJS/CSSを相対パスで参照する。
  base: './',
})
