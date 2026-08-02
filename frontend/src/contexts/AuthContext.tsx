import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { MeResponse } from '../lib/types'
import { authApi } from '../lib/api'

interface AuthContextType {
  user: MeResponse | null
  loading: boolean
  refresh: () => Promise<any>
  logout: () => Promise<void>
  introEnabled: boolean;
  setIntroEnabled: (enabled: boolean) => void;  
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refresh: async () => { },
  logout: async () => { },  
  introEnabled: false,
  setIntroEnabled: () => { }
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [introEnabled, setIntroEnabled] = useState(false);

  const refresh = async () => {
    try {
      const data = await authApi.me()
      setUser(data.id ? data : null)
      
      // 🌟 [추가] 서버에서 받아온 인트로 설정값을 전역 상태에 동기화합니다.
      if (typeof data.intro_page_enabled === 'boolean') {
        setIntroEnabled(data.intro_page_enabled)
      }
      // 🌟 [추가] 중요! 가져온 데이터 원본을 그대로 반환해 줍니다.
      return data; 

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
    <AuthContext.Provider value={{ user, loading, refresh, logout, introEnabled, setIntroEnabled }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
