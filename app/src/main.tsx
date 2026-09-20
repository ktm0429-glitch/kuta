import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// 既存ホームページの任意のフォルダにアップロードして使えるよう、
// サーバー側のリライト設定(.htaccess等)が不要なHashRouterを使う。
// URLは https://example.com/training/#/modules のような形になる。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
