"""마당 — 양평 단체 SNS 공지 + 관리자 직접 등록 + 마을행사 연동"""
from flask import Blueprint, request, jsonify, session, current_app
from models import db, YardPost, VillageEvent, User
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
    """마당 목록: 등록 소식(SNS+직접) + 마을행사(VillageEvent) 통합 최신순"""
    items = []
    for p in YardPost.query.filter_by(is_active=True).order_by(YardPost.created_at.desc()).limit(100).all():
        items.append({
            'id': f'p{p.id}', 'db_id': p.id,
            'kind': 'post',
            'title': p.title, 'content': p.content or '',
            'source_type': p.source_type, 'platform': p.platform,
            'source_url': p.source_url or '',
            'author_name': p.author_name or '',
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


@yard_bp.route('/api/yard/<int:post_id>', methods=['GET'])
def api_yard_get(post_id):
    p = YardPost.query.get(post_id)
    if not p or not p.is_active:
        return jsonify({"status": "error", "msg": "없거나 숨긴 글입니다."}), 404
    return jsonify({
        'id': p.id, 'title': p.title, 'content': p.content or '',
        'source_type': p.source_type, 'platform': p.platform,
        'source_url': p.source_url or '', 'author_name': p.author_name or '',
        'embed_url': _embed_url(p.platform, p.source_url) if p.platform in ('instagram', 'facebook') else '',
        'created_at': str(p.created_at),
    })
