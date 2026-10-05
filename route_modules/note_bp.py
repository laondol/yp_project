from flask import Blueprint, request, jsonify, session
from datetime import datetime, timezone
from models import db, Note, NoteComment
from route_modules.common import author_email_for as _author_email

note_bp = Blueprint('note', __name__)


def _sort_ko(items):
    """한국어 가나다순 + ASCII 정렬 (파이썬 기본 유니코드 정렬)."""
    return sorted(items, key=lambda x: x or '')


def _serialize(note):
    return {
        'id': note.id,
        'title': note.title,
        'category': note.category,
        'content': note.content,
        'latitude': note.latitude,
        'longitude': note.longitude,
        'address': note.address,
        'is_public': note.is_public,
        'allow_comments': bool(note.allow_comments),
        'created_at': note.created_at.isoformat() if note.created_at else None,
        'updated_at': note.updated_at.isoformat() if note.updated_at else None,
    }


@note_bp.route('/api/note/categories', methods=['GET'])
def note_categories():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    cats = (
        db.session.query(Note.category)
        .filter(Note.user_id == uid, Note.category.isnot(None), Note.category != '')
        .distinct()
        .all()
    )
    cats = [c[0] for c in cats]
    return jsonify({"categories": _sort_ko(cats)})


@note_bp.route('/api/note/categories/rename', methods=['PUT'])
def note_category_rename():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    data = request.json or {}
    old = (data.get('old') or '').strip()
    new = (data.get('new') or '').strip()[:50]
    if not old or not new:
        return jsonify({"error": "입력이 올바르지 않습니다."}), 400
    if old == new:
        return jsonify({"success": True, "count": 0})
    count = (
        Note.query.filter(Note.user_id == uid, Note.category == old)
        .update({"category": new}, synchronize_session=False)
    )
    db.session.commit()
    return jsonify({"success": True, "count": count})


@note_bp.route('/api/note/categories/<path:name>', methods=['DELETE'])
def note_category_delete(name):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    name = (name or '').strip()
    if not name:
        return jsonify({"error": "입력이 올바르지 않습니다."}), 400
    count = (
        Note.query.filter(Note.user_id == uid, Note.category == name)
        .update({"category": ''}, synchronize_session=False)
    )
    db.session.commit()
    return jsonify({"success": True, "count": count})


@note_bp.route('/api/note', methods=['GET'])
def note_list():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    q = Note.query.filter_by(user_id=uid)
    cat = request.args.get('category', '').strip()
    if cat:
        q = q.filter(Note.category == cat)
    notes = q.order_by(Note.updated_at.desc()).all()
    return jsonify({"notes": [_serialize(n) for n in notes]})


@note_bp.route('/api/note', methods=['POST'])
def note_create():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    data = request.json or {}
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    if not title:
        title = (data.get('category') or '').strip()[:50] or '제목없음'
    note = Note(
        user_id=uid,
        title=title,
        category=(data.get('category') or '').strip()[:50],
        content=content,
        latitude=data.get('latitude'),
        longitude=data.get('longitude'),
        address=(data.get('address') or '').strip()[:300],
        yard_event_id=int(data.get('yard_event_id')) if str(data.get('yard_event_id') or '').strip().isdigit() else None,
        is_public=bool(data.get('is_public')),
        allow_comments=bool(data.get('allow_comments', True)),
        updated_at=datetime.now(),
    )
    # 마당 행사 후기: 행사 위치·주소 자동 반영 + 공개 (공유마당 배치용)
    if note.yard_event_id:
        from models import YardPost
        yp = YardPost.query.get(note.yard_event_id)
        if yp:
            note.address = yp.event_place or note.address
            if yp.latitude:
                note.latitude = yp.latitude
                note.longitude = yp.longitude
            elif yp.event_place:
                from services.geocode import geocode_text
                note.latitude, note.longitude = geocode_text(yp.event_place)
                if not note.latitude:
                    # 지명은 주소 검색으로 안 잡힘 → 카카오 키워드 검색으로 폴백
                    try:
                        import requests as _req
                        from flask import current_app as _ca
                        kakao_key = _ca.config.get('KAKAO_REST_API_KEY', '')
                        r2 = _req.get('https://dapi.kakao.com/v2/local/search/keyword.json',
                                      headers={'Authorization': f'KakaoAK {kakao_key}'},
                                      params={'query': yp.event_place, 'size': 1}, timeout=10)
                        if r2.status_code == 200:
                            docs = r2.json().get('documents') or []
                            if docs:
                                note.latitude, note.longitude = float(docs[0]['y']), float(docs[0]['x'])
                    except Exception as e:
                        print(f'[NOTE] kakao keyword fail: {e}')
        if not data.get('is_public'):
            note.is_public = True  # 행사 후기는 공개 (공유마당 배치)
    db.session.add(note)
    db.session.commit()
    return jsonify({"success": True, "id": note.id})


@note_bp.route('/api/note/<int:note_id>', methods=['GET'])
def note_detail(note_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    note = Note.query.get(note_id)
    if not note or note.user_id != uid:
        return jsonify({"error": "찾을 수 없습니다."}), 404
    return jsonify(_serialize(note))


@note_bp.route('/api/note/<int:note_id>', methods=['PUT'])
def note_update(note_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    note = Note.query.get(note_id)
    if not note or note.user_id != uid:
        return jsonify({"error": "권한이 없습니다."}), 403
    data = request.json or {}
    if 'title' in data:
        note.title = (data.get('title') or '').strip()
    if 'category' in data:
        note.category = (data.get('category') or '').strip()[:50]
    if 'content' in data:
        note.content = data.get('content') or ''
    if 'latitude' in data:
        note.latitude = data.get('latitude')
    if 'longitude' in data:
        note.longitude = data.get('longitude')
    if 'address' in data:
        note.address = (data.get('address') or '').strip()[:300]
    if 'is_public' in data:
        note.is_public = bool(data.get('is_public'))
    if 'allow_comments' in data:
        note.allow_comments = bool(data.get('allow_comments'))
    note.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"success": True, "id": note.id})


@note_bp.route('/api/note/<int:note_id>', methods=['DELETE'])
def note_delete(note_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    note = Note.query.get(note_id)
    if not note or note.user_id != uid:
        return jsonify({"error": "권한이 없습니다."}), 403
    NoteComment.query.filter_by(note_id=note_id).delete(synchronize_session=False)
    db.session.delete(note)
    db.session.commit()
    return jsonify({"success": True})


def _can_view(note, uid):
    return note and (note.is_public or (uid and note.user_id == uid))


def _serialize_comment(c, uid):
    return {
        'id': c.id,
        'author': c.author,
        'user_id': c.user_id,
        'author_email': _author_email(c.user_id),
        'content': c.content,
        'parent_id': c.parent_id,
        'created_at': c.created_at.isoformat() if c.created_at else None,
        'is_owner': bool(uid and c.user_id and uid == c.user_id),
    }


@note_bp.route('/api/note/public/<int:note_id>')
def note_public(note_id):
    """공개 뷰: 공개 노트는 누구나, 비공개는 로그인 본인만."""
    uid = session.get('user_id')
    note = Note.query.get(note_id)
    if not _can_view(note, uid):
        return jsonify({"error": "찾을 수 없습니다."}), 404
    comments = (
        NoteComment.query.filter_by(note_id=note_id)
        .order_by(NoteComment.created_at.asc()).all()
    )
    return jsonify({
        'id': note.id,
        'title': note.title,
        'category': note.category,
        'content': note.content,
        'address': note.address,
        'is_public': bool(note.is_public),
        'is_owner': bool(uid and note.user_id == uid),
        'allow_comments': bool(note.allow_comments),
        'created_at': note.created_at.isoformat() if note.created_at else None,
        'comments': [_serialize_comment(c, uid) for c in comments],
        'viewer_logged_in': bool(uid),
    })


@note_bp.route('/api/note/<int:note_id>/comment', methods=['POST'])
def note_add_comment(note_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    note = Note.query.get(note_id)
    if not _can_view(note, uid):
        return jsonify({"error": "찾을 수 없습니다."}), 404
    if not note.allow_comments:
        return jsonify({"error": "댓글이 닫힌 공유글입니다."}), 403
    data = request.json or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({"error": "내용을 입력하세요."}), 400
    from models import User
    user = User.query.get(uid)
    c = NoteComment(
        note_id=note_id,
        user_id=uid,
        author=user.username if user else '',
        content=content,
        parent_id=data.get('parent_id') or None,
    )
    db.session.add(c)
    db.session.commit()
    return jsonify({"success": True, "comment": _serialize_comment(c, uid)})


@note_bp.route('/api/note/comment/<int:comment_id>', methods=['DELETE'])
def note_delete_comment(comment_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    c = NoteComment.query.get(comment_id)
    if not c:
        return jsonify({"error": "찾을 수 없습니다."}), 404
    note = Note.query.get(c.note_id)
    # 댓글 작성자 또는 노트 주인(공개된 내 글 관리)만 삭제
    if c.user_id != uid and (not note or note.user_id != uid):
        return jsonify({"error": "권한이 없습니다."}), 403
    db.session.delete(c)
    db.session.commit()
    return jsonify({"success": True})
