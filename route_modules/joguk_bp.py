"""조국혁신당 여주·양평 지역위원회 게시판

- 현수막 게시판: QR로 진입, 개별 글 공개 열람 + 비밀 댓글
- 당원 게시판: 게시판 전용 계정 가입 → 이메일 인증 → 관리자 승인 후 열람
- 관리자: 글/댓글/당원/카드/통계/공론 관리
- 사이트 회원(User)과 완전히 분리된 인증 체계
"""
import os
import re
import json
import uuid
import hashlib
import secrets
import random
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, session, current_app
from werkzeug.security import generate_password_hash, check_password_hash

from models import (
    db, JogukAccount, JogukToken, JogukBanner, JogukComment,
    JogukTopic, JogukIssue, JogukIssueVote, JogukIssueComment,
    JogukCard, JogukStat, JogukPost, JogukPostComment,
    JogukCommittee, JogukIssueMeta, JogukPostLike, JogukPostLifecycle,
    JogukCandidate, JogukCandidateVote, JogukCandidateComment,
    JogukBannerMeta, JogukBannerAssign, JogukBannerPoster, JogukConsent,
    JogukAccessLog, JogukLoginLock,
)
from route_modules.common import masked_email

joguk_bp = Blueprint('joguk_bp', __name__)

TOPICS = [
    ('일반', '환경'), ('일반', '건강'), ('일반', '돌봄'), ('일반', '교육'),
    ('일반', '주거'), ('일반', '노동'), ('일반', '디지털'), ('일반', '문화'),
    ('일반', '법'), ('일반', '정치'), ('일반', '후기'), ('일반', '공론'), ('일반', '기타'),
    ('현안', '여주현안'), ('현안', '양평현안'), ('현안', '지역현안'),
]

UPLOAD_SUBDIR = os.path.join('static', 'uploads', 'joguk')
ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'}
MAX_FILE_MB = 10
_seeded = False


# ---------------------------------------------------------------- helpers
def _admin_email():
    return current_app.config.get('JOGUK_ADMIN_EMAIL', 'laon.cafe@gmail.com')


def _is_admin():
    return session.get('role') == 'admin'


def _account():
    aid = session.get('joguk_account_id')
    if not aid:
        return None
    return JogukAccount.query.get(aid)


def _approved_account():
    a = _account()
    if not a or a.status not in ('approved', 'offline'):
        return None
    return a


def _token_hash(raw):
    return hashlib.sha256((raw or '').encode('utf-8')).hexdigest()


def _issue_token(account_id, kind, hours=24):
    raw = secrets.token_urlsafe(32)
    db.session.add(JogukToken(
        account_id=account_id, kind=kind, token_hash=_token_hash(raw),
        expires_at=datetime.now() + timedelta(hours=hours),
    ))
    db.session.commit()
    return raw


def _consume_token(raw, kind):
    row = JogukToken.query.filter_by(token_hash=_token_hash(raw), kind=kind).first()
    if not row or row.used_at:
        return None
    if row.expires_at and row.expires_at < datetime.now():
        return None
    row.used_at = datetime.now()
    db.session.commit()
    return row


def _send(to, subject, body):
    try:
        from services.email_service import EmailService
        return EmailService.send(to, subject, body)
    except Exception as e:
        print(f'[JOGUK MAIL] {e}')
        return False


POST_KEEP_DAYS = 30      # 작성 후 유지 기간
POST_WARN_DAYS = 3       # 경고 후 자동 숨김까지


def _apply_lifecycle(posts):
    """30일 경과 & 찬성 기준 미달 글에 경고/자동 숨김 적용"""
    now = datetime.now()
    changed = False
    for p in posts:
        lc = JogukPostLifecycle.query.filter_by(post_id=p.id).first()
        base = lc.keep_until if (lc and lc.keep_until) else p.created_at
        if not base:
            continue
        due = base + timedelta(days=POST_KEEP_DAYS)
        if now < due:
            continue
        th = _candidate_threshold()
        if (p.like_count or 0) >= th:
            continue
        if not lc:
            lc = JogukPostLifecycle(post_id=p.id)
            db.session.add(lc)
            db.session.flush()
        if not lc.warned_at:
            lc.warned_at = now
            lc.expire_at = now + timedelta(days=POST_WARN_DAYS)
            changed = True
            _send_expiry_mail(p, lc)
        elif lc.expire_at and now >= lc.expire_at:
            p.status = 'hidden'
            changed = True
    if changed:
        db.session.commit()


def _send_expiry_mail(post, lc):
    acc = JogukAccount.query.get(post.account_id)
    if not acc:
        return
    try:
        _send(acc.email, '[당원게시판] 게시글 유지 여부 확인',
              f"'{post.title}' 글을 올린 지 한 달이 지났지만 찬성표가 {(post.like_count or 0)}표입니다.\n\n"
              f"글을 계속 유지하시겠습니까?\n"
              f"3일 안에 유지하지 않으시면 자동으로 숨김 처리됩니다.\n\n"
              f"게시판: {_board_url()}\n")
    except Exception as e:
        print(f'[JOGUK MAIL] {e}')


ADMIN_SYS_EMAIL = '__admin__@local'
CONSENT_VERSION = '2026-11-23'


def _admin_account():
    """공론 활동 기록 작성용 시스템 계정"""
    acc = JogukAccount.query.filter_by(email=ADMIN_SYS_EMAIL).first()
    if not acc:
        from werkzeug.security import generate_password_hash as _gph
        acc = JogukAccount(email=ADMIN_SYS_EMAIL, password_hash=_gph('__disabled__'),
                           status='offline', email_verified=True)
        db.session.add(acc)
        db.session.commit()
    return acc




ACCESS_LOG_DAYS = 365      # 접속기록 보관 기간
LOGIN_FAIL_LIMIT = 5       # 실패 허용 횟수
LOGIN_LOCK_MINUTES = 15    # 잠금 시간


def _client_ip():
    fwd = request.headers.get('X-Forwarded-For', '')
    if fwd:
        return fwd.split(',')[0].strip()[:64]
    return (request.remote_addr or '')[:64]


def _email_key(email):
    return hashlib.sha256((email or '').lower().encode('utf-8')).hexdigest()


def _log_access(action, account_id=None, email=''):
    """접속기록 저장 (1년 보관, 오래된 기록 정리)"""
    try:
        db.session.add(JogukAccessLog(
            account_id=account_id, email_hash=_email_key(email) if email else '',
            action=action, ip=_client_ip(),
            user_agent=(request.headers.get('User-Agent') or '')[:300],
        ))
        db.session.commit()
        if random.random() < 0.05:
            cutoff = datetime.now() - timedelta(days=ACCESS_LOG_DAYS)
            JogukAccessLog.query.filter(JogukAccessLog.created_at < cutoff).delete()
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'[JOGUK LOG] {e}')


def _check_login_lock(email):
    row = JogukLoginLock.query.filter_by(email_key=_email_key(email)).first()
    if not row:
        return None
    if row.locked_until and row.locked_until > datetime.now():
        mins = max(1, int((row.locked_until - datetime.now()).total_seconds() // 60) + 1)
        return mins
    return None


def _record_login_fail(email):
    key = _email_key(email)
    row = JogukLoginLock.query.filter_by(email_key=key).first()
    now = datetime.now()
    if not row:
        row = JogukLoginLock(email_key=key, fails=1, first_fail_at=now)
        db.session.add(row)
    else:
        if not row.first_fail_at or (now - row.first_fail_at) > timedelta(minutes=LOGIN_LOCK_MINUTES):
            row.fails = 1
            row.first_fail_at = now
            row.locked_until = None
        else:
            row.fails = (row.fails or 0) + 1
        if row.fails >= LOGIN_FAIL_LIMIT:
            row.locked_until = now + timedelta(minutes=LOGIN_LOCK_MINUTES)
    db.session.commit()


def _clear_login_fail(email):
    JogukLoginLock.query.filter_by(email_key=_email_key(email)).delete()
    db.session.commit()


def _candidate_threshold():
    try:
        row = JogukStat.query.filter_by(key='candidate_threshold').first()
        return int(row.value) if row and str(row.value).isdigit() else 10
    except Exception:
        return 10


def _is_committee(acc):
    return bool(acc and JogukCommittee.query.filter_by(account_id=acc.id).first())


def _board_url(base=None):
    b = (base or current_app.config.get('JOGUK_PUBLIC_BASE') or request.url_root or '').rstrip('/')
    if not b:
        b = 'https://unocum.kr'
    return f'{b}/rebuild/member'


def _send_approval_mail(acc, offline=False, base=None):
    """승인/오프라인 확인 안내 메일 (게시판 주소 포함)"""
    if not acc or not acc.email:
        return False
    url = _board_url(base)
    if offline:
        subject = '[당원게시판] 오프라인 확인 완료 — 글쓰기 가능'
        body = (
            '오프라인 확인이 완료되었습니다.\n\n'
            '이제 당원게시판에서 글쓰기와 투표가 가능합니다.\n\n'
            f'게시판 주소: {url}\n'
        )
    else:
        subject = '[당원게시판] 가입이 승인되었습니다'
        body = (
            '가입이 승인되었습니다.\n\n'
            '글을 쓰시려면 직접 운영위원을 직접 만나 확인 되셔야 글쓰기가 가능합니다.\n'
            '온라인확인으로는 읽기만 가능 하십니다.\n\n'
            f'게시판 주소: {url}\n'
        )
    try:
        return _send(acc.email, subject, body)
    except Exception as e:
        print(f'[JOGUK MAIL] {e}')
        return False


def _send_reject_mail(acc, base=None):
    """가입 거절 안내 메일 (재가입 링크 포함)"""
    if not acc or not acc.email:
        return False
    url = _board_url(base)
    subject = '[당원게시판] 가입이 승인되지 않았습니다'
    body = (
        '당원확인이 되지 않습니다.\n\n'
        '경기도당에 질문해 주시고 확인 되시면 수고스럽겠지만 다시 가입해 주세요.\n\n'
        f'가입 주소: {url}\n'
    )
    try:
        return _send(acc.email, subject, body)
    except Exception as e:
        print(f'[JOGUK MAIL] {e}')
        return False


def _moderate(text):
    """욕설·비방 1차 차단 (키워드) + 선택적 AI 검사"""
    try:
        from services.ai_service import moderate_comment
        ok, msg = moderate_comment(text)
        if not ok:
            return False, msg
    except Exception:
        pass
    banned = ['한심', '사기꾼', '빨갱이', '수괴', '매국', '죽어', '꺼져', '미친']
    low = (text or '').lower()
    for w in banned:
        if w in low:
            return False, '비방·혐오 표현이 포함되어 있습니다. 표현을 바꿔주세요.'
    return True, ''


def _save_file(fs, allowed_images_only=False):
    """업로드 저장 → (경로, 오류)"""
    if not fs or not fs.filename:
        return '', ''
    ext = fs.filename.rsplit('.', 1)[-1].lower() if '.' in fs.filename else ''
    if ext not in ALLOWED_EXT:
        return '', '허용되지 않는 파일 형식입니다.'
    if allowed_images_only and ext == 'pdf':
        return '', '이미지 파일만 첨부할 수 있습니다.'
    fs.seek(0, os.SEEK_END)
    size = fs.tell()
    fs.seek(0)
    if size > MAX_FILE_MB * 1024 * 1024:
        return '', f'파일은 {MAX_FILE_MB}MB 이하만 가능합니다.'
    base = os.path.join(current_app.root_path, UPLOAD_SUBDIR)
    os.makedirs(base, exist_ok=True)
    name = f'{uuid.uuid4().hex}.{ext}'
    fs.save(os.path.join(base, name))
    return f'/static/uploads/joguk/{name}', ''


def _clean(s, limit=2000):
    s = (s or '').strip()
    return s[:limit]


def _banner_payload(b):
    return {
        'id': b.id, 'token': b.token, 'title': b.title, 'summary': b.summary or '',
        'body': b.body or '', 'image_path': b.image_path or '',
        'like_count': b.like_count or 0, 'view_count': b.view_count or 0,
        'created_at': b.created_at.isoformat() if b.created_at else '',
        'public_url': f"{_public_base()}/rebuild/{b.token}",
        'status': (_banner_meta(b).status if 'JogukBannerMeta' in globals() else 'posted'),
        'posts': [_assign_payload(a) for a in JogukBannerAssign.query.filter_by(banner_id=b.id).all()
                  if a.photo_path],
    }


def _comment_payload(c, reveal=False):
    return {
        'id': c.id,
        'masked_email': '관리자만 표시' if c.is_anonymous else (c.masked_email or ''),
        'is_anonymous': bool(c.is_anonymous),
        'created_at': c.created_at.isoformat() if c.created_at else '',
        'like_count': c.like_count or 0,
        'has_files': bool(c.files_json and json.loads(c.files_json or '[]')),
        'has_drawing': bool(c.drawing_path),
        'link_url': c.link_url or '',
        'status': c.status,
        'content': c.content if reveal else '',
        'drawing_path': c.drawing_path if reveal else '',
        'files': json.loads(c.files_json or '[]') if reveal else [],
        'ai_reason': c.ai_reason if reveal else '',
    }


# ---------------------------------------------------------------- seed
def seed_joguk_data():
    """최초 1회 데모/기본 데이터 생성 (주제·통계·카드)"""
    global _seeded
    if _seeded:
        return
    _seeded = True
    try:
        if JogukTopic.query.count() == 0:
            for i, (grp, name) in enumerate(TOPICS):
                db.session.add(JogukTopic(group_name=grp, name=name, sort_order=i))
        if JogukStat.query.count() == 0:
            for i, (k, label, v) in enumerate([
                ('candidate_threshold', '안건 후보 기준(찬성표)', '10'),
                ('bills', '추진법안', '12'),
                ('proposed_bills', '제안법안', '18'),
                ('adopted_bills', '채택법안', '12'),
                ('national_rate', '전국 당원비율', '4.7%'),
                ('approval', '지지율', '6.2%'),
                ('member_rate', '여주·양평 당원비율', '3.1%'),
                ('discussing', '토론중', '3'),
                ('results', '공론결과', '5'),
            ]):
                db.session.add(JogukStat(key=k, label=label, value=v, sort_order=i))
        if JogukCard.query.count() == 0:
            for i, (side, t, s) in enumerate([
                ('central', '검찰개혁 입법 과제', '추진법안 4건'),
                ('central', '기본소득 시범 확대', '전국 당원 4.7%'),
                ('central', '기후정의 전환', '당 추진현안 3건'),
                ('central', '노동권 강화', '추진법안 2건'),
                ('central', '지역화폐 확대', '전국 12개 지자체'),
                ('central', '돌봄 공공성 강화', '당 추진현안 5건'),
                ('local', '여주현안 · 공공의료', '토론중 3건'),
                ('local', '양평현안 · 고속도로', '참여 128명'),
                ('local', '지역현안 · 농촌 청년', '의견 42건'),
                ('local', '여주현안 · 스마트팜', '토론중 2건'),
                ('local', '양평현안 · 버스 배차', '참여 88명'),
                ('local', '지역현안 · 청년 주거', '의견 27건'),
            ]):
                db.session.add(JogukCard(side=side, title=t, subtitle=s, sort_order=i))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'[JOGUK SEED] {e}')


@joguk_bp.before_request
def _before():
    seed_joguk_data()


# ---------------------------------------------------------------- auth
@joguk_bp.route('/api/rebuild/signup', methods=['POST'])
def joguk_signup():
    data = request.get_json(silent=True) or request.form
    email = _clean(data.get('email'), 200).lower()
    password = data.get('password') or ''
    name = _clean(data.get('name'), 60)
    address = _clean(data.get('address'), 200)

    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return jsonify({'status': 'error', 'msg': '이메일 형식이 올바르지 않습니다.'}), 400
    if len(password) < 4:
        return jsonify({'status': 'error', 'msg': '비밀번호는 4자 이상이어야 합니다.'}), 400
    if not name or not address:
        return jsonify({'status': 'error', 'msg': '이름과 주소를 입력해 주세요.'}), 400
    if not data.get('agree_privacy'):
        return jsonify({'status': 'error', 'msg': '개인정보 수집·이용에 동의해 주세요.'}), 400
    if not data.get('agree_email'):
        return jsonify({'status': 'error', 'msg': '이메일 인증 및 안내 수신에 동의해 주세요.'}), 400
    if not data.get('agree_transfer'):
        return jsonify({'status': 'error', 'msg': '이름·주소의 위원장 전달에 동의해 주세요.'}), 400
    if not data.get('agree_age'):
        return jsonify({'status': 'error', 'msg': '만 14세 이상 확인이 필요합니다.'}), 400
    if not data.get('agree_overseas'):
        return jsonify({'status': 'error', 'msg': '개인정보 국외 이전에 동의해 주세요.'}), 400
    if JogukAccount.query.filter_by(email=email).first():
        return jsonify({'status': 'error', 'msg': '이미 가입된 이메일입니다.'}), 400

    acc = JogukAccount(email=email, password_hash=generate_password_hash(password), status='pending')
    db.session.add(acc)
    db.session.commit()

    db.session.add(JogukConsent(
        kind='signup', account_id=acc.id, version=CONSENT_VERSION,
        items='privacy,email,transfer,overseas,age14',
    ))
    db.session.commit()
    _log_access('signup', account_id=acc.id, email=email)

    # 이름·주소는 서버에 저장하지 않고 위원장 메일로만 전송
    approve_raw = _issue_token(acc.id, 'approve', hours=24 * 14)
    reject_raw = _issue_token(acc.id, 'reject', hours=24 * 14)
    base = request.url_root.rstrip('/')
    body = (
        f"조국혁신당 여주·양평 지역위원회 당원게시판 가입 신청\n\n"
        f"이름: {name}\n주소: {address}\n이메일: {email}\n\n"
        f"[승인] {base}/api/rebuild/approve?token={approve_raw}\n"
        f"[거절] {base}/api/rebuild/reject?token={reject_raw}\n\n"
        f"※ 이름·주소는 서버에 저장되지 않습니다.\n"
    )
    sent = _send(_admin_email(), '[당원게시판] 가입 신청', body)

    verify_raw = _issue_token(acc.id, 'verify', hours=48)
    _send(email, '[당원게시판] 이메일 인증',
          f"아래 링크를 눌러 이메일 인증을 완료해 주세요.\n{base}/rebuild/member?verify={verify_raw}\n")
    msg = '가입 신청 완료. 이메일 인증 후 관리자 승인을 기다려 주세요.'
    if not sent:
        msg = ('가입 신청은 접수되었습니다. 다만 관리자 알림 메일 발송에 실패했습니다. '
               '이름·주소가 전달되지 않았으니 지역위원장에게 직접 알려주세요.')
    return jsonify({'status': 'ok', 'msg': msg, 'mail_sent': bool(sent)})


@joguk_bp.route('/api/rebuild/verify', methods=['POST'])
def joguk_verify():
    data = request.get_json(silent=True) or {}
    row = _consume_token(data.get('token', ''), 'verify')
    if not row or not row.account_id:
        return jsonify({'status': 'error', 'msg': '인증 링크가 만료되었거나 잘못되었습니다.'}), 400
    acc = JogukAccount.query.get(row.account_id)
    if not acc:
        return jsonify({'status': 'error', 'msg': '계정을 찾을 수 없습니다.'}), 404
    acc.email_verified = True
    acc.verified_at = datetime.now()
    db.session.commit()
    return jsonify({'status': 'ok', 'msg': '이메일 인증 완료. 관리자 승인 후 열람할 수 있습니다.'})


@joguk_bp.route('/api/rebuild/login', methods=['POST'])
def joguk_login():
    data = request.get_json(silent=True) or {}
    email = _clean(data.get('email'), 200).lower()

    locked = _check_login_lock(email)
    if locked:
        _log_access('login_locked', email=email)
        return jsonify({'status': 'error',
                        'msg': f'로그인 시도가 많아 잠시 잠겼습니다. {locked}분 후 다시 시도해 주세요.'}), 429

    acc = JogukAccount.query.filter_by(email=email).first()
    if not acc or acc.status in ('rejected', 'left') or not check_password_hash(acc.password_hash, data.get('password') or ''):
        _record_login_fail(email)
        _log_access('login_fail', account_id=acc.id if acc else None, email=email)
        return jsonify({'status': 'error', 'msg': '이메일 또는 비밀번호가 맞지 않습니다.'}), 401

    _clear_login_fail(email)
    session['joguk_account_id'] = acc.id
    _log_access('login_success', account_id=acc.id, email=email)
    return jsonify({'status': 'ok', 'account': _me_payload(acc)})


@joguk_bp.route('/api/rebuild/magic', methods=['POST'])
def joguk_magic():
    data = request.get_json(silent=True) or {}
    email = _clean(data.get('email'), 200).lower()
    acc = JogukAccount.query.filter_by(email=email).first()
    if acc and acc.status not in ('rejected', 'left'):
        raw = _issue_token(acc.id, 'login', hours=1)
        base = request.url_root.rstrip('/')
        _send(email, '[당원게시판] 로그인 링크',
              f"1시간 안에 아래 링크를 눌러 로그인하세요.\n{base}/rebuild/member?magic={raw}\n")
    return jsonify({'status': 'ok', 'msg': '가입된 이메일이면 로그인 링크를 보냈습니다.'})


@joguk_bp.route('/api/rebuild/magic-login', methods=['POST'])
def joguk_magic_login():
    data = request.get_json(silent=True) or {}
    row = _consume_token(data.get('token', ''), 'login')
    if not row or not row.account_id:
        return jsonify({'status': 'error', 'msg': '링크가 만료되었거나 잘못되었습니다.'}), 400
    acc = JogukAccount.query.get(row.account_id)
    if not acc or acc.status in ('rejected', 'left'):
        return jsonify({'status': 'error', 'msg': '사용할 수 없는 계정입니다.'}), 403
    session['joguk_account_id'] = acc.id
    return jsonify({'status': 'ok', 'account': _me_payload(acc)})


@joguk_bp.route('/api/rebuild/logout', methods=['POST'])
def joguk_logout():
    acc = _account()
    if acc:
        _log_access('logout', account_id=acc.id, email=acc.email)
    session.pop('joguk_account_id', None)
    return jsonify({'status': 'ok'})


def _me_payload(acc):
    return {
        'id': acc.id, 'email': masked_email(acc.email), 'status': acc.status,
        'email_verified': bool(acc.email_verified),
        'can_read': acc.status in ('approved', 'offline'),
        'can_write': acc.status == 'offline',
        'committee': _is_committee(acc),
        'is_admin': _is_admin(),
    }


@joguk_bp.route('/api/rebuild/me')
def joguk_me():
    acc = _account()
    return jsonify({'account': _me_payload(acc) if acc else None, 'is_admin': _is_admin()})


@joguk_bp.route('/api/rebuild/approve')
def joguk_approve_mail():
    row = _consume_token(request.args.get('token', ''), 'approve')
    if not row or not row.account_id:
        return '승인 링크가 만료되었거나 잘못되었습니다.', 400
    acc = JogukAccount.query.get(row.account_id)
    if not acc:
        return '계정을 찾을 수 없습니다.', 404
    acc.status = 'approved'
    acc.approved_at = datetime.now()
    db.session.commit()
    _send_approval_mail(acc, offline=False, base=request.url_root)
    return '<h2>승인 완료</h2><p>승인 안내 메일을 발송했습니다. 해당 당원은 읽기만 가능합니다.</p>'


@joguk_bp.route('/api/rebuild/reject')
def joguk_reject_mail():
    row = _consume_token(request.args.get('token', ''), 'reject')
    if not row or not row.account_id:
        return '거절 링크가 만료되었거나 잘못되었습니다.', 400
    acc = JogukAccount.query.get(row.account_id)
    if not acc:
        return '계정을 찾을 수 없습니다.', 404
    acc.status = 'rejected'
    db.session.commit()
    _send_reject_mail(acc, base=request.url_root)
    return '<h2>거절 처리 완료</h2><p>안내 메일을 발송했습니다.</p>'


# ---------------------------------------------------------------- common data
@joguk_bp.route('/api/rebuild/stats')
def joguk_stats():
    rows = JogukStat.query.order_by(JogukStat.sort_order).all()
    return jsonify({'items': [{'key': r.key, 'label': r.label, 'value': r.value} for r in rows]})


@joguk_bp.route('/api/rebuild/cards')
def joguk_cards():
    side = request.args.get('side', '')
    q = JogukCard.query.filter(JogukCard.active == True)
    if side:
        q = q.filter(JogukCard.side == side)
    rows = q.order_by(JogukCard.sort_order, JogukCard.id).all()
    return jsonify({'items': [{
        'id': r.id, 'side': r.side, 'title': r.title, 'subtitle': r.subtitle or '',
        'body': r.body or '', 'link_url': r.link_url or '',
    } for r in rows]})


# ---------------------------------------------------------------- banner board
@joguk_bp.route('/api/rebuild/banner/<token>')
def joguk_banner(token):
    b = JogukBanner.query.filter_by(token=token, is_public=True).first()
    if not b:
        return jsonify({'status': 'error', 'msg': '글을 찾을 수 없습니다.'}), 404
    b.view_count = (b.view_count or 0) + 1
    db.session.commit()
    comments = JogukComment.query.filter(
        JogukComment.banner_id == b.id,
        JogukComment.status == 'visible',
        JogukComment.is_anonymous == False,   # 익명은 목록에 노출하지 않음
    ).order_by(JogukComment.created_at.desc()).all()
    data = _banner_payload(b)
    data['comments'] = [_comment_payload(c) for c in comments]
    data['comment_count'] = len(comments)
    return jsonify(data)


def _public_base():
    base = (current_app.config.get('JOGUK_PUBLIC_BASE') or '').strip().rstrip('/')
    if base:
        return base
    return request.url_root.rstrip('/')


@joguk_bp.route('/api/rebuild/banner/<token>/qr.png')
def joguk_banner_qr(token):
    b = JogukBanner.query.filter_by(token=token, is_public=True).first()
    if not b:
        return 'not found', 404
    try:
        import qrcode
        from io import BytesIO
        from flask import send_file
        from PIL import Image

        size = request.args.get('size', type=int) or 800
        size = max(300, min(size, 2000))
        url = f"{_public_base()}/rebuild/{b.token}"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white').convert('L')
        img = img.resize((size, size), Image.NEAREST)
        buf = BytesIO()
        img.save(buf, format='PNG', dpi=(300, 300))
        buf.seek(0)
        return send_file(buf, mimetype='image/png', download_name=f'rebuild-{b.token}.png')
    except Exception as e:
        return f'QR 생성 실패: {e}', 500


@joguk_bp.route('/api/rebuild/banner/<token>/like', methods=['POST'])
def joguk_banner_like(token):
    b = JogukBanner.query.filter_by(token=token, is_public=True).first()
    if not b:
        return jsonify({'status': 'error', 'msg': '글을 찾을 수 없습니다.'}), 404
    key = f'joguk_like_{b.id}'
    if session.get(key):
        return jsonify({'status': 'ok', 'like_count': b.like_count or 0, 'already': True})
    session[key] = 1
    b.like_count = (b.like_count or 0) + 1
    db.session.commit()
    return jsonify({'status': 'ok', 'like_count': b.like_count})


@joguk_bp.route('/api/rebuild/banner/<token>/comments', methods=['POST'])
def joguk_comment_create(token):
    b = JogukBanner.query.filter_by(token=token, is_public=True).first()
    if not b:
        return jsonify({'status': 'error', 'msg': '글을 찾을 수 없습니다.'}), 404

    mode = request.form.get('mode', 'account')
    content = _clean(request.form.get('content'), 2000)
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해 주세요.'}), 400
    ok, msg = _moderate(content)
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400

    acc = _account()
    email = ''
    pw_hash = ''
    is_anon = False

    if mode == 'account':
        if not acc:
            return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
        email = acc.email
    elif mode == 'email':
        email = _clean(request.form.get('email'), 200).lower()
        password = request.form.get('password') or ''
        if request.form.get('agree_privacy') not in ('1', 'true', 'on'):
            return jsonify({'status': 'error', 'msg': '개인정보 수집·이용에 동의해 주세요.'}), 400
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return jsonify({'status': 'error', 'msg': '이메일 형식이 올바르지 않습니다.'}), 400
        if len(password) < 4:
            return jsonify({'status': 'error', 'msg': '비밀번호는 4자 이상이어야 합니다.'}), 400
        pw_hash = generate_password_hash(password)
    elif mode == 'anon':
        is_anon = True
    else:
        return jsonify({'status': 'error', 'msg': '잘못된 요청입니다.'}), 400

    drawing_path, err = _save_file(request.files.get('drawing'), allowed_images_only=True)
    if err:
        return jsonify({'status': 'error', 'msg': err}), 400

    files = []
    for fs in request.files.getlist('files'):
        p, err = _save_file(fs)
        if err:
            return jsonify({'status': 'error', 'msg': err}), 400
        if p:
            files.append(p)

    link_url = _clean(request.form.get('link_url'), 500)
    if link_url and not re.match(r'^https?://', link_url, re.I):
        return jsonify({'status': 'error', 'msg': '링크는 http:// 또는 https:// 로 시작해야 합니다.'}), 400

    c = JogukComment(
        banner_id=b.id, account_id=acc.id if acc else None,
        email=email, masked_email=masked_email(email) if email else '',
        password_hash=pw_hash, is_anonymous=is_anon,
        content=content, link_url=link_url, drawing_path=drawing_path,
        files_json=json.dumps(files, ensure_ascii=False),
        status='visible', ai_reason='',
    )
    db.session.add(c)
    db.session.commit()
    if mode == 'email':
        db.session.add(JogukConsent(
            kind='comment', comment_id=c.id, version=CONSENT_VERSION,
            items='privacy,email',
        ))
        db.session.commit()
    return jsonify({
        'status': 'ok', 'id': c.id,
        'msg': '비밀댓글로 저장되었습니다.' if not is_anon else '저장되었습니다. 익명 댓글은 목록에 표시되지 않습니다(관리자만 열람).',
        'listed': not is_anon,
    })


@joguk_bp.route('/api/rebuild/comment/<int:cid>/view', methods=['POST'])
def joguk_comment_view(cid):
    c = JogukComment.query.get_or_404(cid)
    data = request.get_json(silent=True) or {}
    acc = _account()

    allowed = False
    if acc and c.account_id == acc.id:
        allowed = True
    elif c.password_hash and data.get('password') and check_password_hash(c.password_hash, data['password']):
        allowed = True
    if not allowed:
        return jsonify({'status': 'error', 'msg': '비밀번호가 맞지 않습니다.'}), 403

    payload = _comment_payload(c, reveal=True)
    payload['editable'] = True
    return jsonify(payload)


@joguk_bp.route('/api/rebuild/comment/<int:cid>', methods=['PUT'])
def joguk_comment_update(cid):
    c = JogukComment.query.get_or_404(cid)
    data = request.get_json(silent=True) or {}
    acc = _account()
    if not ((acc and c.account_id == acc.id) or
            (c.password_hash and data.get('password') and check_password_hash(c.password_hash, data['password']))):
        return jsonify({'status': 'error', 'msg': '수정 권한이 없습니다.'}), 403
    content = _clean(data.get('content'), 2000)
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해 주세요.'}), 400
    ok, msg = _moderate(content)
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400
    c.content = content
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/comment/<int:cid>/like', methods=['POST'])
def joguk_comment_like(cid):
    c = JogukComment.query.get_or_404(cid)
    if c.status != 'visible':
        return jsonify({'status': 'error', 'msg': '사용할 수 없는 댓글입니다.'}), 400
    key = f'joguk_clike_{c.id}'
    if session.get(key):
        return jsonify({'status': 'ok', 'like_count': c.like_count or 0, 'already': True})
    session[key] = 1
    c.like_count = (c.like_count or 0) + 1
    db.session.commit()
    return jsonify({'status': 'ok', 'like_count': c.like_count})


# ---------------------------------------------------------------- party board
def _require_party():
    acc = _approved_account()
    if not acc:
        return None
    return acc


def _require_writer():
    """글쓰기·투표는 오프라인 확인(offline)만 가능"""
    acc = _approved_account()
    if not acc:
        return None, ('당원 승인 후 이용할 수 있습니다.', 403)
    if acc.status != 'offline':
        return None, ('의견 작성(글쓰기)은 직접 운영위원 확인(오프라인 인증) 후 가능합니다.', 403)
    return acc, None


@joguk_bp.route('/api/rebuild/topics')
def joguk_topics():
    rows = JogukTopic.query.filter(JogukTopic.active == True, JogukTopic.name != '공론') \
        .order_by(JogukTopic.sort_order).all()
    counts = {}
    for r in JogukIssue.query.all():
        counts[r.topic_id] = counts.get(r.topic_id, 0) + 1
    return jsonify({'items': [
        {'id': r.id, 'group': r.group_name, 'name': r.name,
         'description': r.description or '', 'issue_count': counts.get(r.id, 0)}
        for r in rows
    ]})


@joguk_bp.route('/api/rebuild/issues')
def joguk_issues():
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    topic_id = request.args.get('topic', type=int)
    q = JogukIssue.query
    if topic_id:
        q = q.filter(JogukIssue.topic_id == topic_id)
    rows = q.order_by(JogukIssue.created_at.desc()).limit(100).all()
    my_votes = {v.issue_id: v.stance for v in JogukIssueVote.query.filter_by(account_id=acc.id).all()}
    return jsonify({'items': [{
        'id': r.id, 'topic_id': r.topic_id, 'title': r.title, 'body': r.body or '',
        'status': r.status, 'vote_yes': r.vote_yes or 0, 'vote_no': r.vote_no or 0,
        'my_vote': my_votes.get(r.id, ''),
        'result_summary': r.result_summary or '',
        'created_at': r.created_at.isoformat() if r.created_at else '',
    } for r in rows]})


@joguk_bp.route('/api/rebuild/results')
def joguk_results():
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    rows = JogukIssue.query.order_by(JogukIssue.created_at.desc()).limit(100).all()
    metas = {m.issue_id: m for m in JogukIssueMeta.query.all()}
    return jsonify({'items': [{
        'id': r.id, 'title': r.title, 'status': r.status,
        'vote_yes': r.vote_yes or 0, 'vote_no': r.vote_no or 0,
        'result_summary': r.result_summary or '',
        'closed_at': r.closed_at.isoformat() if r.closed_at else '',
        'created_at': r.created_at.isoformat() if r.created_at else '',
        'review_until': (metas.get(r.id).review_until.isoformat()
                         if metas.get(r.id) and metas[r.id].review_until else ''),
        'public_until': (metas.get(r.id).public_until.isoformat()
                         if metas.get(r.id) and metas[r.id].public_until else ''),
    } for r in rows]})


@joguk_bp.route('/api/rebuild/issues/<int:iid>')
def joguk_issue_detail(iid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    r = JogukIssue.query.get_or_404(iid)
    vote = JogukIssueVote.query.filter_by(issue_id=iid, account_id=acc.id).first()
    comments = JogukIssueComment.query.filter_by(issue_id=iid, status='visible') \
        .order_by(JogukIssueComment.created_at.asc()).all()

    meta = JogukIssueMeta.query.filter_by(issue_id=iid).first()
    post_info = None
    candidate_days = None
    if meta and meta.post_id:
        post = JogukPost.query.get(meta.post_id)
        if post:
            th = _candidate_threshold()
            likes = JogukPostLike.query.filter_by(post_id=post.id).order_by(JogukPostLike.created_at.asc()).all()
            candidate_at = likes[th - 1].created_at if len(likes) >= th else None
            if candidate_at and post.created_at:
                candidate_days = (candidate_at - post.created_at).days
            author = JogukAccount.query.get(post.account_id)
            post_info = {
                'id': post.id, 'title': post.title,
                'author': masked_email(author.email) if author else '',
                'created_at': post.created_at.isoformat() if post.created_at else '',
                'like_count': post.like_count or 0, 'threshold': th,
                'candidate_at': candidate_at.isoformat() if candidate_at else '',
                'candidate_days': candidate_days,
            }

    out_comments = []
    for c in comments:
        a = JogukAccount.query.get(c.account_id) if c.account_id else None
        out_comments.append({
            'id': c.id, 'stance': c.stance or '', 'content': c.content or '',
            'author': '관리자' if (a and a.email == ADMIN_SYS_EMAIL) else (masked_email(a.email) if a else ''),
            'created_at': c.created_at.isoformat() if c.created_at else '',
        })

    return jsonify({
        'id': r.id, 'topic_id': r.topic_id, 'title': r.title, 'body': r.body or '',
        'status': r.status, 'vote_yes': r.vote_yes or 0, 'vote_no': r.vote_no or 0,
        'my_vote': vote.stance if vote else '', 'result_summary': r.result_summary or '',
        'created_at': r.created_at.isoformat() if r.created_at else '',
        'publicized_at': r.created_at.isoformat() if r.created_at else '',
        'closed_at': r.closed_at.isoformat() if r.closed_at else '',
        'review_until': meta.review_until.isoformat() if meta and meta.review_until else '',
        'public_until': meta.public_until.isoformat() if meta and meta.public_until else '',
        'post': post_info,
        'comments': out_comments,
    })


@joguk_bp.route('/api/rebuild/issues/<int:iid>/vote', methods=['POST'])
def joguk_issue_vote(iid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 투표할 수 있습니다.'}), 403
    r = JogukIssue.query.get_or_404(iid)
    if r.status != 'open':
        return jsonify({'status': 'error', 'msg': '종료된 안건입니다.'}), 400
    stance = (request.get_json(silent=True) or {}).get('stance')
    if stance not in ('yes', 'no'):
        return jsonify({'status': 'error', 'msg': '찬성 또는 반대를 선택해 주세요.'}), 400
    if JogukIssueVote.query.filter_by(issue_id=iid, account_id=acc.id).first():
        return jsonify({'status': 'error', 'msg': '이미 투표하셨습니다.'}), 400
    db.session.add(JogukIssueVote(issue_id=iid, account_id=acc.id, stance=stance))
    if stance == 'yes':
        r.vote_yes = (r.vote_yes or 0) + 1
    else:
        r.vote_no = (r.vote_no or 0) + 1
    db.session.commit()
    return jsonify({'status': 'ok', 'vote_yes': r.vote_yes, 'vote_no': r.vote_no})


@joguk_bp.route('/api/rebuild/issues/<int:iid>/comments', methods=['POST'])
def joguk_issue_comment(iid):
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '공론 활동 기록은 관리자만 작성할 수 있습니다.'}), 403
    acc = _admin_account()
    r = JogukIssue.query.get_or_404(iid)
    data = request.get_json(silent=True) or {}
    content = _clean(data.get('content'), 2000)
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해 주세요.'}), 400
    ok, msg = _moderate(content)
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400
    stance = data.get('stance') if data.get('stance') in ('yes', 'no') else ''
    db.session.add(JogukIssueComment(issue_id=iid, account_id=acc.id, stance=stance, content=content))
    db.session.commit()
    return jsonify({'status': 'ok'})


# ---------------------------------------------------------------- admin
def _admin_guard():
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '관리자만 접근할 수 있습니다.'}), 403
    return None


@joguk_bp.route('/api/admin/rebuild/overview')
def admin_overview():
    g = _admin_guard()
    if g:
        return g
    return jsonify({
        'banners': JogukBanner.query.count(),
        'comments': JogukComment.query.count(),
        'anonymous': JogukComment.query.filter_by(is_anonymous=True).count(),
        'pending': JogukAccount.query.filter_by(status='pending').count(),
        'approved': JogukAccount.query.filter(JogukAccount.status.in_(['approved', 'offline'])).count(),
        'issues': JogukIssue.query.count(),
    })


# --- banners
@joguk_bp.route('/api/admin/rebuild/banners', methods=['GET', 'POST'])
def admin_banners():
    g = _admin_guard()
    if g:
        return g
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        title = _clean(data.get('title'), 200)
        if not title:
            return jsonify({'status': 'error', 'msg': '제목을 입력해 주세요.'}), 400
        b = JogukBanner(
            token=secrets.token_urlsafe(9).replace('-', '').replace('_', '')[:12],
            title=title, summary=_clean(data.get('summary'), 300),
            body=_clean_html(data.get('body')), image_path=_clean(data.get('image_path'), 300),
            is_public=bool(data.get('is_public', True)),
            created_by=session.get('user_id'),
        )
        db.session.add(b)
        db.session.commit()
        return jsonify({'status': 'ok', 'id': b.id, 'token': b.token})
    rows = JogukBanner.query.order_by(JogukBanner.created_at.desc()).all()
    out = []
    for r in rows:
        d = _banner_payload(r)
        d['is_public'] = bool(r.is_public)
        d['comment_count'] = JogukComment.query.filter_by(banner_id=r.id, is_anonymous=False).count()
        out.append(d)
    return jsonify({'items': out})


@joguk_bp.route('/api/admin/rebuild/banners/<int:bid>', methods=['PUT', 'DELETE'])
def admin_banner_one(bid):
    g = _admin_guard()
    if g:
        return g
    b = JogukBanner.query.get_or_404(bid)
    if request.method == 'DELETE':
        JogukComment.query.filter_by(banner_id=bid).delete()
        db.session.delete(b)
        db.session.commit()
        return jsonify({'status': 'ok'})
    data = request.get_json(silent=True) or {}
    b.title = _clean(data.get('title'), 200) or b.title
    b.summary = _clean(data.get('summary'), 300)
    b.body = _clean_html(data.get('body'))
    b.image_path = _clean(data.get('image_path'), 300)
    b.is_public = bool(data.get('is_public', True))
    db.session.commit()
    return jsonify({'status': 'ok'})


# --- comments
@joguk_bp.route('/api/admin/rebuild/comments')
def admin_comments():
    g = _admin_guard()
    if g:
        return g
    bid = request.args.get('banner_id', type=int)
    q = JogukComment.query
    if bid:
        q = q.filter_by(banner_id=bid)
    rows = q.order_by(JogukComment.created_at.desc()).limit(300).all()
    return jsonify({'items': [_comment_payload(c, reveal=True) for c in rows]})


@joguk_bp.route('/api/admin/rebuild/comments/<int:cid>/status', methods=['POST'])
def admin_comment_status(cid):
    g = _admin_guard()
    if g:
        return g
    c = JogukComment.query.get_or_404(cid)
    data = request.get_json(silent=True) or {}
    st = data.get('status')
    if st not in ('visible', 'hidden', 'flagged'):
        return jsonify({'status': 'error', 'msg': '잘못된 상태값입니다.'}), 400
    c.status = st
    if data.get('reason'):
        c.ai_reason = _clean(data.get('reason'), 300)
    db.session.commit()
    return jsonify({'status': 'ok'})


# --- accounts
@joguk_bp.route('/api/admin/rebuild/accounts')
def admin_accounts():
    g = _admin_guard()
    if g:
        return g
    st = request.args.get('status', '')
    q = JogukAccount.query
    if st:
        q = q.filter(JogukAccount.status == st)
    rows = q.order_by(JogukAccount.created_at.desc()).limit(300).all()
    return jsonify({'items': [{
        'id': a.id, 'email': masked_email(a.email), 'status': a.status,
        'email_verified': bool(a.email_verified),
        'committee': bool(JogukCommittee.query.filter_by(account_id=a.id).first()),
        'banner_poster': bool(JogukBannerPoster.query.filter_by(account_id=a.id).first()),
        'created_at': a.created_at.isoformat() if a.created_at else '',
    } for a in rows]})


@joguk_bp.route('/api/admin/rebuild/accounts/<int:aid>/status', methods=['POST'])
def admin_account_status(aid):
    g = _admin_guard()
    if g:
        return g
    a = JogukAccount.query.get_or_404(aid)
    st = (request.get_json(silent=True) or {}).get('status')
    if st not in ('pending', 'approved', 'offline', 'rejected', 'left'):
        return jsonify({'status': 'error', 'msg': '잘못된 상태값입니다.'}), 400
    a.status = st
    if st in ('approved', 'offline'):
        a.approved_at = datetime.now()
        a.approved_by = session.get('user_id')
    db.session.commit()
    if st in ('approved', 'offline'):
        _send_approval_mail(a, offline=(st == 'offline'), base=request.url_root)
    elif st == 'rejected':
        _send_reject_mail(a, base=request.url_root)
    return jsonify({'status': 'ok'})


# --- cards / stats
@joguk_bp.route('/api/admin/rebuild/cards', methods=['GET', 'POST'])
def admin_cards():
    g = _admin_guard()
    if g:
        return g
    if request.method == 'POST':
        d = request.get_json(silent=True) or {}
        if not _clean(d.get('title'), 200):
            return jsonify({'status': 'error', 'msg': '제목을 입력해 주세요.'}), 400
        c = JogukCard(side='central' if d.get('side') == 'central' else 'local',
                      title=_clean(d.get('title'), 200), subtitle=_clean(d.get('subtitle'), 200),
                      body=d.get('body') or '', link_url=_clean(d.get('link_url'), 500),
                      sort_order=int(d.get('sort_order') or 0), active=bool(d.get('active', True)))
        db.session.add(c)
        db.session.commit()
        return jsonify({'status': 'ok', 'id': c.id})
    rows = JogukCard.query.order_by(JogukCard.side, JogukCard.sort_order).all()
    return jsonify({'items': [{
        'id': r.id, 'side': r.side, 'title': r.title, 'subtitle': r.subtitle or '',
        'body': r.body or '', 'link_url': r.link_url or '',
        'sort_order': r.sort_order, 'active': bool(r.active),
    } for r in rows]})


@joguk_bp.route('/api/admin/rebuild/cards/<int:cid>', methods=['PUT', 'DELETE'])
def admin_card_one(cid):
    g = _admin_guard()
    if g:
        return g
    c = JogukCard.query.get_or_404(cid)
    if request.method == 'DELETE':
        db.session.delete(c)
        db.session.commit()
        return jsonify({'status': 'ok'})
    d = request.get_json(silent=True) or {}
    c.title = _clean(d.get('title'), 200) or c.title
    c.subtitle = _clean(d.get('subtitle'), 200)
    c.body = d.get('body') or ''
    c.link_url = _clean(d.get('link_url'), 500)
    c.sort_order = int(d.get('sort_order') or 0)
    c.active = bool(d.get('active', True))
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/admin/rebuild/stats', methods=['GET', 'POST'])
def admin_stats():
    g = _admin_guard()
    if g:
        return g
    if request.method == 'POST':
        for item in (request.get_json(silent=True) or {}).get('items', []):
            row = JogukStat.query.filter_by(key=item.get('key')).first()
            if not row:
                row = JogukStat(key=item.get('key'), label=item.get('label', ''))
                db.session.add(row)
            row.label = item.get('label', row.label)
            row.value = _clean(item.get('value'), 60)
        db.session.commit()
        return jsonify({'status': 'ok'})
    rows = JogukStat.query.order_by(JogukStat.sort_order).all()
    return jsonify({'items': [{'key': r.key, 'label': r.label, 'value': r.value} for r in rows]})


# --- issues (공론 안건)
@joguk_bp.route('/api/admin/rebuild/issues', methods=['GET', 'POST'])
def admin_issues():
    g = _admin_guard()
    if g:
        return g
    if request.method == 'POST':
        d = request.get_json(silent=True) or {}
        tid = int(d.get('topic_id') or 0)
        if not tid or not JogukTopic.query.get(tid):
            gongron = JogukTopic.query.filter_by(name='공론').first()
            if not gongron:
                gongron = JogukTopic(group_name='일반', name='공론', sort_order=99, active=False)
                db.session.add(gongron)
                db.session.commit()
            tid = gongron.id
        if not _clean(d.get('title'), 200):
            return jsonify({'status': 'error', 'msg': '제목을 입력해 주세요.'}), 400
        it = JogukIssue(topic_id=tid, title=_clean(d.get('title'), 200),
                        body=d.get('body') or '', created_by=session.get('user_id'))
        db.session.add(it)
        db.session.commit()
        return jsonify({'status': 'ok', 'id': it.id})
    rows = JogukIssue.query.order_by(JogukIssue.created_at.desc()).all()
    return jsonify({'items': [{
        'id': r.id, 'topic_id': r.topic_id, 'title': r.title, 'status': r.status,
        'vote_yes': r.vote_yes or 0, 'vote_no': r.vote_no or 0,
        'result_summary': r.result_summary or '',
    } for r in rows]})


@joguk_bp.route('/api/admin/rebuild/issues/<int:iid>', methods=['PUT', 'DELETE'])
def admin_issue_one(iid):
    g = _admin_guard()
    if g:
        return g
    it = JogukIssue.query.get_or_404(iid)
    if request.method == 'DELETE':
        JogukIssueVote.query.filter_by(issue_id=iid).delete()
        JogukIssueComment.query.filter_by(issue_id=iid).delete()
        db.session.delete(it)
        db.session.commit()
        return jsonify({'status': 'ok'})
    d = request.get_json(silent=True) or {}
    if d.get('title'):
        it.title = _clean(d['title'], 200)
    if 'body' in d:
        it.body = d['body'] or ''
    if d.get('status') in ('open', 'closed'):
        it.status = d['status']
        if d['status'] == 'closed' and not it.closed_at:
            it.closed_at = datetime.now()
    if 'result_summary' in d:
        it.result_summary = d['result_summary'] or ''
    db.session.commit()
    return jsonify({'status': 'ok'})

# --- topics (주제 관리)
@joguk_bp.route('/api/admin/rebuild/topics', methods=['GET', 'POST'])
def admin_topics():
    g = _admin_guard()
    if g:
        return g
    if request.method == 'POST':
        d = request.get_json(silent=True) or {}
        name = _clean(d.get('name'), 50)
        if not name:
            return jsonify({'status': 'error', 'msg': '주제명을 입력해 주세요.'}), 400
        if JogukTopic.query.filter_by(name=name).first():
            return jsonify({'status': 'error', 'msg': '이미 있는 주제입니다.'}), 400
        grp = '현안' if d.get('group') == '현안' else '일반'
        max_order = db.session.query(db.func.max(JogukTopic.sort_order)).scalar() or 0
        t = JogukTopic(group_name=grp, name=name,
                       description=_clean(d.get('description'), 300),
                       sort_order=max_order + 1, active=True)
        db.session.add(t)
        db.session.commit()
        return jsonify({'status': 'ok', 'id': t.id})
    rows = JogukTopic.query.order_by(JogukTopic.sort_order, JogukTopic.id).all()
    return jsonify({'items': [{
        'id': r.id, 'group': r.group_name, 'name': r.name,
        'description': r.description or '', 'sort_order': r.sort_order,
        'active': bool(r.active),
        'issue_count': JogukIssue.query.filter_by(topic_id=r.id).count(),
    } for r in rows]})


@joguk_bp.route('/api/admin/rebuild/topics/<int:tid>', methods=['PUT', 'DELETE'])
def admin_topic_one(tid):
    g = _admin_guard()
    if g:
        return g
    t = JogukTopic.query.get_or_404(tid)
    if request.method == 'DELETE':
        if JogukIssue.query.filter_by(topic_id=tid).count() > 0:
            return jsonify({'status': 'error', 'msg': '안건이 있는 주제는 삭제할 수 없습니다. 숨김(비활성)을 사용하세요.'}), 400
        db.session.delete(t)
        db.session.commit()
        return jsonify({'status': 'ok'})
    d = request.get_json(silent=True) or {}
    if d.get('name'):
        nm = _clean(d['name'], 50)
        dup = JogukTopic.query.filter(JogukTopic.name == nm, JogukTopic.id != tid).first()
        if dup:
            return jsonify({'status': 'error', 'msg': '이미 있는 주제입니다.'}), 400
        t.name = nm
    if d.get('group') in ('일반', '현안'):
        t.group_name = d['group']
    if 'description' in d:
        t.description = _clean(d['description'], 300)
    if 'active' in d:
        t.active = bool(d['active'])
    if 'sort_order' in d:
        try:
            t.sort_order = int(d['sort_order'])
        except Exception:
            pass
    db.session.commit()
    return jsonify({'status': 'ok'})

# ---------------------------------------------------------------- 일반 게시글
def _clean_html(html):
    """간단 정화: script/style/이벤트 핸들러 제거"""
    html = html or ''
    html = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', '', html)
    html = re.sub(r'(?i)\son\w+\s*=\s*"[^"]*"', '', html)
    html = re.sub(r"(?i)\son\w+\s*=\s*'[^']*'", '', html)
    html = re.sub(r'(?i)javascript:', '', html)
    return html[:200000]


def _post_list_item(p, with_count=False):
    acc = JogukAccount.query.get(p.account_id)
    topic = JogukTopic.query.get(p.topic_id)
    d = {
        'id': p.id, 'topic_id': p.topic_id, 'topic_name': topic.name if topic else '',
        'title': p.title, 'author': masked_email(acc.email) if acc else '',
        'like_count': p.like_count or 0, 'view_count': p.view_count or 0,
        'created_at': p.created_at.isoformat() if p.created_at else '',
    }
    if with_count:
        d['comment_count'] = JogukPostComment.query.filter_by(post_id=p.id, status='visible').count()
    th = _candidate_threshold()
    d['candidate'] = (p.like_count or 0) >= th
    d['threshold'] = th
    lc = JogukPostLifecycle.query.filter_by(post_id=p.id).first()
    if lc and lc.expire_at and not lc.keep_until:
        d['expire_at'] = lc.expire_at.isoformat()
        d['days_left'] = max(0, (lc.expire_at - datetime.now()).days)
    elif lc and lc.keep_until:
        d['keep_until'] = lc.keep_until.isoformat()
        d['days_left'] = max(0, (lc.keep_until - datetime.now()).days)
    else:
        d['expire_at'] = ''
        d['days_left'] = None
    return d


@joguk_bp.route('/api/rebuild/posts')
def joguk_posts():
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    tid = request.args.get('topic', type=int)
    q = JogukPost.query.filter(JogukPost.status == 'visible')
    if tid:
        q = q.filter(JogukPost.topic_id == tid)
    rows = q.order_by(JogukPost.created_at.desc()).limit(100).all()
    _apply_lifecycle(rows)
    rows = [p for p in rows if p.status == 'visible']
    return jsonify({'items': [_post_list_item(p, True) for p in rows]})


@joguk_bp.route('/api/rebuild/posts/<int:pid>')
def joguk_post_detail(pid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    p = JogukPost.query.get_or_404(pid)
    if p.status != 'visible':
        return jsonify({'status': 'error', 'msg': '볼 수 없는 글입니다.'}), 404
    p.view_count = (p.view_count or 0) + 1
    db.session.commit()
    comments = JogukPostComment.query.filter_by(post_id=pid, status='visible') \
        .order_by(JogukPostComment.created_at.asc()).all()
    d = _post_list_item(p, True)
    d.update({
        'content': p.content or '', 'drawing_data': p.drawing_data or '',
        'mine': p.account_id == acc.id,
        'can_write': acc.status == 'offline',
        'comments': [{
            'id': c.id, 'content': c.content or '',
            'author': masked_email((JogukAccount.query.get(c.account_id) or JogukAccount(email='')).email) if c.account_id else '',
            'created_at': c.created_at.isoformat() if c.created_at else '',
        } for c in comments],
    })
    return jsonify(d)


@joguk_bp.route('/api/rebuild/posts', methods=['POST'])
def joguk_post_create():
    acc, err = _require_writer()
    if err:
        return jsonify({'status': 'error', 'msg': err[0]}), err[1]
    d = request.get_json(silent=True) or {}
    topic_id = int(d.get('topic_id') or 0)
    if not JogukTopic.query.get(topic_id):
        return jsonify({'status': 'error', 'msg': '주제를 선택해 주세요.'}), 400
    title = _clean(d.get('title'), 200)
    if not title:
        return jsonify({'status': 'error', 'msg': '제목을 입력해 주세요.'}), 400
    ok, msg = _moderate(title + ' ' + re.sub(r'<[^>]+>', ' ', d.get('content') or ''))
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400
    drawing = d.get('drawing_data') or ''
    if drawing and not drawing.startswith('data:image/'):
        drawing = ''
    p = JogukPost(topic_id=topic_id, account_id=acc.id, title=title,
                  content=_clean_html(d.get('content')), drawing_data=drawing[:2000000])
    db.session.add(p)
    db.session.commit()
    return jsonify({'status': 'ok', 'id': p.id})


@joguk_bp.route('/api/rebuild/posts/<int:pid>', methods=['PUT', 'DELETE'])
def joguk_post_modify(pid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 이용할 수 있습니다.'}), 403
    p = JogukPost.query.get_or_404(pid)
    if p.account_id != acc.id:
        return jsonify({'status': 'error', 'msg': '작성자만 수정할 수 있습니다.'}), 403
    if request.method == 'DELETE':
        JogukPostComment.query.filter_by(post_id=pid).delete()
        db.session.delete(p)
        db.session.commit()
        return jsonify({'status': 'ok'})
    d = request.get_json(silent=True) or {}
    if d.get('title'):
        p.title = _clean(d['title'], 200)
    if 'content' in d:
        p.content = _clean_html(d['content'])
    if 'drawing_data' in d:
        dr = d.get('drawing_data') or ''
        p.drawing_data = dr[:2000000] if dr.startswith('data:image/') else ''
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/posts/<int:pid>/comments', methods=['POST'])
def joguk_post_comment(pid):
    acc, err = _require_writer()
    if err:
        return jsonify({'status': 'error', 'msg': err[0]}), err[1]
    p = JogukPost.query.get_or_404(pid)
    d = request.get_json(silent=True) or {}
    content = _clean(d.get('content'), 2000)
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해 주세요.'}), 400
    ok, msg = _moderate(content)
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400
    db.session.add(JogukPostComment(post_id=pid, account_id=acc.id, content=content))
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/posts/<int:pid>/like', methods=['POST'])
def joguk_post_like(pid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 찬성할 수 있습니다.'}), 403
    p = JogukPost.query.get_or_404(pid)
    key = f'joguk_plike_{p.id}_{acc.id}'
    if session.get(key):
        return jsonify({'status': 'ok', 'like_count': p.like_count or 0, 'already': True,
                        'threshold': _candidate_threshold(), 'candidate': (p.like_count or 0) >= _candidate_threshold()})
    session[key] = 1
    p.like_count = (p.like_count or 0) + 1
    if not JogukPostLike.query.filter_by(post_id=p.id, account_id=acc.id).first():
        db.session.add(JogukPostLike(post_id=p.id, account_id=acc.id))
    db.session.commit()
    th = _candidate_threshold()
    return jsonify({'status': 'ok', 'like_count': p.like_count, 'threshold': th,
                    'candidate': p.like_count >= th})


# ---------------------------------------------------------------- 업로드 (당원 전용)
@joguk_bp.route('/api/rebuild/upload-image', methods=['POST'])
def joguk_upload_image():
    acc, err = _require_writer()
    if err:
        return jsonify({'status': 'error', 'msg': err[0]}), err[1]
    path, e = _save_file(request.files.get('file'), allowed_images_only=True)
    if e:
        return jsonify({'status': 'error', 'msg': e}), 400
    return jsonify({'status': 'success', 'url': path})


@joguk_bp.route('/api/rebuild/upload-file', methods=['POST'])
def joguk_upload_file():
    acc, err = _require_writer()
    if err:
        return jsonify({'error': err[0]}), err[1]
    fs = request.files.get('file')
    path, e = _save_file(fs)
    if e:
        return jsonify({'error': e}), 400
    return jsonify({'url': path, 'name': fs.filename if fs else ''})


# ---------------------------------------------------------------- 관리자: 게시글
@joguk_bp.route('/api/admin/rebuild/posts')
def admin_posts():
    g = _admin_guard()
    if g:
        return g
    rows = JogukPost.query.order_by(JogukPost.created_at.desc()).limit(200).all()
    return jsonify({'items': [_post_list_item(p, True) for p in rows]})


@joguk_bp.route('/api/admin/rebuild/posts/<int:pid>/status', methods=['POST'])
def admin_post_status(pid):
    g = _admin_guard()
    if g:
        return g
    p = JogukPost.query.get_or_404(pid)
    st = (request.get_json(silent=True) or {}).get('status')
    if st not in ('visible', 'hidden'):
        return jsonify({'status': 'error', 'msg': '잘못된 상태입니다.'}), 400
    p.status = st
    db.session.commit()
    return jsonify({'status': 'ok'})

# ---------------------------------------------------------------- 운영위원회
@joguk_bp.route('/api/rebuild/committee/candidates')
def committee_candidates():
    acc = _require_party()
    if not acc or not _is_committee(acc):
        return jsonify({'status': 'error', 'msg': '운영위원만 접근할 수 있습니다.'}), 403
    th = _candidate_threshold()
    adopted = {m.post_id for m in JogukIssueMeta.query.all() if m.post_id}
    rows = JogukPost.query.filter(JogukPost.status == 'visible',
                                  JogukPost.like_count >= th).order_by(JogukPost.created_at.desc()).all()
    return jsonify({'threshold': th, 'items': [
        dict(_post_list_item(p, True), adopted=p.id in adopted) for p in rows
    ]})


@joguk_bp.route('/api/rebuild/committee/adopt', methods=['POST'])
def committee_adopt():
    acc = _require_party()
    if not acc or not _is_committee(acc):
        return jsonify({'status': 'error', 'msg': '운영위원만 접근할 수 있습니다.'}), 403
    d = request.get_json(silent=True) or {}
    pid = int(d.get('post_id') or 0)
    p = JogukPost.query.get(pid)
    if not p:
        return jsonify({'status': 'error', 'msg': '제안글을 찾을 수 없습니다.'}), 404
    if JogukIssueMeta.query.filter_by(post_id=pid).first():
        return jsonify({'status': 'error', 'msg': '이미 안건으로 채택되었습니다.'}), 400

    review_days = max(1, min(int(d.get('review_days') or 7), 60))
    public_days = max(1, min(int(d.get('public_days') or review_days), review_days))  # 공론기간 ≤ 심의기간
    now = datetime.now()

    issue = JogukIssue(topic_id=(JogukTopic.query.filter_by(name='공론').first() or JogukTopic(group_name='일반', name='공론', sort_order=99)).id,
                       title=p.title, body=re.sub(r'<[^>]+>', ' ', p.content or '')[:2000], status='open')
    db.session.add(issue)
    db.session.flush()
    db.session.add(JogukIssueMeta(issue_id=issue.id, post_id=pid,
                                  review_until=now + timedelta(days=review_days),
                                  public_until=now + timedelta(days=public_days)))
    db.session.commit()
    return jsonify({'status': 'ok', 'issue_id': issue.id})


@joguk_bp.route('/api/rebuild/committee/members')
def committee_members():
    acc = _require_party()
    if not acc or not _is_committee(acc):
        return jsonify({'status': 'error', 'msg': '운영위원만 접근할 수 있습니다.'}), 403
    rows = JogukCommittee.query.all()
    out = []
    for r in rows:
        a = JogukAccount.query.get(r.account_id)
        if a:
            out.append({'account_id': a.id, 'email': masked_email(a.email)})
    return jsonify({'items': out})


# 결과 목록에 기간 정보 포함
@joguk_bp.route('/api/rebuild/committee/toggle', methods=['POST'])
def committee_toggle():
    """관리자만: 운영위원 지정/해제"""
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '관리자만 가능합니다.'}), 403
    d = request.get_json(silent=True) or {}
    aid = int(d.get('account_id') or 0)
    if not JogukAccount.query.get(aid):
        return jsonify({'status': 'error', 'msg': '계정을 찾을 수 없습니다.'}), 404
    row = JogukCommittee.query.filter_by(account_id=aid).first()
    if d.get('on'):
        if not row:
            db.session.add(JogukCommittee(account_id=aid))
    elif row:
        db.session.delete(row)
    db.session.commit()
    return jsonify({'status': 'ok'})

@joguk_bp.route('/api/rebuild/posts/<int:pid>/keep', methods=['POST'])
def joguk_post_keep(pid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 이용할 수 있습니다.'}), 403
    p = JogukPost.query.get_or_404(pid)
    if p.account_id != acc.id:
        return jsonify({'status': 'error', 'msg': '작성자만 유지할 수 있습니다.'}), 403
    lc = JogukPostLifecycle.query.filter_by(post_id=pid).first()
    if not lc:
        lc = JogukPostLifecycle(post_id=pid)
        db.session.add(lc)
    lc.keep_until = datetime.now() + timedelta(days=POST_KEEP_DAYS)
    lc.warned_at = None
    lc.expire_at = None
    db.session.commit()
    return jsonify({'status': 'ok', 'keep_until': lc.keep_until.isoformat()})

# ---------------------------------------------------------------- 안건 후보 게시판
CANDIDATE_DEFAULT_DAYS = 3


def _is_committee_or_admin(acc):
    return bool(acc and (_is_committee(acc) or _is_admin()))


def _ensure_candidate(p):
    """찬성 기준 도달 시 후보 행 생성 (만료 기본 3일)"""
    row = JogukCandidate.query.filter_by(post_id=p.id).first()
    if row:
        return row
    th = _candidate_threshold()
    likes = JogukPostLike.query.filter_by(post_id=p.id).order_by(JogukPostLike.created_at.asc()).all()
    if len(likes) < th and (p.like_count or 0) < th:
        return None
    base = likes[th - 1].created_at if len(likes) >= th else (p.created_at or datetime.now())
    row = JogukCandidate(post_id=p.id, expires_at=base + timedelta(days=CANDIDATE_DEFAULT_DAYS))
    db.session.add(row)
    db.session.commit()
    return row


def _candidate_payload(p):
    row = _ensure_candidate(p)
    yes = JogukCandidateVote.query.filter_by(post_id=p.id, stance='yes').count()
    no = JogukCandidateVote.query.filter_by(post_id=p.id, stance='no').count()
    return {
        'post_id': p.id, 'title': p.title, 'author': _post_list_item(p)['author'],
        'like_count': p.like_count or 0, 'threshold': _candidate_threshold(),
        'expires_at': row.expires_at.isoformat() if row and row.expires_at else '',
        'days_left': max(0, (row.expires_at - datetime.now()).days) if row and row.expires_at else None,
        'vote_yes': yes, 'vote_no': no,
        'comment_count': JogukCandidateComment.query.filter_by(post_id=p.id).count(),
        'created_at': p.created_at.isoformat() if p.created_at else '',
    }


@joguk_bp.route('/api/rebuild/candidates')
def candidates_list():
    acc = _require_party()
    if not _is_admin() and not (acc and _is_committee(acc)):
        return jsonify({'status': 'error', 'msg': '운영위원만 접근할 수 있습니다.'}), 403
    th = _candidate_threshold()
    adopted = {m.post_id for m in JogukIssueMeta.query.all() if m.post_id}
    rows = JogukPost.query.filter(JogukPost.status == 'visible', JogukPost.like_count >= th) \
        .order_by(JogukPost.created_at.desc()).all()
    out = []
    for p in rows:
        d = _candidate_payload(p)
        d['adopted'] = p.id in adopted
        out.append(d)
    return jsonify({'threshold': th, 'items': out})


@joguk_bp.route('/api/rebuild/candidates/<int:pid>')
def candidate_detail(pid):
    acc = _require_party()
    if not _is_admin() and not (acc and _is_committee(acc)):
        return jsonify({'status': 'error', 'msg': '운영위원만 접근할 수 있습니다.'}), 403
    p = JogukPost.query.get_or_404(pid)
    d = _candidate_payload(p)
    d['author'] = _post_list_item(p)['author']
    d['content'] = p.content or ''
    _voter = acc
    if not _voter and _is_admin():
        _voter = _admin_account()
    my = JogukCandidateVote.query.filter_by(post_id=pid, account_id=_voter.id).first() if _voter else None
    d['my_vote'] = my.stance if my else ''
    cmts = JogukCandidateComment.query.filter_by(post_id=pid).order_by(JogukCandidateComment.created_at.asc()).all()
    out = []
    for c in cmts:
        a = JogukAccount.query.get(c.account_id)
        out.append({'id': c.id, 'content': c.content,
                    'author': '관리자' if (a and a.email == ADMIN_SYS_EMAIL) else (masked_email(a.email) if a else ''),
                    'created_at': c.created_at.isoformat() if c.created_at else ''})
    d['comments'] = out
    d['can_edit_expiry'] = _is_admin()
    return jsonify(d)


@joguk_bp.route('/api/rebuild/candidates/<int:pid>/vote', methods=['POST'])
def candidate_vote(pid):
    acc = _require_party()
    if not acc:
        if _is_admin():
            acc = _admin_account()
        else:
            return jsonify({'status': 'error', 'msg': '운영위원만 투표할 수 있습니다.'}), 403
    elif not _is_committee_or_admin(acc):
        return jsonify({'status': 'error', 'msg': '운영위원만 투표할 수 있습니다.'}), 403
    stance = (request.get_json(silent=True) or {}).get('stance')
    if stance not in ('yes', 'no'):
        return jsonify({'status': 'error', 'msg': '찬성 또는 반대를 선택해 주세요.'}), 400
    if JogukCandidateVote.query.filter_by(post_id=pid, account_id=acc.id).first():
        return jsonify({'status': 'error', 'msg': '이미 투표하셨습니다.'}), 400
    db.session.add(JogukCandidateVote(post_id=pid, account_id=acc.id, stance=stance))
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/candidates/<int:pid>/comment', methods=['POST'])
def candidate_comment(pid):
    acc = _require_party()
    if not acc:
        if _is_admin():
            acc = _admin_account()
        else:
            return jsonify({'status': 'error', 'msg': '운영위원만 의견을 쓸 수 있습니다.'}), 403
    elif not _is_committee_or_admin(acc):
        return jsonify({'status': 'error', 'msg': '운영위원만 의견을 쓸 수 있습니다.'}), 403
    content = _clean((request.get_json(silent=True) or {}).get('content'), 2000)
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해 주세요.'}), 400
    ok, msg = _moderate(content)
    if not ok:
        return jsonify({'status': 'error', 'msg': msg}), 400
    db.session.add(JogukCandidateComment(post_id=pid, account_id=acc.id, content=content))
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/candidates/<int:pid>/expiry', methods=['PUT'])
def candidate_expiry(pid):
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '책임자(관리자)만 변경할 수 있습니다.'}), 403
    row = JogukCandidate.query.filter_by(post_id=pid).first()
    if not row:
        return jsonify({'status': 'error', 'msg': '후보가 아닙니다.'}), 404
    d = request.get_json(silent=True) or {}
    if d.get('expires_at'):
        try:
            row.expires_at = datetime.fromisoformat(str(d['expires_at']).replace('Z', ''))
        except Exception:
            return jsonify({'status': 'error', 'msg': '날짜 형식이 올바르지 않습니다.'}), 400
    elif d.get('days') is not None:
        row.expires_at = datetime.now() + timedelta(days=max(1, int(d['days'])))
    else:
        return jsonify({'status': 'error', 'msg': '만료일을 지정해 주세요.'}), 400
    db.session.commit()
    return jsonify({'status': 'ok', 'expires_at': row.expires_at.isoformat()})

# ---------------------------------------------------------------- 당원게시판: 현수막 목록(읽기 전용)
@joguk_bp.route('/api/rebuild/banners')
def joguk_banners_read():
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    rows = JogukBanner.query.filter_by(is_public=True).order_by(JogukBanner.created_at.desc()).limit(100).all()
    out = []
    for b in rows:
        d = _banner_payload(b)
        d['comment_count'] = JogukComment.query.filter_by(
            banner_id=b.id, status='visible', is_anonymous=False).count()
        out.append(d)
    return jsonify({'items': out})

# ---------------------------------------------------------------- 현수막 게시/완료
def _banner_meta(b):
    m = JogukBannerMeta.query.filter_by(banner_id=b.id).first()
    if not m:
        m = JogukBannerMeta(banner_id=b.id, status='draft')
        db.session.add(m)
        db.session.commit()
    return m


def _assign_payload(a):
    acc = JogukAccount.query.get(a.account_id)
    return {
        'account_id': a.account_id,
        'email': masked_email(acc.email) if acc else '',
        'photo_path': a.photo_path or '',
        'lat': a.lat or '', 'lng': a.lng or '', 'memo': a.memo or '',
        'posted_at': a.posted_at.isoformat() if a.posted_at else '',
    }


@joguk_bp.route('/api/rebuild/my-banners')
def my_banners():
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 열람할 수 있습니다.'}), 403
    rows = JogukBannerAssign.query.filter_by(account_id=acc.id).all()
    out = []
    for a in rows:
        b = JogukBanner.query.get(a.banner_id)
        if not b:
            continue
        d = _banner_payload(b)
        d['assign'] = _assign_payload(a)
        d['status'] = _banner_meta(b).status
        out.append(d)
    return jsonify({'items': out})


@joguk_bp.route('/api/rebuild/banners/<int:bid>/post', methods=['POST'])
def banner_post_record(bid):
    acc = _require_party()
    if not acc:
        return jsonify({'status': 'error', 'msg': '당원 승인 후 이용할 수 있습니다.'}), 403
    a = JogukBannerAssign.query.filter_by(banner_id=bid, account_id=acc.id).first()
    if not a:
        return jsonify({'status': 'error', 'msg': '배정된 현수막이 아닙니다.'}), 403

    photo, err = _save_file(request.files.get('photo'), allowed_images_only=True)
    if err:
        return jsonify({'status': 'error', 'msg': err}), 400
    if not photo:
        return jsonify({'status': 'error', 'msg': '게시 사진을 첨부해 주세요.'}), 400

    a.photo_path = photo
    a.lat = _clean(request.form.get('lat'), 30)
    a.lng = _clean(request.form.get('lng'), 30)
    a.memo = _clean(request.form.get('memo'), 300)
    a.posted_at = datetime.now()

    b = JogukBanner.query.get(bid)
    if b:
        b.is_public = True
    m = JogukBannerMeta.query.filter_by(banner_id=bid).first()
    if not m:
        m = JogukBannerMeta(banner_id=bid, status='posted')
        db.session.add(m)
    elif m.status == 'draft':
        m.status = 'posted'
    db.session.commit()
    return jsonify({'status': 'ok'})


# --- 관리자: 상태/담당자
@joguk_bp.route('/api/admin/rebuild/banners/<int:bid>/status', methods=['POST'])
def admin_banner_status(bid):
    g = _admin_guard()
    if g:
        return g
    b = JogukBanner.query.get_or_404(bid)
    st = (request.get_json(silent=True) or {}).get('status')
    if st not in ('draft', 'posted', 'done'):
        return jsonify({'status': 'error', 'msg': '잘못된 상태입니다.'}), 400
    m = _banner_meta(b)
    m.status = st
    # 게시 단계에서는 담당 당원만 확인, 완료 시 공개
    b.is_public = (st == 'done')
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/admin/rebuild/banners/<int:bid>/assignees', methods=['GET', 'POST'])
def admin_banner_assignees(bid):
    g = _admin_guard()
    if g:
        return g
    b = JogukBanner.query.get_or_404(bid)
    if request.method == 'POST':
        email = _clean((request.get_json(silent=True) or {}).get('email'), 200).lower()
        acc = JogukAccount.query.filter_by(email=email).first()
        if not acc:
            return jsonify({'status': 'error', 'msg': '해당 이메일의 당원 계정이 없습니다.'}), 404
        if not JogukBannerAssign.query.filter_by(banner_id=bid, account_id=acc.id).first():
            db.session.add(JogukBannerAssign(banner_id=bid, account_id=acc.id))
            if not JogukBannerPoster.query.filter_by(account_id=acc.id).first():
                db.session.add(JogukBannerPoster(account_id=acc.id))
            db.session.commit()
        return jsonify({'status': 'ok'})
    rows = JogukBannerAssign.query.filter_by(banner_id=bid).all()
    return jsonify({'items': [_assign_payload(a) for a in rows]})


@joguk_bp.route('/api/admin/rebuild/banners/<int:bid>/assignees/<int:aid>', methods=['DELETE'])
def admin_banner_unassign(bid, aid):
    g = _admin_guard()
    if g:
        return g
    JogukBannerAssign.query.filter_by(banner_id=bid, account_id=aid).delete()
    db.session.commit()
    return jsonify({'status': 'ok'})

@joguk_bp.route('/api/rebuild/banner-poster/toggle', methods=['POST'])
def banner_poster_toggle():
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '관리자만 가능합니다.'}), 403
    d = request.get_json(silent=True) or {}
    aid = int(d.get('account_id') or 0)
    if not JogukAccount.query.get(aid):
        return jsonify({'status': 'error', 'msg': '계정을 찾을 수 없습니다.'}), 404
    row = JogukBannerPoster.query.filter_by(account_id=aid).first()
    if d.get('on'):
        if not row:
            db.session.add(JogukBannerPoster(account_id=aid))
    elif row:
        db.session.delete(row)
    db.session.commit()
    return jsonify({'status': 'ok'})


@joguk_bp.route('/api/rebuild/banner-posters')
def banner_posters_list():
    if not _is_admin():
        return jsonify({'status': 'error', 'msg': '관리자만 가능합니다.'}), 403
    rows = JogukBannerPoster.query.all()
    out = []
    for r in rows:
        a = JogukAccount.query.get(r.account_id)
        if a:
            out.append({'account_id': a.id, 'email': masked_email(a.email)})
    return jsonify({'items': out})

# ---------------------------------------------------------------- 관리자 업로드 (현수막 글쓰기)
@joguk_bp.route('/api/admin/rebuild/upload-image', methods=['POST'])
def admin_upload_image():
    g = _admin_guard()
    if g:
        return g
    path, err = _save_file(request.files.get('file'), allowed_images_only=True)
    if err:
        return jsonify({'status': 'error', 'msg': err}), 400
    return jsonify({'status': 'success', 'url': path})


@joguk_bp.route('/api/admin/rebuild/upload-file', methods=['POST'])
def admin_upload_file():
    g = _admin_guard()
    if g:
        return g
    fs = request.files.get('file')
    path, err = _save_file(fs)
    if err:
        return jsonify({'error': err}), 400
    return jsonify({'url': path, 'name': fs.filename if fs else ''})

@joguk_bp.route('/api/rebuild/consent-text')
def consent_text():
    return jsonify({
        'version': CONSENT_VERSION,
        'items': [
            {'key': 'privacy', 'required': True,
             'title': '개인정보 수집·이용 동의',
             'desc': '수집 항목: 이메일, 비밀번호 / 수집 목적: 게시판 회원 식별·이메일 인증 / 보유 기간: 탈퇴 또는 목적 달성 시까지'},
            {'key': 'email', 'required': True,
             'title': '이메일 인증 및 안내 수신 동의',
             'desc': '가입 인증, 승인 결과, 게시글 만료 안내를 이메일로 발송합니다.'},
            {'key': 'transfer', 'required': True,
             'title': '이름·주소 전달 동의',
             'desc': '이름과 주소는 서버에 저장하지 않으며, 가입 승인 확인을 위해 지역위원장 이메일로만 전송됩니다.'},
            {'key': 'overseas', 'required': True,
             'title': '개인정보 국외 이전 동의',
             'desc': '위원장 메일이 Google(Gmail, 미국)을 사용하므로 이름·주소가 국외로 이전됩니다. '
                     '이전 항목: 이름·주소 / 이전 국가: 미국 / 이전 시기·방법: 가입 즉시 이메일 전송 / '
                     '이전받는 자: Google LLC / 보유기간: 위원장 확인 후 파기'},
            {'key': 'age14', 'required': True,
             'title': '만 14세 이상입니다',
             'desc': '만 14세 미만은 법정대리인 동의가 필요합니다.'},
        ],
        'rights': '동의를 거부할 권리가 있으며, 거부 시 게시판 가입이 제한됩니다. '
                  '보호책임자: 지역위원장 이훈 (laon.cafe@gmail.com)',
    })

# ---------------------------------------------------------------- 개인정보 처리방침 (공개)
@joguk_bp.route('/rebuild/privacy')
def joguk_privacy_page():
    body = """
    <h1>개인정보 처리방침</h1>
    <p class="meta">조국혁신당 여주·양평 지역위원회 당원게시판 · 시행일 2026-11-23</p>

    <h2>1. 수집하는 개인정보 항목</h2>
    <table>
      <tr><th>구분</th><th>항목</th><th>수집 방법</th></tr>
      <tr><td>필수</td><td>이메일, 비밀번호(암호화 저장)</td><td>회원가입</td></tr>
      <tr><td>필수(전송만)</td><td>이름, 주소</td><td>가입 시 위원장 이메일로 전송 (서버 미저장)</td></tr>
      <tr><td>자동</td><td>동의 기록(항목·버전·일시)</td><td>가입·댓글 작성 시</td></tr>
    </table>

    <h2>2. 수집·이용 목적</h2>
    <ul>
      <li>게시판 회원 식별 및 로그인</li>
      <li>이메일 인증, 가입 승인 결과 안내, 게시글 만료 안내</li>
      <li>당원 여부 확인(운영위 승인)</li>
    </ul>

    <h2>3. 보유 및 이용 기간</h2>
    <ul>
      <li>회원 정보: 탈퇴 또는 삭제 요청 시까지</li>
      <li>댓글: 작성자가 삭제하거나 관리자가 삭제할 때까지</li>
      <li>동의 기록: 동의 철회 후 5년(분쟁 대응)</li>
    </ul>

    <h2>4. 개인정보의 제3자 제공 및 국외 이전</h2>
    <p>이름·주소는 서버에 저장하지 않고, 가입 승인 확인을 위해 지역위원장 이메일로 전송합니다.</p>
    <table>
      <tr><th>이전받는 자</th><th>국가</th><th>항목</th><th>시기·방법</th></tr>
      <tr><td>Google LLC (Gmail)</td><td>미국</td><td>이름, 주소, 이메일</td><td>가입 즉시 이메일 전송</td></tr>
    </table>

    <h2>5. 파기 절차 및 방법</h2>
    <ul>
      <li>보유기간 경과 또는 목적 달성 시 지체 없이 파기</li>
      <li>전자적 파일: 복원 불가능한 방법으로 삭제</li>
      <li>메일로 받은 이름·주소: 위원장 확인 후 파기</li>
    </ul>

    <h2>6. 정보주체의 권리</h2>
    <ul>
      <li>열람·정정·삭제·처리정지 요구 가능</li>
      <li>동의 철회 가능 (철회 시 게시판 이용 제한)</li>
      <li>요구는 아래 연락처로 접수하며 지체 없이 처리합니다.</li>
    </ul>

    <h2>7. 안전성 확보조치</h2>
    <ul>
      <li>비밀번호는 복원 불가능한 해시로 저장</li>
      <li>이메일은 화면에 절반만 표시, 댓글은 비밀글로 처리</li>
      <li>개인정보 처리 권한은 관리자로 제한</li>
    </ul>

    <h2>8. 개인정보 보호책임자</h2>
    <p>지역위원장 이훈 · laon.cafe@gmail.com</p>

    <h2>9. 접속기록의 보관</h2>
    <ul>
      <li>개인정보처리시스템 접속기록을 <b>1년간</b> 보관합니다.</li>
      <li>보관 항목: 접속 일시, 접속 IP, 브라우저 정보, 수행 업무(로그인·가입·탈퇴 등)</li>
      <li>보관 기간이 지난 기록은 자동으로 파기합니다.</li>
    </ul>

    <h2>10. 개인정보 유출 대응 절차</h2>
    <p>유출 사고 발생 시 지체 없이 아래 절차에 따라 처리합니다.
       <a href="/rebuild/security">유출 대응 절차 전문 보기</a></p>

    <h2>11. 고지 의무</h2>
    <p>본 방침이 변경되면 게시판 공지로 알립니다.</p>
    """
    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>개인정보 처리방침</title>
    <style>
      body {{ font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; background:#f6f7f9; margin:0; padding:24px; color:#222; }}
      .wrap {{ max-width: 820px; margin: 0 auto; background:#fff; padding:32px 36px; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,.06); }}
      h1 {{ color:#1F7A4D; font-size:24px; margin:0 0 6px; }}
      h2 {{ font-size:16px; margin:22px 0 8px; }}
      .meta {{ color:#666; font-size:13px; margin-bottom:18px; }}
      p, li {{ font-size:14px; line-height:1.7; }}
      table {{ width:100%; border-collapse:collapse; margin:8px 0; }}
      th, td {{ border:1px solid #d9e2dc; padding:6px 8px; font-size:13px; text-align:left; }}
      th {{ background:#1F7A4D; color:#fff; }}
      a.back {{ display:inline-block; margin-top:24px; color:#1F7A4D; text-decoration:none; font-size:14px; }}
      @media print {{ body {{ background:#fff; padding:0; }} .wrap {{ box-shadow:none; }} }}
    </style></head><body><div class="wrap">{body}
    <a class="back" href="/rebuild/member">← 당원게시판으로 돌아가기</a>
    </div></body></html>"""
    return html

@joguk_bp.route('/api/rebuild/withdraw', methods=['POST'])
def joguk_withdraw():
    """회원 탈퇴 — 계정 및 관련 기록 즉시 파기"""
    acc = _account()
    if not acc:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    password = (request.get_json(silent=True) or {}).get('password') or ''
    if not check_password_hash(acc.password_hash, password):
        return jsonify({'status': 'error', 'msg': '비밀번호가 맞지 않습니다.'}), 400

    aid = acc.id
    # 게시글과 하위 기록
    posts = JogukPost.query.filter_by(account_id=aid).all()
    for p in posts:
        JogukPostComment.query.filter_by(post_id=p.id).delete()
        JogukPostLike.query.filter_by(post_id=p.id).delete()
        JogukCandidateVote.query.filter_by(post_id=p.id).delete()
        JogukCandidateComment.query.filter_by(post_id=p.id).delete()
        JogukCandidate.query.filter_by(post_id=p.id).delete()
        db.session.delete(p)
    # 참여 기록
    JogukPostComment.query.filter_by(account_id=aid).delete()
    JogukPostLike.query.filter_by(account_id=aid).delete()
    JogukIssueVote.query.filter_by(account_id=aid).delete()
    JogukIssueComment.query.filter_by(account_id=aid).delete()
    JogukCandidateVote.query.filter_by(account_id=aid).delete()
    JogukCandidateComment.query.filter_by(account_id=aid).delete()
    JogukComment.query.filter_by(account_id=aid).delete()
    JogukToken.query.filter_by(account_id=aid).delete()
    JogukConsent.query.filter_by(account_id=aid).delete()
    JogukCommittee.query.filter_by(account_id=aid).delete()
    JogukBannerPoster.query.filter_by(account_id=aid).delete()
    JogukBannerAssign.query.filter_by(account_id=aid).delete()

    email_copy = acc.email
    db.session.delete(acc)
    db.session.commit()
    _log_access('withdraw', email=email_copy)
    session.pop('joguk_account_id', None)
    return jsonify({'status': 'ok', 'msg': '탈퇴 처리되었습니다. 개인정보가 파기되었습니다.'})
