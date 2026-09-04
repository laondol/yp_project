#!/usr/bin/env python
"""마당 기존 소식에 신청기간·연락처·예약링크를 AI로 백필 (일회성, 재실행 안전)"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run import create_app
from models import YardPost, db
from services.news_service import _motif_text
from services.yard_collector import _parse_dt


def extract_fields(p):
    """AI로 소식에서 신청기간·연락처·예약링크 추출"""
    result = _motif_text(
        "당신은 양평 지역 소식 편집자입니다. 소식에서 신청 정보를 정확히 추출합니다. JSON으로만 답합니다. 없는 정보는 절대 만들지 마세요.",
        f"""다음 소식에서 신청기간·연락처·예약/신청 링크를 찾아 JSON으로 출력하세요.
내용에 실제로 있는 정보만 출력하고, 없는 항목은 반드시 빈 문자열로 두세요. 추측하지 마세요.
{{"apply_start": "신청기간 시작 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM", "apply_end": "신청기간 종료 (같은 형식)", "contact": "전화번호 등 연락처", "reserve_url": "예약/신청 페이지의 http 링크"}}

제목: {p.title[:150]}
내용: {(p.content or '')[:600]}""",
        format_json=True,
    )
    return result if isinstance(result, dict) else {}


def main():
    app = create_app()
    with app.app_context():
        posts = YardPost.query.filter(
            YardPost.apply_start.is_(None),
        ).order_by(YardPost.id.asc()).all()
        total = len(posts)
        print(f'대상: {total}건 (신청기간 비어있는 소식)')

        filled = 0
        for i, p in enumerate(posts):
            try:
                r = extract_fields(p)
                updated = []
                if not p.apply_start and r.get('apply_start'):
                    dt = _parse_dt(str(r['apply_start'])[:16])
                    if dt:
                        p.apply_start = dt
                        updated.append('신청시작')
                if not p.apply_end and r.get('apply_end'):
                    dt = _parse_dt(str(r['apply_end'])[:16])
                    if dt:
                        p.apply_end = dt
                        updated.append('신청종료')
                if not p.contact and r.get('contact'):
                    p.contact = str(r['contact'])[:100]
                    updated.append('연락처')
                if not p.reserve_url and r.get('reserve_url'):
                    u = str(r['reserve_url'])[:500]
                    if u.startswith('http') and 'naver.com' not in u:  # 자기 블로그 링크 제외
                        p.reserve_url = u
                        updated.append('예약링크')
                if updated:
                    db.session.commit()
                    filled += 1
                    print(f'[{i+1}/{total}] #{p.id} {", ".join(updated)} 채움: {p.title[:35]}')
            except Exception as e:
                print(f'[{i+1}/{total}] #{p.id} 오류: {str(e)[:60]}')

        print(f'완료: {filled}/{total}건에 정보 채움')


if __name__ == '__main__':
    main()
