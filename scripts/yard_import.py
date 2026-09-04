#!/usr/bin/env python
"""마당 소식 가져오기 (양평서버에서 실행) ← yard_posts_export.json
사용: docker exec yp_flask python /yp_project/scripts/yard_import.py [json경로]
중복(같은 제목+출처)은 자동 스킵되므로 여러 번 실행해도 안전합니다."""
import sys, os, json
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run import create_app
from models import YardPost, YardSchedule, db


def _parse(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def main():
    json_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'yard_posts_export.json')
    if not os.path.exists(json_path):
        print(f'파일 없음: {json_path}')
        print('WSL에서 내보낸 yard_posts_export.json을 이 서버 ~/yp_project/ 로 복사해 주세요.')
        sys.exit(1)

    with open(json_path, encoding='utf-8') as f:
        posts = json.load(f)

    app = create_app()
    with app.app_context():
        created = skipped = 0
        for it in posts:
            title = (it.get('title') or '').strip()
            if not title:
                continue
            # 중복 차단: 같은 제목 + 같은 출처
            q = YardPost.query.filter_by(title=title)
            if it.get('source_url'):
                q = q.filter_by(source_url=it['source_url'])
            if q.first():
                skipped += 1
                continue

            p = YardPost(
                title=title[:300],
                content=it.get('content') or '',
                source_type=it.get('source_type') or 'manual',
                platform=it.get('platform') or '',
                source_url=(it.get('source_url') or '')[:500],
                reserve_url=(it.get('reserve_url') or '')[:500] or None,
                contact=(it.get('contact') or '')[:100] or None,
                author_name=(it.get('author_name') or '')[:100] or None,
                like_count=it.get('like_count') or 0,
                dislike_count=it.get('dislike_count') or 0,
                event_date=_parse(it.get('event_date')),
                event_end=_parse(it.get('event_end')),
                is_allday=bool(it.get('is_allday')),
                event_place=(it.get('event_place') or '')[:200] or None,
                apply_start=_parse(it.get('apply_start')),
                apply_end=_parse(it.get('apply_end')),
                is_approved=bool(it.get('is_approved')),  # WSL에서 승인된 상태 그대로
                is_active=True,
            )
            db.session.add(p)
            db.session.flush()  # p.id 확보
            for s in it.get('extra_schedules', []):
                ss = _parse(s.get('event_start'))
                if ss:
                    db.session.add(YardSchedule(
                        post_id=p.id,
                        event_start=ss,
                        event_end=_parse(s.get('event_end')),
                        is_allday=bool(s.get('is_allday')),
                    ))
            created += 1

        db.session.commit()
        print(f'가져오기 완료: 신규 {created}건, 중복 스킵 {skipped}건')


if __name__ == '__main__':
    main()
