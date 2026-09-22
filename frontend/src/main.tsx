import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 공유마당 오프라인 대기열 백그라운드 전송용 Service Worker (캐싱 없음, sync 전용)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 미지원/실패 무시 — 페이지 폴백 동작 */ })
  })
}
