from flask import Blueprint, request, jsonify, session
from datetime import datetime, timezone
from models import db, Note

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
        is_public=bool(data.get('is_public')),
        updated_at=datetime.now(timezone.utc),
    )
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
    note.updated_at = datetime.now(timezone.utc)
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
    db.session.delete(note)
    db.session.commit()
    return jsonify({"success": True})
