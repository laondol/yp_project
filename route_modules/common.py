from flask import session
from models import User


import random
import hashlib

def masked_email(email):
    """이메일 아이디의 무작위 위치 50%를 * 로 마스킹(순서 없음), 도메인은 * 로 통째로 숨김.
    같은 이메일은 항상(서버 재시작 포함) 같은 모양이 되도록 hashlib 시드로 난수를 고정한다.
    예) laon.cafe@gmail.com -> la**.*af*@* (위치는 이메일마다 랜덤, 단 고정)
    """
    if not email:
        return ''
    email = str(email).strip()
    if '@' not in email:
        return email
    local, _ = email.split('@', 1)
    local = local.strip()
    if not local:
        return '@*'
    seed = int(hashlib.sha256(local.encode('utf-8')).hexdigest(), 16) % (2**32)
    rnd = random.Random(seed)
    chars = list(local)
    n = len(chars)
    mask_count = n // 2  # 정확히 절반 마스킹
    positions = rnd.sample(range(n), mask_count)
    for p in positions:
        chars[p] = '*'
    return ''.join(chars) + '@*'

def author_email_for(uid):
    """로그인한 회원에게만 작성자의 마스킹 이메일 제공, 비회원/미로그인은 빈 문자열."""
    if not session.get('user_id'):
        return ''
    if not uid:
        return ''
    u = User.query.get(uid)
    if not u:
        return ''
    return masked_email(u.email)


def has_page_access(page):
    """특정 페이지 접근 권한 확인
    - leader: 모든 권한 (단 마을은 체크 필요)
    - managed_pages에 포함된 페이지에만 접근 가능
    """
    role = session.get('role', '')
    uid = session.get('user_id')
    # 마을 관리 권한은 leader만 체크 필요
    if page == 'village' or page.startswith('vi_'):
        if uid:
            user = User.query.get(uid)
            if user and user.managed_pages:
                pages = user.managed_pages.split(',')
                if page in pages or 'village' in pages:
                    return True
                for p in pages:
                    if p.startswith('vi_'):
                        return True
        return False
    # 마을 외 페이지: leader는 전체 권한
    if role == 'leader':
        return True
    if uid:
        user = User.query.get(uid)
    if user and user.managed_pages:
        pages = user.managed_pages.split(',')
        if page in pages:
            return True
    return False


LEADER_EMAIL = 'eou@kakao.com'        # 책임자: 비공개 글 전체 열람 권한(1인)
LEGAL_MANAGER_EMAIL = 'daerilee@gmail.com'  # 이훈: 노동법률상담 페이지 관리자(해당 페이지+관련페이지만 권한, 타 페이지 무권한)

RAMP_KEYWORDS = ('경사로', '휠체어', '휠체어경사로')


def is_ramp_post(post):
    """휠체어경사로보급사업과 관련된 게시글(경사로/휠체어 키워드) 여부."""
    if post is None:
        return False
    title = getattr(post, 'title', '') or ''
    content = getattr(post, 'content', '') or ''
    text = title + ' ' + content
    return any(k in text for k in RAMP_KEYWORDS)


def is_privileged_viewer(author_uid=None, page_key=None):
    """비공개 글 열람 권한: 작성자 본인, 책임자(eou@kakao.com, 전체), 해당 페이지 관리자.
    이훈(daerilee@gmail.com)은 노동법률상담 페이지('legal') 및 관련 페이지에서만 권한을 가지며,
    경사로/심리/기타 페이지에는 어떤 권한도 없음. 일반 관리자(role admin)는 전역 비공개 열람 권한 없음."""
    uid = session.get('user_id')
    if uid and author_uid is not None and uid == author_uid:
        return True
    email = (session.get('email') or '').strip().lower()
    if email == LEADER_EMAIL:
        return True
    if page_key and email == LEGAL_MANAGER_EMAIL and page_key == 'legal':
        return True
    if page_key and uid:
        user = User.query.get(uid)
        if user and user.managed_pages:
            pages = [p.strip() for p in user.managed_pages.split(',')]
            if page_key in pages:
                if not (email == LEGAL_MANAGER_EMAIL and page_key != 'legal'):
                    return True
    return False


def is_legal_manager():
    """노동이슈(법률상담실) 게시글 작성·AI 추천 선택 권한은 이훈(daerilee@gmail.com)만.
    사용자 명시: '이훈에게만 있어야 됩니다' → 책임자(eou@kakao.com)도 이 권한에는 포함하지 않음."""
    email = (session.get('email') or '').strip().lower()
    return email == LEGAL_MANAGER_EMAIL


def mask_name(name):
    if not name:
        return ''
    return '*' * len(name)


def mask_title(title, keep=0.4):
    if not title:
        return ''
    keep_n = max(1, int(len(title) * keep))
    return title[:keep_n] + '*' * (len(title) - keep_n)


def mask_post_item(d, author_uid=None, content_fields=(), page_key=None):
    """하는일 메뉴 비공개 게시판(법률/심리/경사로)용. 권한 없는 경우: 제목 60%가림, 본문·AI요약·AI사유 공백,
    작성자 메일은 50% 마스킹(기존 원칙), 작성자 이름은 그대로."""
    if is_privileged_viewer(author_uid, page_key):
        return d
    d = dict(d)
    if 'title' in d:
        d['title'] = mask_title(d['title'], keep=0.4)
    if 'author_email' in d:
        d['author_email'] = masked_email(d['author_email'])
    if 'email' in d:
        d['email'] = masked_email(d['email'])
    for f in tuple(content_fields) + ('content', 'ai_summary', 'ai_reason'):
        if f in d:
            d[f] = ''
    d['can_view_content'] = False
    return d
