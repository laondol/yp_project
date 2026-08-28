import sys, os, json, time, shutil
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from run import app
from models import db, ShareReport, User, Message
from services.ai_service import moderate_image, _motif_json
from datetime import datetime, timedelta

INTERVAL = 2
# AI가 독단 승인할 수 있는 글 카테고리 (개인정보/인물과 무관)
AI_APPROVABLE_CATEGORIES = {'사건', '풍경', '장소', '맛집', '가게', '음식', '건물', '시설', '기타'}
# 이미지가 clean 하더라도 텍스트에서 민감 정보가 추정되는 키워드 (보류 유도)
SENSITIVE_TEXT_HINTS = ['번호판', '주민번호', '신분증', '여권', '계좌', '카드번호', '면허증']
SHARE_REPORTS_RELPREFIX = 'static/uploads/share_reports/'
SUB_WEB = '/share_reports'
REVIEW_SUB = 'review'
REJECTED_ARCHIVE_ROOT = os.path.join('server_local', 'rejected_archive')


def _is_member(report):
    return bool(report.user_id) and report.user_id != 0


def _text_has_sensitive_hint(text):
    if not text:
        return False
    return any(h in text for h in SENSITIVE_TEXT_HINTS)


def _classify_text(report):
    """글 담당 AI: 카테고리 분류"""
    try:
        title = report.title or ''
        desc = report.description or ''
        prompt = "양평군 공유 글을 분류하세요.\n제목:" + title + "\n내용:" + desc + "\nJSON: {\"category\": \"풍경/장소/맛집/가게/음식/건물/시설/사건/기타\"}"
        data = _motif_json("양평군 공유 분류 AI", prompt)
        if isinstance(data, str):
            data = json.loads(data)
        return data.get('category', report.ai_category or '기타')
    except Exception:
        return report.ai_category or '기타'


def _share_base():
    return os.path.join(app.root_path, 'static', 'uploads', 'share_reports')


def _move_report_files(report, target_sub):
    """report의 이미지/그림/동영상/추가이미지를 share_reports/<target_sub>/ 로 이동하고 DB 경로 교체"""
    base = _share_base()
    tdir = os.path.join(base, target_sub)
    os.makedirs(tdir, exist_ok=True)
    prefix = '/static/uploads/share_reports/'

    def _move(val):
        if not val:
            return None
        fname = os.path.basename(val)
        part = val[len(prefix):] if val.startswith(prefix) else fname
        src = os.path.join(base, part)
        same = os.path.normpath(src) == os.path.normpath(os.path.join(tdir, fname))
        if os.path.exists(src) and not same:
            dst = os.path.join(tdir, fname)
            i = 0
            while os.path.exists(dst) and os.path.normpath(dst) != os.path.normpath(src):
                i += 1
                dst = os.path.join(tdir, 'dup' + str(i) + '_' + fname)
            try:
                shutil.move(src, dst)
                return prefix + target_sub + '/' + os.path.basename(dst)
            except Exception:
                pass
        return val

    report.image_path = _move(report.image_path)
    report.drawing_path = _move(report.drawing_path)
    report.video_path = _move(report.video_path)
    extras = []
    if report.extra_images:
        for p in report.extra_images.split(','):
            if p.strip():
                moved = _move(p.strip())
                if moved:
                    extras.append(moved)
    report.extra_images = ','.join(extras)


def moderate_report(report):
    """폴더 컨베이어 심사: review/ 에 있는 리포트를 판단 후 approved or hold 로 이동 대상 반환.
    완료 시 이동 대상 subfolder 이름(approved/hold)을 반환하며, 호출자가 파일 이동·커밋을 담당한다."""
    target = None

    # 1) 동영상은 운영진 승인 (review → hold 대기. 관리자 패널에서 승인)
    if report.video_path:
        report.status = 'pending_review'
        report.moderation_result = 'video'
        report.moderation_reason = '동영상은 승인 후 공개됩니다'
        report.is_moderated = True
        report.moderation_at = datetime.now()
        print(f"[WORKER] #{report.id} video → pending_review (hold)")
        return 'hold'

    # 2) 이미지 담당 AI 검열
    paths = []
    if report.image_path: paths.append(report.image_path)
    if report.extra_images:
        paths += [e.strip() for e in report.extra_images.split(',') if e.strip()]
    if report.drawing_path: paths.append(report.drawing_path)

    image_flagged = False
    image_reason = ''
    image_cat = 'clean'
    for rel_path in paths:
        abs_path = os.path.join(app.root_path, rel_path.lstrip('/'))
        if not os.path.exists(abs_path):
            continue
        flagged, reason, cat = moderate_image(abs_path)
        if flagged or cat == 'unanalyzable':
            image_flagged = True
            image_reason = reason
            image_cat = cat
            break

    # 3) 글 담당 AI 분류 (category)
    category = _classify_text(report)
    report.ai_category = category

    # 4) 이미지에 문제 있으면 보류
    if image_flagged:
        report.is_moderated = True
        report.moderation_at = datetime.now()
        report.moderation_reason = image_reason
        report.moderation_result = image_cat
        if image_cat == 'person':
            report.status = 'pending_person'
            report.ai_opinion = 'AI: 인물 포함으로 보류(작성자 동의 필요)'
            print(f"[WORKER] #{report.id} person → pending_person (hold)")
            _notify_person(report)
        else:
            report.status = 'flagged'
            report.ai_opinion = f'AI: 이미지 문제({image_cat})로 보류'
            _notify_hold(report, image_reason or f'이미지 문제({image_cat})')
            print(f"[WORKER] #{report.id} {image_cat} → flagged (hold)")
        return 'hold'

    # 5) 텍스트 민감 힌트 보류 (애매한 것 포함 전부 hold 흐름과 일관)
    if _text_has_sensitive_hint(report.description) or _text_has_sensitive_hint(report.title):
        report.is_moderated = True
        report.moderation_at = datetime.now()
        report.moderation_result = 'privacy_text'
        report.moderation_reason = '본문에 개인정보 추정 문구 포함'
        report.status = 'pending'
        report.ai_opinion = 'AI: 본문에 개인정보 추정 문구가 있어 보류'
        _notify_hold(report, '본문에 개인정보 추정 문구 포함')
        print(f"[WORKER] #{report.id} sensitive text → pending (hold)")
        return 'hold'

    # 6) 비회원 글은 AI가 독단 승인하지 않고 보류(관리자 최종 승인 시 공개)
    if not _is_member(report):
        report.is_moderated = True
        report.moderation_at = datetime.now()
        report.moderation_result = 'clean'
        report.moderation_reason = '비회원 글은 관리자 승인 후 공개'
        report.status = 'pending'
        report.ai_opinion = 'AI: 비회원 자동 승인 없이 관리자 승인 대기'
        print(f"[WORKER] #{report.id} non-member → pending (hold)")
        return 'hold'

    # 7) 회원 + 이미지 clean + 무관 카테고리 → AI 독단 승인
    cat_tokens = [c.strip() for c in (category or '').replace('/', ' ').replace(',', ' ').split() if c.strip()]
    if any(tok in AI_APPROVABLE_CATEGORIES for tok in cat_tokens):
        report.is_moderated = True
        report.moderation_at = datetime.now()
        report.moderation_result = 'clean'
        report.moderation_reason = 'AI 무자동 승인'
        report.status = 'approved'
        report.created_at = datetime.now()  # 승인 즉시 공유 목록 맨 앞에 표시
        report.ai_opinion = f'AI: 이미지 이상 없음, 카테고리 "{category}"는 개인정보와 무관하여 자동 승인'
        _resolve_canonical(report)
        print(f"[WORKER] #{report.id} AI auto-approved ({category}) -> APPROVED")
        return 'approved'

    # 8) 그 외 (회원이나 판단 불가/애매한 카테고리) → 반드시 보류
    report.is_moderated = True
    report.moderation_at = datetime.now()
    report.moderation_result = 'clean'
    report.moderation_reason = 'AI 검토 후 보류(관리자/책임자 확인 권장)'
    report.status = 'pending'
    report.ai_opinion = f'AI: 카테고리 "{category}"는 확인이 필요하여 보류'
    _notify_hold(report, 'AI 검토 후 보류(관리자/책임자 확인 권장)')
    print(f"[WORKER] #{report.id} held ({category}) → pending (hold)")
    return 'hold'


def _resolve_canonical(report):
    try:
        from route_modules.construction_bp import _resolve_canonical_store_name
        _resolve_canonical_store_name(report)
    except Exception:
        pass


def _notify_person(report):
    try:
        uploader = User.query.get(report.user_id)
        admin_user = User.query.filter(User.role == 'admin').first()
        if uploader and admin_user:
            accept_url = f"{app.config.get('SITE_URL', 'https://test.unocum.kr')}/share-report/accept-person/{report.id}"
            msg = Message(
                sender_id=admin_user.id, sender_name=admin_user.username, sender_role='admin',
                receiver_id=uploader.id,
                subject='공유 이미지에 인물이 포함되어 있습니다',
                content=f'{uploader.real_name or uploader.username}님, 올리신 공유글(#{report.id})에 인물 사진이 포함되어 있습니다.\n\n게시를 원하시면 아래 링크에서 책임 동의를 완료해 주세요.\n{accept_url}\n\n동의하지 않으시면 게시가 보류됩니다.'
            )
            db.session.add(msg)
    except Exception:
        pass


def _notify_hold(report, reason):
    """보류 시 작성자에게 통보(쪽지)"""
    try:
        uploader = User.query.get(report.user_id)
        admin_user = User.query.filter(User.role == 'admin').first()
        if uploader and admin_user:
            msg = Message(
                sender_id=admin_user.id, sender_name=admin_user.username, sender_role='admin',
                receiver_id=uploader.id,
                subject=f'공유글 #{report.id}이(가) 검토 보류되었습니다',
                content=f'{uploader.real_name or uploader.username}님, 올리신 공유글(#{report.id})이 검토 결과 보류되었습니다.\n사유: {reason}\n\n작성자 본인에게만 표시되며, 관리자/책임자가 확인하면 게시가 진행됩니다. 마이페이지에서 수정할 수도 있습니다.'
            )
            db.session.add(msg)
    except Exception:
        pass


# === 편지 검토 함수 ===
def moderate_pending_letters():
    """심사 대기 중인 편지 (기존 로직 유지)"""
    try:
        pending = Message.query.filter(
            Message.letter_type == 'pending',
            Message.moderation_status == 'pending'
        ).order_by(Message.created_at.asc()).all()

        for msg in pending:
            try:
                reason = _review_letter_content(msg)
                if reason:
                    msg.moderation_status = 'rejected'
                    msg.ripjc_reason = reason
                    ai_admin = User.query.filter(User.username == 'ai_admin').first()
                    if not ai_admin:
                        ai_admin = User.query.filter(User.role == 'admin').first()
                    reject_msg = Message(
                        sender_id=ai_admin.id if ai_admin else 0,
                        sender_name='AI 관리자',
                        sender_role='admin',
                        receiver_id=msg.sender_id,
                        subject=f'편지 발송 반려: {msg.subject}',
                        content="[AI 관리자 알림] ㅡ {subject} 이(가) 검토 결과 반려되었습니다.\n반려 사유: ".format(subject=msg.subject) + reason + "\n※ 자동 검토에 의해 발송",
                        is_public=False,
                        letter_type='ai_reject'
                    )
                    db.session.add(reject_msg)
                    print(f'[WORKER] Letter #{msg.id} rejected: {reason}')
                else:
                    msg.moderation_status = 'approved'
                    if msg.original_receiver_type == 'global':
                        admin_user = User.query.filter(User.username == 'herb2727').first()
                        if admin_user:
                            msg.receiver_id = admin_user.id
                    else:
                        me = User.query.get(msg.sender_id)
                        if me and me.town and me.village:
                            leader = User.query.filter(
                                User.role == 'leader',
                                User.town == me.town,
                                User.village == me.village
                            ).first()
                            if leader:
                                msg.receiver_id = leader.id
                    msg.letter_type = 'admin' if msg.original_receiver_type == 'global' else 'village_leader'
                    msg.is_public = True
                    print(f'[WORKER] Letter #{msg.id} approved & delivered')
                db.session.commit()
            except Exception as e:
                db.session.rollback()
                print(f'[WORKER] Letter #{msg.id} error: {e}')
    except Exception as e:
        print(f'[WORKER] moderate_pending_letters error: {e}')


def _review_letter_content(msg):
    """편지 내용 검토 - 문제 있으면 사유, 없으면 None"""
    content = (msg.content or '') + ' ' + (msg.subject or '')
    banned_words = ['광고', '홍보', '구매', '판매', '대출', '보험', '투자', '수?익', '사기', '피싱', '스팸']
    for w in banned_words:
        if w in content:
            return f'광고/홍보성 내용 포함({w})'
    import re
    if re.search(r'\d{6}-\d{7}', content):
        return '주민등록번호 포함'
    if re.search(r'\d{4}-\d{4}-\d{4}-\d{4}', content):
        return '카드번호 포함'
    if re.search(r'010-\d{4}-\d{4}', content):
        return '전화번호 포함'
    profanity = ['씨발', '병신', '개새끼', '좆', 'ㅅㅂ', 'ㅂㅅ', 'ㅄ']
    for w in profanity:
        if w in content:
            return '비속어 포함'
    threats = ['죽여', '죽일', '폭행', '협박', '위해']
    for w in threats:
        if w in content:
            return '협박성 내용'
    return None


def _archive_expired_rejected():
    """반려 30일 경과 글 → 서버 로컬 server_local/rejected_archive/YYYY-MM/ 로 이동 + 사이트 제거"""
    cutoff = datetime.now() - timedelta(days=30)
    expired = ShareReport.query.filter(
        ShareReport.status == 'rejected',
        ShareReport.rejected_at < cutoff
    ).all()
    for r in expired:
        month = r.rejected_at.strftime('%Y-%m') if r.rejected_at else datetime.now().strftime('%Y-%m')
        arch = os.path.join(app.root_path, REJECTED_ARCHIVE_ROOT, month)
        os.makedirs(arch, exist_ok=True)
        moved_any = False
        for attr in ('image_path', 'drawing_path', 'video_path'):
            p = getattr(r, attr, None)
            if not p:
                continue
            src = os.path.join(app.root_path, p.lstrip('/'))
            if os.path.exists(src):
                try:
                    dst = os.path.join(arch, os.path.basename(src))
                    shutil.move(src, dst)
                    moved_any = True
                except Exception:
                    pass
        if r.extra_images:
            for ep in r.extra_images.split(','):
                ep = ep.strip()
                if not ep:
                    continue
                src = os.path.join(app.root_path, ep.lstrip('/'))
                if os.path.exists(src):
                    try:
                        dst = os.path.join(arch, os.path.basename(src))
                        shutil.move(src, dst)
                        moved_any = True
                    except Exception:
                        pass
        db.session.delete(r)
        print(f"[WORKER] #{r.id} rejected >30d → moved to {os.path.join(REJECTED_ARCHIVE_ROOT, month)} and removed")


def process_all():
    # review/ 폴더만 스캔 (컨베이어). draft/approved/hold/rejected은 대상 아님
    with app.app_context():
        like_pattern = '%/share_reports/review/%'
        reports = ShareReport.query.filter(
            db.or_(
                ShareReport.image_path.like(like_pattern),
                ShareReport.drawing_path.like(like_pattern),
                ShareReport.video_path.like(like_pattern),
                ShareReport.extra_images.like(like_pattern),
            )
        ).order_by(ShareReport.created_at.asc()).all()
        if reports:
            for report in reports:
                try:
                    target = moderate_report(report)
                    if target:
                        _move_report_files(report, target)
                    db.session.commit()
                except Exception as e:
                    db.session.rollback()
                    print(f"[WORKER] #{report.id} error: {e}")
        try:
            _archive_expired_rejected()
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"[WORKER] archive_expired error: {e}")


if __name__ == '__main__':
    print("[AI MODERATION WORKER] 시작됨 (폴더 컨베이어: review→approved/hold)")
    while True:
        try:
            process_all()
        except Exception as e:
            print(f"[WORKER] error: {e}")
        time.sleep(INTERVAL)