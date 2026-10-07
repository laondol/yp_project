#!/usr/bin/env python3
"""회신한 편지 원문이 '미확인'으로 남아 벗에게/벗으로부터 탭에 잔류하는 데이터 진단·복구

규칙: 편지의 삭제·회신 버튼을 누른 건 '읽음(확인)'으로 간주 → 보관함으로 이동.
과거 버그: 회신 생성 시 원문 is_read를 설정하지 않아 잔류 → 본 스크립트로 기존 DB 교정.
재발 방지 코드(api_message_send 회신 분기)는 이미 수정됨.

사용법 (컨테이너 안에서):
  # 1) 진단만 (데이터 변경 없음)
  docker exec -i yp_flask python3 /yp_project/scripts/fix_unread_sent.py
  # 2) 복구 적용
  docker exec -i yp_flask python3 /yp_project/scripts/fix_unread_sent.py --apply

복구(A): 원문을 보낸 받는이가 스레드에 '회신'한데 원문이 미확인 → 원문 사본 읽음 처리
  - 발신자 탭: 벗에게 → 보관함 이동
  - 수신자 탭: 벗으로부터 → 보관함 이동 (회신한当事者이므로 규칙상 정상)
진단만:
  B) batch_key 없는 레거시 발송 그룹 (삭제 시 일부 잔존 유발 가능)
  C) sender_archived=TRUE인데 비공지 (코드 미반영분, 있으면 알려주세요)
"""
import sys
import logging
from collections import defaultdict

if '__file__' in globals():
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
else:
    import os
    _base = '/yp_project' if os.path.isdir('/yp_project') else os.getcwd()
    os.chdir(_base)
    sys.path.insert(0, _base)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)


def main():
    apply = '--apply' in sys.argv
    from run import create_app
    from models import Message, db
    from datetime import datetime

    app = create_app()
    with app.app_context():
        rows = Message.query.all()
        by_id = {m.id: m for m in rows}

        def root_of(mid):
            cur = by_id.get(mid)
            seen = set()
            while cur is not None and cur.reply_to_id is not None and cur.id not in seen:
                seen.add(cur.id)
                cur = by_id.get(cur.reply_to_id)
            return cur

        # 원문 id → 회신을 보낸 발신자 집합
        reply_senders = defaultdict(set)
        reply_cnt = defaultdict(int)
        for m in rows:
            if m.reply_to_id is None:
                continue
            rt = root_of(m.reply_to_id)
            if rt is not None:
                reply_senders[rt.id].add(m.sender_id)
                reply_cnt[rt.id] += 1

        targets = []
        for m in rows:
            if m.is_read or m.is_notice or m.reply_to_id is not None:
                continue
            if m.sender_id is None or m.sender_id == m.receiver_id:
                continue
            if m.receiver_id in reply_senders.get(m.id, ()):
                targets.append(m)

        log.info('── A. 회신했는데 미확인으로 잔류한 원문: %d건', len(targets))
        for m in targets[:20]:
            log.info('   #%d  %s→%s  회신 %d건  "%s"  (%s)',
                     m.id, m.sender_id, m.receiver_id, reply_cnt.get(m.id, 0),
                     (m.subject or '(제목 없음)')[:40],
                     m.created_at.strftime('%Y-%m-%d %H:%M') if m.created_at else '?')
        if len(targets) > 20:
            log.info('   ... 외 %d건', len(targets) - 20)

        if apply and targets:
            now = datetime.now()
            for m in targets:
                m.is_read = True
                if not m.read_at:
                    m.read_at = now
            db.session.commit()
            left = 0
            for m in Message.query.all():
                if (m.is_read or m.is_notice or m.reply_to_id is not None
                        or m.sender_id is None or m.sender_id == m.receiver_id):
                    continue
                if m.receiver_id in reply_senders.get(m.id, ()):
                    left += 1
            log.info('[복구 완료] %d건 읽음 처리 → 남은 잔류 %d건', len(targets), left)
        elif apply:
            log.info('[복구] 대상 없음')
        else:
            log.info('(진단만 — 적용하려면 --apply 를 붙이세요)')

        # B. batch_key 없는 레거시 발송 그룹 (같은 발신자·제목·본문·시각±5초)
        legacy = [m for m in rows
                  if m.batch_key is None and m.sender_id is not None
                  and m.sender_id != m.receiver_id and m.reply_to_id is None]
        groups = defaultdict(list)
        for m in legacy:
            ts = int(m.created_at.timestamp()) // 5 if m.created_at else 0
            groups[(m.sender_id, m.subject or '', (m.content or '')[:200], ts)].append(m)
        dup = {k: v for k, v in groups.items() if len(v) > 1}
        dup_rows = sum(len(v) for v in dup.values())
        log.info('── B. batch_key 없는 레거시 발송 중 동일발송 그룹: %d그룹 / %d행', len(dup), dup_rows)
        for (sender, subj, _, _), v in list(dup.items())[:10]:
            log.info('   발신자 %s "%s" × %d행 (ids: %s)',
                     sender, subj[:40], len(v),
                     ','.join(str(x.id) for x in v))
        if dup:
            log.info('   → 삭제가 일부만 잔존하는 구조입니다. 그룹별 처리 방침 알려주시면 처리하겠습니다.')

        # C. sender_archived=TRUE 인 비공지 발신
        c = [m for m in rows if m.sender_archived and not m.is_notice
             and m.sender_id != m.receiver_id]
        log.info('── C. 발신보관 플래그가 있는데 비공지: %d건', len(c))

        log.info('완료')


if __name__ == '__main__':
    main()
