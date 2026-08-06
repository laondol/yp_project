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
