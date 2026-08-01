import { useState, useEffect, useCallback } from 'react'

const ALL_KEYS = [
  'member_info', 'tongbot', 'todo_memo', 'location', 'dashboard',
  'appointments', 'bot_activity', 'points', 'friends_messages',
  'posts', 'photos',
]

export function useBlockOrder(page: 'profile' | 'intro' = 'profile') {
  const [order, setOrder] = useState<string[]>(ALL_KEYS)
  const [introEnabled, setIntroEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const lsKey = `yp_block_order_${page}`
    const cached = localStorage.getItem(lsKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOrder(parsed)
        }
      } catch {}
    }

    fetch('/api/user/block-order', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const serverOrder = page === 'intro' ? d.intro : d.profile
        if (Array.isArray(serverOrder) && serverOrder.length > 0) {
          setOrder(serverOrder)
          localStorage.setItem(lsKey, JSON.stringify(serverOrder))
        }
        if (typeof d.intro_enabled === 'boolean') {
          setIntroEnabled(d.intro_enabled)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [page])

  const saveOrder = useCallback((newOrder: string[]) => {
    setOrder(newOrder)
    const lsKey = `yp_block_order_${page}`
    localStorage.setItem(lsKey, JSON.stringify(newOrder))
    fetch('/api/user/block-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ page, order: newOrder }),
    }).catch(() => {})
  }, [page])

  const toggleIntro = useCallback((enabled: boolean) => {
    setIntroEnabled(enabled)
    fetch('/api/user/intro-page/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    }).catch(() => {})
  }, [])

  return { order, saveOrder, introEnabled, toggleIntro, loaded, ALL_KEYS }
}
