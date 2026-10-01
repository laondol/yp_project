from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, current_app, send_file
from models import db, Message, User, Friend, PointHistory, BlockedEmail, EmailRateLimit
from datetime import datetime, timedelta
import re

message_bp = Blueprint('message', __name__)

LETTER_COST = 10  # 편지 1通당 닢 10 차감
INTERNAL_ADMIN_ID = 1  # 전체관리자 수신용 내부 ID (운영 db의 admin1)
INTERNAL_AI_ADMIN_ID = 9  # AI관리자 발송용 내부 ID (herb2727)

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
EMAIL_RATE_LIMIT_PER_MIN = 5  # 분당 최대 발송 건수
EMAIL_RATE_LIMIT_PER_DAY = 30  # 일당 최대 발송 건수


def _get_balance(uid):
    """사용자의 닢 잔액 반환"""
    user = User.query.get(uid)
    return user.points if user else 0


def _get_internal_admin():
    """전체관리자용 내부 계정 반환"""
    return User.query.get(INTERNAL_ADMIN_ID)

def _get_ai_admin():
    """AI관리자 발송용 내부 계정 반환"""
    return User.query.get(INTERNAL_AI_ADMIN_ID)

def _get_village_leader(user_town, user_village):
    """해당 읍/면/리의 마을지기 반환"""
    if not user_town or not user_village:
        return None
    return User.query.filter(
        User.role == 'leader', User.town == user_town, User.village == user_village
    ).first()

def _deduct_points(uid, amount, desc):
    """坭 차감 (성공 시 True, 실패 시 False)"""
    user = User.query.get(uid)
    if not user or (user.points or 0) < amount:
        return False
    user.points -= amount
    h = PointHistory(user_id=uid, change_type='letter', amount=-amount,
                     balance_after=user.points, description=desc)
    db.session.add(h)
    return True


# ── 스레드/탭 헬퍼 ──
NOTICE_ROLES = ('admin', 'leader')  # 관리자/마을지기 발신 → 공지 탭


def _get_friend_ids(uid):
    """내 벗 ID 집합"""
    ids = set()
    for f in Friend.query.filter(
        Friend.status == 'accepted',
        ((Friend.requester_id == uid) | (Friend.receiver_id == uid))
    ).all():
        ids.add(f.requester_id if f.receiver_id == uid else f.receiver_id)
    return ids


def _get_root(msg):
    """reply_to_id 체인을 따라 원문(루트) 편지 반환"""
    cur = msg
    seen = set()
    while cur.reply_to_id and cur.id not in seen:
        seen.add(cur.id)
        parent = Message.query.get(cur.reply_to_id)
        if not parent:
            break
        cur = parent
    return cur


def _descendants(root):
    """루트에서 도달 가능한 모든 편지(루트 포함) — reply_to_id 하위 호환"""
    result = []
    stack = [root]
    seen = set()
    while stack:
        cur = stack.pop()
        if cur.id in seen:
            continue
        seen.add(cur.id)
        result.append(cur)
        for c in Message.query.filter_by(reply_to_id=cur.id).all():
            stack.append(c)
    return result


def _thread_rows(msg):
    """스레드 전체 행 (thread_key 우선, 없으면 reply_to 하위 호환)"""
    root = _get_root(msg)
    if root.thread_key:
        return Message.query.filter_by(thread_key=root.thread_key).all(), root
    return _descendants(root), root


def _ensure_thread_key(msg):
    """회신 생성 시 스레드 전체에 thread_key 부여(레거시 백필). 스레드 키 반환"""
    root = _get_root(msg)
    if root.thread_key:
        return root.thread_key
    key = uuid.uuid4().hex
    for r in _descendants(root):
        r.thread_key = key
    return key


def _batch_id(row):
    """행의 배치 그룹 키 (batch_key 없으면 행별 고유)"""
    return row.batch_key or f'id:{row.id}'


def _batch_rows(rows, key):
    """배치 키로 행 그룹핑 (batch_key가 None인 레거시는 각각 별그룹)"""
    return [r for r in rows if _batch_id(r) == key]


def _display_name(user, role=None, is_notice=False):
    """탭/스레드 표시 아이디: 공지(시스템·관리메뉴 발신)는 admin@unocum.kr, 그 외 로그인 이메일"""
    if is_notice:
        return 'admin@unocum.kr'
    if not user:
        return '알수없음'
    return user.email or user.username or '알수없음'


def _is_notice_root(root, uid, friend_ids):
    """공지 원문 여부 (공지에는 회신 불가): 공지성 발신 또는 나에게 비벗인 원문"""
    if root.sender_id == uid:
        return False
    if root.is_notice or root.sender_id is None:
        return True
    return root.sender_id not in friend_ids


def _is_sent_personal(rows, friend_ids):
    """벗에게 탭 배치 판정: 공지 아님 + 수신자 전원이 내 벗목록 (회신 포함)"""
    if any(r.is_notice for r in rows):
        return False
    return all(r.receiver_id in friend_ids for r in rows)


def _msg_row_dict(m, uid, friend_ids):
    """리스트 행 공통 직렬화"""
    sender = User.query.get(m.sender_id)
    receiver = User.query.get(m.receiver_id)
    direction = 'sent' if m.sender_id == uid else 'received'
    return {
        'id': m.id, 'subject': m.subject, 'content': m.content,
        'sender_id': m.sender_id, 'receiver_id': m.receiver_id,
        'sender_name': _display_name(sender, m.sender_role, m.is_notice),
        'sender_username': sender.email if sender else None,
        'sender_role': m.sender_role, 'letter_type': m.letter_type,
        'receiver_name': _display_name(receiver, receiver.role if receiver else None),
        'is_read': m.is_read, 'is_public': m.is_public,
        'is_notice': m.is_notice,
        'direction': direction, 'reply_to_id': m.reply_to_id,
        'sender_is_friend': m.sender_id in friend_ids,
        'batch_key': m.batch_key, 'thread_key': m.thread_key,
        'created_at': m.created_at.isoformat() if m.created_at else None,
        'read_at': m.read_at.isoformat() if m.read_at else None,
    }


@message_bp.route('/message/count')
def message_count():
    uid = session.get('user_id')
    if not uid:
        return jsonify({'count': 0})
    cnt = Message.query.filter_by(receiver_id=uid, is_read=False).count()
    return jsonify({'count': cnt})


def _serve_spa():
    import os
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    return render_template('intro.html')

@message_bp.route('/message/inbox')
def message_inbox():
    if not session.get('username'):
        return redirect(url_for('auth.login', next='/message/inbox'))
    return _serve_spa()

@message_bp.route('/message/send')
def message_send():
    if not session.get('username'):
        return redirect(url_for('auth.login', next='/message/send'))
    return _serve_spa()

@message_bp.route('/api/message/users')
def api_message_users():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    # 벗 목록
    friends = Friend.query.filter(
        (Friend.requester_id == uid) & (Friend.status == 'accepted')
    ).all()
    friend_ids = [f.receiver_id for f in friends]
    friends2 = Friend.query.filter(
        (Friend.receiver_id == uid) & (Friend.status == 'accepted')
    ).all()
    friend_ids += [f.requester_id for f in friends2]
    users = User.query.filter(User.id.in_(friend_ids)).all() if friend_ids else []
    result = [{'id': u.id, 'username': u.email, 'real_name': u.real_name, 'town': u.town, 'village': u.village} for u in users]
    return jsonify(result)


def _sent_entry_dict(uid, rows):
    """발신 배치 → 리스트 행 직렬화 (rows는 최신순 정렬 완료, 1배치=1행)"""
    latest = rows[0]
    any_read = any(r.is_read for r in rows)
    return {
        'id': rows[0].id if any_read else min(r.id for r in rows),
        'batch_key': rows[0].batch_key,
        'subject': latest.subject, 'content': latest.content,
        'sender_id': uid, 'receiver_id': rows[0].receiver_id,
        'direction': 'sent', 'reply_to_id': latest.reply_to_id,
        'is_root': latest.reply_to_id is None,
        'letter_type': latest.letter_type, 'is_public': latest.is_public,
        'is_read': any_read,
        'is_notice': any(r.is_notice for r in rows),
        'sender_name': _display_name(User.query.get(uid)),
        'sender_username': (User.query.get(uid).email if User.query.get(uid) else None),
        'sender_is_friend': True,
        'created_at': (max(r.created_at for r in rows) if any_read else latest.created_at).isoformat() if (latest.created_at) else None,
        'read_at': max((r.read_at for r in rows if r.read_at), default=None).isoformat() if any(r.read_at for r in rows) else None,
        'receivers': [
            {'id': r.receiver_id,
             'username': (User.query.get(r.receiver_id).email if User.query.get(r.receiver_id) else None),
             'is_read': r.is_read} for r in rows
        ],
        'unread_count': sum(1 for r in rows if not r.is_read),
        'total_count': len(rows),
    }


@message_bp.route('/api/messages')
def api_messages():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    tab = request.args.get('tab', 'received')
    friend_ids = _get_friend_ids(uid)
    from sqlalchemy import or_

    if tab == 'received':
        # 벗으로부터: 벗이 보낸 읽지 않은 원문 편지만 (공지 제외)
        if friend_ids:
            msgs = Message.query.filter(
                Message.receiver_id == uid,
                Message.is_read == False,
                Message.reply_to_id.is_(None),
                Message.sender_id.in_(friend_ids),
                Message.is_notice == False,
            ).order_by(Message.created_at.desc()).limit(50).all()
        else:
            msgs = []
        result = [_msg_row_dict(m, uid, friend_ids) for m in msgs]
        return jsonify({'my_id': uid, 'messages': result})

    # 발신 배치 그룹 (한 번의 발송 = 한 행). sent/archive/notice 공통, 300건 내 그룹핑.
    notice_sent, sent_entries, archive_sent = [], [], []
    if tab in ('notice', 'sent', 'archive'):
        sent_rows = Message.query.filter(
            Message.sender_id == uid,
            Message.receiver_id != uid,
        ).order_by(Message.created_at.desc()).limit(300).all()
        groups = {}
        for r in sent_rows:
            groups.setdefault(_batch_id(r), []).append(r)
        for key, rows in groups.items():
            rows.sort(key=lambda x: (x.created_at or datetime.min, x.id), reverse=True)
            entry = _sent_entry_dict(uid, rows)
            if any(r.is_notice for r in rows):
                # 발신 공지: 미확인 → 공지 탭 / 읽혔거나 발신자가 보관(읽음) 처리 → 보관함
                if any(r.is_read for r in rows) or any(r.sender_archived for r in rows):
                    archive_sent.append(entry)
                else:
                    notice_sent.append(entry)
            elif any(r.is_read for r in rows) or not _is_sent_personal(rows, friend_ids):
                # 전원 미확인 + 벗 전원 발신(비공지)만 벗에게 → 그 외(읽음·비벗 대상)는 보관함
                archive_sent.append(entry)
            else:
                sent_entries.append(entry)

    if tab == 'notice':
        # 공지: 시스템·관리메뉴 발신(is_notice) 또는 비벗이 보낸 읽지 않은 원문 (수신)
        #     + 내가 보낸 공지 배치 (발신 기록)
        q = Message.query.filter(
            Message.receiver_id == uid,
            or_(Message.sender_id.is_(None), Message.sender_id != uid),
            Message.is_read == False,
            Message.reply_to_id.is_(None),
        )
        conds = [Message.is_notice == True]
        if friend_ids:
            conds.append(or_(Message.sender_id.is_(None), ~Message.sender_id.in_(friend_ids)))
        else:
            conds.append(Message.id != 0)
        msgs = q.filter(or_(*conds)).order_by(Message.created_at.desc()).limit(50).all()
        result = [_msg_row_dict(m, uid, friend_ids) for m in msgs]
        for e in notice_sent:
            e['is_unread_reply'] = False
            result.append(e)
        result.sort(key=lambda e: e['created_at'] or '', reverse=True)
        return jsonify({'my_id': uid, 'messages': result[:100]})

    if tab == 'sent':
        sent_entries.sort(key=lambda e: e['created_at'] or '', reverse=True)
        return jsonify({'my_id': uid, 'messages': sent_entries[:50]})

    if tab == 'archive':
        # 보관함: 읽은 원문(받은/보낸) + 읽지 않은 회신(받은, 발신자 아이디 빨간 표시)
        recv_read = Message.query.filter(
            Message.receiver_id == uid,
            Message.sender_id != uid,
            Message.is_read == True,
            Message.reply_to_id.is_(None),
        ).order_by(Message.created_at.desc()).limit(100).all()
        unread_replies = Message.query.filter(
            Message.receiver_id == uid,
            Message.sender_id != uid,
            Message.reply_to_id.isnot(None),
            Message.is_read == False,
        ).order_by(Message.created_at.desc()).limit(100).all()

        result = [_msg_row_dict(m, uid, friend_ids) for m in recv_read]
        for m in unread_replies:
            d = _msg_row_dict(m, uid, friend_ids)
            d['is_unread_reply'] = True
            result.append(d)
        for e in archive_sent:
            e['is_unread_reply'] = False
            result.append(e)
        result.sort(key=lambda e: e['created_at'] or '', reverse=True)
        return jsonify({'my_id': uid, 'messages': result[:150]})

    return jsonify({'my_id': uid, 'messages': []})


@message_bp.route('/api/messages/counts')
def api_messages_counts():
    """4탭 미확인 개수 (탭 빨간 배지)"""
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    friend_ids = _get_friend_ids(uid)

    from sqlalchemy import or_
    received = 0
    if friend_ids:
        received = Message.query.filter(
            Message.receiver_id == uid,
            Message.is_read == False,
            Message.reply_to_id.is_(None),
            Message.sender_id.in_(friend_ids),
            Message.is_notice == False,
        ).count()

    conds = [Message.is_notice == True]
    if friend_ids:
        conds.append(or_(Message.sender_id.is_(None), ~Message.sender_id.in_(friend_ids)))
    else:
        conds.append(Message.id != 0)
    notice = Message.query.filter(
        Message.receiver_id == uid,
        or_(Message.sender_id.is_(None), Message.sender_id != uid),
        Message.is_read == False,
        Message.reply_to_id.is_(None),
    ).filter(or_(*conds)).count()

    # 벗에게: 벗 전원 발신·비공지·전원 미확인 발송 배치 수
    sent = 0
    sent_rows = Message.query.filter(
        Message.sender_id == uid,
        Message.receiver_id != uid,
    ).order_by(Message.created_at.desc()).limit(300).all()
    groups = {}
    for r in sent_rows:
        groups.setdefault(_batch_id(r), []).append(r)
    for rows in groups.values():
        if not _is_sent_personal(rows, friend_ids):
            continue  # 공지·비벗 대상 발신은 벗에게 배지에서 제외
        if not any(r.is_read for r in rows):
            sent += 1

    # 보관함: 읽지 않은 회신
    archive = Message.query.filter(
        Message.receiver_id == uid,
        Message.sender_id != uid,
        Message.reply_to_id.isnot(None),
        Message.is_read == False,
    ).count()

    return jsonify({'received': received, 'sent': sent, 'notice': notice, 'archive': archive})

@message_bp.route('/api/messages/archive-count')
def api_messages_archive_count():
    """보관함에서 읽지 않은 회신/답신 개수 반환"""
    uid = session.get('user_id')
    if not uid: return jsonify({'count': 0})
    # 상대가 보낸 읽지 않은 회신/답신 (reply_to_id가 있고, 받은 사람만 카운트)
    count = Message.query.filter(
        Message.receiver_id == uid,
        Message.sender_id != uid,
        Message.reply_to_id.isnot(None),
        Message.is_read == False,
    ).count()
    return jsonify({'count': count})

@message_bp.route('/api/message/<int:msg_id>')
def api_message_detail(msg_id):
    """단일 편지 조회 (회신용)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({'error': 'login'}), 401
    m = Message.query.get(msg_id)
    if not m:
        return jsonify({'error': 'not found'}), 404
    # 수신자 또는 발신자만 조회 가능
    if m.receiver_id != uid and m.sender_id != uid:
        role = session.get('role', 'user')
        if not (m.is_public and role in ('admin', 'leader')):
            return jsonify({'error': 'forbidden'}), 403
    sender = User.query.get(m.sender_id)
    receiver = User.query.get(m.receiver_id)

    # 공지(시스템·관리메뉴 발신) → 회신은 받은 사람의 마을지기에게 (공지 회신은 서버에서 차단됨)
    reply_to_id = m.sender_id
    reply_to_name = _display_name(sender, m.sender_role, m.is_notice)
    sender_is_admin = bool(m.is_notice)

    if sender_is_admin and receiver:
        # 받은 사람의 마을지기 찾기
        me = User.query.get(uid)
        if me and me.town and me.village:
            leader = User.query.filter(
                User.role == 'leader', User.town == me.town, User.village == me.village
            ).first()
            if leader:
                reply_to_id = leader.id
                reply_to_name = _display_name(leader, 'leader', False)

    return jsonify({
        'id': m.id, 'subject': m.subject, 'content': m.content,
        'sender_id': m.sender_id,
        'sender_name': _display_name(sender, m.sender_role, m.is_notice),
        'receiver_id': m.receiver_id,
        'receiver_name': _display_name(receiver, receiver.role if receiver else None),
        'is_notice': m.is_notice,
        'reply_to_id': reply_to_id,
        'reply_to_name': reply_to_name,
        'sender_is_admin': sender_is_admin,
        'created_at': m.created_at.isoformat() if m.created_at else None,
    })

@message_bp.route('/api/message/<int:msg_id>/thread')
def api_message_thread(msg_id):
    """특정 편지의 전체 스레드 조회 — 박스(블록) 구조 포함"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({'error': 'login'}), 401
    m = Message.query.get(msg_id)
    if not m:
        return jsonify({'error': 'not found'}), 404
    if m.receiver_id != uid and m.sender_id != uid:
        role = session.get('role', 'user')
        if not (m.is_public and role in ('admin', 'leader')):
            return jsonify({'error': 'forbidden'}), 403

    rows, root = _thread_rows(m)
    friend_ids = _get_friend_ids(uid)

    # 박스 계산 (배치 단위, 시간순)
    batches = {}
    for r in sorted(rows, key=lambda x: (x.created_at or datetime.min, x.id)):
        bid = _batch_id(r)
        b = batches.get(bid)
        if b is None:
            b = batches[bid] = {'rows': [], 'sender': r.sender_id,
                                'reply_to': r.reply_to_id, 'created': r.created_at}
        b['rows'].append(r)
    order = sorted(batches.keys(), key=lambda k: (batches[k]['created'] or datetime.min))
    root_bid = _batch_id(root)
    root_sender = root.sender_id
    box = {}
    counter = 0
    for bid in order:
        b = batches[bid]
        if b['reply_to'] is None:          # 원문 → 1번 박스
            counter = max(counter, 1)
            box[bid] = 1
            continue
        parent_row = Message.query.get(b['reply_to'])
        pbid = _batch_id(parent_row) if parent_row else root_bid
        pbox = box.get(pbid, 1)
        if b['sender'] == root_sender:     # 발신자(원문 작성자)의 답변 → 새 박스
            counter += 1
            box[bid] = counter
        elif pbid == root_bid:             # 원문 바로 아래 회신 → 원문 박스 유지
            box[bid] = pbox
        elif pbox == 1:                    # 1번 박스 멤버에 대한 답신 → 새 박스
            counter += 1
            box[bid] = counter
        else:                              # 2번 이상 박스 내부 → 같은 박스
            box[bid] = pbox

    # 내게 보이는 행만 (공개 fan-out은 참여자마다 행 1개, 개별답신은 발신자/수신자만)
    my_rows = [r for r in rows if r.sender_id == uid or r.receiver_id == uid]
    seen = set()
    entries = []
    for r in sorted(my_rows, key=lambda x: (x.created_at or datetime.min, x.id)):
        bid = _batch_id(r)
        if bid in seen:
            continue
        seen.add(bid)
        b = batches[bid]
        sender_user = User.query.get(r.sender_id)
        unread = sum(1 for x in b['rows'] if not x.is_read)
        entries.append({
            'id': r.id, 'subject': r.subject, 'content': r.content,
            'sender_id': r.sender_id,
            'sender_name': _display_name(sender_user, r.sender_role, r.is_notice),
            'sender_username': sender_user.email if sender_user else None,
            'sender_role': r.sender_role,
            'sender_is_admin': bool(r.is_notice),
            'sender_is_friend': r.sender_id in friend_ids,
            'is_read': r.is_read,
            'read_at': r.read_at.isoformat() if r.read_at else None,
            'created_at': r.created_at.isoformat() if r.created_at else None,
            'reply_to_id': r.reply_to_id,
            'batch_key': r.batch_key,
            'box_index': box.get(bid, 1),
            'unread_count': unread,
            'total_count': len(b['rows']),
            'letter_type': r.letter_type, 'is_public': r.is_public,
        })

    # 참여자 목록
    participants = {}
    for r in rows:
        for pid in (r.sender_id, r.receiver_id):
            if pid in participants:
                continue
            u = User.query.get(pid)
            participants[pid] = {
                'id': pid,
                'username': _display_name(u),
                'real_name': u.real_name if u else None,
                'role': u.role if u else None,
                'display_name': _display_name(u),
                'is_friend': pid in friend_ids,
            }

    root_user = User.query.get(root.sender_id)
    return jsonify({
        'my_id': uid,
        'root_id': root.id,
        'root_subject': root.subject,
        'root_sender_id': root.sender_id,
        'root_sender_name': _display_name(root_user, root.sender_role, root.is_notice),
        'is_notice': _is_notice_root(root, uid, friend_ids),
        'thread': entries,  # 오래된 순 (클라이언트가 박스 단위 역순 렌더)
        'participants': list(participants.values()),
        'friend_ids': sorted(friend_ids),
    })

@message_bp.route('/api/message/send', methods=['POST'])
def api_message_send():
    uid = session.get('user_id')
    if not uid: return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    ids_raw = request.form.get('receiver_ids') or request.form.get('receiver_id')
    external_email = request.form.get('external_email', '').strip()
    subject = request.form.get('subject', '').strip()
    content = request.form.get('content', '').strip()
    reply_to_id_raw = request.form.get('reply_to_id')
    reply_to_id = int(reply_to_id_raw) if reply_to_id_raw and reply_to_id_raw.isdigit() else None

    has_internal = bool((ids_raw and ids_raw.strip()) or reply_to_id)
    has_external = bool(external_email)

    if not has_internal and not has_external:
        return jsonify({'status': 'error', 'msg': '받는 사람 또는 이메일을 입력하세요.'}), 400
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력하세요.'}), 400

    # ── 외부 이메일: 스팸 필터 ──
    if has_external:
        if not EMAIL_REGEX.match(external_email):
            return jsonify({'status': 'error', 'msg': '올바른 이메일 형식이 아닙니다.'}), 400
        if BlockedEmail.query.filter_by(email=external_email).first():
            return jsonify({'status': 'error', 'msg': '차단된 이메일입니다.'}), 400
        # 분당 발송 제한
        one_min_ago = datetime.now() - timedelta(minutes=1)
        recent_count = EmailRateLimit.query.filter(
            EmailRateLimit.user_id == uid,
            EmailRateLimit.sent_at >= one_min_ago
        ).count()
        if recent_count >= EMAIL_RATE_LIMIT_PER_MIN:
            return jsonify({'status': 'error', 'msg': f'분당 {EMAIL_RATE_LIMIT_PER_MIN}건까지만 발송 가능합니다.'}), 429
        # 일당 발송 제한
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        day_count = EmailRateLimit.query.filter(
            EmailRateLimit.user_id == uid,
            EmailRateLimit.sent_at >= today_start
        ).count()
        if day_count >= EMAIL_RATE_LIMIT_PER_DAY:
            return jsonify({'status': 'error', 'msg': f'일일 {EMAIL_RATE_LIMIT_PER_DAY}건 발송 제한을 초과했습니다.'}), 429

    # ── 내부 편지 처리 ──
    ids = []
    sent = 0
    thread_key = None
    scope = request.form.get('scope', '').strip()  # 회신 시 'public'(전체답신/공개회신) | 'private'
    if has_internal:
        try:
            ids = [int(x.strip()) for x in (ids_raw or '').split(',') if x.strip()]
        except ValueError:
            return jsonify({'status': 'error', 'msg': '받는 사람 형식이 올바르지 않습니다.'}), 400
        ids = list(dict.fromkeys(ids))
        ids = [i for i in ids if i != uid]

        batch_key = uuid.uuid4().hex
        if reply_to_id:
            parent = Message.query.get(reply_to_id)
            if not parent:
                return jsonify({'status': 'error', 'msg': '원문 편지를 찾을 수 없습니다.'}), 404
            if parent.receiver_id != uid and parent.sender_id != uid:
                return jsonify({'status': 'error', 'msg': '열람 권한이 없습니다.'}), 403
            root = _get_root(parent)
            thread_key = _ensure_thread_key(parent)
            i_am_root = (root.sender_id == uid)
            fids = _get_friend_ids(uid)

            if not i_am_root and _is_notice_root(root, uid, fids):
                if root.is_notice or root.sender_id is None:
                    return jsonify({'status': 'error', 'msg': '공지 편지는 회신할 수 없습니다.'}), 400
                return jsonify({'status': 'error', 'msg': '벗이 아니라서 공지사항에는 회신할 수 없습니다.'}), 400

            if i_am_root and scope != 'public':
                # 발신자 개별답신: 지정한 수신자 1명 (없으면 회신 대상)
                if not ids:
                    ids = [parent.sender_id] if parent.sender_id != uid else []
                bad = [i for i in ids if i not in fids]
                if bad:
                    return jsonify({'status': 'error',
                                    'msg': '벗이 아닌 사람에게는 회신할 수 없습니다. 벗 신청 후 이용하세요.'}), 400
            else:
                # 공개 회신/전체답신: 스레드 참여자 전원에게 fan-out
                allowed = (i_am_root or parent.sender_id == uid
                           or parent.sender_id in fids or parent.sender_id == root.sender_id)
                if not allowed:
                    return jsonify({'status': 'error',
                                    'msg': '벗이 아닌 사람에게는 회신할 수 없습니다. 벗 신청 후 이용하세요.'}), 400
                trows, _ = _thread_rows(parent)
                participants = set()
                for r in trows:
                    participants.add(r.sender_id)
                    participants.add(r.receiver_id)
                participants.discard(uid)
                ids = sorted(participants)

        if ids:
            total = LETTER_COST * len(ids)
            balance = _get_balance(uid)
            if balance < total:
                return jsonify({'status': 'error', 'msg': f'屃이 부족합니다. (현재 {balance}屃, 필요 {total}屃)'}), 400
            for rid in ids:
                receiver = User.query.get(rid)
                if not receiver:
                    continue
                if not _deduct_points(uid, LETTER_COST, f'편지 발송 → {rid}'):
                    continue
                msg = Message(
                    sender_id=uid,
                    sender_name=session.get('real_name', session['username']),
                    sender_role=session.get('role', 'user'),
                    receiver_id=receiver.id,
                    subject='' if reply_to_id else subject,  # 회신/답신은 제목 없음
                    content=content,
                    letter_type='normal',
                    reply_to_id=reply_to_id,
                    thread_key=thread_key if reply_to_id else batch_key,
                    batch_key=batch_key,
                )
                db.session.add(msg)
                sent += 1
            db.session.commit()

    # ── 외부 이메일 발송 ──
    email_sent = False
    if has_external:
        from services.email_service import EmailService
        sender_name = session.get('real_name', session.get('username', '함께사는양평'))
        email_subject = subject or f'[함께사는양평] {sender_name}님의 편지'
        email_body = (
            f"보낸 사람: {sender_name}\n"
            f"제목: {subject or '(제목 없음)'}\n"
            f"{'─' * 40}\n\n"
            f"{content}\n\n"
            f"{'─' * 40}\n"
            f"함께사는양평 편지함에서 확인하세요.\n"
            f"{current_app.config.get('SITE_URL', 'https://unocum.kr')}/message/inbox"
        )
        # 이메일 발송 시 Message 레코드도 저장 (발신 기록)
        sender_user = User.query.get(uid)
        msg_ext = Message(
            sender_id=uid,
            sender_name=sender_name,
            sender_role=session.get('role', 'user'),
            receiver_id=uid,  # 발신자가 수신자 기록 (보낸 편지함용)
            subject=subject,
            content=content,
            letter_type='normal',
            reply_to_id=reply_to_id,
            external_email=external_email,
            email_status='sent' if EmailService.send(external_email, email_subject, email_body) else 'failed',
            thread_key=thread_key if reply_to_id else None,
            batch_key=uuid.uuid4().hex if reply_to_id else None,
        )
        db.session.add(msg_ext)
        db.session.commit()
        email_sent = msg_ext.email_status == 'sent'
        # 발송 빈도 기록
        rate = EmailRateLimit(user_id=uid)
        db.session.add(rate)
        db.session.commit()

    # 회신/답신 시 내가 받은 원문(내 사본) 자동 읽음 처리 (내가 보낸 사본은 미확인 유지)
    if reply_to_id:
        orig = Message.query.get(reply_to_id)
        if orig and not orig.is_read and orig.receiver_id == uid:
            orig.is_read = True
            orig.read_at = datetime.now()
            db.session.commit()

    msgs = []
    if sent > 0:
        msgs.append(f'{sent}명에게 편지가 전송되었습니다.')
    if has_external:
        msgs.append(f'외부 이메일({external_email}) {"발송 완료" if email_sent else "발송 실패"}')
    if not msgs:
        return jsonify({'status': 'error', 'msg': '전송할 대상을 찾지 못했습니다.'}), 400
    return jsonify({'status': 'success', 'msg': ' '.join(msgs)})

import os as _os
import uuid
import io
import time
import ftplib
from werkzeug.utils import secure_filename
from services.security import validate_upload, secure_save

# FTP 접근 불가 시 매 요청마다 30s 타임아웃을 기다리지 않도록 실패를 잠깐 캐싱
_ftp_cache = {'ok': None, 'ts': 0.0, 'ttl': 60.0}


def _ftp_config():
    cfg = current_app.config
    if not cfg.get('FTP_ENABLED'):
        return None
    return {
        'host': cfg.get('FTP_HOST'),
        'port': int(cfg.get('FTP_PORT', 21)),
        'user': cfg.get('FTP_USER'),
        'pass': cfg.get('FTP_PASS'),
        'remote_dir': (cfg.get('FTP_REMOTE_DIR') or '/').strip(),
        'use_tls': bool(cfg.get('FTP_USE_TLS', False)),
    }


def _ftp_connect(cfg):
    now = time.time()
    if _ftp_cache['ok'] is False and (now - _ftp_cache['ts']) < _ftp_cache['ttl']:
        return None  # 최근 연결 실패 캐싱: 바로 로컬 폴백
    try:
        if cfg['use_tls']:
            ftp = ftplib.FTP_TLS()
        else:
            ftp = ftplib.FTP()
        ftp.connect(cfg['host'], cfg['port'], timeout=10)
        ftp.login(cfg['user'], cfg['pass'])
        if cfg['use_tls']:
            ftp.prot_p()
        rdir = cfg['remote_dir']
        if rdir and rdir not in ('/', ''):
            parts = [p for p in rdir.split('/') if p]
            try:
                ftp.cwd(rdir)
            except ftplib.error_perm:
                ftp.cwd('/')
                for p in parts:
                    try:
                        ftp.cwd(p)
                    except ftplib.error_perm:
                        ftp.mkd(p)
                        ftp.cwd(p)
        _ftp_cache['ok'] = True
        _ftp_cache['ts'] = now
        return ftp
    except Exception as e:
        current_app.logger.warning('FTP 연결 실패: %s', e)
        _ftp_cache['ok'] = False
        _ftp_cache['ts'] = now
        return None


def _ftp_store(filename, data):
    """FTP에 파일 저장. 성공 True / 실패 False"""
    cfg = _ftp_config()
    if not cfg or not cfg['host']:
        return False
    ftp = _ftp_connect(cfg)
    if not ftp:
        return False
    try:
        data.seek(0)
        ftp.storbinary('STOR ' + filename, data)
        return True
    except Exception as e:
        current_app.logger.warning('FTP 업로드 실패: %s', e)
        return False
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


def _ftp_retrieve(filename):
    """FTP에서 파일 바이트 반환. 실패/없음 시 None"""
    cfg = _ftp_config()
    if not cfg or not cfg['host']:
        return None
    ftp = _ftp_connect(cfg)
    if not ftp:
        return None
    try:
        buf = io.BytesIO()
        ftp.retrbinary('RETR ' + filename, buf.write)
        buf.seek(0)
        return buf
    except Exception as e:
        current_app.logger.warning('FTP 다운로드 실패: %s', e)
        return None
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

@message_bp.route('/api/message/upload-image', methods=['POST'])
def api_message_upload_image():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    file = request.files.get('image') or request.files.get('file')
    if not file: return jsonify({'error': '파일 없음'}), 400
    ok, msg = validate_upload(file)
    if not ok: return jsonify({'error': msg}), 400
    upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'message_images')
    _os.makedirs(upload_dir, exist_ok=True)
    try:
        path = secure_save(file, upload_dir)
        url = '/static/uploads/message_images/' + _os.path.basename(path)
        return jsonify({'status': 'success', 'url': url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@message_bp.route('/api/upload/file', methods=['POST'])
def api_upload_file():
    """일반 파일 첨부 업로드 (확장자/용량 제한 없음). 편지·게시글 공용."""
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    file = request.files.get('file')
    if not file: return jsonify({'error': '파일 없음'}), 400
    original = file.filename or 'file'
    clean = secure_filename(original)
    if not clean:
        clean = 'file'
    ext = original.rsplit('.', 1)[1].lower() if '.' in original else ''
    safe_name = uuid.uuid4().hex + ('.' + ext if ext else '')
    upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'general_files')
    _os.makedirs(upload_dir, exist_ok=True)
    save_path = _os.path.join(upload_dir, safe_name)
    try:
        file.seek(0)
        file.save(save_path)
        size = _os.path.getsize(save_path)
        # FTP 저장소가 활성화되면 원격에도 업로드 (실패해도 로컬 복사본 유지)
        if current_app.config.get('FTP_ENABLED'):
            try:
                with open(save_path, 'rb') as f:
                    _ftp_store(safe_name, f)
            except Exception as e:
                current_app.logger.warning('FTP 백업 업로드 실패(로컬 유지): %s', e)
        url = '/files/' + safe_name
        return jsonify({'url': url, 'name': original, 'size': size})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@message_bp.route('/files/<path:filename>')
def serve_general_file(filename):
    """업로드된 일반 파일을 항상 첨부 다운로드로 제공 (인라인 렌더링 차단 → 저장형 XSS 방지).
       FTP 저장소가 활성화되면 FTP에서 우선 조회하고, 없으면 로컬 폴백."""
    if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
        return jsonify({'error': 'invalid'}), 400
    if current_app.config.get('FTP_ENABLED'):
        data = _ftp_retrieve(filename)
        if data is not None:
            resp = send_file(data, as_attachment=True)
            resp.headers['Content-Disposition'] = 'attachment; filename="%s"' % filename
            resp.headers['X-Content-Type-Options'] = 'nosniff'
            return resp
    upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'general_files')
    full = _os.path.join(upload_dir, filename)
    if not _os.path.isfile(full):
        return jsonify({'error': 'not found'}), 404
    resp = send_file(full, as_attachment=True, download_name=filename)
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    return resp

@message_bp.route('/message/send/global', methods=['GET', 'POST'])
def send_message_global():
    if not session.get('username'):
        return redirect(url_for('auth.login', next=request.path))
    uid = session['user_id']
    # 전체관리자(내부 ID) 조회
    from models import User
    admin_user = User.query.filter(User.role == 'admin').first()
    if not admin_user:
        return jsonify({'error': '전체관리자 없음'}), 404
    receiver = admin_user
    is_admin = True
    is_village_leader = False
    admin_type = 'global'

    if request.method == 'POST':
        subject = request.form.get('subject', '').strip()
        content = request.form.get('content', '').strip()
        agree_public = request.form.get('agree_public')
        agree_conduct = request.form.get('agree_conduct')

        if not subject or not content:
            return jsonify({'error': '제목과 내용을 입력하세요.'}), 400

        balance = _get_balance(uid)
        if balance < LETTER_COST:
            return jsonify({'error': f'坭가 부족합니다. (현재 {balance}坭, 필요 {LETTER_COST}坭)'}), 400

        if not agree_public:
            return jsonify({'error': '공개편지 동의가 필요합니다.'}), 400
        if not agree_conduct:
            return jsonify({'error': '행동강령 동의가 필요합니다.'}), 400

        if not _deduct_points(uid, LETTER_COST, f'편지 발송 → 전체관리자'):
            return jsonify({'error': '坭 차감 실패'}), 400

        msg = Message(
            sender_id=uid,
            sender_name=session.get('real_name', session['username']),
            sender_role=session.get('role', 'user'),
            receiver_id=receiver.id,
            subject=subject,
            content=content,
            is_public=True,
            letter_type='pending',
            town=User.query.get(uid).town or '',
            village=User.query.get(uid).village or '',
            original_receiver_type='global',
            moderation_status='pending'
        )
        db.session.add(msg)
        db.session.commit()

        return jsonify({'success': True, 'msg': f'{LETTER_COST}坭이 차감되었습니다. ({_get_balance(uid)}坭 남음)'})

    return _serve_spa()


@message_bp.route('/message/send/admin', methods=['GET', 'POST'])
def send_message_admin():
    """전체관리자에게 편지 보내기 (내부 관리자 ID로 발송)"""
    if not session.get('username'):
        return redirect(url_for('auth.login', next=request.path))
    uid = session['user_id']
    internal_admin = _get_internal_admin()
    if not internal_admin:
        return jsonify({'error': '내부 관리자 계정을 찾을 수 없습니다.'}), 500

    if request.method == 'POST':
        subject = request.form.get('subject', '').strip()
        content = request.form.get('content', '').strip()
        agree_public = request.form.get('agree_public')
        agree_conduct = request.form.get('agree_conduct')

        if not subject or not content:
            return jsonify({'error': '제목과 내용을 입력하세요.'}), 400

        balance = _get_balance(uid)
        if balance < LETTER_COST:
            return jsonify({'error': f'坭가 부족합니다. (현재 {balance}坭, 필요 {LETTER_COST}坭)'}), 400
        if not agree_public:
            return jsonify({'error': '공개편지 동의가 필요합니다.'}), 400
        if not agree_conduct:
            return jsonify({'error': '행동강령 동의가 필요합니다.'}), 400
        if not _deduct_points(uid, LETTER_COST, '편지 발송 → 전체관리자'):
            return jsonify({'error': '坭 차감에 실패했습니다.'}), 400

        msg = Message(
            sender_id=uid,
            sender_name=session.get('real_name', session['username']),
            sender_role=session.get('role', 'user'),
            receiver_id=INTERNAL_ADMIN_ID,  # 내부 관리자 ID로 발송
            subject=subject,
            content=content,
            is_public=True,
            letter_type='admin'
        )
        db.session.add(msg)
        db.session.commit()
        return jsonify({'success': True, 'msg': f'{LETTER_COST}坭이 차감되었습니다. ({_get_balance(uid)}坭 남음)'})

    return _serve_spa()

@message_bp.route('/message/send/village_leader', methods=['GET', 'POST'])
def send_message_village_leader():
    """마을지기에게 편지 보내기 (해당 읍/면/리 마을지기)"""
    if not session.get('username'):
        return redirect(url_for('auth.login', next=request.path))
    uid = session['user_id']
    me = User.query.get(uid)
    village_leader = _get_village_leader(me.town, me.village) if me else None
    
    if not village_leader:
        return jsonify({'error': '해당 지역의 마을지기가 없습니다.'}), 404

    if request.method == 'POST':
        subject = request.form.get('subject', '').strip()
        content = request.form.get('content', '').strip()
        agree_public = request.form.get('agree_public')
        agree_conduct = request.form.get('agree_conduct')

        if not subject or not content:
            return jsonify({'error': '제목과 내용을 입력하세요.'}), 400

        balance = _get_balance(uid)
        if balance < LETTER_COST:
            return jsonify({'error': f'坭가 부족합니다. (현재 {balance}坭, 필요 {LETTER_COST}坭)'}), 400
        if not agree_public:
            return jsonify({'error': '공개편지 동의가 필요합니다.'}), 400
        if not agree_conduct:
            return jsonify({'error': '행동강령 동의가 필요합니다.'}), 400
        if not _deduct_points(uid, LETTER_COST, f'편지 발송 → 마을지기({village_leader.real_name or village_leader.username})'):
            return jsonify({'error': '坭 차감에 실패했습니다.'}), 400

        msg = Message(
            sender_id=uid,
            sender_name=session.get('real_name', session['username']),
            sender_role=session.get('role', 'user'),
            receiver_id=village_leader.id,
            subject=subject,
            content=content,
            is_public=True,
            letter_type='village_leader'
        )
        db.session.add(msg)
        db.session.commit()
        return jsonify({'success': True, 'msg': f'{LETTER_COST}坭이 차감되었습니다. ({_get_balance(uid)}坭 남음)'})

    return _serve_spa()


@message_bp.route('/message/read/<int:msg_id>', methods=['GET', 'POST'])
def read_message(msg_id):
    if not session.get('username'):
        return redirect(url_for('auth.login', next=request.path))
    uid = session['user_id']
    role = session.get('role', 'user')
    msg = Message.query.get_or_404(msg_id)

    # 열람 권한: 받은 사람 본인, 또는 공개편지且 관리자/책임자
    if msg.receiver_id != uid and not (msg.is_public and role in ['admin', 'leader']):
        return jsonify({'error': '권한 없음'}), 403

    msg.is_read = True
    if not msg.read_at:
        msg.read_at = datetime.now()
    db.session.commit()

    if request.method == 'POST':
        return jsonify({'status': 'success'})
    return redirect(url_for('.message_inbox'))


@message_bp.route('/api/message/delete/<int:msg_id>', methods=['POST'])
def api_message_delete(msg_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    msg = Message.query.get_or_404(msg_id)
    # 삭제 권한: 보낸 사람 본인 또는 받은 사람 본인
    if msg.sender_id != uid and msg.receiver_id != uid:
        return jsonify({'status': 'error', 'msg': '권한 없음'}), 403
    try:
        if msg.sender_id == uid:
            # 발신자 삭제: 한 수신자라도 읽었으면 삭제 불가 (사본 삭제는 수신자 본인이 읽은 후에도 가능)
            # 단, 공지(is_notice)는 발신자가 읽은 후에도 삭제 가능 (공지 정리)
            if msg.batch_key:
                rows = Message.query.filter_by(batch_key=msg.batch_key).all()
                if any(r.is_read for r in rows) and not msg.is_notice:
                    return jsonify({'status': 'error', 'msg': '이미 읽은 편지는 삭제할 수 없습니다.'}), 400
                for r in rows:
                    db.session.delete(r)
            else:
                if msg.is_read and not msg.is_notice:
                    return jsonify({'status': 'error', 'msg': '이미 읽은 편지는 삭제할 수 없습니다.'}), 400
                db.session.delete(msg)
        else:
            # 수신자: 본인 사본만 삭제
            db.session.delete(msg)
        db.session.commit()
        return jsonify({'status': 'success'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@message_bp.route('/api/message/sender-archive/<int:msg_id>', methods=['POST'])
def api_message_sender_archive(msg_id):
    """발신 공지 보관 처리: 발신자의 공지 탭에서 보관함으로 이동 (수신자 상태는 불변)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    msg = Message.query.get_or_404(msg_id)
    if msg.sender_id != uid:
        return jsonify({'status': 'error', 'msg': '권한 없음'}), 403
    if not msg.is_notice:
        return jsonify({'status': 'error', 'msg': '공지만 보관 처리할 수 있습니다.'}), 400
    try:
        if msg.batch_key:
            rows = Message.query.filter_by(batch_key=msg.batch_key).all()
        else:
            rows = [msg]
        for r in rows:
            r.sender_archived = True
        db.session.commit()
        return jsonify({'status': 'success'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@message_bp.route('/api/message/<int:msg_id>/edit', methods=['POST'])
def api_message_edit(msg_id):
    """보낸 편지 수정 (전원 미확인일 때만, 배치 전체 동시 수정)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    msg = Message.query.get(msg_id)
    if not msg:
        return jsonify({'status': 'error', 'msg': 'not found'}), 404
    if msg.sender_id != uid:
        return jsonify({'status': 'error', 'msg': '권한 없음'}), 403
    data = request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    subject = data.get('subject')
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력하세요.'}), 400
    rows = (Message.query.filter_by(batch_key=msg.batch_key).all()
            if msg.batch_key else [msg])
    if any(r.is_read for r in rows):
        return jsonify({'status': 'error', 'msg': '이미 읽은 편지는 수정할 수 없습니다.'}), 400
    try:
        for r in rows:
            r.content = content
            if subject is not None and not r.reply_to_id:
                r.subject = subject
        db.session.commit()
        return jsonify({'status': 'success'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@message_bp.route('/friends/list')
def friends_list():
    """JSON으로 벗 목록 반환 (편지 대상 선택용)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({'friends': []})
    f1 = Friend.query.filter_by(requester_id=uid, status='accepted').all()
    f2 = Friend.query.filter_by(receiver_id=uid, status='accepted').all()
    ids = set([f.receiver_id for f in f1] + [f.requester_id for f in f2])
    users = User.query.filter(User.id.in_(ids)).all() if ids else []
    return jsonify({'friends': [{'id': u.id, 'name': u.real_name or u.username, 'town': u.town or '', 'village': u.village or ''} for u in users]})

@message_bp.route('/message/admin/pending')
def admin_pending_letters():
    """관리자용 보류 편지함 (관리자/마을지기 공통 접근)"""
    if not session.get('username'):
        return redirect(url_for('auth.login', next=request.path))
    uid = session['user_id']
    role = session.get('role', 'user')
    
    # 관리자 또는 마을지기만 접근 가능
    if role not in ['admin', 'leader']:
        return '권한 없음', 403
    
    me = User.query.get(uid)
    
    # 관리자는 전체, 마을지기는 자기 읍/면/리만
    if role == 'admin':
        pending = Message.query.filter_by(letter_type='pending').order_by(Message.created_at.desc()).all()
    else:
        pending = Message.query.filter(
            Message.letter_type == 'pending',
            Message.town == me.town,
            Message.village == me.village
        ).order_by(Message.created_at.desc()).all()
    
    return _serve_spa()

@message_bp.route('/message/admin/pending/<int:msg_id>/approve', methods=['POST'])
def admin_approve_pending(msg_id):
    """보류 편지 승인 -> 실제 수신자에게 전달"""
    if not session.get('username'):
        return jsonify({'error': '로그인 필요'}), 401
    role = session.get('role', 'user')
    if role not in ['admin', 'leader']:
        return jsonify({'error': '권한 없음'}), 403
    
    msg = Message.query.get_or_404(msg_id)
    if msg.letter_type != 'pending':
        return jsonify({'error': '잘못된 요청'}), 400
    
    # 원래 수신자 결정 (전체관리자 또는 마을지기)
    if msg.original_receiver_type == 'global':
        real_receiver_id = INTERNAL_ADMIN_ID
    else:
        me = User.query.get(session['user_id'])
        leader = _get_village_leader(me.town, me.village)
        real_receiver_id = leader.id if leader else INTERNAL_ADMIN_ID
    
    msg.receiver_id = real_receiver_id
    msg.letter_type = 'admin' if msg.original_receiver_type == 'global' else 'village_leader'
    msg.is_public = True
    msg.moderation_status = 'approved'
    db.session.commit()
    
    return jsonify({'success': True})

@message_bp.route('/message/admin/pending/<int:msg_id>/reject', methods=['POST'])
def admin_reject_pending(msg_id):
    """보류 편지 반려 -> 발송자에게 AI관리자 명의로 통보"""
    if not session.get('username'):
        return jsonify({'error': '로그인 필요'}), 401
    role = session.get('role', 'user')
    if role not in ['admin', 'leader']:
        return jsonify({'error': '권한 없음'}), 403
    
    msg = Message.query.get_or_404(msg_id)
    if msg.letter_type != 'pending':
        return jsonify({'error': '잘못된 요청'}), 400
    
    ai_admin = _get_ai_admin()
    reason = request.form.get('reason', '내용 검토 결과 부적절함')
    
    # 발송자에게 반려 통보 (AI관리자 명의)
    reject_msg = Message(
        sender_id=INTERNAL_AI_ADMIN_ID,
        sender_name='함께사는양평',
        sender_role='admin',
        receiver_id=msg.sender_id,
        subject='편지 발송 반려: ' + msg.subject,
        content=('[함께사는양평 알림] 귀하가 보낸 편지(제목: ' + msg.subject + ')가 검토 결과 반려되었습니다.\n\n'
                 '반려 사유: ' + reason + '\n\n'
                 '※ 이 메시지는 자동 검토 시스템에 의해 발송되었습니다.'),
        is_public=False,
        letter_type='ai_reject',
        is_notice=True
    )
    db.session.add(reject_msg)
    
    # 원본 편지 상태 업데이트
    msg.moderation_status = 'rejected'
    msg.rejection_reason = reason
    db.session.commit()
    
    return jsonify({'success': True})


# ── 차단 이메일 관리 (관리자) ──

@message_bp.route('/api/admin/blocked-emails')
def api_blocked_emails_list():
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({'error': 'forbidden'}), 403
    items = BlockedEmail.query.order_by(BlockedEmail.created_at.desc()).all()
    return jsonify([{
        'id': b.id, 'email': b.email, 'reason': b.reason,
        'created_at': b.created_at.isoformat() if b.created_at else None,
    } for b in items])

@message_bp.route('/api/admin/blocked-emails', methods=['POST'])
def api_blocked_email_add():
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({'error': 'forbidden'}), 403
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    reason = (data.get('reason') or '').strip()
    if not email:
        return jsonify({'error': '이메일을 입력하세요'}), 400
    if BlockedEmail.query.filter_by(email=email).first():
        return jsonify({'error': '이미 차단된 이메일입니다'}), 409
    b = BlockedEmail(email=email, reason=reason)
    db.session.add(b)
    db.session.commit()
    return jsonify({'success': True, 'id': b.id})

@message_bp.route('/api/admin/blocked-emails/<int:bid>', methods=['DELETE'])
def api_blocked_email_delete(bid):
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({'error': 'forbidden'}), 403
    b = BlockedEmail.query.get(bid)
    if not b:
        return jsonify({'error': 'not found'}), 404
    db.session.delete(b)
    db.session.commit()
    return jsonify({'success': True})
