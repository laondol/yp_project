#!/usr/bin/env python
"""마당 소식 내보내기 (WSL에서 실행) → yard_posts_export.json 생성"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run import create_app
from models import YardPost, YardSchedule


def main():
    app = create_app()
    with app.app_context():
        posts = YardPost.query.filter_by(is_active=True).order_by(YardPost.id.asc()).all()
        out = []
        for p in posts:
            out.append({
                'title': p.title, 'content': p.content or '',
                'source_type': p.source_type or 'manual', 'platform': p.platform or '',
                'source_url': p.source_url or '', 'reserve_url': p.reserve_url or '',
                'contact': p.contact or '', 'author_name': p.author_name or '',
                'like_count': p.like_count or 0, 'dislike_count': p.dislike_count or 0,
                'event_date': p.event_date.isoformat() if p.event_date else '',
                'event_end': p.event_end.isoformat() if p.event_end else '',
                'is_allday': bool(p.is_allday),
                'event_place': p.event_place or '',
                'apply_start': p.apply_start.isoformat() if p.apply_start else '',
                'apply_end': p.apply_end.isoformat() if p.apply_end else '',
                'is_approved': bool(p.is_approved),
                'extra_schedules': [
                    {'event_start': s.event_start.isoformat() if s.event_start else '',
                     'event_end': s.event_end.isoformat() if s.event_end else '',
                     'is_allday': bool(s.is_allday)}
                    for s in YardSchedule.query.filter_by(post_id=p.id).order_by(YardSchedule.event_start.asc()).all()
                ],
            })
        out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'yard_posts_export.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f'내보내기 완료: {len(out)}건 → {out_path}')


if __name__ == '__main__':
    main()
