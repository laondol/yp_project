from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, current_app, send_file
from models import db, Message, User, Friend, PointHistory
from datetime import datetime

message_bp = Blueprint('message', __name__)

LETTER_COST = 10  # 편지 1通당 닢 10 차감
INTERNAL_ADMIN_ID = 1  # 전체관리자 수신용 내부 ID (운영 db의 admin1)
INTERNAL_AI_ADMIN_ID = 9  # AI관리자 발송용 내부 ID (herb2727)


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
    result = [{'id': u.id, 'username': u.username, 'real_name': u.real_name, 'town': u.town, 'village': u.village} for u in users]
    return jsonify(result)


@message_bp.route('/api/messages')
def api_messages():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    tab = request.args.get('tab', 'received')
    role = session.get('role', 'user')
    if tab == 'received':
        msgs = Message.query.filter(
            (Message.receiver_id == uid) |
            ((Message.is_public == True) & (role in ['admin', 'leader']))
        ).order_by(Message.created_at.desc()).limit(50).all()
    else:
        msgs = Message.query.filter_by(sender_id=uid).order_by(Message.created_at.desc()).limit(50).all()
    result = []
    for m in msgs:
        sender = User.query.get(m.sender_id)
        receiver = User.query.get(m.receiver_id)
        result.append({
            'id': m.id, 'subject': m.subject, 'content': m.content,
            'sender_name': sender.real_name or sender.username if sender else '알수없음',
            'receiver_name': receiver.real_name or receiver.username if receiver else '알수없음',
            'sender_role': m.sender_role, 'letter_type': m.letter_type,
            'is_read': m.is_read, 'is_public': m.is_public,
            'created_at': m.created_at.isoformat() if m.created_at else None,
        })
    return jsonify(result)

@message_bp.route('/api/message/send', methods=['POST'])
def api_message_send():
    uid = session.get('user_id')
    if not uid: return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    ids_raw = request.form.get('receiver_ids') or request.form.get('receiver_id')
    subject = request.form.get('subject', '').strip()
    content = request.form.get('content', '').strip()
    if not ids_raw or not content:
        return jsonify({'status': 'error', 'msg': '받는 사람과 내용을 입력하세요.'}), 400
    try:
        ids = [int(x.strip()) for x in ids_raw.split(',') if x.strip()]
    except ValueError:
        return jsonify({'status': 'error', 'msg': '받는 사람 형식이 올바르지 않습니다.'}), 400
    if not ids:
        return jsonify({'status': 'error', 'msg': '받는 사람을 선택하세요.'}), 400
    ids = list(dict.fromkeys(ids))          # 중복 제거
    ids = [i for i in ids if i != uid]        # 자기 자신 제외
    if not ids:
        return jsonify({'status': 'error', 'msg': '받는 사람을 선택하세요.'}), 400
    total = LETTER_COST * len(ids)
    balance = _get_balance(uid)
    if balance < total:
        return jsonify({'status': 'error', 'msg': f'닢이 부족합니다. (현재 {balance}닢, 필요 {total}닢)'}), 400
    sent = 0
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
            subject=subject,
            content=content,
            letter_type='normal'
        )
        db.session.add(msg)
        sent += 1
    db.session.commit()
    if sent == 0:
        return jsonify({'status': 'error', 'msg': '전송할 대상을 찾지 못했습니다.'}), 400
    return jsonify({'status': 'success', 'msg': f'{sent}명에게 편지가 전송되었습니다.'})

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
    resp = send_file(full, as_attachment=True)
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
    db.session.commit()

    if request.method == 'POST':
        return jsonify({'status': 'success'})
    return redirect(url_for('.message_inbox'))


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
        sender_name='AI 관리자',
        sender_role='admin',
        receiver_id=msg.sender_id,
        subject='편지 발송 반려: ' + msg.subject,
        content=('[AI 관리자 알림] 귀하가 보낸 편지(제목: ' + msg.subject + ')가 검토 결과 반려되었습니다.\n\n'
                 '반려 사유: ' + reason + '\n\n'
                 '※ 이 메시지는 자동 검토 시스템에 의해 발송되었습니다.'),
        is_public=False,
        letter_type='ai_reject'
    )
    db.session.add(reject_msg)
    
    # 원본 편지 상태 업데이트
    msg.moderation_status = 'rejected'
    msg.rejection_reason = reason
    db.session.commit()
    
    return jsonify({'success': True})
