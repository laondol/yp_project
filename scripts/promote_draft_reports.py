"""자동보관(draft) 공유글을 심사 대기(pending)로 승격한다. 기본은 dry-run.

사용:
  docker exec yp_flask python3 scripts/promote_draft_reports.py          # 확인만
  docker exec yp_flask python3 scripts/promote_draft_reports.py --apply  # 실제 반영
"""
import sys
sys.path.insert(0, '/yp_project')

from datetime import datetime, timezone

from run import app
from models import db, ShareReport
from route_modules.share_bp import _move_report_files


def main():
    apply = '--apply' in sys.argv
    with app.app_context():
        drafts = ShareReport.query.filter_by(status='draft').order_by(ShareReport.id.asc()).all()
        print(f'draft {len(drafts)}건')
        for r in drafts:
            print(f'  #{r.id} user_id={r.user_id} auto_sent={r.auto_sent} '
                  f'title={r.title!r} image={r.image_path}')
            if not apply:
                continue
            _move_report_files(r, 'review')
            r.status = 'pending'
            r.auto_sent = False
            r.moderation_result = 'pending'
            r.moderation_reason = 'AI 검증 대기중'
            r.is_moderated = False
            r.updated_at = datetime.now(timezone.utc)
        if apply and drafts:
            db.session.commit()
            print('승격 완료. moderation_worker가 review/ 폴더를 2초 내 스캔합니다.')
        elif not apply:
            print('dry-run: 실제 변경하려면 --apply')


if __name__ == '__main__':
    main()
