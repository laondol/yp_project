import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
from flask import Flask, send_from_directory
from flask_migrate import Migrate
from config import Config
from models import db, User
from tongbot_routes import tongbot_bp
from route_modules.construction_bp import construction_bp
from route_modules.share_bp import share_bp
from route_modules.legal_bp import legal_bp
from route_modules.village_bp import village_bp
from route_modules.friends_bp import friends_bp
from route_modules.user_bp import user_bp
from route_modules.board_bp import board_bp
from route_modules.admin_bp import admin_bp
from route_modules.news_bp import news_bp

from route_modules.search_bp import search_bp
from route_modules.message_bp import message_bp
from route_modules.service_bp import service_bp
from route_modules.auth_bp import auth_bp
from route_modules.page_bp import page_bp
from route_modules.psycho_bp import psycho_bp
from route_modules.epub_bp import epub_bp
from route_modules.guide_bp import guide_bp
from route_modules.did_bp import did_bp
from werkzeug.security import generate_password_hash
import sys
import os
import time

# 한국 시간 (KST, UTC+9) 사용
os.environ['TZ'] = 'Asia/Seoul'
try:
    time.tzset()
except AttributeError:
    pass  # Windows는 tzset() 미지원
        
# 🎯 [경로 패치]: 이 파일(run.py)이 있는 폴더를 파이썬 탐색 경로 1순위로 강제 지정합니다.
# 이 코드가 있으면 이중 폴더 구조에서도 절대 에러가 나지 않습니다.
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # DB 초기화 (순환 참조 원천 해결)
    db.init_app(app)
    Migrate(app, db)

    # OAuth2 초기화 (Google/Kakao/Naver)
    from services.oauth import init_oauth
    init_oauth(app)
    
    # Jinja2 커스텀 필터 등록
    import json as _json
    app.jinja_env.filters['fromjson'] = lambda s: _json.loads(s) if s else []
    app.jinja_env.filters['comma'] = lambda v: f'{int(v or 0):,}'
    from markupsafe import Markup
    app.jinja_env.globals['nip'] = lambda: '닢'

    # 웹 경로 등록
    app.register_blueprint(tongbot_bp)
    app.register_blueprint(construction_bp)
    app.register_blueprint(share_bp)
    app.register_blueprint(legal_bp)
    app.register_blueprint(village_bp)
    app.register_blueprint(friends_bp)
    app.register_blueprint(user_bp)
    app.register_blueprint(board_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(news_bp)

    app.register_blueprint(search_bp)
    app.register_blueprint(message_bp)
    app.register_blueprint(service_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(page_bp)
    app.register_blueprint(psycho_bp)
    app.register_blueprint(epub_bp)
    app.register_blueprint(guide_bp)
    app.register_blueprint(did_bp)
    
    # gunicorn에서도 실행되도록 초기화 보장
    with app.app_context():
        db.create_all()
        # 신규 컬럼 자동 추가 (기존 DB 마이그레이션)
        from sqlalchemy import inspect as _sa_inspect, text as _sa_text
        try:
            _inspector = _sa_inspect(db.engine)
            _tbls = _inspector.get_table_names()
            if 'tong_bot_memo' in _tbls:
                _cols = [c['name'] for c in _inspector.get_columns('tong_bot_memo')]
                if 'end_date' not in _cols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text('ALTER TABLE tong_bot_memo ADD COLUMN end_date TIMESTAMP'))
                        _conn.commit()
            if 'tong_bot_schedule' in _tbls:
                _cols = [c['name'] for c in _inspector.get_columns('tong_bot_schedule')]
                if 'repeat_lastday' not in _cols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text('ALTER TABLE tong_bot_schedule ADD COLUMN repeat_lastday BOOLEAN DEFAULT FALSE'))
                        _conn.commit()
                if 'route_dirty' not in _cols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text('ALTER TABLE tong_bot_schedule ADD COLUMN route_dirty BOOLEAN DEFAULT FALSE'))
                        _conn.commit()
                    # 초기 마이그레이션(컬럼 최초 추가 시에만): 기존 모든 모일정에 dirty 표시 → 다음 스케줄러 주기에서 전체 재생성
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text(
                            "UPDATE tong_bot_schedule SET route_dirty = TRUE WHERE "
                            "location IS NOT NULL AND location != '' AND "
                            "(kind IS NULL OR kind IN ('base','occurrence')) AND "
                            "title NOT LIKE '%이동%' AND title NOT LIKE '%귀가%'"))
                        _conn.commit()
            # 블록 순서 필드 (인트로페이지)
            if 'user' in _tbls:
                _ucols = [c['name'] for c in _inspector.get_columns('user')]
                if 'block_order_profile' not in _ucols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text("ALTER TABLE \"user\" ADD COLUMN block_order_profile TEXT"))
                        _conn.commit()
                if 'block_order_intro' not in _ucols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text("ALTER TABLE \"user\" ADD COLUMN block_order_intro TEXT"))
                        _conn.commit()
                if 'intro_page_enabled' not in _ucols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text("ALTER TABLE \"user\" ADD COLUMN intro_page_enabled BOOLEAN DEFAULT FALSE"))
                        _conn.commit()
                if 'password_v2' not in _ucols:
                    with db.engine.connect() as _conn:
                        _conn.execute(_sa_text("ALTER TABLE \"user\" ADD COLUMN password_v2 BOOLEAN DEFAULT FALSE"))
                        _conn.commit()
            # 마을지기 홍보 지도 테이블 (신규: village_place_category / village_place / village_place_report)
            _place_ddl = [
                ("CREATE TABLE IF NOT EXISTS village_place_category ("
                 "id SERIAL PRIMARY KEY, myeon VARCHAR(20), ri VARCHAR(20), name VARCHAR(100) NOT NULL, "
                 "icon VARCHAR(10) DEFAULT '📍', color VARCHAR(20) DEFAULT '#6c757d', sort_order INTEGER DEFAULT 0, "
                 "created_by INTEGER, created_at TIMESTAMP)"),
                ("CREATE TABLE IF NOT EXISTS village_place ("
                 "id SERIAL PRIMARY KEY, myeon VARCHAR(20), ri VARCHAR(20), category_id INTEGER, name VARCHAR(200) NOT NULL, "
                 "address VARCHAR(300), latitude FLOAT, longitude FLOAT, description TEXT, story TEXT, "
                 "open_hr VARCHAR(100), tel VARCHAR(30), website VARCHAR(300), media TEXT DEFAULT '[]', "
                 "tags VARCHAR(300) DEFAULT '', status VARCHAR(20) DEFAULT 'pending', submitted_by INTEGER, "
                 "approved_by INTEGER, created_at TIMESTAMP, updated_at TIMESTAMP, "
                 "FOREIGN KEY(category_id) REFERENCES village_place_category(id))"),
                ("CREATE TABLE IF NOT EXISTS village_place_report ("
                 "id SERIAL PRIMARY KEY, place_id INTEGER NOT NULL, user_id INTEGER NOT NULL, "
                 "report_type VARCHAR(20) NOT NULL, comment TEXT, created_at TIMESTAMP, "
                 "FOREIGN KEY(place_id) REFERENCES village_place(id))"),
            ]
            for _ddl in _place_ddl:
                with db.engine.connect() as _conn:
                    _conn.execute(_sa_text(_ddl))
                    _conn.commit()
            print("[OK] 신규 컬럼 마이그레이션 완료")
        except Exception as e:
            print(f"[SKIP] 컬럼 마이그레이션: {e}")
        if not User.query.first():
            hashed_pw = generate_password_hash('pw1234')
            demo_users = [
                User(username='admin1', email='admin@unocum.kr', password=hashed_pw, role='admin', real_name="홍길동", phone="010-1111-2222", town="양평읍", village="양근리", is_verified_resident=True),
                User(username='leader1', email='eou@kakao.com', password=hashed_pw, role='leader', real_name="이순신", phone="010-3333-4444", town="강상면", village="병산리", is_verified_resident=True, managed_pages='legal,psycho,village,ramp'),
                User(username='user1', email='user@test.com', password=hashed_pw, role='user', real_name="강감찬", phone="010-5555-6666", town="용문면", village="다문리", is_verified_resident=False)
            ]
            for u in demo_users:
                db.session.add(u)
            db.session.commit()
            print("[OK] Demo accounts created (pw: pw1234)")

    return app

app = create_app()

@app.route('/robots.txt')
def robots_txt():
    return send_from_directory('static', 'robots.txt', mimetype='text/plain')

@app.route('/sitemap.xml')
def sitemap_xml():
    return send_from_directory('static', 'sitemap.xml', mimetype='application/xml')

@app.after_request
def security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['X-XSS-Protection'] = '1; mode=block'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if resp.mimetype == 'text/html':
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
    return resp

if __name__ == '__main__':
    print("[함께사는양평] 통합 관제 서버가 켜졌습니다. http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)