import os
from dotenv import load_dotenv

# Docker 컨테이너에서도 .env를 찾을 수 있도록 명시적 경로 지정
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(_env_path):
    load_dotenv(_env_path)
else:
    from dotenv import find_dotenv
    load_dotenv(find_dotenv())

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'fallback_dev_key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql://yp_dev:yp_dev_pass_2026@postgres:5432/yp_local')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true'
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
    MAX_CONTENT_LENGTH = None  # 일반 파일 첨부 요청: 당분간 용량 제한 없음 (None=무제한, 0은 오히려 0바이트로 실패)
    JUSO_API_KEY = os.getenv('JUSO_API_KEY', '')
    DATA_GO_KR_API_KEY = os.getenv('DATA_GO_KR_API_KEY', '')
    GG_TRAFFIC_API_KEY = os.getenv('GG_TRAFFIC_API_KEY', '')
    GG_BUILDING_API_KEY = os.getenv('GG_BUILDING_API_KEY', '')
    ARCH_HUB_API_KEY = os.getenv('ARCH_HUB_API_KEY', '')
    SAFEMAP_API_KEY = os.getenv('SAFEMAP_API_KEY', '')
    GG_PUBLTOLT_API_KEY = os.getenv('GG_PUBLTOLT_API_KEY', '')
    EX_CONSTRUCTION_API_KEY = os.getenv('EX_CONSTRUCTION_API_KEY', '')
    MOTIF_API_KEY = os.getenv('MOTIF_API_KEY', '')             # ← 추가
    MOTIF_BASE_URL = os.getenv('MOTIF_BASE_URL', 'https://chat.motiftech.io/openapi/v1')  # ← 추가
    OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '')

    # 외부 FTP 저장소 (일반 파일 첨부: /api/upload/file → FTP, 다운로드는 Flask가 중계)
    FTP_ENABLED = os.getenv('FTP_ENABLED', 'false').lower() == 'true'
    FTP_HOST = os.getenv('FTP_HOST', '')
    FTP_PORT = int(os.getenv('FTP_PORT', '21'))
    FTP_USER = os.getenv('FTP_USER', '')
    FTP_PASS = os.getenv('FTP_PASS', '')
    FTP_REMOTE_DIR = os.getenv('FTP_REMOTE_DIR', '/')
    FTP_USE_TLS = os.getenv('FTP_USE_TLS', 'false').lower() == 'true'

    # RAG 독립 서비스
    RAG_URL = os.getenv('RAG_URL', 'http://localhost:8001')
    RAG_API_KEY = os.getenv('RAG_API_KEY', '')
    SMTP_HOST = os.getenv('SMTP_HOST', 'email-smtp.ap-northeast-2.amazonaws.com')
    SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USERNAME = os.getenv('SMTP_USERNAME', '')
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
    MAIL_FROM = os.getenv('MAIL_FROM', 'yp@unocum.kr')
    SITE_URL = os.getenv('SITE_URL', 'https://unocum.kr')

    # OAuth2
    KAKAO_REST_API_KEY = os.getenv('KAKAO_REST_API_KEY', '')
    KAKAO_JAVASCRIPT_KEY = os.getenv('KAKAO_JAVASCRIPT_KEY', '')
    NAVER_CLIENT_ID = os.getenv('NAVER_CLIENT_ID', '')
    NAVER_CLIENT_SECRET = os.getenv('NAVER_CLIENT_SECRET', '')
    NAVER_MAP_CLIENT_ID = os.getenv('NAVER_SEARCH_CLIENT_ID', '')
    NAVER_SEARCH_CLIENT_ID = os.getenv('NAVER_SEARCH_CLIENT_ID', '')
    NAVER_SEARCH_CLIENT_SECRET = os.getenv('NAVER_SEARCH_CLIENT_SECRET', '')
    GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '')
    GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET', '')

    GOOGLE_OAUTH = {
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
    } if GOOGLE_CLIENT_ID else None

    KAKAO_OAUTH = {
        'client_id': KAKAO_REST_API_KEY,
    } if KAKAO_REST_API_KEY else None

    NAVER_OAUTH = {
        'client_id': NAVER_CLIENT_ID,
        'client_secret': NAVER_CLIENT_SECRET,
    } if NAVER_CLIENT_ID else None
    ODCLOUD_API_KEY = os.getenv('ODCLOUD_API_KEY', '')
