from flask import Blueprint, request, jsonify, session, current_app, send_file
from models import (
    db, User, Message, Friend,
    DiscussionRoom, DiscussionParticipant, DiscussionMessage, DiscussionVote,
    DiscussionProposal, DiscussionProposalVote,
)
from datetime import datetime, timedelta
import json

discussion_bp = Blueprint('discussion', __name__)


def _uid():
    return session.get('user_id')


def _serve_spa():
    import os
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    return 'Not Found', 404


def _get_thread_participants(root_id):
    """편지 스레드의 모든 참여자 ID 반환"""
    participants = set()
    msg = Message.query.get(root_id)
    if msg:
        participants.add(msg.sender_id)
        participants.add(msg.receiver_id)
    children = Message.query.filter(Message.reply_to_id == root_id).all()
    for c in children:
        participants.add(c.sender_id)
        participants.add(c.receiver_id)
    return participants


def _check_room_participant(room_id, uid):
    return DiscussionParticipant.query.filter_by(room_id=room_id, user_id=uid).first()


# ── SPA 페이지 ──

@discussion_bp.route('/discussion')
def discussion_list_page():
    if not session.get('username'):
        return _serve_spa()
    return _serve_spa()


@discussion_bp.route('/discussion/<int:room_id>')
def discussion_room_page(room_id):
    if not session.get('username'):
        return _serve_spa()
    return _serve_spa()


# ── 토론 제안 ──

@discussion_bp.route('/api/discussion/proposals', methods=['POST'])
def api_create_proposal():
    """편지 스레드에서 토론 제안 생성"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    data = request.get_json()
    thread_root_id = data.get('thread_root_id')
    required_agree_count = data.get('required_agree_count', 2)
    voting_days = data.get('voting_days', 3)

    if not thread_root_id:
        return jsonify({'error': '스레드 정보가 없습니다.'}), 400

    root = Message.query.get(thread_root_id)
    if not root:
        return jsonify({'error': '원문을 찾을 수 없습니다.'}), 404

    # 스레드 참여자 확인
    participants = _get_thread_participants(thread_root_id)
    if uid not in participants:
        return jsonify({'error': '스레드 참여자만 제안할 수 있습니다.'}), 403

    # 기존 투표 진행 중인 제안 확인
    existing = DiscussionProposal.query.filter_by(
        thread_root_id=thread_root_id, status='voting'
    ).first()
    if existing:
        return jsonify({'error': '이미 투표 진행 중인 제안이 있습니다.'}), 400

    proposal = DiscussionProposal(
        thread_root_id=thread_root_id,
        proposed_by=uid,
        required_agree_count=required_agree_count,
        voting_end_at=datetime.now() + timedelta(days=voting_days),
    )
    db.session.add(proposal)
    db.session.commit()

    return jsonify({
        'status': 'success',
        'proposal_id': proposal.id,
        'msg': f'토론 제안이 생성되었습니다. {voting_days}일 내 {required_agree_count}명 이상 동의 시 토론방이 개설됩니다.',
    })


@discussion_bp.route('/api/discussion/proposals/<int:proposal_id>')
def api_get_proposal(proposal_id):
    """제안 상세 조회"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    p = DiscussionProposal.query.get(proposal_id)
    if not p:
        return jsonify({'error': 'not found'}), 404

    proposer = User.query.get(p.proposed_by)
    thread_root = Message.query.get(p.thread_root_id)
    root_sender = User.query.get(thread_root.sender_id) if thread_root else None

    # 투표 현황
    votes = DiscussionProposalVote.query.filter_by(proposal_id=proposal_id).all()
    agree_count = sum(1 for v in votes if v.vote == 'agree')
    disagree_count = sum(1 for v in votes if v.vote == 'disagree')

    # 내 투표
    my_vote = next((v.vote for v in votes if v.user_id == uid), None)

    # 스레드 참여자 목록
    thread_participants = []
    for pid in _get_thread_participants(p.thread_root_id):
        u = User.query.get(pid)
        if u:
            thread_participants.append({
                'id': u.id,
                'name': u.real_name or u.username,
            })

    return jsonify({
        'id': p.id,
        'thread_root_id': p.thread_root_id,
        'thread_subject': thread_root.subject if thread_root else '',
        'proposed_by': proposer.real_name or proposer.username if proposer else '',
        'required_agree_count': p.required_agree_count,
        'status': p.status,
        'voting_end_at': p.voting_end_at.isoformat() if p.voting_end_at else None,
        'agree_count': agree_count,
        'disagree_count': disagree_count,
        'my_vote': my_vote,
        'thread_participants': thread_participants,
        'room_id': p.room_id,
        'created_at': p.created_at.isoformat() if p.created_at else None,
    })


@discussion_bp.route('/api/discussion/proposals/<int:proposal_id>/vote', methods=['POST'])
def api_vote_proposal(proposal_id):
    """토론 제안 투표"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    p = DiscussionProposal.query.get(proposal_id)
    if not p:
        return jsonify({'error': 'not found'}), 404
    if p.status != 'voting':
        return jsonify({'error': '투표가 마감되었습니다.'}), 400

    # 스레드 참여자 확인
    participants = _get_thread_participants(p.thread_root_id)
    if uid not in participants:
        return jsonify({'error': '스레드 참여자만 투표할 수 있습니다.'}), 403

    data = request.get_json()
    vote = data.get('vote')  # agree, disagree
    if vote not in ('agree', 'disagree'):
        return jsonify({'error': '잘못된 투표입니다.'}), 400

    existing = DiscussionProposalVote.query.filter_by(
        proposal_id=proposal_id, user_id=uid
    ).first()
    if existing:
        existing.vote = vote
    else:
        v = DiscussionProposalVote(
            proposal_id=proposal_id, user_id=uid, vote=vote
        )
        db.session.add(v)

    db.session.commit()

    # 투표 결과 확인
    votes = DiscussionProposalVote.query.filter_by(proposal_id=proposal_id).all()
    agree_count = sum(1 for v in votes if v.vote == 'agree')

    if agree_count >= p.required_agree_count:
        p.status = 'approved'
        db.session.commit()

    return jsonify({
        'status': 'success',
        'agree_count': agree_count,
        'required': p.required_agree_count,
        'proposal_status': p.status,
    })


@discussion_bp.route('/api/discussion/proposals/<int:proposal_id>/schedule', methods=['POST'])
def api_schedule_proposal(proposal_id):
    """투표 통과 후 마감시간 설정"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    p = DiscussionProposal.query.get(proposal_id)
    if not p:
        return jsonify({'error': 'not found'}), 404
    if p.status != 'approved':
        return jsonify({'error': '승인된 제안만 일정을 설정할 수 있습니다.'}), 400
    if p.proposed_by != uid:
        return jsonify({'error': '제안자만 일정을 설정할 수 있습니다.'}), 403

    data = request.get_json()
    end_at_str = data.get('end_at')
    topic = data.get('topic', '')
    description = data.get('description', '')

    if not end_at_str:
        return jsonify({'error': '마감시간을 설정해주세요.'}), 400

    end_at = datetime.fromisoformat(end_at_str.replace('Z', '+00:00').replace('+00:00', ''))

    # 토론방 생성
    room = DiscussionRoom(
        topic=topic or f'토론: {p.thread_root.subject if p.thread_root else ""}',
        description=description,
        created_by=uid,
        letter_root_id=p.thread_root_id,
        end_at=end_at,
    )
    db.session.add(room)
    db.session.flush()

    # 제안자 참여자로 추가
    creator = DiscussionParticipant(
        room_id=room.id, user_id=uid, role='creator', invited_via='thread'
    )
    db.session.add(creator)

    # 스레드 참여자 전원 참여자로 추가
    for pid in _get_thread_participants(p.thread_root_id):
        if pid != uid:
            part = DiscussionParticipant(
                room_id=room.id, user_id=pid, role='member', invited_via='thread'
            )
            db.session.add(part)

    p.room_id = room.id
    db.session.commit()

    return jsonify({
        'status': 'success',
        'room_id': room.id,
        'msg': '토론방이 개설되었습니다.',
    })


# ── 토론방 직접 개설 ──

@discussion_bp.route('/api/discussion/rooms', methods=['POST'])
def api_create_room():
    """토론방 직접 개설"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    data = request.get_json()
    topic = data.get('topic', '')
    description = data.get('description', '')
    end_at_str = data.get('end_at')
    friend_ids = data.get('friend_ids', [])
    letter_root_id = data.get('letter_root_id')

    if not topic:
        return jsonify({'error': '주제를 입력해주세요.'}), 400

    end_at = None
    if end_at_str:
        end_at = datetime.fromisoformat(end_at_str.replace('Z', '+00:00').replace('+00:00', ''))

    room = DiscussionRoom(
        topic=topic,
        description=description,
        created_by=uid,
        letter_root_id=letter_root_id,
        end_at=end_at,
    )
    db.session.add(room)
    db.session.flush()

    # 개설자 참여
    db.session.add(DiscussionParticipant(
        room_id=room.id, user_id=uid, role='creator', invited_via='friend_select'
    ))

    # 친구 초대
    for fid in friend_ids:
        if fid != uid:
            db.session.add(DiscussionParticipant(
                room_id=room.id, user_id=fid, role='member', invited_via='friend_select'
            ))

    db.session.commit()

    return jsonify({'status': 'success', 'room_id': room.id})


@discussion_bp.route('/api/discussion/rooms')
def api_list_rooms():
    """내 토론방 목록"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    parts = DiscussionParticipant.query.filter_by(user_id=uid).all()
    room_ids = [p.room_id for p in parts]

    rooms = DiscussionRoom.query.filter(
        DiscussionRoom.id.in_(room_ids)
    ).order_by(DiscussionRoom.created_at.desc()).all()

    result = []
    for r in rooms:
        creator = User.query.get(r.created_by)
        msg_count = DiscussionMessage.query.filter_by(room_id=r.id).count()
        part_count = DiscussionParticipant.query.filter_by(room_id=r.id).count()
        unread = DiscussionMessage.query.filter(
            DiscussionMessage.room_id == r.id,
            DiscussionMessage.user_id != uid,
            DiscussionMessage.id > 0,
        ).count()

        result.append({
            'id': r.id,
            'topic': r.topic,
            'status': r.status,
            'created_by': creator.real_name or creator.username if creator else '',
            'end_at': r.end_at.isoformat() if r.end_at else None,
            'message_count': msg_count,
            'participant_count': part_count,
            'has_summary': bool(r.summary_text),
            'created_at': r.created_at.isoformat() if r.created_at else None,
        })

    return jsonify({'rooms': result})


@discussion_bp.route('/api/discussion/rooms/<int:room_id>')
def api_get_room(room_id):
    """토론방 상세 + 참여자"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    room = DiscussionRoom.query.get(room_id)
    if not room:
        return jsonify({'error': 'not found'}), 404

    me = _check_room_participant(room_id, uid)
    if not me:
        return jsonify({'error': '참여자가 아닙니다.'}), 403

    creator = User.query.get(room.created_by)
    participants = []
    for p in DiscussionParticipant.query.filter_by(room_id=room_id).all():
        u = User.query.get(p.user_id)
        participants.append({
            'id': u.id if u else 0,
            'name': u.real_name or u.username if u else '',
            'role': p.role,
            'joined_at': p.joined_at.isoformat() if p.joined_at else None,
        })

    # 원문 편지 정보
    letter_info = None
    if room.letter_root_id:
        root = Message.query.get(room.letter_root_id)
        if root:
            sender = User.query.get(root.sender_id)
            letter_info = {
                'id': root.id,
                'subject': root.subject,
                'sender': sender.real_name or sender.username if sender else '',
                'created_at': root.created_at.isoformat() if root.created_at else None,
            }

    return jsonify({
        'id': room.id,
        'topic': room.topic,
        'description': room.description,
        'status': room.status,
        'end_at': room.end_at.isoformat() if room.end_at else None,
        'summary_text': room.summary_text,
        'summary_confirmed': room.summary_confirmed,
        'letter_root_id': room.letter_root_id,
        'letter_info': letter_info,
        'creator': creator.real_name or creator.username if creator else '',
        'participants': participants,
        'created_at': room.created_at.isoformat() if room.created_at else None,
    })


@discussion_bp.route('/api/discussion/rooms/<int:room_id>/join', methods=['POST'])
def api_join_room(room_id):
    """링크로 토론방 참여"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    room = DiscussionRoom.query.get(room_id)
    if not room or room.status != 'open':
        return jsonify({'error': '토론방을 찾을 수 없습니다.'}), 404

    existing = _check_room_participant(room_id, uid)
    if existing:
        return jsonify({'status': 'success', 'msg': '이미 참여 중입니다.'})

    db.session.add(DiscussionParticipant(
        room_id=room_id, user_id=uid, role='member', invited_via='link'
    ))
    db.session.commit()

    return jsonify({'status': 'success', 'msg': '토론방에 참여했습니다.'})


@discussion_bp.route('/api/discussion/rooms/<int:room_id>/invite', methods=['POST'])
def api_invite_room(room_id):
    """벗 초대"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    me = _check_room_participant(room_id, uid)
    if not me:
        return jsonify({'error': '참여자가 아닙니다.'}), 403

    data = request.get_json()
    friend_ids = data.get('friend_ids', [])

    invited = 0
    for fid in friend_ids:
        existing = _check_room_participant(room_id, fid)
        if not existing:
            db.session.add(DiscussionParticipant(
                room_id=room_id, user_id=fid, role='member', invited_via='friend_select'
            ))
            invited += 1

    db.session.commit()

    return jsonify({'status': 'success', 'invited': invited})


# ── 토론 메시지 ──

@discussion_bp.route('/api/discussion/rooms/<int:room_id>/messages')
def api_list_messages(room_id):
    """토론 메시지 목록"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    me = _check_room_participant(room_id, uid)
    if not me:
        return jsonify({'error': '참여자가 아닙니다.'}), 403

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)

    msgs = DiscussionMessage.query.filter_by(room_id=room_id).order_by(
        DiscussionMessage.created_at.desc()
    ).paginate(page=page, per_page=per_page, error_out=False)

    result = []
    for m in msgs.items:
        user = User.query.get(m.user_id)
        vote_counts = db.session.query(
            DiscussionVote.vote, db.func.count(DiscussionVote.id)
        ).filter_by(message_id=m.id).group_by(DiscussionVote.vote).all()
        vote_map = dict(vote_counts)

        my_vote = DiscussionVote.query.filter_by(message_id=m.id, user_id=uid).first()

        result.append({
            'id': m.id,
            'user_id': m.user_id,
            'user_name': user.real_name or user.username if user else '',
            'content': m.content,
            'content_type': m.content_type,
            'reply_to_id': m.reply_to_id,
            'like_count': vote_map.get('like', 0),
            'dislike_count': vote_map.get('dislike', 0),
            'my_vote': my_vote.vote if my_vote else None,
            'created_at': m.created_at.isoformat() if m.created_at else None,
        })

    return jsonify({
        'messages': result,
        'total': msgs.total,
        'pages': msgs.pages,
        'current_page': page,
    })


@discussion_bp.route('/api/discussion/rooms/<int:room_id>/messages', methods=['POST'])
def api_send_message(room_id):
    """토론 메시지 발송"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    me = _check_room_participant(room_id, uid)
    if not me:
        return jsonify({'error': '참여자가 아닙니다.'}), 403

    room = DiscussionRoom.query.get(room_id)
    if not room or room.status != 'open':
        return jsonify({'error': '토론방이 닫혀있습니다.'}), 400

    data = request.get_json()
    content = data.get('content', '').strip()
    content_type = data.get('content_type', 'text')
    reply_to_id = data.get('reply_to_id')

    if not content:
        return jsonify({'error': '내용을 입력해주세요.'}), 400

    msg = DiscussionMessage(
        room_id=room_id,
        user_id=uid,
        content=content,
        content_type=content_type,
        reply_to_id=reply_to_id,
    )
    db.session.add(msg)
    db.session.commit()

    user = User.query.get(uid)
    return jsonify({
        'status': 'success',
        'message': {
            'id': msg.id,
            'user_id': uid,
            'user_name': user.real_name or user.username if user else '',
            'content': msg.content,
            'content_type': msg.content_type,
            'reply_to_id': msg.reply_to_id,
            'like_count': 0,
            'dislike_count': 0,
            'my_vote': None,
            'created_at': msg.created_at.isoformat() if msg.created_at else None,
        },
    })


@discussion_bp.route('/api/discussion/messages/<int:msg_id>/vote', methods=['POST'])
def api_vote_message(msg_id):
    """메시지 좋아요/싫어요"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    msg = DiscussionMessage.query.get(msg_id)
    if not msg:
        return jsonify({'error': 'not found'}), 404

    me = _check_room_participant(msg.room_id, uid)
    if not me:
        return jsonify({'error': '참여자가 아닙니다.'}), 403

    data = request.get_json()
    vote = data.get('vote')
    if vote not in ('like', 'dislike'):
        return jsonify({'error': '잘못된 투표입니다.'}), 400

    existing = DiscussionVote.query.filter_by(message_id=msg_id, user_id=uid).first()
    if existing:
        if existing.vote == vote:
            db.session.delete(existing)
        else:
            existing.vote = vote
    else:
        db.session.add(DiscussionVote(
            message_id=msg_id, user_id=uid, vote=vote
        ))

    db.session.commit()

    counts = db.session.query(
        DiscussionVote.vote, db.func.count(DiscussionVote.id)
    ).filter_by(message_id=msg_id).group_by(DiscussionVote.vote).all()
    count_map = dict(counts)

    my_vote_obj = DiscussionVote.query.filter_by(message_id=msg_id, user_id=uid).first()

    return jsonify({
        'status': 'success',
        'like_count': count_map.get('like', 0),
        'dislike_count': count_map.get('dislike', 0),
        'my_vote': my_vote_obj.vote if my_vote_obj else None,
    })


# ── 토론 종료 & AI 요약 ──

@discussion_bp.route('/api/discussion/rooms/<int:room_id>/close', methods=['POST'])
def api_close_room(room_id):
    """토론방 종료"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    room = DiscussionRoom.query.get(room_id)
    if not room:
        return jsonify({'error': 'not found'}), 404
    if room.created_by != uid:
        return jsonify({'error': '개설자만 종료할 수 있습니다.'}), 403

    room.status = 'closed'
    db.session.commit()

    return jsonify({'status': 'success', 'msg': '토론방이 종료되었습니다.'})


@discussion_bp.route('/api/discussion/rooms/<int:room_id>/summary/generate', methods=['POST'])
def api_generate_summary(room_id):
    """AI 요약 생성"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    room = DiscussionRoom.query.get(room_id)
    if not room:
        return jsonify({'error': 'not found'}), 404
    if room.created_by != uid:
        return jsonify({'error': '개설자만 요약을 생성할 수 있습니다.'}), 403

    msgs = DiscussionMessage.query.filter_by(room_id=room_id).order_by(
        DiscussionMessage.created_at.asc()
    ).all()

    if not msgs:
        return jsonify({'error': '메시지가 없습니다.'}), 400

    # 메시지 목록 구성
    chat_log = []
    for m in msgs:
        user = User.query.get(m.user_id)
        name = user.real_name or user.username if user else '알수없음'
        chat_log.append(f'{name}: {m.content[:200]}')

    prompt = f'''다음은 "{room.topic}" 주제로 진행된 토론 내용입니다.
참여자들의 주요 의견, 합의 사항, 쟁점, 결론을 요약해주세요.

토론 내용:
{chr(10).join(chat_log)}'''

    try:
        import requests as _req
        api_key = current_app.config.get('MOTIF_API_KEY', '')
        resp = _req.post(
            'https://api-cbt.morphfactory.io/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': 'motif/motif-3',
                'messages': [
                    {'role': 'system', 'content': '당신은 토론 내용을 객관적으로 요약하는 전문가입니다. 한국어로 작성하세요.'},
                    {'role': 'user', 'content': prompt},
                ],
                'max_tokens': 2000,
                'temperature': 0.3,
            },
            timeout=60,
        )
        result = resp.json()
        summary = result.get('choices', [{}])[0].get('message', {}).get('content', '')
    except Exception as e:
        summary = f'요약 생성 중 오류 발생: {str(e)}'

    room.summary_text = summary
    room.summary_confirmed = False
    db.session.commit()

    return jsonify({'status': 'success', 'summary': summary})


@discussion_bp.route('/api/discussion/rooms/<int:room_id>/summary/confirm', methods=['POST'])
def api_confirm_summary(room_id):
    """개설자 요약 확인 + 참여자에게 편지 발송"""
    uid = _uid()
    if not uid:
        return jsonify({'error': 'login'}), 401

    room = DiscussionRoom.query.get(room_id)
    if not room:
        return jsonify({'error': 'not found'}), 404
    if room.created_by != uid:
        return jsonify({'error': '개설자만 확인할 수 있습니다.'}), 403
    if not room.summary_text:
        return jsonify({'error': '요약이 없습니다.'}), 400

    room.summary_confirmed = True
    room.status = 'closed'

    # 참여자에게 요약 편지 발송
    participants = DiscussionParticipant.query.filter_by(room_id=room_id).all()
    sent = 0
    for p in participants:
        if p.user_id != uid:  # 개설자 제외
            msg = Message(
                sender_id=uid,
                sender_name=session.get('real_name', session['username']),
                sender_role=session.get('role', 'user'),
                receiver_id=p.user_id,
                subject=f'[토론 요약] {room.topic}',
                content=f'<h4>{room.topic} - 토론 요약</h4><hr>{room.summary_text}',
                letter_type='normal',
            )
            db.session.add(msg)
            sent += 1

    db.session.commit()

    return jsonify({'status': 'success', 'msg': f'{sent}명에게 요약 편지가 발송되었습니다.'})
