import { useAuth } from '../contexts/AuthContext'

interface Props {
  name?: string
  email?: string | null
  userId?: number | null
  className?: string
  style?: React.CSSProperties
  prefix?: string
}

export default function AuthorName({ name, email, userId, className, style, prefix }: Props) {
  const { user } = useAuth()

  const sendFriendRequest = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user?.id) {
      window.location.href = `/login?next=${window.location.pathname}`
      return
    }
    if (!userId || userId === user.id) return

    const notice =
      `${email ?? (name ?? '이 회원')}님에게 벗 신청을 보냅니다.\n\n` +
      `⚠️ 안내\n` +
      `• 상대가 신청을 수락하면 신청자(나)의 이메일 일부가 상대에게 공개됩니다.\n` +
      `• 이에 따른 모든 책임은 신청인(나)에게 있습니다.\n` +
      `• 한 번 맺어진 벗은 헤어질 때 조정위원회의 조정을 받을 수 있습니다.\n\n` +
      `위 내용에 동의하고 벗 신청을 보낼까요?`

    if (!confirm(notice)) return
    try {
      const fd = new URLSearchParams()
      fd.set('share_login_location', '0')
      const r = await fetch(`/friends/request/${userId}`, { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      const d = await r.json()
      alert(d.msg || (d.status === 'success' ? '벗 신청을 보냈습니다.' : '오류'))
    } catch {
      alert('벗 신청 중 오류가 발생했습니다.')
    }
  }

  // ✏️ 닉네임은 아예 표시하지 않고, 마스킹된 이메일만 노출한다.
  // 비회원/미로그인에게는 이메일조차 보여주지 않는다.
  const showEmail = !!email && !!user?.id && userId !== user.id

  return (
    <span
      className={className}
      style={{ cursor: userId && userId !== user?.id ? 'pointer' : 'default', ...style }}
      title={showEmail ? '작성자에게 벗 신청' : undefined}
      onClick={userId && userId !== user?.id ? sendFriendRequest : undefined}
    >
      {showEmail && (
        <>
          {prefix}
          <span style={{ fontStyle: 'normal' }}>{email}</span>
        </>
      )}
    </span>
  )
}