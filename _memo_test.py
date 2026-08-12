# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from run import create_app, db
from models import TongBotMemo

app = create_app()
app.config['TESTING'] = True
client = app.test_client()

uid = 8
with app.app_context():
    start = TongBotMemo.query.filter(TongBotMemo.user_id == uid).count()
print("before memos for uid", uid, ":", start)

test_msgs = [
    "메모에 22일 풀뿌리 야유회 적어줘",
    "오후 19시에 빨래 걷으라고 알림 오게 메모 부탁해",
    "오후 7시까지 은영이에게 만원 지급이라고 메모에 기록 부탁해",
]

for msg in test_msgs:
    with client.session_transaction() as s:
        s['user_id'] = uid
    r = client.post('/api/bot/chat', json={"message": msg})
    data = r.get_json()
    print("\n==== INPUT:", msg)
    print("status:", r.status_code)
    print("reply:", str(data.get('reply'))[:400] if isinstance(data, dict) else data)

with app.app_context():
    end = TongBotMemo.query.filter(TongBotMemo.user_id == uid).count()
    print("\nAFTER memos for uid", uid, ":", end, "(+%d saved)" % (end - start))
    print("\nNew memos:")
    ms = TongBotMemo.query.filter(TongBotMemo.user_id == uid).order_by(TongBotMemo.id.desc()).limit(6).all()
    for m in ms:
        print(" ", m.id, "|", (m.content or '')[:60], "| end:", m.end_date, "| reminder:", m.reminder_at, "| author:", m.author)