import os
import time
import threading
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from flask import Flask
from flask_migrate import Migrate
from config import Config
from models import db, User, PointHistory, Post, Message, Friend, TongBotSchedule, LegalPost, PsychoPost
from werkzeug.security import generate_password_hash

import sys
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)


def create_scheduler_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    Migrate(app, db)
    return app


def run_cache_scheduler(app):
    time.sleep(10)
    while True:
        try:
            with app.app_context():
                from services.cache_refresh import refresh_all_caches
                refresh_all_caches()
        except Exception as e:
            print(f"[CACHE] error: {e}")
        time.sleep(600)


def run_notification_scheduler(app):
    time.sleep(5)
    while True:
        try:
            with app.app_context():
                from tongbot_routes import run_notification_check
                run_notification_check()
        except Exception as e:
            print(f'[NOTI] error: {e}')
        time.sleep(30)


def run_route_recalc_scheduler(app):
    time.sleep(60)
    while True:
        try:
            with app.app_context():
                for u in User.query.all():
                    try:
                        from services.route_recalc import recalc_user_routes
                        recalc_user_routes(u.id)
                    except Exception as e:
                        print(f'[ROUTE] user {u.id} recalc error: {e}')
        except Exception as e:
            print(f'[ROUTE] scheduler error: {e}')
        time.sleep(600)


def run_rag_rebuild(app):
    try:
        with app.app_context():
            from services.rag import rebuild_index
            rebuild_index(app)
    except Exception as e:
        print(f"[RAG] rebuild error: {e}")


def run_construction_extract_scheduler(app):
    """매일 새벽 5시에 최근 기사에서 공사현안을 AI로 추출하여 위치기반안내에 등록"""
    time.sleep(120)  # 기동 직후 1회 선실행 (배포 즉시 반영)
    while True:
        try:
            with app.app_context():
                from services.news_construction import process_recent_articles
                process_recent_articles(app, days=3)
        except Exception as e:
            print(f"[CONSTRUCTION_EXTRACT] 오류: {e}")
        try:
            now = datetime.now()
            target = now.replace(hour=5, minute=0, second=0, microsecond=0)
            if now >= target:
                from datetime import timedelta
                target += timedelta(days=1)
            wait_sec = (target - now).total_seconds()
            print(f"[CONSTRUCTION_EXTRACT] 다음 실행까지 {wait_sec/3600:.1f}시간 대기")
            time.sleep(wait_sec)
        except Exception as e:
            print(f"[CONSTRUCTION_EXTRACT] 대기 오류: {e}")
            time.sleep(3600)


def run_yard_collect_scheduler(app):
    """마당 소식 자동 수집 (네이버 블로그/카페 양평 단체 공지) - 기동 2분 후 1회, 이후 매일 08:00"""
    time.sleep(120)
    while True:
        try:
            with app.app_context():
                from services.yard_collector import collect_yard_notices
                n = collect_yard_notices()
                print(f"[YARD_COLLECT] 마당 소식 수집: {n}건")
        except Exception as e:
            print(f"[YARD_COLLECT] 오류: {e}")
        try:
            now = datetime.now()
            target = now.replace(hour=8, minute=0, second=0, microsecond=0)
            if now >= target:
                from datetime import timedelta
                target += timedelta(days=1)
            wait_sec = (target - now).total_seconds()
            print(f"[YARD_COLLECT] 다음 수집까지 {wait_sec/3600:.1f}시간 대기")
            time.sleep(wait_sec)
        except Exception:
            time.sleep(3600)


def run_monthly_payout(app):
    time.sleep(30)
    while True:
        try:
            with app.app_context():
                from models import User
                from services.point_service import add_points
                now = datetime.now(timezone.utc)
                granted = 0
                for u in User.query.all():
                    base = u.last_payout or u.created_at
                    if base:
                        if base.tzinfo is None:
                            base = base.replace(tzinfo=timezone.utc)
                        if (now - base).days >= 30:
                            add_points(u.id, 1000, 'monthly', '30일 주기 물맑은머니 지급')
                            if 'village' in (u.managed_pages or ''):
                                add_points(u.id, 10000, 'village_monthly', '마을지기 활동지원금')
                            u.last_payout = now
                            granted += 1
                if granted:
                    db.session.commit()
                    print(f'[PAYOUT] monthly points granted to {granted} user(s)')
        except Exception as e:
            print(f'[PAYOUT] error: {e}')
        time.sleep(86400)


def run_startup_tasks(app):
    for attempt in range(10):
        try:
            with app.app_context():
                db.create_all()
            break
        except Exception as e:
            print(f"[STARTUP] DB 연결 실패 (시도 {attempt+1}/10): {e}")
            time.sleep(10)
    else:
        print("[STARTUP] DB 연결 10회 실패 - startup tasks 건너뜀")

    # Friend 요청 불일치 보정
    try:
        with app.app_context():
            orphan_msgs = Message.query.filter(
                Message.subject.in_(['👋 벗 맺기 신청', '👋 벗 신청'])
            ).all()
            for m in orphan_msgs:
                existing = Friend.query.filter(
                    ((Friend.requester_id == m.sender_id) & (Friend.receiver_id == m.receiver_id)) |
                    ((Friend.requester_id == m.receiver_id) & (Friend.receiver_id == m.sender_id))
                ).first()
                if not existing:
                    f = Friend(requester_id=m.sender_id, receiver_id=m.receiver_id, status='pending')
                    db.session.add(f)
            if orphan_msgs:
                db.session.commit()
                print(f'[OK] {len(orphan_msgs)} orphaned friend request(s) fixed')
    except Exception as e:
        print(f'[SKIP] orphan friend fix: {e}')

    # PointHistory balance_after 일괄 보정
    try:
        with app.app_context():
            from sqlalchemy import inspect as sa_inspect
            inspector = sa_inspect(db.engine)
            if 'point_history' in [t for t in inspector.get_table_names()]:
                all_users = User.query.all()
                for u in all_users:
                    records = PointHistory.query.filter_by(user_id=u.id).order_by(PointHistory.created_at.asc()).all()
                    running = 0
                    for r in records:
                        running += r.amount
                        r.balance_after = running
                db.session.commit()
                print('[OK] point_history balance_after recalculated for all users')
    except Exception as e:
        print(f'[SKIP] point_history recalculation: {e}')

    # 낙제 게시물 만료 삭제
    try:
        with app.app_context():
            expired = Post.query.filter(Post.total_score <= -50, Post.deadline != None, Post.deadline < datetime.now()).all()
            for p in expired:
                db.session.delete(p)
            if expired:
                db.session.commit()
                print(f'[OK] {len(expired)} expired post(s) deleted')
    except Exception as e:
        print(f'[SKIP] expired post cleanup: {e}')

    # 상담 보류글 1일 자동 삭제
    try:
        with app.app_context():
            from sqlalchemy import or_
            cutoff = datetime.now() - timedelta(days=1)
            flagged_legal = LegalPost.query.filter(
                LegalPost.status == 'flagged',
                LegalPost.created_at < cutoff,
                or_(LegalPost.flagged_decision_at == None, LegalPost.flagged_decision_at < cutoff)
            ).all()
            for p in flagged_legal:
                db.session.delete(p)
            flagged_psycho = PsychoPost.query.filter(
                PsychoPost.status == 'flagged',
                PsychoPost.created_at < cutoff
            ).all()
            for p in flagged_psycho:
                db.session.delete(p)
            if flagged_legal or flagged_psycho:
                db.session.commit()
                print(f'[OK] {len(flagged_legal)+len(flagged_psycho)} flagged consultation post(s) auto-deleted')
    except Exception as e:
        print(f'[SKIP] flagged post cleanup: {e}')


def run_labor_news_scheduler(app):
    """매일 오전 6시에 10개 노동 뉴스 소스 자동 수집 (오전 10시까지 결과 준비)"""
    def _wait_until_4am():
        now = datetime.now()
        target = now.replace(hour=4, minute=0, second=0, microsecond=0)
        if now >= target:
            from datetime import timedelta
            target += timedelta(days=1)
        wait_sec = (target - now).total_seconds()
        print(f"[LABOR_NEWS_SCHEDULER] 다음 수집까지 {wait_sec/3600:.1f}시간 대기")
        time.sleep(wait_sec)

    _wait_until_4am()
    while True:
        try:
            with app.app_context():
                from services.labor_news_collector import collect_labor_news
                count, mode = collect_labor_news()
                print(f"[LABOR_NEWS_SCHEDULER] 수집 완료: {count}건 (경로: {mode})")
        except Exception as e:
            print(f"[LABOR_NEWS_SCHEDULER] 오류: {e}")
        time.sleep(86400)


def run_kr_yp_news_scheduler(app):
    """매일 새벽 2시에 10개 주요 언론사 대한민국·양평 뉴스 자동 수집"""
    def _wait_until_2am():
        now = datetime.now()
        target = now.replace(hour=2, minute=0, second=0, microsecond=0)
        if now >= target:
            from datetime import timedelta
            target += timedelta(days=1)
        wait_sec = (target - now).total_seconds()
        print(f"[KR_YP_NEWS_SCHEDULER] 다음 수집까지 {wait_sec/3600:.1f}시간 대기")
        time.sleep(wait_sec)

    _wait_until_2am()
    while True:
        try:
            with app.app_context():
                from services.labor_news_collector import collect_kr_yp_news
                count, mode = collect_kr_yp_news()
                print(f"[KR_YP_NEWS_SCHEDULER] 자동 수집 완료: {count}건 (경로: {mode})")
        except Exception as e:
            print(f"[KR_YP_NEWS_SCHEDULER] 수집 오류: {e}")
        time.sleep(86400)


def run_world_news_scheduler(app):
    """매일 오후 1시에 10개 세계 언론사 글로벌 뉴스 자동 수집 (오후 8시까지, 9시 정리)"""
    def _wait_until_1pm():
        now = datetime.now()
        target = now.replace(hour=13, minute=0, second=0, microsecond=0)
        if now >= target:
            from datetime import timedelta
            target += timedelta(days=1)
        wait_sec = (target - now).total_seconds()
        print(f"[WORLD_NEWS_SCHEDULER] 다음 수집까지 {wait_sec/3600:.1f}시간 대기")
        time.sleep(wait_sec)

    _wait_until_1pm()
    while True:
        try:
            with app.app_context():
                from services.labor_news_collector import collect_world_news
                count = collect_world_news()
                print(f"[WORLD_NEWS_SCHEDULER] 자동 수집 완료: {count}건")
        except Exception as e:
            print(f"[WORLD_NEWS_SCHEDULER] 수집 오류: {e}")
        time.sleep(86400)


def main():
    print("[SCHEDULER] Starting background scheduler...")
    app = create_scheduler_app()

    try:
        with app.app_context():
            run_startup_tasks(app)
    except Exception as e:
        print(f"[SCHEDULER] startup tasks failed: {e}")

    threading.Thread(target=run_cache_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_notification_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_route_recalc_scheduler, args=(app,), daemon=True).start()
    # RAG 재구축은 yp_rag 서버 시작 시 자체 수행하므로 중복 제거 (타임아웃 오류 해결)
    # threading.Thread(target=run_rag_rebuild, args=(app,), daemon=True).start()
    threading.Thread(target=run_monthly_payout, args=(app,), daemon=True).start()
    threading.Thread(target=run_construction_extract_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_yard_collect_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_labor_news_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_kr_yp_news_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_world_news_scheduler, args=(app,), daemon=True).start()

    print("[SCHEDULER] All schedulers started. Keeping alive...")
    while True:
        time.sleep(60)


if __name__ == '__main__':
    main()
