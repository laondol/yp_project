"""마당 — 양평 단체 SNS 공지 + 관리자 직접 등록 + 마을행사 연동 + 댓글"""
import os
from flask import Blueprint, request, jsonify, session, current_app
from models import db, YardPost, YardComment, YardOrg, VillageEvent, User
from datetime import datetime

yard_bp = Blueprint('yard_bp', __name__)


def _detect_platform(url):
    """SNS URL에서 플랫폼 판별"""
    u = (url or '').lower()
    if 'instagram.com' in u:
        return 'instagram'
    if 'facebook.com' in u or 'fb.watch' in u:
        return 'facebook'
    if 'pf.kakao.com' in u or 'kakao.com' in u or 'band.us' in u:
        return 'kakao'
    return 'web'


def _embed_url(platform, url):
    """SNS 공개 게시물 임베드 URL 생성 (임베드 불가 플랫폼은 원문 URL 유지)"""
    if platform == 'instagram':
        import re
        m = re.search(r'instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)', url or '')
        if m:
            return f"https://www.instagram.com/p/{m.group(1)}/embed"
        return ''
    if platform == 'facebook':
        from urllib.parse import quote
        return f"https://www.facebook.com/plugins/post.php?href={quote(url)}&show_text=true&width=500"
    return ''


@yard_bp.route('/api/yard', methods=['GET'])
def api_yard_list():
    """마당 목록(일반 회원): 관리자 승인된 소식 + 마을행사 통합 최신순"""
    items = []
    for p in YardPost.query.filter_by(is_active=True, is_approved=True).order_by(YardPost.created_at.desc()).limit(100).all():
        items.append({
            'id': f'p{p.id}', 'db_id': p.id,
            'kind': 'post',
            'title': p.title, 'content': p.content or '',
            'source_type': p.source_type, 'platform': p.platform,
            'source_url': p.source_url or '',
            'author_name': p.author_name or '',
            'like_count': p.like_count or 0, 'dislike_count': p.dislike_count or 0,
            'created_at': p.created_at.isoformat() if p.created_at else '',
        })
    # 마을지기 마을행사 (진행 예정/진행중)
    for ev in VillageEvent.query.filter(VillageEvent.status.in_(['upcoming', 'ongoing'])).order_by(VillageEvent.created_at.desc()).limit(30).all():
        author = ''
        if ev.created_by:
            u = User.query.get(ev.created_by)
            author = (u.name or u.username) if u else ''
        ev_dt = ''
        if ev.event_date:
            ev_dt = ev.event_date.strftime('%m/%d %H:%M')
        items.append({
            'id': f'e{ev.id}', 'db_id': ev.id,
            'kind': 'event',
            'title': ev.title,
            'content': (ev.description or '')[:300],
            'platform': 'event',
            'source_url': f'/village/event/{ev.id}',
            'author_name': f'{ev.myeon or ""} {ev.ri or ""} 마을지기'.strip() or '마을지기',
            'event_date': ev_dt,
            'created_at': str(ev.created_at),
        })
    items.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return jsonify({'items': items})


def _require_admin():
    return session.get('role') in ['admin', 'leader']


@yard_bp.route('/api/yard', methods=['POST'])
def api_yard_create():
    """관리자/마을지기: 직접 입력 또는 SNS 공지 URL 등록"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({"status": "error", "msg": "제목을 입력하세요."}), 400
    source_url = (data.get('source_url') or '').strip()
    source_type = 'sns' if source_url else 'manual'
    platform = _detect_platform(source_url) if source_url else 'web'
    created_by = session.get('user_id')
    if created_by and not User.query.get(created_by):
        created_by = None
    p = YardPost(
        title=title[:300],
        content=(data.get('content') or '').strip(),
        source_type=source_type,
        platform=platform,
        source_url=source_url[:500],
        author_name=(data.get('author_name') or '').strip()[:100],
        is_approved=True,  # 관리자 직접 등록은 즉시 공개
        created_by=created_by,
    )
    db.session.add(p)
    db.session.commit()
    return jsonify({"status": "success", "id": p.id, "msg": "✅ 마당에 등록되었습니다."})


@yard_bp.route('/api/yard/<string:fid>', methods=['DELETE'])
def api_yard_delete(fid):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 마당에서 삭제할 수 없습니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    db.session.delete(p)
    db.session.commit()
    return jsonify({"status": "success", "msg": "삭제되었습니다."})


@yard_bp.route('/api/yard/<string:fid>/toggle', methods=['POST'])
def api_yard_toggle(fid):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 수정할 수 없습니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    p.is_active = not p.is_active
    db.session.commit()
    return jsonify({"status": "success", "is_active": p.is_active, "msg": f"{'표시' if p.is_active else '숨김'}으로 변경"})


@yard_bp.route('/api/yard/admin', methods=['GET'])
def api_yard_admin_list():
    """관리자: 승인 대기 + 승인됨 전체 목록"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    out = []
    for p in YardPost.query.order_by(YardPost.created_at.desc()).limit(300).all():
        out.append({
            'id': f'p{p.id}', 'db_id': p.id,
            'title': p.title, 'content': (p.content or '')[:200],
            'source_type': p.source_type, 'platform': p.platform,
            'source_url': p.source_url or '', 'author_name': p.author_name or '',
            'is_approved': bool(p.is_approved), 'is_active': bool(p.is_active),
            'created_at': p.created_at.isoformat() if p.created_at else '',
        })
    return jsonify({'items': out})


@yard_bp.route('/api/yard/<string:fid>/approve', methods=['POST'])
def api_yard_approve(fid):
    """관리자 승인/승인해제"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 승인 대상이 아닙니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    p.is_approved = not bool(p.is_approved)
    db.session.commit()
    return jsonify({"status": "success", "is_approved": p.is_approved,
                    "msg": "✅ 승인 — 마당에 공개되었습니다." if p.is_approved else "승인 해제 — 비공개로 전환했습니다."})


@yard_bp.route('/api/yard/orgs', methods=['GET'])
def api_yard_orgs():
    """관리자: 자동수집 대상 단체 목록"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    orgs = []
    for o in YardOrg.query.order_by(YardOrg.created_at.desc()).all():
        orgs.append({
            'id': o.id, 'name': o.name, 'url': o.url or '',
            'platform': o.platform or '', 'is_active': bool(o.is_active),
            'created_at': o.created_at.isoformat() if o.created_at else '',
        })
    return jsonify({'orgs': orgs})


@yard_bp.route('/api/yard/orgs', methods=['POST'])
def api_yard_org_create():
    """관리자: 단체 등록 (단체명 + 블로그/카페 주소). 블로그/카페만 자동수집 가능"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()[:100]
    if not name:
        return jsonify({"status": "error", "msg": "단체명을 입력하세요."}), 400
    url = (data.get('url') or '').strip()[:500]
    if not url:
        return jsonify({"status": "error", "msg": "블로그 또는 카페 주소를 입력하세요."}), 400
    # 네이버 블로그/카페 우선 판별 (자동수집 가능 플랫폼)
    u = url.lower()
    if 'blog.naver.com' in u:
        platform = 'naverblog'
    elif 'cafe.naver.com' in u or 'm.cafe.naver.com' in u:
        platform = 'navercafe'
    else:
        platform = _detect_platform(url)
    if YardOrg.query.filter_by(name=name).first():
        return jsonify({"status": "error", "msg": "이미 등록된 단체명입니다."}), 400
    o = YardOrg(name=name, url=url[:500], platform=platform, created_by=session.get('user_id'))
    db.session.add(o)
    db.session.commit()
    auto_note = ' → 자동수집 대상에 포함됩니다.' if platform in ('naverblog', 'navercafe') else ' → 이 플랫폼은 자동수집이 불가하여 관리자 직접 등록용으로 참고 저장됩니다.'
    return jsonify({"status": "success", "id": o.id, "platform": platform, "msg": f"✅ 단체 등록 완료{auto_note}"})


@yard_bp.route('/api/yard/orgs/<int:org_id>', methods=['DELETE'])
def api_yard_org_delete(org_id):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    o = YardOrg.query.get(org_id)
    if not o:
        return jsonify({"status": "error", "msg": "없는 단체입니다."}), 404
    db.session.delete(o)
    db.session.commit()
    return jsonify({"status": "success", "msg": "단체 등록이 삭제되었습니다."})


@yard_bp.route('/api/yard/<int:post_id>', methods=['GET'])
def api_yard_get(post_id):
    p = YardPost.query.get(post_id)
    if not p or not p.is_active:
        return jsonify({"status": "error", "msg": "없거나 숨긴 글입니다."}), 404
    comments = []
    for c in YardComment.query.filter_by(post_id=p.id).order_by(YardComment.created_at.asc()).all():
        user = User.query.get(c.user_id) if c.user_id else None
        uname = (user.name or user.username) if user else (c.author_name or '익명')
        comments.append({
            'id': c.id, 'user_id': c.user_id, 'author_name': uname or '익명',
            'content': c.content or '', 'image_path': c.image_path or '',
            'link_url': c.link_url or '',
            'like_count': c.like_count or 0, 'dislike_count': c.dislike_count or 0,
            'created_at': c.created_at.isoformat() if c.created_at else '',
        })
    return jsonify({
        'id': p.id, 'title': p.title, 'content': p.content or '',
        'source_type': p.source_type, 'platform': p.platform,
        'source_url': p.source_url or '', 'author_name': p.author_name or '',
        'like_count': p.like_count or 0, 'dislike_count': p.dislike_count or 0,
        'embed_url': _embed_url(p.platform, p.source_url) if p.platform in ('instagram', 'facebook') else '',
        'comments': comments,
        'created_at': str(p.created_at),
    })


@yard_bp.route('/api/yard/<int:post_id>/vote', methods=['POST'])
def api_yard_vote(post_id):
    """마당 글 좋아요/싫어요 (로그인 필요)"""
    if not session.get('user_id'):
        return jsonify({"status": "error", "msg": "로그인 후 이용하세요."}), 401
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    if request.is_json:
        vote = (request.get_json(silent=True) or {}).get('vote', '')
    else:
        vote = request.form.get('vote', '')
    if vote == 'like':
        p.like_count = (p.like_count or 0) + 1
    elif vote == 'dislike':
        p.dislike_count = (p.dislike_count or 0) + 1
    else:
        return jsonify({"status": "error", "msg": "잘못된 요청"}), 400
    db.session.commit()
    return jsonify({"status": "success", "like_count": p.like_count, "dislike_count": p.dislike_count})


@yard_bp.route('/api/yard/<int:post_id>/comment', methods=['POST'])
def api_yard_comment(post_id):
    """댓글 등록 (사진·링크 첨부 가능, 로그인 필요)"""
    if not session.get('user_id'):
        return jsonify({"status": "error", "msg": "로그인 후 이용하세요."}), 401
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404

    content = (request.form.get('content') or '').strip()
    link_url = (request.form.get('link_url') or '').strip()[:500]
    image_path = ''
    file = request.files.get('image')
    if file and file.filename:
        from services.security import secure_save
        upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'yard_comments')
        try:
            image_path = secure_save(file, upload_dir, max_mb=10)
        except ValueError as e:
            return jsonify({"status": "error", "msg": str(e)[:80]}), 400

    if not content and not image_path and not link_url:
        return jsonify({"status": "error", "msg": "내용/사진/링크 중 하나는 입력하세요."}), 400

    user = User.query.get(session.get('user_id'))
    uid = session.get('user_id')
    if uid and not user:
        uid = None
    c = YardComment(
        post_id=p.id,
        user_id=uid,
        author_name=(user.name or user.username) if user else '회원',
        content=content[:2000],
        image_path=image_path,
        link_url=link_url,
    )
    db.session.add(c)
    db.session.commit()
    return jsonify({
        "status": "success", "id": c.id,
        "comment": {'id': c.id, 'user_id': c.user_id, 'author_name': c.author_name,
                    'content': c.content, 'image_path': c.image_path, 'link_url': c.link_url,
                    'like_count': 0, 'dislike_count': 0,
                    'created_at': c.created_at.isoformat() if c.created_at else ''},
        "msg": "댓글이 등록되었습니다.",
    })


@yard_bp.route('/api/yard/comment/<int:comment_id>', methods=['DELETE'])
def api_yard_comment_delete(comment_id):
    c = YardComment.query.get(comment_id)
    if not c:
        return jsonify({"status": "error", "msg": "없는 댓글입니다."}), 404
    if session.get('user_id') != c.user_id and session.get('role') not in ['admin', 'leader']:
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    db.session.delete(c)
    db.session.commit()
    return jsonify({"status": "success", "msg": "댓글이 삭제되었습니다."})
