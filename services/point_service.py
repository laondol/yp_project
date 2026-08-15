from datetime import datetime
from flask import current_app
from models import db, PointHistory


def add_points(user_id, amount, reason, description='', ref_id=None):
    try:
        ph = PointHistory(
            user_id=user_id,
            change_type=reason,
            amount=amount,
            description=description or '',
            related_id=ref_id,
            created_at=datetime.now(),
        )
        db.session.add(ph)
        from models import User
        user = User.query.get(user_id)
        if user:
            user.points = (user.points or 0) + amount
    except Exception as e:
        current_app.logger.error(f'add_points failed (user={user_id}, amount={amount}, reason={reason}): {e}')
