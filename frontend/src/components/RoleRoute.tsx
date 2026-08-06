import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function RoleRoute({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="text-center py-5"><div className="spinner-border text-success" role="status" /></div>
  }

  if (!user || !roles.includes(user.role || '')) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}