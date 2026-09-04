import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

interface YardDetail {
  id: number; title: string; content: string
  source_type: string; platform: string
  source_url: string; author_name: string
  embed_url?: string; created_at: string
}

export default function YardDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [post, setPost] = useState<YardDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/yard/${id}`)
      .then(r => r.json().then(d => r.ok ? setPost(d) : setError(d.msg || '불러올 수 없습니다.')))
      .catch(() => setError('불러오기 실패'))
  }, [id])

  if (error) {
    return (
      <div className="container mt-4">
        <div className="alert alert-warning">{error}</div>
        <button className="btn btn-outline-secondary" onClick={() => navigate('/yard')}>← 마당으로</button>
      </div>
    )
  }
  if (!post) return <div className="text-center py-5"><div className="spinner-border" /></div>

  const embedUrl = post.embed_url || ''

  return (
    <div className="container mt-4" style={{ maxWidth: 700 }}>
      <button className="btn btn-sm btn-outline-secondary mb-3" onClick={() => navigate('/yard')}>← 마당으로</button>
      <div className="card border-0 shadow-sm" style={{ borderRadius: 18, overflow: 'hidden' }}>
        <div className="card-body p-4">
          <div className="mb-2">
            {post.platform === 'instagram' && <span className="badge bg-danger">📸 인스타그램</span>}
            {post.platform === 'facebook' && <span className="badge bg-primary">📘 페이스북</span>}
            {post.platform === 'kakao' && <span className="badge bg-warning text-dark">💛 카카오</span>}
            {post.platform === 'web' && <span className="badge bg-info">🌐 웹</span>}
            {post.platform === '' && <span className="badge bg-secondary">📢 직접 등록</span>}
          </div>
          <h4 className="fw-bold mb-2">{post.title}</h4>
          {post.author_name && <div className="small text-muted mb-2">👤 {post.author_name}</div>}

          {post.content && <div className="mb-3" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{post.content}</div>}

          {/* 인스타그램/페이스북 공개 게시물 임베드 */}
          {embedUrl ? (
            <div className="d-flex justify-content-center my-4">
              <iframe
                src={embedUrl}
                style={{ border: 'none', width: '100%', maxWidth: 500, height: platformHeight(post.platform), overflow: 'hidden' }}
                scrolling="no"
                allowFullScreen
                title="SNS 게시물"
              />
            </div>
          ) : post.source_url ? (
            <div className="alert alert-light small my-3">
              이 게시물은 임베드 지원이 제한되어 아래 버튼으로 원문을 확인하세요.
            </div>
          ) : null}

          {/* 원문 URL 대비 */}
          {post.source_url && (
            <div className="mt-4">
              {embedUrl ? (
                <a href={post.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline-success btn-sm me-2">
                  ↗ 원문 바로가기
                </a>
              ) : (
                <a href={post.source_url} target="_blank" rel="noopener noreferrer"
                  className="btn btn-success btn-lg px-4">
                  ↗ {post.platform === 'kakao' ? '카카오' : '원문 페이지'}에서 보기
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  function platformHeight(platform: string): number {
    return platform === 'facebook' ? 640 : 700
  }
}
