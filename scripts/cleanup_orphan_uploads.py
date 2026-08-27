"""
고아 업로드 파일 정리 스크립트 (WSL 로컬 전용 유지보수 도구)

과거에 회원/게시글 삭제 시 DB만 지우고 실제 파일은 남겨둔 경우,
디스크에만 존재하고 어떤 DB 레코드에서도 참조되지 않는 파일을 삭제합니다.

동작:
  1) DB 전체에서 파일 참조(파일컬럼 + 본문 속 /files/, /static/uploads/ URL)를 모아 '보존 집합' 생성
  2) UPLOAD_FOLDER 를 순회하면서 보존 집합에 없는 파일 = 고아 → 삭제

안전장치:
  - 삭제 대상은 UPLOAD_FOLDER 내부로만 제한
  - 기본 실행은 dry-run(실제 삭제 안 함). --delete 붙여야 진짜 삭제
  - 보존 집합에 없는 파일만 대상 (참조 누락 시 삭제되므로 dry-run 먼저 확인 권장)

실행:
  docker exec yp_flask python /yp_project/scripts/cleanup_orphan_uploads.py            # 미리보기
  docker exec yp_flask python /yp_project/scripts/cleanup_orphan_uploads.py --delete     # 실제 삭제
"""
import os
import re
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import current_app
from run import create_app
from models import (
    db, User, Post, NewsArticle, Message, ShareReport, LegalPost, PsychoPost,
    RampApplication, VillageBroadcast, VillagePlace, VillagePage, Note,
    EpubBook, EpubPage, EpubMedia,
)

URL_RE = re.compile(r'(?:https?://[^/\s"\'>]+)?(?:/files/|/static/uploads/)[^\s"\'>]+')


def resolve(p):
    if not p:
        return None
    p = p.strip()
    p = re.sub(r'^https?://[^/]+', '', p)  # 도메인 제거
    if p.startswith('/files/'):
        return os.path.join(current_app.config['UPLOAD_FOLDER'], 'general_files', os.path.basename(p))
    if p.startswith('/static/'):
        return os.path.join(current_app.root_path, p.lstrip('/'))
    return None


def collect_keep():
    keep = set()
    keep_basenames = set()

    def add(p):
        r = resolve(p)
        if r:
            ap = os.path.abspath(r)
            keep.add(ap)
            keep_basenames.add(os.path.basename(ap))

    def add_text(t):
        if not t:
            return
        for m in URL_RE.findall(t):
            add(m)

    def txt(obj, *attrs):
        for a in attrs:
            v = getattr(obj, a, None)
            if v:
                add_text(v)

    for u in User.query.all():
        add(getattr(u, 'bill_image_path', None))
        add(getattr(u, 'photo_path', None))
    for p in Post.query.all():
        add(p.file_path)
        txt(p, 'content')
    for a in NewsArticle.query.all():
        add(a.image_path)
        txt(a, 'content')
    for m in Message.query.all():
        add(m.attachment)
        txt(m, 'content')
    for s in ShareReport.query.all():
        add(s.image_path)
        add(s.drawing_path)
        add(s.video_path)
        txt(s, 'extra_images', 'description')
    for lp in LegalPost.query.all():
        add(lp.file_path)
        txt(lp, 'content', 'answer')
    for pp in PsychoPost.query.all():
        add(pp.file_path)
        txt(pp, 'content', 'answer')
    for r in RampApplication.query.all():
        add(getattr(r, 'photo_path', None))
    for vb in VillageBroadcast.query.all():
        add(vb.attachment)
        txt(vb, 'content')
    for vp in VillagePlace.query.all():
        txt(vp, 'media', 'content')
    for vpg in VillagePage.query.all():
        txt(vpg, 'content')
    for n in Note.query.all():
        txt(n, 'content')
    for book in EpubBook.query.all():
        for page in EpubPage.query.filter_by(book_id=book.id).all():
            txt(page, 'content')
            for media in EpubMedia.query.filter_by(page_id=page.id).all():
                add(media.file_path)
    return keep, keep_basenames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--delete', action='store_true', help='실제 삭제(미지정 시 dry-run)')
    args = ap.parse_args()

    app = create_app()
    with app.app_context():
        keep, keep_basenames = collect_keep()
        base = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
        if not os.path.isdir(base):
            print('UPLOAD_FOLDER 없음:', base)
            return

        orphan = []
        kept_on_disk = 0
        for root, _dirs, files in os.walk(base):
            for f in files:
                fp = os.path.abspath(os.path.join(root, f))
                if fp in keep or os.path.basename(fp) in keep_basenames:
                    kept_on_disk += 1
                else:
                    orphan.append(fp)

        print(f'[정보] 보존 참조 수={len(keep)} 디스크 파일 중 보존={kept_on_disk} 고아={len(orphan)}')
        print(f'[모드] {"실제삭제" if args.delete else "DRY-RUN(삭제 안 함)"}')

        deleted = 0
        for fp in orphan:
            if args.delete:
                try:
                    os.remove(fp)
                    deleted += 1
                except Exception as e:
                    print('  ERR', fp, e)
            else:
                print('  DEL', fp)
        if args.delete:
            print(f'[완료] 삭제됨={deleted}/{len(orphan)}')


if __name__ == '__main__':
    main()
