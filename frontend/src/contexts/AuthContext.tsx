import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { MeResponse } from '../lib/types'
import { authApi } from '../lib/api'

interface AuthContextType {
  user: MeResponse | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const data = await authApi.me()
      setUser(data.id ? data : null)
      // 인트로 페이지 활성화된 사용자 → 인트로 페이지로 리다이렉트
      if (data.id && data.intro_page_enabled) {
        const path = window.location.pathname
        if (path !== '/intro-profile' && !path.startsWith('/login') && !path.startsWith('/register')) {
          window.location.href = '/intro-profile'
        }
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const logout = async () => {
    await authApi.logout()
    setUser(null)
    window.location.href = '/'
  }

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
