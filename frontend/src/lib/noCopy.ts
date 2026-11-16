import { useEffect } from 'react'

/**
 * 마당 회원 전용 콘텐츠 복사 방지
 * - 우클릭/복사/잘라내기/드래그 차단
 * - 입력창(검색 등)에서는 키보드 단축키 허용
 */
export default function useNoCopy(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const prevent = (e: Event) => { e.preventDefault() }

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = (e.key || '').toLowerCase()
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'a', 's', 'p'].includes(k)) {
        e.preventDefault()
      }
    }

    document.addEventListener('contextmenu', prevent)
    document.addEventListener('copy', prevent)
    document.addEventListener('cut', prevent)
    document.addEventListener('dragstart', prevent)
    document.addEventListener('keydown', onKeyDown)

    const prevSelect = document.body.style.userSelect
    const prevWebkit = (document.body.style as any).webkitUserSelect
    document.body.style.userSelect = 'none'
    ;(document.body.style as any).webkitUserSelect = 'none'

    return () => {
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('copy', prevent)
      document.removeEventListener('cut', prevent)
      document.removeEventListener('dragstart', prevent)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.userSelect = prevSelect
      ;(document.body.style as any).webkitUserSelect = prevWebkit
    }
  }, [enabled])
}
