from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False, default='')
    password = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='user') # admin, leader, user
    
    # 이웃 자치 데이터
    real_name = db.Column(db.String(50))
    phone = db.Column(db.String(20))
    email = db.Column(db.String(100))                    # 이메일 (인증용)
    email_verified = db.Column(db.Boolean, default=False)
    town = db.Column(db.String(50))                      # 읍/면 (현재)
    village = db.Column(db.String(50))                   # 리 (현재)
    # 가입 시 위치 (과거 위치)
    reg_town = db.Column(db.String(50))                  # 가입 시 읍/면
    reg_village = db.Column(db.String(50))               # 가입 시 리
    reg_latitude = db.Column(db.Float)                   # 가입 시 위도
    reg_longitude = db.Column(db.Float)                  # 가입 시 경도
    # 현재 위치 (갱신용)
    curr_latitude = db.Column(db.Float)                  # 현재 위도
    curr_longitude = db.Column(db.Float)                 # 현재 경도
    curr_offset_lat = db.Column(db.Float, default=0)     # GPS 보정 오프셋
    curr_offset_lng = db.Column(db.Float, default=0)     # GPS 보정 오프셋
    curr_town = db.Column(db.String(50))                 # 현재 읍/면
    curr_village = db.Column(db.String(50))              # 현재 리
    curr_address = db.Column(db.String(200))             # 현재 상세주소
    location_updated_at = db.Column(db.DateTime)         # 위치 갱신 일시
    
    is_verified_resident = db.Column(db.Boolean, default=False) # 주민 자치인증 완료 여부
    verified_method = db.Column(db.String(30), default='none')  # gps, bill, none
    jin_verified_at = db.Column(db.DateTime)  # 마을지기 진 인증 시각
    photo_path = db.Column(db.String(300))  # 마을지기 촬영 사진
    bill_image_path = db.Column(db.String(300))                  # 고지서 사진 경로 (인증 후 즉시 파기)
    
    points = db.Column(db.Integer, default=1000)         # 물맑은머니 닢
    is_paid = db.Column(db.Boolean, default=False)       # 유료회원 여부
    last_payout = db.Column(db.DateTime)                 # 마지막 지급일 (가입일 기준 30일 주기)
    last_login = db.Column(db.DateTime)                  # 마지막 로그인 일시
    last_logout = db.Column(db.DateTime)                 # 마지막 로그아웃 일시
    login_latitude = db.Column(db.Float)                 # 마지막 로그인 위도
    login_longitude = db.Column(db.Float)                # 마지막 로그인 경도
    login_town = db.Column(db.String(50))                # 마지막 로그인 읍/면
    login_village = db.Column(db.String(50))             # 마지막 로그인 리
    login_location_share = db.Column(db.Boolean, default=False) # 벗에게 로그인 위치 공유 동의
    location_share = db.Column(db.Boolean, default=False) # 위치 공유 동의
    village_notify = db.Column(db.Boolean, default=True) # 마을소식 알림
    is_neighbor = db.Column(db.Boolean, default=False)  # 이웃주민 (집에서 위치인증 완료)
    office_latitude = db.Column(db.Float)                 # 일터 위도
    office_longitude = db.Column(db.Float)                # 일터 경도
    office_address = db.Column(db.String(200))            # 일터 주소
    work_start_time = db.Column(db.String(5))             # 업무 시작시간 (HH:MM)
    temp_address = db.Column(db.String(200))              # 임시숙소 주소
    temp_latitude = db.Column(db.Float)                   # 임시숙소 위도
    temp_longitude = db.Column(db.Float)                  # 임시숙소 경도
    temp_start_date = db.Column(db.DateTime)              # 임시숙소 시작일
    temp_end_date = db.Column(db.DateTime)                # 임시숙소 종료일

    # SNS 연동 로그인
    social_id = db.Column(db.String(200), unique=True, nullable=True)
    social_provider = db.Column(db.String(20), nullable=True)  # google, kakao, naver
    social_email = db.Column(db.String(100), nullable=True)
    email_verification_token = db.Column(db.String(100), nullable=True)
    email_verification_sent_at = db.Column(db.DateTime, nullable=True)
    reset_token = db.Column(db.String(100), nullable=True)
    reset_token_expiry = db.Column(db.DateTime, nullable=True)
    managed_pages = db.Column(db.String(500), default='')
    block_order_profile = db.Column(db.Text, nullable=True)   # JSON: 블록 순서 (회원정보페이지)
    block_order_intro = db.Column(db.Text, nullable=True)     # JSON: 블록 순서 (인트로페이지)
    intro_page_enabled = db.Column(db.Boolean, default=False)  # 인트로페이지 활성화 여부
    password_v2 = db.Column(db.Boolean, default=False)          # True=클라이언트 해시(PBKDF2), False=기존 방식
    share_mod_approved = db.Column(db.Boolean, default=False)   # 공유마당 심사 권한 (관리자/책임자 부여)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    author_name = db.Column(db.String(50))
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    
    category = db.Column(db.String(50), default='일반제안')     # 일반제안, 양평소식, 마을제보
    status = db.Column(db.String(20), default='제안')           # 제안, 하고싶은, 하고있는, 했던거, 하는일
    
    # AI 지킴이 심사 데이터
    ai_score = db.Column(db.Integer, default=0)
    ai_summary = db.Column(db.Text)
    ai_reason = db.Column(db.Text)
    ai_debate_log = db.Column(db.Text, default="[]")
    ai_improvement_tip = db.Column(db.Text)
    
    # 거버넌스 채점단 가중치
    admin_score = db.Column(db.Integer, default=0)
    leader_score = db.Column(db.Integer, default=0)
    member_score = db.Column(db.Integer, default=0)
    total_score = db.Column(db.Integer, default=0)
    
    file_path = db.Column(db.String(300))                       # 주민 업로드/그림 저장 경로
    latitude = db.Column(db.Float)                              # 위치: 위도
    longitude = db.Column(db.Float)                             # 위치: 경도
    address = db.Column(db.String(300))                         # 위치: 주소/설명
    is_forced_approved = db.Column(db.Boolean, default=False)   # 지킴이 즉시 승인 여부
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)   # 수정일 (48시간 대기 리셋용)
    deadline = db.Column(db.DateTime)                           # 낙제 시 30일 수정 기한
    penalty_applied = db.Column(db.Boolean, default=False)
    like_count = db.Column(db.Integer, default=0)
    dislike_count = db.Column(db.Integer, default=0)
    is_finalized = db.Column(db.Boolean, default=False)         # admin+leader 점수 확정

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    author = db.Column(db.String(50))
    content = db.Column(db.Text, nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('comment.id'), nullable=True)
    total_score = db.Column(db.Integer, default=0)              # 댓글 AI 방역용
    created_at = db.Column(db.DateTime, default=datetime.now)

    replies = db.relationship('Comment', backref=db.backref('parent', remote_side=[id]), lazy=True)

class ShareComment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    share_id = db.Column(db.Integer, db.ForeignKey('share_report.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    author = db.Column(db.String(50))
    content = db.Column(db.Text, nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('share_comment.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

    replies = db.relationship('ShareComment', backref=db.backref('parent', remote_side=[id]), lazy=True)

class NewsArticle(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    ai_score = db.Column(db.Integer, default=0)
    summary = db.Column(db.Text)
    content = db.Column(db.Text)
    source_url = db.Column(db.Text)
    source_name = db.Column(db.String(200))
    image_path = db.Column(db.String(300))
    category = db.Column(db.String(50), default='세계뉴스')
    is_selected = db.Column(db.Boolean, default=False)
    is_ai_generated = db.Column(db.Boolean, default=False)
    like_count = db.Column(db.Integer, default=0)
    dislike_count = db.Column(db.Integer, default=0)
    # 승인 상태 (탭별)
    world_ai_approved = db.Column(db.Boolean, default=False)
    world_admin_approved = db.Column(db.Boolean, default=False)
    kr_yp_ai_approved = db.Column(db.Boolean, default=False)
    kr_yp_admin_approved = db.Column(db.Boolean, default=False)
    labor_only = db.Column(db.Boolean, default=False)
    ai_reason = db.Column(db.Text)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)
    published_at = db.Column(db.DateTime, nullable=True)

class NewsComment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    news_id = db.Column(db.Integer, db.ForeignKey('news_article.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    author_name = db.Column(db.String(50))
    content = db.Column(db.Text, nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('news_comment.id'))  # 답글용
    ai_score = db.Column(db.Integer, default=0)
    is_hidden = db.Column(db.Boolean, default=False)  # AI 낙제 시 숨김
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)
    
    replies = db.relationship('NewsComment', backref=db.backref('parent', remote_side=[id]), lazy=True)

class NewsRecommendation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    news_id = db.Column(db.Integer, db.ForeignKey('news_article.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    author_name = db.Column(db.String(50))
    title = db.Column(db.String(200), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    description = db.Column(db.Text)
    is_approved = db.Column(db.Boolean, default=False)
    approved_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    approved_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)

class NewsVote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    news_id = db.Column(db.Integer, db.ForeignKey('news_article.id'), nullable=False)
    vote = db.Column(db.String(10), default='like')  # 'like' or 'dislike'
    created_at = db.Column(db.DateTime, default=datetime.now)
    __table_args__ = (db.UniqueConstraint('user_id', 'news_id'),)

class LaborNewsArticle(db.Model):
    __tablename__ = 'labor_news_article'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    summary = db.Column(db.Text)
    content = db.Column(db.Text)
    source_url = db.Column(db.Text)
    source_name = db.Column(db.String(200))
    category = db.Column(db.String(50), default='정책정보')
    is_selected = db.Column(db.Boolean, default=False)
    is_ai_generated = db.Column(db.Boolean, default=False)
    ai_reason = db.Column(db.Text)
    like_count = db.Column(db.Integer, default=0)
    dislike_count = db.Column(db.Integer, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class LaborNewsVote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    labor_news_id = db.Column(db.Integer, db.ForeignKey('labor_news_article.id'), nullable=False)
    vote = db.Column(db.String(10), default='like')
    cost = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=datetime.now)

class PointHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    change_type = db.Column(db.String(30))  # signup, monthly, post, comment, like, admin_adjust, payment
    amount = db.Column(db.Integer, default=0)  # 양수: 적립, 음수: 차감
    balance_after = db.Column(db.Integer, default=0)
    description = db.Column(db.Text)
    related_id = db.Column(db.Integer)  # post_id, comment_id 등
    created_at = db.Column(db.DateTime, default=datetime.now)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    sender_name = db.Column(db.String(50))
    sender_role = db.Column(db.String(20))
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    subject = db.Column(db.String(200))
    content = db.Column(db.Text)
    is_read = db.Column(db.Boolean, default=False)
    is_public = db.Column(db.Boolean, default=False)
    letter_type = db.Column(db.String(20), default='private')
    attachment = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.now)
    # 관리자 편지 관련
    town = db.Column(db.String(50))
    village = db.Column(db.String(50))
    original_receiver_type = db.Column(db.String(20))  # 'global', 'village'
    moderation_status = db.Column(db.String(20), default='approved')  # 'approved', 'pending', 'rejected'
    rejection_reason = db.Column(db.Text)

class ShareReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    author_name = db.Column(db.String(50))
    title = db.Column(db.String(200))
    description = db.Column(db.Text)
    image_path = db.Column(db.String(300))
    extra_images = db.Column(db.Text, default='')
    drawing_path = db.Column(db.String(300))
    video_path = db.Column(db.String(300))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    town = db.Column(db.String(50))
    village = db.Column(db.String(50))
    address = db.Column(db.String(200))
    status = db.Column(db.String(20), default='pending')
    admin_note = db.Column(db.Text)
    ai_category = db.Column(db.String(50))
    ai_summary = db.Column(db.Text)
    ai_confidence = db.Column(db.Float)
    ai_region_news = db.Column(db.Text)
    ai_news_links = db.Column(db.Text)
    ai_danger_alert = db.Column(db.Boolean, default=False)
    like_count = db.Column(db.Integer, default=0)
    dislike_count = db.Column(db.Integer, default=0)
    admin_score = db.Column(db.Integer, default=0)
    leader_score = db.Column(db.Integer, default=0)
    member_score = db.Column(db.Integer, default=0)
    total_score = db.Column(db.Integer, default=0)
    is_moderated = db.Column(db.Boolean, default=False)
    moderation_result = db.Column(db.String(20), default='pending')
    moderation_reason = db.Column(db.Text)
    moderation_at = db.Column(db.DateTime)
    canonical_name = db.Column(db.String(200))
    canonical_source = db.Column(db.String(50))
    smartplace_url = db.Column(db.String(500))
    store_suggestion_id = db.Column(db.Integer, db.ForeignKey('store_suggestion.id'), nullable=True)
    sub_category = db.Column(db.String(50), default='')
    promotion_allowed = db.Column(db.Boolean, default=False)
    auto_sent = db.Column(db.Boolean, default=False)        # True=자동 발송(접수 버튼 미사용), False=수동 접수
    rejected_at = db.Column(db.DateTime)                    # 반려 시각 (30일 후 로컬 보관 이동 기준)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class ShareVote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    share_id = db.Column(db.Integer, db.ForeignKey('share_report.id'), nullable=False)
    vote = db.Column(db.String(10), default='like')
    cost = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=datetime.now)

class StoreInfo(db.Model):
    """관리자 등록 동네가게 정보"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    town = db.Column(db.String(50))
    village = db.Column(db.String(50))
    # 링크 3종 (우선순위: our_link > store_homepage > smartplace)
    our_link = db.Column(db.String(500))     # 자체 사이트 내 가게소개 링크
    store_homepage = db.Column(db.String(500))  # 가게 자체 홈페이지
    smartplace = db.Column(db.String(500))
    phone = db.Column(db.String(30))
    created_at = db.Column(db.DateTime, default=datetime.now)


class StoreSuggestion(db.Model):
    """회원이 제안한 가게명 + 투표(경쟁 요소). place_id(카카오) 기준으로 묶음."""
    id = db.Column(db.Integer, primary_key=True)
    place_id = db.Column(db.String(50), nullable=False)  # 카카오 place id
    name = db.Column(db.String(200), nullable=False)     # 제안된 가게명
    suggested_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    vote_count = db.Column(db.Integer, default=1)
    lat = db.Column(db.Float)
    lon = db.Column(db.Float)
    address = db.Column(db.String(200))
    place_url = db.Column(db.String(500))
    phone = db.Column(db.String(30))
    created_at = db.Column(db.DateTime, default=datetime.now)

    @property
    def top_name(self):
        # 같은 place_id 중 최다 투표 이름
        from sqlalchemy import func
        row = db.session.query(StoreSuggestion.name, func.sum(StoreSuggestion.vote_count).label('v'))\
                        .filter_by(place_id=self.place_id).group_by(StoreSuggestion.name)\
                        .order_by(func.sum(StoreSuggestion.vote_count).desc()).first()
        return row[0] if row else self.name


class StoreMenu(db.Model):
    """가게 메뉴 (AI가 식사/음료/디저트/기타로 자동 분류)"""
    id = db.Column(db.Integer, primary_key=True)
    store_suggestion_id = db.Column(db.Integer, db.ForeignKey('store_suggestion.id'), nullable=True)
    place_id = db.Column(db.String(50), nullable=True)
    name = db.Column(db.String(200), nullable=False)
    sub_category = db.Column(db.String(20), default='기타')  # 식사/음료/디저트/기타
    price = db.Column(db.String(30))
    description = db.Column(db.Text)
    ai_generated = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)


class StoreSuggestionVote(db.Model):
    """가게명 제안 투표 이력 (회원별)"""
    id = db.Column(db.Integer, primary_key=True)
    suggestion_id = db.Column(db.Integer, db.ForeignKey('store_suggestion.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

class ConstructionNotice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text)
    location = db.Column(db.String(200))
    address = db.Column(db.String(300))  # 도로명 주소 (역지오코딩)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    source = db.Column(db.String(50))
    source_url = db.Column(db.String(500))
    notice_type = db.Column(db.String(50))
    start_date = db.Column(db.DateTime)
    end_date = db.Column(db.DateTime)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class YardPost(db.Model):
    """마당 — 양평 단체 SNS 공지 + 관리자 직접 등록 소식"""
    __tablename__ = 'yard_post'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    content = db.Column(db.Text)
    source_type = db.Column(db.String(20), default='manual')  # manual(직접), sns(SNS URL), village_event(마을행사 링크)
    platform = db.Column(db.String(20), default='')  # instagram, facebook, kakao, web, ''
    source_url = db.Column(db.String(500))
    author_name = db.Column(db.String(100))         # 단체명/작성자
    is_active = db.Column(db.Boolean, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)


class VillageAlert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text)
    town = db.Column(db.String(50))
    village = db.Column(db.String(50))
    alert_type = db.Column(db.String(30), default='general')
    urgency = db.Column(db.String(20), default='normal')
    author_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    author_name = db.Column(db.String(50))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class AiBroadcast(db.Model):
    """양평AI 전체공지 (담당자 작성 → 책임자 승인 → 발행)"""
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    author_name = db.Column(db.String(50))
    status = db.Column(db.String(20), default='draft')  # draft, pending, approved, published, rejected
    approver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    approved_at = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class HeritageStamp(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    heritage_name = db.Column(db.String(200), nullable=False)
    heritage_lat = db.Column(db.Float)
    heritage_lng = db.Column(db.Float)
    stamped_at = db.Column(db.DateTime, default=datetime.now)

class PublicFacility(db.Model):
    """공중화장실 등 생활안전지도 편의시설"""
    id = db.Column(db.Integer, primary_key=True)
    facility_type = db.Column(db.String(50), default='toilet')  # toilet, shelter, ev_charger, office, ...
    name = db.Column(db.String(300), nullable=False)
    address = db.Column(db.String(300))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    open_hr = db.Column(db.String(100))
    tel = db.Column(db.String(30))
    manager = db.Column(db.String(100))
    emergency_bell = db.Column(db.Boolean, default=False)
    cctv = db.Column(db.Boolean, default=False)
    source = db.Column(db.String(50))          # gg_api, community
    source_url = db.Column(db.String(200))     # objt id / num
    town = db.Column(db.String(50))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)
    is_community = db.Column(db.Boolean, default=False)
    submitted_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    status = db.Column(db.String(20), default='active')  # active, inactive, closed
    verified_count = db.Column(db.Integer, default=0)
    reject_count = db.Column(db.Integer, default=0)
    notes = db.Column(db.Text, default='')
    photo_url = db.Column(db.String(300))
    gender_type = db.Column(db.String(20))   # mixed, separate, male_only, female_only
    accessible = db.Column(db.Boolean, default=False)  # 장애인 가능


class TongBot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    bot_id = db.Column(db.String(10), unique=True, nullable=False)
    bot_name = db.Column(db.String(30), unique=True, nullable=False)
    personality = db.Column(db.Text, default='')
    level = db.Column(db.Integer, default=1)
    exp = db.Column(db.Integer, default=0)
    intimacy = db.Column(db.Integer, default=0)
    mood = db.Column(db.String(20), default='neutral')
    chat_count = db.Column(db.Integer, default=0)
    memory = db.Column(db.Text, default='')
    tone = db.Column(db.String(20), default='friendly')
    is_active = db.Column(db.Boolean, default=True)
    recalled_at = db.Column(db.DateTime, nullable=True)
    recall_reason = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class TongBotDraft(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200))
    content = db.Column(db.Text)
    category = db.Column(db.String(50))
    bot_review = db.Column(db.Text)
    bot_suggestion = db.Column(db.String(100))
    status = db.Column(db.String(20), default='draft')
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class Note(db.Model):
    """통벗 노트: 회원별 자유 분류로 작성한 개인 글 (추후 공개 전환 가능)"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200))
    category = db.Column(db.String(50))
    content = db.Column(db.Text)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    address = db.Column(db.String(300))
    is_public = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class TongBotMemo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    author = db.Column(db.String(10), default='user')
    is_shared = db.Column(db.Boolean, default=False)
    done = db.Column(db.Boolean, default=False)
    seen = db.Column(db.Boolean, default=False)
    end_date = db.Column(db.DateTime, nullable=True)  # 종료일(마감일) - 반복/요금 메모 자동 설정
    reminder_at = db.Column(db.DateTime, nullable=True)  # 메모 알림 예약 시각 ("오후 8시에 알려줘" 등)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class TongBotMemoComment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    memo_id = db.Column(db.Integer, db.ForeignKey('tong_bot_memo.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class TongBotSchedule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    event_date = db.Column(db.DateTime, nullable=False)
    end_date = db.Column(db.DateTime)
    location = db.Column(db.String(200))
    memo = db.Column(db.Text)
    content = db.Column(db.Text)
    departure_location = db.Column(db.String(200))
    return_location = db.Column(db.String(200))
    departure_time = db.Column(db.DateTime)
    return_time = db.Column(db.DateTime)
    invited_user_ids = db.Column(db.Text, default='')
    linked_msg_id = db.Column(db.Integer)
    linked_chat_id = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.now)
    is_allday = db.Column(db.Boolean, default=False)
    is_recurring = db.Column(db.Boolean, default=False)
    repeat_type = db.Column(db.String(20), default='')
    repeat_end_date = db.Column(db.DateTime, nullable=True)
    repeat_interval = db.Column(db.Integer, default=1)
    repeat_infinite = db.Column(db.Boolean, default=False)
    repeat_weekdays = db.Column(db.Integer, default=0)  # bitmask: Mon=1<<0 .. Sun=1<<6
    repeat_week_of_month = db.Column(db.Integer, default=0)  # 0=매주, 1-5=N번째
    repeat_month_of_year = db.Column(db.Integer, default=0)  # 0=매년아님, 1-12=해당월
    repeat_lastday = db.Column(db.Boolean, default=False)  # '매달 말일': 월 마지막 날 반복
    reminder_minutes = db.Column(db.Integer, default=0)  # 0=알림안함, 10/30/60/1440(1일전)
    repeat_exceptions = db.Column(db.Text, default='')  # JSON list of 'YYYY-MM-DD' dates to skip
    # --- 모듈화: parent_id 기반 발생일/경로 추적 ---
    kind = db.Column(db.String(20), default='base')  # 'base' | 'occurrence' | 'route'
    parent_id = db.Column(db.Integer, db.ForeignKey('tong_bot_schedule.id', ondelete='CASCADE'), nullable=True)
    occ_date = db.Column(db.Date, nullable=True)  # 발생일 실제 날짜 (occurrence 전용)
    route_dirty = db.Column(db.Boolean, default=False)  # 모일정 변경 시 이동/귀가 재생성 필요 표시

class ChatRoom(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), default='')
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    participants = db.Column(db.Text, default='[]')
    status_map = db.Column(db.Text, default='{}')
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    expires_at = db.Column(db.DateTime)

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, nullable=False)
    user_id = db.Column(db.Integer, nullable=True)
    username = db.Column(db.String(50))
    message = db.Column(db.Text)
    is_bot = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class FriendCache(db.Model):
    user_id = db.Column(db.Integer, primary_key=True)
    friend_ids = db.Column(db.Text, default='[]')
    updated_at = db.Column(db.DateTime, default=datetime.now)

class VillageCache(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    town = db.Column(db.String(50))
    village = db.Column(db.String(50))
    data_type = db.Column(db.String(30))
    data_json = db.Column(db.Text)
    data_count = db.Column(db.Integer, default=0)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class BotKnowledge(db.Model):
    id = db.Column(db.Integer, db.Sequence('bot_knowledge_id_seq'), primary_key=True)
    topic = db.Column(db.String(100))
    content = db.Column(db.Text)
    source_bot = db.Column(db.String(30))
    useful_count = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=datetime.now)

class BotFeedback(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    bot_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_positive = db.Column(db.Boolean, nullable=False)
    memo_id = db.Column(db.Integer, db.ForeignKey('tong_bot_memo.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

class LegalPost(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    author_name = db.Column(db.String(50), default='익명')
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    answer = db.Column(db.Text)
    comments = db.Column(db.Text)
    answered_at = db.Column(db.DateTime)
    fee = db.Column(db.Integer)
    travel_allowance = db.Column(db.Integer)
    is_public = db.Column(db.Boolean, default=False)
    ai_score = db.Column(db.Integer, default=0)
    ai_reason = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')
    labor_approved = db.Column(db.Boolean, default=False)
    file_path = db.Column(db.String(500))
    link = db.Column(db.String(500))
    viewed_at = db.Column(db.DateTime)
    flagged_decision_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)

class LegalAppointment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    name = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    date = db.Column(db.Date, nullable=False)
    time_slot = db.Column(db.String(20), nullable=False)
    location = db.Column(db.String(200))
    content = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')
    fee = db.Column(db.Integer)
    travel_allowance = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.now)
    approved_at = db.Column(db.DateTime)
    approved_by = db.Column(db.Integer, db.ForeignKey('user.id'))

class LawyerSchedule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    day_of_week = db.Column(db.Integer, nullable=False)
    is_available = db.Column(db.Boolean, default=True)
    start_hour = db.Column(db.Integer, default=10)
    end_hour = db.Column(db.Integer, default=16)
    slot_hours = db.Column(db.Integer, default=2)
    created_at = db.Column(db.DateTime, default=datetime.now)

class GoogleCalendarConfig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    service_account_json = db.Column(db.Text)
    calendar_id = db.Column(db.String(200))
    is_connected = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class PsychoPost(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    author_name = db.Column(db.String(50), default='익명')
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    answer = db.Column(db.Text)
    comments = db.Column(db.Text)
    answered_at = db.Column(db.DateTime)
    fee = db.Column(db.Integer)
    travel_allowance = db.Column(db.Integer)
    is_public = db.Column(db.Boolean, default=False)
    ai_score = db.Column(db.Integer, default=0)
    ai_reason = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')
    flagged_decision_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)
    file_path = db.Column(db.String(500), nullable=True)
    viewed_at = db.Column(db.DateTime, nullable=True)

class PsychoAppointment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    name = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    date = db.Column(db.Date, nullable=False)
    time_slot = db.Column(db.String(20), nullable=False)
    location = db.Column(db.String(200))
    content = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')
    fee = db.Column(db.Integer)
    travel_allowance = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.now)
    approved_at = db.Column(db.DateTime)
    approved_by = db.Column(db.Integer, db.ForeignKey('user.id'))

class PsychoDoctorSchedule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    day_of_week = db.Column(db.Integer, nullable=False)
    is_available = db.Column(db.Boolean, default=True)
    start_hour = db.Column(db.Integer, default=10)
    end_hour = db.Column(db.Integer, default=16)
    slot_hours = db.Column(db.Integer, default=2)
    created_at = db.Column(db.DateTime, default=datetime.now)

class PsychoGoogleCalendarConfig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    service_account_json = db.Column(db.Text)
    calendar_id = db.Column(db.String(200))
    is_connected = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class FriendGroup(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class PostVote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    vote_type = db.Column(db.String(10))  # 'like' or 'dislike'
    created_at = db.Column(db.DateTime, default=datetime.now)

class Friend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey('friend_group.id'), nullable=True)
    status = db.Column(db.String(20), default='pending')  # pending, accepted, rejected
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now)

class RampApplication(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    location = db.Column(db.String(200), nullable=False)
    photo_path = db.Column(db.String(300))
    step_height = db.Column(db.String(50), nullable=False)
    ownership = db.Column(db.String(20), nullable=False)
    agree_removal = db.Column(db.Boolean, default=False)
    agree_damage = db.Column(db.Boolean, default=False)
    signed_at = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.now)


class RampVolunteer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.now)


class SiteSetting(db.Model):
    __tablename__ = 'site_setting'
    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.Text)


class AiKnowledge(db.Model):
    __tablename__ = 'ai_knowledge'
    id = db.Column(db.Integer, primary_key=True)
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class VillageEvent(db.Model):
    __tablename__ = 'village_event'
    id = db.Column(db.Integer, primary_key=True)
    myeon = db.Column(db.String(20))
    ri = db.Column(db.String(20))
    title = db.Column(db.String(200), nullable=False)
    event_type = db.Column(db.String(20), default='meeting')  # meeting, activity
    meeting_category = db.Column(db.String(20), default='gathering')  # gathering(간담회), conference(컨퍼런스)
    meeting_mode = db.Column(db.String(20), default='')  # online(온라인), offline(오프라인), hybrid(온오프라인) — 간담회용
    description = db.Column(db.Text)
    location = db.Column(db.String(200))
    video_url = db.Column(db.String(500))
    event_date = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='upcoming')  # upcoming, ongoing, completed, afterparty
    chat_close_date = db.Column(db.DateTime)  # 채팅방 종료 예정일 (답변 완료 후 +10일)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class VillageEventAttendee(db.Model):
    __tablename__ = 'village_event_attendee'
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('village_event.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    email = db.Column(db.String(100))
    name = db.Column(db.String(50))
    consented = db.Column(db.Boolean, default=False)
    mobile_helper = db.Column(db.String(10))  # 지원(도우미 자원) / 필요(도우미 요청) / None
    role = db.Column(db.String(50))
    status = db.Column(db.String(20), default='pending')  # pending, confirmed, attended, absent
    last_ping = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)

class VillageEventChat(db.Model):
    __tablename__ = 'village_event_chat'
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('village_event.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    author = db.Column(db.String(50))
    message = db.Column(db.Text, nullable=False)
    msg_type = db.Column(db.String(10), default='')  # question(질문), opinion(의견), ''(일반)
    like_count = db.Column(db.Integer, default=0)    # 동의(좋아요)
    dislike_count = db.Column(db.Integer, default=0) # 별로예요
    answer = db.Column(db.Text)                      # 발표자/마을지기 답변
    answered_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    answered_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.now)

class VillageEventChatVote(db.Model):
    __tablename__ = 'village_event_chat_vote'
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('village_event_chat.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    vote = db.Column(db.String(10), nullable=False)  # like / dislike
    created_at = db.Column(db.DateTime, default=datetime.now)

class VillageEventFile(db.Model):
    __tablename__ = 'village_event_file'
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('village_event.id'), nullable=False)
    uploader_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    uploader_name = db.Column(db.String(50))
    filename = db.Column(db.String(255), nullable=False)  # 표시용 원본 파일명
    file_path = db.Column(db.String(500), nullable=False) # 저장된 URL 경로
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.now)

class VillagePage(db.Model):
    __tablename__ = 'village_page'
    id = db.Column(db.Integer, primary_key=True)
    myeon = db.Column(db.String(20), nullable=False)
    ri = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(200))
    content = db.Column(db.Text)
    visibility = db.Column(db.String(20), default='members')  # off, members, public
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
class VillageWish(db.Model):
    __tablename__ = 'village_wish'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    content = db.Column(db.Text, nullable=False)
    village_ri = db.Column(db.String(30))
    status = db.Column(db.String(20), default='pending')
    reply = db.Column(db.Text)
    replied_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class VillageBroadcast(db.Model):
    __tablename__ = 'village_broadcast'
    id = db.Column(db.Integer, primary_key=True)
    myeon = db.Column(db.String(50), nullable=False)
    ri = db.Column(db.String(50), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    subject = db.Column(db.String(200), default='')
    content = db.Column(db.Text, nullable=False)
    attachment = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.now)

class VillagePlaceCategory(db.Model):
    """마을지기 홍보 지도 자유 카테고리"""
    __tablename__ = 'village_place_category'
    id = db.Column(db.Integer, primary_key=True)
    myeon = db.Column(db.String(20))
    ri = db.Column(db.String(20))
    name = db.Column(db.String(100), nullable=False)
    icon = db.Column(db.String(10), default='📍')  # 이모지
    color = db.Column(db.String(20), default='#6c757d')
    sort_order = db.Column(db.Integer, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)


class VillagePlace(db.Model):
    """마을지기 홍보 지도 장소/건물 (회원 제안 → 마을지기 승인)"""
    __tablename__ = 'village_place'
    id = db.Column(db.Integer, primary_key=True)
    myeon = db.Column(db.String(20))
    ri = db.Column(db.String(20))
    category_id = db.Column(db.Integer, db.ForeignKey('village_place_category.id'), nullable=True)
    name = db.Column(db.String(200), nullable=False)
    address = db.Column(db.String(300))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    description = db.Column(db.Text)   # 소개
    story = db.Column(db.Text)         # 이야기/역사
    open_hr = db.Column(db.String(100))
    tel = db.Column(db.String(30))
    website = db.Column(db.String(300))
    media = db.Column(db.Text, default='[]')  # JSON: [{"type":"image|video","url":"..."}]
    tags = db.Column(db.String(300), default='')
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected, closed
    submitted_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    approved_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    category = db.relationship('VillagePlaceCategory', foreign_keys=[category_id])


class VillagePlaceReport(db.Model):
    """마을지도 장소 방문/정보 보고 (기존 FacilityReport와 분리)"""
    __tablename__ = 'village_place_report'
    id = db.Column(db.Integer, primary_key=True)
    place_id = db.Column(db.Integer, db.ForeignKey('village_place.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    report_type = db.Column(db.String(20), nullable=False)  # confirm, fix, flag, memo
    comment = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.now)

    place = db.relationship('VillagePlace', backref='reports')
    user = db.relationship('User', backref='village_place_reports')


class ContentPermission(db.Model):
    __tablename__ = 'content_permission'
    id = db.Column(db.Integer, primary_key=True)
    share_id = db.Column(db.Integer, db.ForeignKey('share_report.id'), nullable=True)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')
    message = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.now)
    responded_at = db.Column(db.DateTime)

class BlockedEmail(db.Model):
    __tablename__ = 'blocked_email'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), nullable=False, unique=True)
    reason = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.now)

class TempEmailVerify(db.Model):
    __tablename__ = 'temp_email_verify'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), nullable=False)
    token = db.Column(db.String(100), nullable=False, unique=True)
    redirect = db.Column(db.String(200), default='/legal/list')
    is_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class GpsCalibration(db.Model):
    """GPS 보정 데이터: 마을(리) 단위로 누적 보정값 저장"""
    __tablename__ = 'gps_calibration'
    id = db.Column(db.Integer, primary_key=True)
    town = db.Column(db.String(50), nullable=False)
    village = db.Column(db.String(50), nullable=False)
    offset_lat = db.Column(db.Float, default=0)     # 위도 보정값 (누적 평균)
    offset_lon = db.Column(db.Float, default=0)     # 경도 보정값 (누적 평균)
    sample_count = db.Column(db.Integer, default=0) # 보정 횟수
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class SharedRoute(db.Model):
    __tablename__ = 'shared_route'
    id = db.Column(db.Integer, primary_key=True)
    from_name = db.Column(db.String(200), nullable=False)
    to_name = db.Column(db.String(200), nullable=False)
    from_lat = db.Column(db.Float)
    from_lng = db.Column(db.Float)
    to_lat = db.Column(db.Float)
    to_lng = db.Column(db.Float)
    steps = db.Column(db.Text)
    total_min = db.Column(db.Integer)
    distance_km = db.Column(db.Float)
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    source_schedule_id = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)


class ScheduleReminderLog(db.Model):
    __tablename__ = 'schedule_reminder_log'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    schedule_id = db.Column(db.Integer, db.ForeignKey('tong_bot_schedule.id'))
    memo_id = db.Column(db.Integer, nullable=True)
    kind = db.Column(db.String(10), default='schedule')  # schedule | memo
    occ_date = db.Column(db.String(20))
    title = db.Column(db.String(200))
    event_date = db.Column(db.DateTime)
    sent_at = db.Column(db.DateTime, default=datetime.now)
    seen = db.Column(db.Boolean, default=False)


class MessageReminderLog(db.Model):
    __tablename__ = 'message_reminder_log'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    message_id = db.Column(db.Integer, db.ForeignKey('message.id'))
    sender_name = db.Column(db.String(50))
    subject = db.Column(db.String(200))
    sent_at = db.Column(db.DateTime, default=datetime.now)
    seen = db.Column(db.Boolean, default=False)


class PushSubscription(db.Model):
    __tablename__ = 'push_subscription'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    endpoint = db.Column(db.Text, nullable=False)
    p256dh = db.Column(db.Text, nullable=False)
    auth = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)


# ═══════════════════ EPUB (위치기반 콘텐츠 에디터) ═══════════════════

class EpubBook(db.Model):
    __tablename__ = "epub_book"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    title = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text, default="")
    layout_type = db.Column(db.String(30), default="newsletter")  # newsletter/guidebook/journal
    template_id = db.Column(db.Integer, db.ForeignKey("epub_template.id"), nullable=True)
    town = db.Column(db.String(50), default="")
    village = db.Column(db.String(50), default="")
    cover_image = db.Column(db.String(500), default="")
    status = db.Column(db.String(20), default="draft")  # draft/published
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
    pages = db.relationship("EpubPage", backref="book", lazy="dynamic", cascade="all, delete-orphan")


class EpubPage(db.Model):
    __tablename__ = "epub_page"
    id = db.Column(db.Integer, primary_key=True)
    book_id = db.Column(db.Integer, db.ForeignKey("epub_book.id"), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    title = db.Column(db.String(200), default="")
    content = db.Column(db.Text, default="")
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    media = db.relationship("EpubMedia", backref="page", lazy="dynamic", cascade="all, delete-orphan")


class EpubMedia(db.Model):
    __tablename__ = "epub_media"
    id = db.Column(db.Integer, primary_key=True)
    page_id = db.Column(db.Integer, db.ForeignKey("epub_page.id"), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    media_type = db.Column(db.String(20), default="image")  # image/video
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    caption = db.Column(db.String(500), default="")
    alt_text = db.Column(db.String(300), default="")
    order_index = db.Column(db.Integer, default=0)
    editor_state = db.Column(db.Text, nullable=True)  # JSON
    created_at = db.Column(db.DateTime, default=datetime.now)


class EpubTemplate(db.Model):
    __tablename__ = "epub_template"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default="")
    layout_type = db.Column(db.String(30), default="newsletter")
    sections = db.Column(db.Text, default="[]")  # JSON array
    style_guide = db.Column(db.Text, default="{}")  # JSON object
    is_default = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)


class GuideSection(db.Model):
    __tablename__ = "guide_section"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, default="")
    icon = db.Column(db.String(50), default="")
    order_index = db.Column(db.Integer, default=0)
    parent_id = db.Column(db.Integer, db.ForeignKey("guide_section.id"), nullable=True)
    layout_type = db.Column(db.String(30), default="card")
    style_json = db.Column(db.Text, default="{}")
    language = db.Column(db.String(10), default="ko")
    status = db.Column(db.String(20), default="published")
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
    children = db.relationship("GuideSection", backref=db.backref("parent", remote_side=[id]),
                               foreign_keys=[parent_id], order_by="GuideSection.order_index")

    def to_dict(self):
        return {
            "id": self.id, "title": self.title, "content": self.content,
            "icon": self.icon, "order_index": self.order_index, "parent_id": self.parent_id,
            "layout_type": self.layout_type, "style_json": __import__('json').loads(self.style_json or "{}"),
            "language": self.language, "status": self.status,
            "children": [c.to_dict() for c in self.children],
        }


class GuideTemplate(db.Model):
    __tablename__ = "guide_template"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default="")
    html_content = db.Column(db.Text, default="")
    source_type = db.Column(db.String(30), default="manual")
    source_id = db.Column(db.Integer, nullable=True)
    layout_type = db.Column(db.String(30), default="card")
    style_guide = db.Column(db.Text, default="{}")
    preview_image = db.Column(db.String(500), default="")
    is_active = db.Column(db.Boolean, default=True)
    is_featured = db.Column(db.Boolean, default=False)
    use_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "html_content": self.html_content, "source_type": self.source_type,
            "source_id": self.source_id, "layout_type": self.layout_type,
            "style_guide": __import__('json').loads(self.style_guide or "{}"),
            "preview_image": self.preview_image,
            "is_active": self.is_active, "is_featured": self.is_featured,
            "use_count": self.use_count,
            "created_at": self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else None,
        }

class DIDDocument(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    did = db.Column(db.String(200), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    public_key_jwk = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class VerifiableCredential(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    vc_id = db.Column(db.String(200), unique=True, nullable=False)
    issuer_did = db.Column(db.String(200), nullable=False)
    subject_did = db.Column(db.String(200), nullable=False)
    subject_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    type = db.Column(db.String(100), default='ResidentCredential')
    vc_json = db.Column(db.Text, nullable=False)
    issued_at = db.Column(db.DateTime, default=datetime.now)
    revoked = db.Column(db.Boolean, default=False)

class QRSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(64), unique=True, nullable=False)
    issuer_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    subject_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    purpose = db.Column(db.String(50), default='issue_vc')
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.now)
    expires_at = db.Column(db.DateTime, nullable=False)


class FacilityReport(db.Model):
    """화장실 사용 보고 (가능/불가/메모)"""
    __tablename__ = 'facility_report'
    id = db.Column(db.Integer, primary_key=True)
    facility_id = db.Column(db.Integer, db.ForeignKey('public_facility.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    report_type = db.Column(db.String(20), nullable=False)  # verify, reject, memo
    comment = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.now)

    facility = db.relationship('PublicFacility', backref='reports')
    user = db.relationship('User', backref='facility_reports')
