import os
import time
import threading
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from flask import Flask
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


def run_startup_tasks(app):
    with app.app_context():
        db.create_all()

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
            expired = Post.query.filter(Post.total_score <= -50, Post.deadline != None, Post.deadline < datetime.now(timezone.utc)).all()
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
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)
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


def main():
    print("[SCHEDULER] Starting background scheduler...")
    app = create_scheduler_app()

    with app.app_context():
        run_startup_tasks(app)

    threading.Thread(target=run_cache_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_notification_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_route_recalc_scheduler, args=(app,), daemon=True).start()
    threading.Thread(target=run_rag_rebuild, args=(app,), daemon=True).start()

    print("[SCHEDULER] All schedulers started. Keeping alive...")
    while True:
        time.sleep(60)


if __name__ == '__main__':
    main()
