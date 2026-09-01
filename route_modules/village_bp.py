from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, current_app, send_file
from datetime import datetime, timezone, timedelta
from sqlalchemy import or_
from models import db, User, ShareReport, VillageWish, VillageBroadcast, ContentPermission, Post, Message, VillageCache, VillagePage, VillageEvent, VillageEventAttendee, VillageEventChat, VillageEventChatVote, VillageEventFile, StoreInfo, NewsArticle, VillagePlace, VillagePlaceCategory, VillagePlaceReport
from route_modules.common import has_page_access
from services.geocode import haversine

village_bp = Blueprint('village', __name__)

def _is_presenter(event_id, uid):
    """발표자 여부 (참석자 역할이 '발표자')"""
    if not uid:
        return False
    att = VillageEventAttendee.query.filter_by(event_id=event_id, user_id=uid, role='발표자').first()
    return bool(att)

def _chat_open(ev):
    return not (ev.chat_close_date and datetime.now() > ev.chat_close_date)

def _serve_spa():
    import os
    from flask import current_app, send_file
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    from flask import render_template
    return render_template('intro.html')

@village_bp.route('/village')
def village_admin():
    if not has_page_access('village'):
        return "권한 없음", 403
    return _serve_spa()

@village_bp.route('/village/ai-categorize', methods=['POST'])
def village_ai_categorize():
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    content = request.json.get('content','')[:1000]
    try:
        from openai import OpenAI
        client = OpenAI(base_url="https://chat.motiftech.io/openapi/v1", api_key=current_app.config.get('MOTIF_API_KEY',''))
        resp = client.chat.completions.create(
            model="motif-12.7b",
            messages=[{"role":"system","content":"다음 글을 분석해서 '개인' 또는 '공공'으로 분류하고 한줄 요약해줘. JSON: {\"category\":\"개인\" or \"공공\",\"summary\":\"한줄요약\"}"},
                      {"role":"user","content":content}],
            temperature=0.3, max_tokens=200
        )
        import json as _json, re as _re
        _raw = resp.choices[0].message.content or ""
        _raw = _re.sub(r'```(?:json)?', '', _raw).strip()
        _s = _raw.find('{'); _e = _raw.rfind('}')
        result = _json.loads(_raw[_s:_e+1]) if _s != -1 and _e > _s else _json.loads(_raw)
    except:
        result = {"category":"공공","summary":content[:50]}
    return jsonify(result)

@village_bp.route('/village/edit-post/<int:post_id>', methods=['POST'])
def village_edit_post(post_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    post = Post.query.get_or_404(post_id)
    post.title = request.form.get('title', post.title)
    post.content = request.form.get('content', post.content)
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/message-all', methods=['POST'])
def village_message_all():
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    uid = session.get('user_id')
    user = User.query.get(uid)
    if not user:
        return jsonify({"error":"사용자 정보 없음"}), 404
    mp = (user.managed_pages or '').split(',') if user else []
    myeon_list = []
    ri_list = []
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                myeon_list.append(parts[0])
                ri_list.append(parts[1])
            elif len(parts) == 1:
                ri_list.append(parts[0])
                if user.town:
                    myeon_list.append(user.town)
    if not ri_list:
        ri_list = [user.village or user.curr_village or '']
        myeon_list = [user.town or user.curr_town or '']
    subject = request.form.get('subject','').strip()
    content = request.form.get('content','').strip()
    if not content:
        return jsonify({"error":"내용을 입력하세요."})
    attachment_path = None
    file = request.files.get('attachment')
    if file and file.filename:
        from services.security import validate_upload, secure_save
        ok, msg = validate_upload(file)
        if ok:
            try:
                import os as _os
                upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'village_msg')
                _os.makedirs(upload_dir, exist_ok=True)
                attachment_path = secure_save(file, upload_dir)
                # FTP 백업 (이중저장)
                try:
                    from services.security import ftp_backup
                    _abs = _os.path.join(current_app.root_path, attachment_path.lstrip('/'))
                    ftp_backup(_abs, 'village_msg')
                except Exception:
                    pass
            except Exception:
                pass
    from sqlalchemy import or_, and_
    conditions = [and_(User.town == m, User.village == r) for m, r in zip(myeon_list, ri_list)]
    receivers = User.query.filter(User.id != uid, or_(*conditions)).all() if conditions else []
    count = 0
    for r in receivers:
        try:
            msg = Message(sender_id=uid, sender_name=user.real_name or user.username,
                receiver_id=r.id, subject=subject, content=content,
                attachment=attachment_path)
            db.session.add(msg)
            count += 1
        except:
            pass
    db.session.commit()
    for m, r in zip(myeon_list, ri_list):
        try:
            bc = VillageBroadcast(myeon=m, ri=r, sender_id=uid, subject=subject, content=content, attachment=attachment_path)
            db.session.add(bc)
        except:
            pass
    db.session.commit()
    return jsonify({"status":"success","msg":f"{count}명에게 편지 발송 완료"})

@village_bp.route('/village/qr')
def village_qr():
    if not has_page_access('village'):
        return "권한 없음", 403
    import secrets, time
    uid = session.get('user_id')
    code = secrets.token_urlsafe(12)
    expiry = int(time.time()) + 600
    user = User.query.get(uid)
    mp = (user.managed_pages or '').split(',') if user else []
    ris = []
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                ris.append(parts[1])
    # 캐시에 QR 코드 정보 저장
    vc = VillageCache.query.filter_by(data_type='qr_code').first()
    if not vc:
        vc = VillageCache(data_type='qr_code')
    vc.town = str(uid)
    vc.village = code
    vc.data_json = f'{{"expiry":{expiry},"ris":{",".join(ris)}}}'
    db.session.add(vc)
    db.session.commit()
    site_url = current_app.config.get('SITE_URL', request.host_url.rstrip('/'))
    qr_url_base = f'{site_url}/village/invite'
    # 마을지기가 만든 페이지 목록
    myeon = ris[0] if ris else ''
    pages = VillagePage.query.filter_by(myeon=myeon, created_by=uid).all()
    return _serve_spa()

@village_bp.route('/village/jin-verify/<int:member_id>', methods=['POST'])
def village_jin_verify(member_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    member = User.query.get_or_404(member_id)
    member.is_verified_resident = True
    member.jin_verified_at = datetime.now()
    db.session.commit()
    return jsonify({"status":"success","msg":f"{member.real_name or member.username}님 진 인증 완료"})

@village_bp.route('/village/register-member', methods=['POST'])
def village_register_member():
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    name = request.form.get('name','').strip()
    phone = request.form.get('phone','').strip()
    if not name:
        return jsonify({"error":"이름은 필수입니다."})
    uid = session.get('user_id')
    caretaker = User.query.get(uid)
    # 중복 확인 (이름+전화번호)
    member = None
    if phone:
        member = User.query.filter_by(phone=phone).first()
    if not member:
        # 신규 회원 생성 (이메일 없이)
        from werkzeug.security import generate_password_hash
        import random, string
        username = f'마을{random.randint(10000,99999)}'
        member = User(
            username=username,
            real_name=name,
            phone=phone or '',
            role='user',
            password=generate_password_hash(''.join(random.choices(string.digits, k=6))),
            is_verified_resident=True
        )
        db.session.add(member)
        db.session.flush()
    # 사진 처리
    photo = request.files.get('photo')
    if photo and photo.filename:
        from services.security import validate_upload, secure_save
        ok, msg = validate_upload(photo)
        if ok:
            try:
                import os as _os
                upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'village_members')
                _os.makedirs(upload_dir, exist_ok=True)
                member.photo_path = secure_save(photo, upload_dir)
                # FTP 백업 (이중저장)
                try:
                    from services.security import ftp_backup
                    _abs = _os.path.join(current_app.root_path, member.photo_path.lstrip('/'))
                    ftp_backup(_abs, 'village_members')
                except Exception:
                    pass
            except Exception:
                pass
    # 마을지기의 managed_pages에 등록
    cp = (caretaker.managed_pages or '').split(',')
    member_key = f'member_{member.id}'
    if member_key not in cp:
        cp.append(member_key)
        caretaker.managed_pages = ','.join(filter(None, cp))
    db.session.commit()
    return jsonify({"status":"success","msg":f"{name}님 등록 완료"})

@village_bp.route('/village/page', methods=['GET','POST'])
def village_page_edit():
    uid = session.get('user_id')
    if has_page_access('village'):
        # 마을지기: 편집 모드
        user = User.query.get(uid)
        mp = (user.managed_pages or '').split(',') if user else []
        myeon = ri = None
        for p in mp:
            if p.startswith('vi_'):
                parts = p[3:].split('_')
                if len(parts) >= 2:
                    myeon, ri = parts[0], parts[1]
                    break
        if not myeon:
            return "담당 마을이 지정되지 않았습니다.", 400
        page = VillagePage.query.filter_by(myeon=myeon, ri=ri).first()
        if not page:
            page = VillagePage(myeon=myeon, ri=ri, title=ri+' 마을', content='', visibility='members', created_by=uid)
            db.session.add(page)
            db.session.flush()
        if request.method == 'POST':
            page.title = request.form.get('title', page.title)
            page.content = request.form.get('content', page.content)
            page.visibility = request.form.get('visibility', page.visibility)
            db.session.commit()
            return "<script>alert('저장되었습니다.'); location.reload();</script>"
        return _serve_spa()
    # 일반 회원: 자신의 위치에 맞는 공개 마을 페이지 보기
    user = User.query.get(uid) if uid else None
    if user:
        ri = user.curr_village or user.login_village or user.village or user.reg_village or ''
        town = user.curr_town or user.town or user.reg_town or ''
        if ri:
            page = VillagePage.query.filter_by(myeon=town, ri=ri).first()
            if page and page.visibility != 'off':
                return redirect(url_for('village.village_page_view', tmyeon=town, tri=ri))
    return "<script>alert('해당하는 마을 페이지가 없습니다.'); history.back();</script>"

@village_bp.route('/api/village/page')
def api_village_page():
    myeon = request.args.get('myeon', '').strip()
    ri = request.args.get('ri', '').strip()
    if not myeon or not ri:
        return jsonify({"error":"myeon과 ri 파라미터가 필요합니다."}), 400
    page = VillagePage.query.filter_by(myeon=myeon, ri=ri).first()
    if not page or page.visibility == 'off':
        return jsonify({"error":"페이지를 찾을 수 없습니다."}), 404
    content = page.content or ''
    if '[gallery]' in content:
        shares = ShareReport.query.filter(ShareReport.image_path.isnot(None), ShareReport.image_path != '').order_by(ShareReport.created_at.desc()).limit(12).all()
        imgs = ''.join([f'<div class="col-4 col-md-3 mb-2"><img src="{s.image_path}" class="img-fluid rounded" style="height:150px;object-fit:cover;width:100%;"></div>' for s in shares if s.image_path])
        gallery_html = f'<div class="row g-2 my-3">{imgs}</div>' if imgs else '<p class="text-muted">갤러리 이미지가 없습니다.</p>'
        content = content.replace('[gallery]', gallery_html)
    if '[stores]' in content:
        stores = StoreInfo.query.filter(StoreInfo.is_active == True).order_by(StoreInfo.created_at.desc()).limit(10).all()
        store_items = ''.join([f'<div class="col-6 mb-2"><div class="card p-2"><strong>{s.name}</strong><br><small>{getattr(s, "address", "") or ""}</small></div></div>' for s in stores])
        stores_html = f'<div class="row g-2 my-3">{store_items}</div>' if store_items else '<p class="text-muted">등록된 가게가 없습니다.</p>'
        content = content.replace('[stores]', stores_html)
    if '[posts]' in content:
        recent_posts = Post.query.filter(Post.total_score > -50).order_by(Post.created_at.desc()).limit(10).all()
        post_items = ''.join([f'<div class="mb-2"><a href="/post/{p.id}" class="text-decoration-none"><strong>{p.title}</strong></a><br><small class="text-muted">{"👍 " + str(p.like_count or 0)}</small></div>' for p in recent_posts])
        posts_html = f'<div class="my-3">{post_items}</div>' if post_items else '<p class="text-muted">게시글이 없습니다.</p>'
        content = content.replace('[posts]', posts_html)
    return jsonify({
        'id': page.id, 'myeon': page.myeon, 'ri': page.ri,
        'title': page.title, 'content': content,
        'visibility': page.visibility,
        'created_at': page.created_at.isoformat() if page.created_at else None,
    })

@village_bp.route('/api/village/my-page')
def api_village_my_page():
    """현재 로그인한 회원의 위치에 해당하는 마을 페이지 정보"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"exists": False})
    user = User.query.get(uid)
    if not user:
        return jsonify({"exists": False})
    # 우선순위: curr_village > login_village > village > reg_village
    ri = user.curr_village or user.login_village or user.village or user.reg_village or ''
    town = user.curr_town or user.town or user.reg_town or ''
    if not ri:
        return jsonify({"exists": False})
    page = VillagePage.query.filter_by(myeon=town, ri=ri).first()
    if not page or page.visibility == 'off':
        return jsonify({"exists": False, "myeon": town, "ri": ri})
    return jsonify({"exists": True, "id": page.id, "title": page.title, "myeon": town, "ri": ri})

@village_bp.route('/village/view/<string:tmyeon>/<string:tri>')
def village_page_view(tmyeon, tri):
    page = VillagePage.query.filter_by(myeon=tmyeon, ri=tri).first()
    if not page or page.visibility == 'off':
        # 담당 마을지기면 페이지 자동 생성 (그 외는 지도 열람만 허용)
        uid = session.get('user_id')
        is_caretaker = False
        if uid:
            u = User.query.get(uid)
            if u and u.managed_pages:
                mp = (u.managed_pages or '').split(',')
                if 'village' in mp or any(p.startswith('vi_') and p[3:] == f'{tmyeon}_{tri}' for p in mp):
                    is_caretaker = True
        if is_caretaker and not page:
            page = VillagePage(myeon=tmyeon, ri=tri, title=f'{tri} 마을', content='', visibility='members', created_by=uid)
            db.session.add(page)
            db.session.commit()
        # 지도 열람은 전원 허용
        return _serve_spa()
    # 지도 열람은 전원 허용 → members 공개여도 차단하지 않고 SPA 서빙
    return _serve_spa()

@village_bp.route('/village/page/toggle', methods=['POST'])
def village_page_toggle():
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    uid = session.get('user_id')
    user = User.query.get(uid)
    mp = (user.managed_pages or '').split(',') if user else []
    myeon = ri = None
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                myeon, ri = parts[0], parts[1]
                break
    if not myeon:
        return jsonify({"error":"담당 마을 없음"})
    page = VillagePage.query.filter_by(myeon=myeon, ri=ri).first()
    if not page:
        return jsonify({"error":"페이지 없음"})
    page.visibility = 'off' if page.visibility != 'off' else 'public'
    db.session.commit()
    return jsonify({"status":"success","visibility":page.visibility})

@village_bp.route('/village/events')
def village_events():
    if not has_page_access('village'):
        return "권한 없음", 403
    return _serve_spa()

@village_bp.route('/village/event/create', methods=['GET','POST'])
def village_event_create():
    if not has_page_access('village'):
        return "권한 없음", 403
    uid = session.get('user_id')
    user = User.query.get(uid)
    mp = (user.managed_pages or '').split(',') if user else []
    myeon = ri = None
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                myeon, ri = parts[0], parts[1]; break
    if request.method == 'POST':
        ev = VillageEvent(
            myeon=myeon, ri=ri,
            title=request.form['title'],
            event_type=request.form.get('event_type','meeting'),
            meeting_category=request.form.get('meeting_category','gathering'),
            meeting_mode=request.form.get('meeting_mode',''),
            description=request.form.get('description',''),
            location=request.form.get('location',''),
            video_url=request.form.get('video_url',''),
            event_date=datetime.strptime(request.form['event_date'],'%Y-%m-%dT%H:%M') if request.form.get('event_date') else datetime.now(),
            created_by=uid
        )
        db.session.add(ev)
        db.session.commit()
        return redirect(url_for('village_event_view', event_id=ev.id))
    return _serve_spa()

@village_bp.route('/village/event/<int:event_id>')
def village_event_view(event_id):
    return _serve_spa()

@village_bp.route('/village/event/<int:event_id>/join', methods=['POST'])
def village_event_join(event_id):
    ev = VillageEvent.query.get_or_404(event_id)
    uid = session.get('user_id')
    consented = request.form.get('consented') == 'true'
    email = request.form.get('email','').strip()
    name = request.form.get('name','').strip()
    mobile_helper = request.form.get('mobile_helper','').strip()
    if mobile_helper not in ('지원','필요'):
        mobile_helper = ''
    attendee = None
    if uid:
        attendee = VillageEventAttendee.query.filter_by(event_id=event_id, user_id=uid).first()
    elif email:
        attendee = VillageEventAttendee.query.filter_by(event_id=event_id, email=email).first()
    if not attendee:
        attendee = VillageEventAttendee(event_id=event_id, user_id=uid, email=email, name=name, consented=consented, mobile_helper=mobile_helper)
        db.session.add(attendee)
    else:
        attendee.consented = consented
        attendee.email = email or attendee.email
        attendee.name = name or attendee.name
        attendee.mobile_helper = mobile_helper or attendee.mobile_helper
    db.session.commit()
    return jsonify({"status":"success","consented":attendee.consented})

@village_bp.route('/village/event/<int:event_id>/chat', methods=['POST'])
def village_event_chat(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    ev = VillageEvent.query.get_or_404(event_id)
    if not _chat_open(ev):
        return jsonify({"status":"closed","msg":"종료된 채팅방입니다."}), 403
    msg = request.form.get('message','').strip()
    if not msg:
        return jsonify({"error":"메시지 입력"})
    msg_type = request.form.get('msg_type','').strip()
    if msg_type not in ('question','opinion',''):
        msg_type = ''
    user = User.query.get(uid)
    # AI 프로텍터: 욕설/비방 필터링
    blocked = False
    try:
        from openai import OpenAI
        client = OpenAI(base_url="https://chat.motiftech.io/openapi/v1", api_key=current_app.config.get('MOTIF_API_KEY',''))
        resp = client.chat.completions.create(
            model="motif-12.7b",
            messages=[{"role":"system","content":"다음 채팅 메시지가 욕설,비방,광고성인지 'clean'또는'block'으로만 답변"},{"role":"user","content":msg}],
            temperature=0, max_tokens=10
        )
        if 'block' in resp.choices[0].message.content.lower():
            blocked = True
    except:
        pass
    if blocked:
        return jsonify({"status":"blocked","msg":"AI가 부적절한 메시지로 판단했습니다."})
    chat = VillageEventChat(event_id=event_id, user_id=uid, author=user.real_name or user.username, message=msg, msg_type=msg_type)
    db.session.add(chat)
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/event/<int:event_id>/chats')
def village_event_chats(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    sort = request.args.get('sort', 'new')
    q = VillageEventChat.query.filter_by(event_id=event_id)
    if sort == 'likes':
        chats = q.order_by(VillageEventChat.like_count.desc(), VillageEventChat.created_at.desc()).all()
    else:
        chats = q.order_by(VillageEventChat.created_at.desc()).all()
    my_votes = {}
    if chats:
        votes = VillageEventChatVote.query.filter(VillageEventChatVote.chat_id.in_([c.id for c in chats]), VillageEventChatVote.user_id == uid).all()
        my_votes = {v.chat_id: v.vote for v in votes}
    answerer_ids = {c.answered_by for c in chats if c.answered_by}
    answerers = {u.id: (u.real_name or u.username) for u in User.query.filter(User.id.in_(answerer_ids or [0])).all()}
    ev = VillageEvent.query.get_or_404(event_id)
    can_answer = has_page_access('village') or _is_presenter(event_id, uid)
    return jsonify({
        'chats': [{
            'id': c.id, 'author': c.author, 'message': c.message, 'msg_type': c.msg_type or '',
            'like_count': c.like_count or 0, 'dislike_count': c.dislike_count or 0,
            'my_vote': my_votes.get(c.id, ''),
            'answer': c.answer, 'answerer': answerers.get(c.answered_by, ''),
            'answered_at': c.answered_at.isoformat() if c.answered_at else None,
            'created_at': c.created_at.isoformat() if c.created_at else None,
        } for c in chats],
        'can_answer': can_answer,
        'chat_open': _chat_open(ev),
        'chat_close_date': ev.chat_close_date.isoformat() if ev.chat_close_date else None,
    })

@village_bp.route('/village/event/<int:event_id>/chat/<int:chat_id>/vote', methods=['POST'])
def village_event_chat_vote(event_id, chat_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    ev = VillageEvent.query.get_or_404(event_id)
    if not _chat_open(ev):
        return jsonify({"status":"closed","msg":"종료된 채팅방입니다."}), 403
    vote = request.form.get('vote','')
    if vote not in ('like','dislike'):
        return jsonify({"error":"vote 값 오류"})
    chat = VillageEventChat.query.get_or_404(chat_id)
    existing = VillageEventChatVote.query.filter_by(chat_id=chat_id, user_id=uid).first()
    if existing:
        if existing.vote == vote:
            db.session.delete(existing)
        else:
            existing.vote = vote
    else:
        db.session.add(VillageEventChatVote(chat_id=chat_id, user_id=uid, vote=vote))
    db.session.commit()
    chat.like_count = VillageEventChatVote.query.filter_by(chat_id=chat_id, vote='like').count()
    chat.dislike_count = VillageEventChatVote.query.filter_by(chat_id=chat_id, vote='dislike').count()
    db.session.commit()
    return jsonify({"status":"success","like_count":chat.like_count,"dislike_count":chat.dislike_count})

@village_bp.route('/village/event/<int:event_id>/chat/<int:chat_id>/answer', methods=['POST'])
def village_event_chat_answer(event_id, chat_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    if not (has_page_access('village') or _is_presenter(event_id, uid)):
        return jsonify({"error":"발표자/마을지기만 답변할 수 있습니다."}), 403
    answer = request.form.get('answer','').strip()
    if not answer:
        return jsonify({"error":"답변 내용을 입력하세요."})
    chat = VillageEventChat.query.get_or_404(chat_id)
    chat.answer = answer
    chat.answered_by = uid
    chat.answered_at = datetime.now()
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/event/<int:event_id>/close-chat', methods=['POST'])
def village_event_close_chat(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    if not (has_page_access('village') or _is_presenter(event_id, uid)):
        return jsonify({"error":"발표자/마을지기만 종료할 수 있습니다."}), 403
    ev = VillageEvent.query.get_or_404(event_id)
    ev.chat_close_date = datetime.now() + timedelta(days=10)
    db.session.commit()
    return jsonify({"status":"success","chat_close_date":ev.chat_close_date.isoformat()})

@village_bp.route('/village/event/<int:event_id>/ai-summary', methods=['POST'])
def village_event_ai_summary(event_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    chat = VillageEventChat.query.filter_by(event_id=event_id).order_by(VillageEventChat.created_at.asc()).all()
    if not chat:
        return jsonify({"summary":"대화 내용이 없습니다."})
    def _t(c):
        return '질문' if c.msg_type == 'question' else ('의견' if c.msg_type == 'opinion' else '일반')
    messages = '\n'.join([f'{c.author}: {c.message} [{_t(c)}|공감{c.like_count or 0}]' for c in chat])
    try:
        from openai import OpenAI
        client = OpenAI(base_url="https://chat.motiftech.io/openapi/v1", api_key=current_app.config.get('MOTIF_API_KEY',''))
        resp = client.chat.completions.create(
            model="motif-12.7b",
            messages=[{"role":"system","content":"회의 채팅 내용을 [질문]과 [의견]으로 나누어 정리해줘. 같은 주제는 묶고, 공감(좋아요)이 많은 순서로 배치해. 각 항목 앞에 [질문] 또는 [의견] 표시와 (공감 n)을 붙여줘. 마지막에 주요 논의사항과 결정사항을 구분해 마크다운으로 정리해줘."},
                      {"role":"user","content":messages[:3000]}],
            temperature=0.5, max_tokens=800
        )
        summary = resp.choices[0].message.content
    except Exception as e:
        summary = f"요약 실패: {e}"
    return jsonify({"summary":summary})

@village_bp.route('/village/event/<int:event_id>/role', methods=['POST'])
def village_event_role(event_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    attendee_id = request.form.get('attendee_id', type=int)
    role = request.form.get('role','').strip()
    att = VillageEventAttendee.query.get_or_404(attendee_id)
    att.role = role
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/event/<int:event_id>/status', methods=['POST'])
def village_event_status(event_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    ev = VillageEvent.query.get_or_404(event_id)
    ev.status = request.form.get('status', ev.status)
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/event/<int:event_id>/attend/<int:attendee_id>', methods=['POST'])
def village_event_attend(event_id, attendee_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    att = VillageEventAttendee.query.get_or_404(attendee_id)
    att.status = request.form.get('status', 'confirmed')
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/event/<int:event_id>/qr')
def village_event_qr(event_id):
    if not has_page_access('village'):
        return "권한 없음", 403
    ev = VillageEvent.query.get_or_404(event_id)
    site_url = current_app.config.get('SITE_URL', request.host_url.rstrip('/'))
    qr_url = f'{site_url}/village/event/{ev.id}'
    return _serve_spa()

@village_bp.route('/village/event/<int:event_id>/message', methods=['POST'])
def village_event_message(event_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    ev = VillageEvent.query.get_or_404(event_id)
    subject = request.form.get('subject','').strip()
    msg_content = request.form.get('content','').strip()
    if not subject or not msg_content:
        return jsonify({"error":"제목과 내용을 입력하세요."})
    scope = request.form.get('scope','attendees')
    uid = session.get('user_id')
    user = User.query.get(uid)
    # 대상자 선정
    receivers = []
    if scope == 'attendees':
        attendees = VillageEventAttendee.query.filter_by(event_id=event_id).all()
        for a in attendees:
            if a.user_id:
                u = User.query.get(a.user_id)
                if u: receivers.append(u)
    elif scope == 'village':
        receivers = User.query.filter(User.village == ev.ri).all()
    elif scope == 'myeon':
        receivers = User.query.filter(User.town == ev.myeon).all()
    elif scope == 'all':
        receivers = User.query.all()
    # 비용 체크
    cost = len(receivers)
    if (user.points or 0) < cost:
        return jsonify({"error":f"닢이 부족합니다. (필요: {cost}닢, 보유: {user.points or 0}닢)"})
    # 발송
    count = 0
    for r in receivers:
        if r.id == uid: continue
        msg = Message(sender_id=uid, sender_name=user.real_name or user.username,
            receiver_id=r.id, subject=subject, content=msg_content)
        db.session.add(msg)
        count += 1
    add_points(uid, -cost, 'event_message', f'활동 쪽지: {ev.title[:30]} ({count}명)')
    db.session.commit()
    return jsonify({"status":"success","msg":f"{count}명에게 쪽지 발송 완료 ({cost}닢 차감)"})

@village_bp.route('/village/event/<int:event_id>/ping', methods=['POST'])
def village_event_ping(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    att = VillageEventAttendee.query.filter_by(event_id=event_id, user_id=uid).first()
    if att:
        att.last_ping = datetime.now()
        db.session.commit()
    attendees = VillageEventAttendee.query.filter_by(event_id=event_id).all()
    now = datetime.now()
    away = []
    for a in attendees:
        if a.last_ping and (now - a.last_ping).total_seconds() > 30:
            away.append({'id':a.id,'name':a.name or a.email or '익명','seconds':int((now - a.last_ping).total_seconds())})
    return jsonify({"status":"ok","away":away})

@village_bp.route('/api/village/dashboard')
def api_village_dashboard():
    uid = session.get('user_id')
    if not uid or not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    user = User.query.get(uid)
    if not user:
        return jsonify({"error":"사용자 없음"}), 404
    mp = (user.managed_pages or '').split(',') if user else []
    village_ris = []
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                village_ris.append({"myeon": parts[0], "ri": parts[1]})
    myeon_list = [v["myeon"] for v in village_ris]
    ri_list = [v["ri"] for v in village_ris]
    members = User.query.filter(
        User.town.in_(myeon_list) if myeon_list else False,
        User.village.in_(ri_list) if ri_list else True
    ).all() if myeon_list else []
    member_ids = [m.id for m in members]
    member_count = len(member_ids)
    posts = Post.query.filter(Post.user_id.in_(member_ids)).order_by(Post.created_at.desc()).limit(50).all() if member_ids else []
    shares = ShareReport.query.filter(ShareReport.user_id.in_(member_ids)).order_by(ShareReport.created_at.desc()).limit(50).all() if member_ids else []
    ri_names = [v["ri"] for v in village_ris]
    wishes = VillageWish.query.filter(VillageWish.village_ri.in_(ri_names)).order_by(VillageWish.created_at.desc()).limit(50).all() if ri_names else []
    return jsonify({
        "village_ris": village_ris,
        "member_count": member_count,
        "members": [{
            "id": m.id, "real_name": m.real_name or '-', "email": m.email,
            "town": m.town or '', "village": m.village or '',
            "is_verified_resident": m.is_verified_resident,
            "jin_verified_at": m.jin_verified_at.isoformat() if m.jin_verified_at else None,
            "photo_path": m.photo_path or ''
        } for m in members],
        "posts": [{
            "id": p.id, "title": p.title, "content": (p.content or '')[:200],
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "user_id": p.user_id
        } for p in posts],
        "shares": [{
            "id": s.id, "title": s.title, "description": (s.description or '')[:200],
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "user_id": s.user_id, "image_path": s.image_path or ''
        } for s in shares],
        "wishes": [{
            "id": w.id, "content": w.content, "status": w.status or 'pending',
            "reply": w.reply, "user_id": w.user_id,
            "created_at": w.created_at.isoformat() if w.created_at else None
        } for w in wishes],
    })

@village_bp.route('/api/village/feed')
def api_village_feed():
    uid = session.get('user_id')
    if not uid or not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    user = User.query.get(uid)
    if not user:
        return jsonify({"error":"사용자 없음"}), 404
    mp = (user.managed_pages or '').split(',') if user else []
    village_ris = []
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                village_ris.append({"myeon": parts[0], "ri": parts[1]})
    myeon_list = [v["myeon"] for v in village_ris]
    ri_list = [v["ri"] for v in village_ris]
    broadcast_list = []
    for v in village_ris:
        bcs = VillageBroadcast.query.filter_by(myeon=v["myeon"], ri=v["ri"])\
            .order_by(VillageBroadcast.created_at.desc()).limit(30).all()
        for bc in bcs:
            sender = User.query.get(bc.sender_id)
            broadcast_list.append({
                "type": "broadcast",
                "id": bc.id,
                "subject": bc.subject,
                "content": bc.content,
                "sender_name": sender.real_name or sender.username if sender else '',
                "attachment": bc.attachment,
                "created_at": bc.created_at.isoformat() if bc.created_at else None,
            })
    member_ids = [m.id for m in User.query.filter(
        User.town.in_(myeon_list) if myeon_list else False,
        User.village.in_(ri_list) if ri_list else True
    ).all()] if myeon_list else []
    posts = Post.query.filter(Post.user_id.in_(member_ids)).order_by(Post.created_at.desc()).limit(30).all() if member_ids else []
    shares = ShareReport.query.filter(
        ShareReport.town.in_(myeon_list),
        ShareReport.village.in_(ri_list)
    ).order_by(ShareReport.created_at.desc()).limit(30).all() if myeon_list else []
    ri_names = [v["ri"] for v in village_ris]
    wishes = VillageWish.query.filter(VillageWish.village_ri.in_(ri_names)).order_by(VillageWish.created_at.desc()).limit(30).all() if ri_names else []
    items = []
    for p in posts:
        items.append({"type": "post", "id": p.id, "title": p.title, "content": (p.content or '')[:300], "created_at": p.created_at.isoformat() if p.created_at else None, "user_id": p.user_id})
    for s in shares:
        items.append({"type": "share", "id": s.id, "title": s.title, "description": (s.description or '')[:300], "created_at": s.created_at.isoformat() if s.created_at else None, "user_id": s.user_id, "image_path": s.image_path or ''})
    for w in wishes:
        items.append({"type": "wish", "id": w.id, "content": w.content, "status": w.status or 'pending', "reply": w.reply, "created_at": w.created_at.isoformat() if w.created_at else None, "user_id": w.user_id})
    items.extend(broadcast_list)
    items.sort(key=lambda x: x.get("created_at") or '', reverse=True)
    return jsonify(items[:50])

@village_bp.route('/api/village/content/permission-request', methods=['POST'])
def content_permission_request():
    uid = session.get('user_id')
    if not uid or not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    share_id = request.form.get('share_id', type=int)
    post_id = request.form.get('post_id', type=int)
    message = request.form.get('message', '')
    if not share_id and not post_id:
        return jsonify({"error":"콘텐츠를 지정해주세요."}), 400
    content = None
    author_id = None
    if share_id:
        content = ShareReport.query.get(share_id)
        if content: author_id = content.user_id
    if not author_id:
        return jsonify({"error":"작성자를 찾을 수 없습니다."}), 404
    existing = ContentPermission.query.filter_by(
        share_id=share_id, requester_id=uid, status='pending'
    ).first()
    if existing:
        return jsonify({"error":"이미 승인 요청이 있습니다."}), 409
    cp = ContentPermission(share_id=share_id, post_id=post_id,
        requester_id=uid, author_id=author_id, message=message)
    db.session.add(cp)
    msg = Message(sender_id=uid, sender_name='마을지기',
        receiver_id=author_id,
        subject=f'콘텐츠 사용 허가 요청',
        content=f'회원님의 콘텐츠를 마을 홍보에 사용하고자 합니다. 허가해 주시면 감사하겠습니다.\n\n요청 메시지: {message}\n\n승인 링크: {request.host_url}village/content-permissions')
    db.session.add(msg)
    db.session.commit()
    return jsonify({"status":"success","msg":"사용 허가 요청을 보냈습니다."})

@village_bp.route('/api/village/content/permissions/pending', methods=['GET'])
def content_permissions_pending():
    uid = session.get('user_id')
    if not uid: return jsonify({"error":"로그인 필요"}), 401
    perms = ContentPermission.query.filter_by(author_id=uid, status='pending')\
        .order_by(ContentPermission.created_at.desc()).all()
    result = []
    for cp in perms:
        share = ShareReport.query.get(cp.share_id) if cp.share_id else None
        requester = User.query.get(cp.requester_id)
        result.append({
            "id": cp.id, "share_id": cp.share_id, "post_id": cp.post_id,
            "share_title": share.title if share else '',
            "requester_name": requester.real_name or requester.username if requester else '',
            "message": cp.message, "status": cp.status,
            "created_at": cp.created_at.isoformat() if cp.created_at else None,
        })
    return jsonify(result)

@village_bp.route('/api/village/content/permission-respond', methods=['POST'])
def content_permission_respond():
    uid = session.get('user_id')
    if not uid: return jsonify({"error":"로그인 필요"}), 401
    perm_id = request.form.get('perm_id', type=int)
    action = request.form.get('action', '')
    if not perm_id or action not in ('approve', 'reject'):
        return jsonify({"error":"잘못된 요청"}), 400
    cp = ContentPermission.query.get(perm_id)
    if not cp or cp.author_id != uid:
        return jsonify({"error":"권한 없음"}), 403
    cp.status = 'approved' if action == 'approve' else 'rejected'
    cp.responded_at = datetime.now()
    if action == 'approve' and cp.share_id:
        share = ShareReport.query.get(cp.share_id)
        if share:
            share.promotion_allowed = True
    db.session.commit()
    return jsonify({"status":"success","msg":"처리 완료"})

@village_bp.route('/api/village/content/promotion-allowed')
def content_promotion_allowed():
    uid = session.get('user_id')
    if not uid or not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    shares = ShareReport.query.filter_by(promotion_allowed=True)\
        .order_by(ShareReport.created_at.desc()).limit(50).all()
    return jsonify([{
        "id": s.id, "title": s.title, "description": s.description,
        "image_path": s.image_path or '', "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s in shares])

@village_bp.route('/village/invite/<path:target>')
def village_invite(target):
    uid = session.get('user_id')
    if not uid:
        return redirect(url_for('auth.login', next=request.path))
    user = User.query.get(uid)
    # 진 인증 체크 (6개월)
    if not user.jin_verified_at or (datetime.now() - user.jin_verified_at).days > 150:
        return _serve_spa()
    # target에 따라 이동
    if target == 'join':
        return redirect(url_for('village_join', code=request.args.get('code','')))
    elif target.startswith('page_'):
        page_id = int(target.split('_')[1])
        page = VillagePage.query.get(page_id)
        if page:
            return redirect(url_for('village_page_view', tmyeon=page.myeon, tri=page.ri))
    return "<script>alert('페이지를 찾을 수 없습니다.'); history.back();</script>"

@village_bp.route('/village/invite-jin', methods=['POST'])
def village_invite_jin():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"})
    user = User.query.get(uid)
    user.jin_verified_at = datetime.now()
    user.is_verified_resident = True
    db.session.commit()
    target = request.json.get('target','')
    redirect = '/village/join' if target == 'join' else '/intro'
    if target.startswith('page_'):
        page_id = int(target.split('_')[1])
        page = VillagePage.query.get(page_id)
        if page:
            redirect = url_for('village_page_view', tmyeon=page.myeon, tri=page.ri)
    return jsonify({"status":"success","redirect":redirect})

@village_bp.route('/village/wish', methods=['POST'])
def village_wish_create():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    user = User.query.get(uid)
    content = request.form.get('content','').strip()
    ri = user.village or user.curr_village or ''
    if not content:
        return jsonify({"error":"내용을 입력하세요."})
    w = VillageWish(user_id=uid, content=content, village_ri=ri)
    db.session.add(w)
    db.session.commit()
    return jsonify({"status":"success","msg":"마을에 전달되었습니다."})

@village_bp.route('/village/wish/<int:wish_id>/reply', methods=['POST'])
def village_wish_reply(wish_id):
    if not has_page_access('village'):
        return jsonify({"error":"권한 없음"}), 403
    w = VillageWish.query.get_or_404(wish_id)
    w.status = request.form.get('status', w.status)
    w.reply = request.form.get('reply','')
    w.replied_by = session.get('user_id')
    db.session.commit()
    return jsonify({"status":"success"})

@village_bp.route('/village/my-wishes')
def village_my_wishes():
    if not session.get('user_id'):
        return redirect(url_for('auth.login'))
    return _serve_spa()

@village_bp.route('/api/village/events')
def api_village_events():
    myeon = request.args.get('myeon', '')
    ri = request.args.get('ri', '')
    q = VillageEvent.query
    if myeon: q = q.filter(VillageEvent.myeon == myeon)
    if ri: q = q.filter(VillageEvent.ri == ri)
    events = q.order_by(VillageEvent.event_date.desc()).limit(20).all()
    return jsonify([{
        'id': e.id, 'myeon': e.myeon, 'ri': e.ri, 'title': e.title,
        'event_type': e.event_type, 'description': e.description,
        'meeting_category': e.meeting_category or 'gathering',
        'meeting_mode': e.meeting_mode or '',
        'video_url': e.video_url,
        'location': e.location, 'status': e.status,
        'event_date': e.event_date.isoformat() if e.event_date else None,
        'created_at': e.created_at.isoformat() if e.created_at else None,
    } for e in events])

@village_bp.route('/api/village/wishes')
def api_village_wishes():
    uid = session.get('user_id')
    if not uid: return jsonify({"error":"login"}), 401
    wishes = VillageWish.query.filter_by(user_id=uid).order_by(VillageWish.created_at.desc()).all()
    return jsonify([{
        'id': w.id, 'content': w.content, 'village_ri': w.village_ri,
        'status': w.status, 'reply': w.reply,
        'created_at': w.created_at.isoformat() if w.created_at else None,
    } for w in wishes])

@village_bp.route('/api/village/alerts')
def api_village_alerts():
    town = request.args.get('town', '')
    village = request.args.get('village', '')
    q = VillageAlert.query.filter_by(is_active=True)
    if town: q = q.filter(VillageAlert.town == town)
    if village: q = q.filter(VillageAlert.village == village)
    alerts = q.order_by(VillageAlert.created_at.desc()).limit(20).all()
    return jsonify([{
        'id': a.id, 'title': a.title, 'content': a.content,
        'town': a.town, 'village': a.village,
        'alert_type': a.alert_type, 'urgency': a.urgency,
        'author_name': a.author_name,
        'created_at': a.created_at.isoformat() if a.created_at else None,
    } for a in alerts])

@village_bp.route('/api/village/images')
def village_images():
    myeon = request.args.get('myeon','')
    ri = request.args.get('ri','')
    images = []
    shares = ShareReport.query.filter(ShareReport.image_path.isnot(None), ShareReport.image_path != '').order_by(ShareReport.created_at.desc()).limit(20).all()
    images = [s.image_path for s in shares if s.image_path]
    return jsonify({"images": images})

@village_bp.route('/village/join', methods=['GET','POST'])
def village_join():
    code = request.args.get('code') or request.form.get('code')
    if not code:
        return "<script>alert('QR 코드가 필요합니다.'); location.href='/intro';</script>"
    # 캐시에서 정보 조회
    vc = VillageCache.query.filter_by(village=code).first()
    if not vc:
        return "<script>alert('만료되었거나 잘못된 QR입니다.'); location.href='/intro';</script>"
    import json as _json
    try:
        data = _json.loads(vc.data_json or '{}')
    except:
        return "<script>alert('잘못된 QR 정보입니다.'); location.href='/intro';</script>"
    expiry = data.get('expiry', 0)
    import time
    if time.time() > expiry:
        return "<script>alert('QR 코드가 만료되었습니다. (10분 유효)'); location.href='/intro';</script>"
    ris = data.get('ris','').split(',') if data.get('ris') else []
    caretaker_uid = int(vc.town) if vc.town and vc.town.isdigit() else None
    caretaker = User.query.get(caretaker_uid) if caretaker_uid else None

    if request.method == 'POST':
        uid = session.get('user_id')
        if not uid:
            return "<script>alert('로그인이 필요합니다.'); location.href='/login';</script>"
        member = User.query.get(uid)
        if not member:
            return "<script>alert('회원 정보를 찾을 수 없습니다.'); location.href='/intro';</script>"
        # 동의 처리: 마을지기의 managed_pages에 회원 등록
        if caretaker:
            cp = (caretaker.managed_pages or '').split(',')
            member_key = f'member_{uid}'
            if member_key not in cp:
                cp.append(member_key)
                caretaker.managed_pages = ','.join(filter(None, cp))
            # 회원 사진 처리
            photo = request.files.get('photo')
            if photo and photo.filename:
                import os as _os
                upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'village_members')
                _os.makedirs(upload_dir, exist_ok=True)
                fname = f'{uid}_{datetime.now().strftime("%Y%m%d%H%M%S")}.jpg'
                fpath = _os.path.join(upload_dir, fname)
                photo.save(fpath)
                member.photo_path = '/static/uploads/village_members/' + fname
            db.session.commit()
        return "<script>alert('마을 등록이 완료되었습니다!'); location.href='/user/%d';</script>" % uid
    return _serve_spa()


# ============================================================
# 마을지기 홍보 지도 (회원 제안 → 마을지기 승인)
# ============================================================

def _village_scope():
    """현재 로그인한 마을지기의 담당 읍면/리 목록"""
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    if not user:
        return []
    scopes = []
    for p in (user.managed_pages or '').split(','):
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                scopes.append({"myeon": parts[0], "ri": parts[1]})
    return scopes


def _scope_match(myeon, ri, scopes):
    if not scopes:
        return False
    for s in scopes:
        if (s["myeon"] == myeon or not myeon) and (s["ri"] == ri or not ri):
            return True
    return False


@village_bp.route('/api/village/map/categories')
def api_village_map_categories():
    myeon = request.args.get('myeon', '').strip()
    ri = request.args.get('ri', '').strip()
    q = VillagePlaceCategory.query
    if myeon: q = q.filter(VillagePlaceCategory.myeon == myeon)
    if ri: q = q.filter(VillagePlaceCategory.ri == ri)
    cats = q.order_by(VillagePlaceCategory.sort_order.asc(), VillagePlaceCategory.id.asc()).all()
    return jsonify({"categories": [{
        "id": c.id, "myeon": c.myeon, "ri": c.ri, "name": c.name,
        "icon": c.icon or '📍', "color": c.color or '#6c757d', "sort_order": c.sort_order or 0,
    } for c in cats]})


@village_bp.route('/api/village/map/categories', methods=['POST'])
def api_village_map_categories_create():
    if not has_page_access('village'):
        return jsonify({"error": "권한 없음"}), 403
    scopes = _village_scope()
    data = request.get_json() or {}
    myeon = (data.get('myeon') or '').strip()
    ri = (data.get('ri') or '').strip()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "카테고리 이름을 입력하세요."}), 400
    if not _scope_match(myeon, ri, scopes):
        return jsonify({"error": "담당 마을이 아닙니다."}), 403
    cat = VillagePlaceCategory(
        myeon=myeon, ri=ri, name=name,
        icon=(data.get('icon') or '📍').strip() or '📍',
        color=(data.get('color') or '#6c757d').strip() or '#6c757d',
        sort_order=int(data.get('sort_order') or 0),
        created_by=session.get('user_id'),
    )
    db.session.add(cat)
    db.session.commit()
    return jsonify({"success": True, "id": cat.id})


@village_bp.route('/api/village/map/categories/<int:cid>', methods=['PUT', 'DELETE'])
def api_village_map_category_item(cid):
    if not has_page_access('village'):
        return jsonify({"error": "권한 없음"}), 403
    cat = VillagePlaceCategory.query.get_or_404(cid)
    scopes = _village_scope()
    if not _scope_match(cat.myeon, cat.ri, scopes):
        return jsonify({"error": "담당 마을이 아닙니다."}), 403
    if request.method == 'DELETE':
        # 해당 카테고리의 장소는 카테고리를 비운다
        for p in VillagePlace.query.filter_by(category_id=cat.id).all():
            p.category_id = None
        db.session.delete(cat)
        db.session.commit()
        return jsonify({"success": True})
    data = request.get_json() or {}
    if 'name' in data and data.get('name'):
        cat.name = str(data['name']).strip()
    if 'icon' in data:
        cat.icon = str(data.get('icon') or '📍').strip()
    if 'color' in data:
        cat.color = str(data.get('color') or '#6c757d').strip()
    if 'sort_order' in data:
        try: cat.sort_order = int(data['sort_order'])
        except (TypeError, ValueError): pass
    db.session.commit()
    return jsonify({"success": True})


@village_bp.route('/api/village/map/places')
def api_village_map_places():
    myeon = request.args.get('myeon', '').strip()
    ri = request.args.get('ri', '').strip()
    approved = request.args.get('approved', '1') in ('1', 'true', 'True')
    q = VillagePlace.query
    if approved:
        q = q.filter(VillagePlace.status == 'approved')
    else:
        uid = session.get('user_id')
        if not uid or not has_page_access('village'):
            return jsonify({"error": "권한 없음"}), 403
        q = q.filter(VillagePlace.status.in_(['pending', 'rejected']))
    if myeon: q = q.filter(VillagePlace.myeon == myeon)
    if ri: q = q.filter(VillagePlace.ri == ri)
    places = q.order_by(VillagePlace.updated_at.desc()).all()
    out = []
    for p in places:
        out.append(_place_public(p))
    return jsonify({"places": out})


def _place_public(p):
    import json as _json
    try:
        media = _json.loads(p.media or '[]')
    except Exception:
        media = []
    sub = User.query.get(p.submitted_by) if p.submitted_by else None
    appr = User.query.get(p.approved_by) if p.approved_by else None
    cat = p.category
    return {
        "id": p.id, "myeon": p.myeon, "ri": p.ri,
        "category_id": p.category_id,
        "category": {
            "id": cat.id, "name": cat.name, "icon": cat.icon or '📍', "color": cat.color or '#6c757d'
        } if cat else None,
        "name": p.name, "address": p.address, "latitude": p.latitude, "longitude": p.longitude,
        "description": p.description, "story": p.story, "open_hr": p.open_hr,
        "tel": p.tel, "website": p.website, "media": media, "tags": p.tags,
        "status": p.status, "submitted_by": p.submitted_by,
        "submitted_name": (sub.real_name or sub.username) if sub else '',
        "approved_by": p.approved_by,
        "approved_name": (appr.real_name or appr.username) if appr else '',
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@village_bp.route('/api/village/map/places/<int:pid>')
def api_village_map_place_detail(pid):
    p = VillagePlace.query.get_or_404(pid)
    if p.status != 'approved':
        uid = session.get('user_id')
        if not uid or not has_page_access('village'):
            return jsonify({"error": "권한 없음"}), 403
    return jsonify(_place_public(p))


@village_bp.route('/api/village/map/places', methods=['POST'])
def api_village_map_places_create():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    try:
        lat = float(data.get('latitude'))
        lng = float(data.get('longitude'))
    except (TypeError, ValueError):
        lat = lng = None
    if not name or lat is None or lng is None:
        return jsonify({"error": "이름과 위치가 필요합니다."}), 400
    myeon = (data.get('myeon') or '').strip()
    ri = (data.get('ri') or '').strip()
    place = VillagePlace(
        myeon=myeon, ri=ri,
        category_id=data.get('category_id') or None,
        name=name,
        address=(data.get('address') or '').strip(),
        latitude=lat, longitude=lng,
        description=(data.get('description') or '').strip(),
        story=(data.get('story') or '').strip(),
        open_hr=(data.get('open_hr') or '').strip(),
        tel=(data.get('tel') or '').strip(),
        website=(data.get('website') or '').strip(),
        tags=(data.get('tags') or '').strip(),
        media=data.get('media') or '[]',
        status='pending',
        submitted_by=uid,
    )
    db.session.add(place)
    db.session.commit()
    return jsonify({"success": True, "id": place.id, "status": place.status, "msg": "제안이 접수되었습니다. 마을지기의 승인 후 공개됩니다."})


@village_bp.route('/api/village/map/places/<int:pid>', methods=['PUT'])
def api_village_map_places_update(pid):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    p = VillagePlace.query.get_or_404(pid)
    # 등록자 본인(미승인) 또는 마을지기
    can_edit = (p.submitted_by == uid and p.status == 'pending') or has_page_access('village')
    if not can_edit:
        return jsonify({"error": "수정 권한이 없습니다."}), 403
    data = request.get_json() or {}
    for field in ['name', 'address', 'description', 'story', 'open_hr', 'tel', 'website', 'tags']:
        if field in data:
            setattr(p, field, (data[field] or '').strip() if isinstance(data[field], str) else data[field])
    if 'category_id' in data:
        p.category_id = data['category_id'] or None
    if 'media' in data:
        import json as _json
        try:
            _json.loads(data['media'])
            p.media = data['media']
        except Exception:
            pass
    if 'latitude' in data and data['latitude'] is not None:
        try: p.latitude = float(data['latitude'])
        except (TypeError, ValueError): pass
    if 'longitude' in data and data['longitude'] is not None:
        try: p.longitude = float(data['longitude'])
        except (TypeError, ValueError): pass
    if has_page_access('village') and 'status' in data and data['status'] in ('pending', 'approved', 'rejected', 'closed'):
        p.status = data['status']
        if data['status'] in ('approved', 'rejected'):
            p.approved_by = uid
    db.session.commit()
    return jsonify({"success": True, "msg": "수정되었습니다."})


@village_bp.route('/api/village/map/places/<int:pid>/review', methods=['POST'])
def api_village_map_places_review(pid):
    if not has_page_access('village'):
        return jsonify({"error": "권한 없음"}), 403
    p = VillagePlace.query.get_or_404(pid)
    scopes = _village_scope()
    if not _scope_match(p.myeon, p.ri, scopes):
        return jsonify({"error": "담당 마을이 아닙니다."}), 403
    data = request.get_json() or {}
    action = data.get('action', '')
    if action not in ('approve', 'reject'):
        return jsonify({"error": "잘못된 처리입니다."}), 400
    p.status = 'approved' if action == 'approve' else 'rejected'
    p.approved_by = session.get('user_id')
    db.session.commit()
    return jsonify({"success": True, "status": p.status, "msg": "승인되었습니다." if action == 'approve' else "반려되었습니다."})


@village_bp.route('/api/village/map/places/<int:pid>', methods=['DELETE'])
def api_village_map_places_delete(pid):
    if not has_page_access('village'):
        return jsonify({"error": "권한 없음"}), 403
    p = VillagePlace.query.get_or_404(pid)
    scopes = _village_scope()
    if not _scope_match(p.myeon, p.ri, scopes):
        return jsonify({"error": "담당 마을이 아닙니다."}), 403
    db.session.delete(p)
    db.session.commit()
    return jsonify({"success": True, "msg": "삭제되었습니다."})


@village_bp.route('/api/village/map/pending')
def api_village_map_pending():
    if not has_page_access('village'):
        return jsonify({"error": "권한 없음"}), 403
    scopes = _village_scope()
    places = VillagePlace.query.filter(VillagePlace.status == 'pending').order_by(VillagePlace.created_at.asc()).all()
    out = [p for p in places if _scope_match(p.myeon, p.ri, scopes)]
    return jsonify({"pending": [_place_public(p) for p in out]})


@village_bp.route('/api/village/map/report/<int:pid>', methods=['POST'])
def api_village_map_place_report(pid):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    p = VillagePlace.query.get_or_404(pid)
    if p.status != 'approved':
        return jsonify({"error": "공개된 장소가 아닙니다."}), 400
    data = request.get_json() or {}
    report_type = data.get('report_type', '')
    comment = (data.get('comment') or '').strip()
    if report_type not in ('confirm', 'fix', 'flag', 'memo'):
        return jsonify({"error": "잘못된 보고 유형입니다."}), 400
    r = VillagePlaceReport(place_id=pid, user_id=uid, report_type=report_type, comment=comment)
    db.session.add(r)
    db.session.commit()
    return jsonify({"success": True, "msg": "보고가 접수되었습니다."})


@village_bp.route('/api/village/map/upload', methods=['POST'])
def api_village_map_upload():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    from services.security import secure_save, validate_upload
    import os as _os
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({"error": "파일이 없습니다."}), 400
    upload_dir = _os.path.join(current_app.config['UPLOAD_FOLDER'], 'village_map')
    _os.makedirs(upload_dir, exist_ok=True)
    # 동영상 허용 (mp4/webm/mov/m4v) — 자체 검증 (validate_upload는 이미지 전용)
    video_ext = ('.mp4', '.webm', '.mov', '.m4v')
    fname_lower = file.filename.lower()
    if fname_lower.endswith(video_ext):
        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > 100 * 1024 * 1024:
            return jsonify({"error": "동영상은 100MB 이하만 업로드할 수 있습니다."}), 400
        try:
            import uuid as _uuid
            from werkzeug.utils import secure_filename
            ext = fname_lower.rsplit('.', 1)[1]
            safe_name = f"{_uuid.uuid4().hex}.{ext}"
            save_path = _os.path.join(upload_dir, safe_name)
            file.seek(0)
            file.save(save_path)
            return jsonify({"success": True, "url": f"/static/uploads/village_map/{safe_name}", "type": "video"})
        except Exception as e:
            return jsonify({"error": f"동영상 업로드 실패: {e}"}), 500
    # 이미지 검증
    ok, msg = validate_upload(file)
    if not ok:
        return jsonify({"error": msg}), 400
    try:
        path = secure_save(file, upload_dir, max_mb=20)
        # FTP 백업 (이중저장)
        try:
            from services.security import ftp_backup
            _abs = _os.path.join(current_app.root_path, path.lstrip('/'))
            ftp_backup(_abs, 'village_map')
        except Exception:
            pass
        return jsonify({"success": True, "url": path, "type": "image"})
    except Exception as e:
        return jsonify({"error": f"이미지 업로드 실패: {e}"}), 500


# ============ 회의 채팅방 자료실 ============
@village_bp.route('/village/event/<int:event_id>/files', methods=['GET'])
def village_event_files(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    files = VillageEventFile.query.filter_by(event_id=event_id).order_by(VillageEventFile.created_at.desc()).all()
    ev = VillageEvent.query.get_or_404(event_id)
    return jsonify({
        'files': [{
            'id': f.id, 'filename': f.filename, 'uploader_name': f.uploader_name or '',
            'file_size': f.file_size or 0,
            'created_at': f.created_at.isoformat() if f.created_at else None,
        } for f in files],
        'can_upload': has_page_access('village') or _is_presenter(event_id, uid),
        'chat_open': _chat_open(ev),
    })

@village_bp.route('/village/event/<int:event_id>/files', methods=['POST'])
def village_event_file_upload(event_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error":"로그인 필요"}), 401
    if not (has_page_access('village') or _is_presenter(event_id, uid)):
        return jsonify({"error":"마을지기/발표자만 자료를 올릴 수 있습니다."}), 403
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({"error":"파일을 선택하세요."})
    import os as _os
    from services.security import secure_save
    save_dir = _os.path.join(current_app.root_path, 'static', 'uploads', 'village_event_files')
    try:
        url_path = secure_save(file, save_dir, max_mb=30)
        # FTP 백업 (이중저장)
        try:
            from services.security import ftp_backup
            _abs = _os.path.join(current_app.root_path, url_path.lstrip('/'))
            ftp_backup(_abs, 'village_event_files')
        except Exception:
            pass
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"업로드 실패: {e}"}), 500
    user = User.query.get(uid)
    f = VillageEventFile(
        event_id=event_id, uploader_id=uid,
        uploader_name=(user.real_name or user.username) if user else '',
        filename=file.filename, file_path=url_path,
        file_size=request.content_length or 0,
    )
    db.session.add(f)
    db.session.commit()
    return jsonify({"status":"success","id":f.id})

@village_bp.route('/village/event/<int:event_id>/files/<int:file_id>/download')
def village_event_file_download(event_id, file_id):
    if not session.get('user_id'):
        return jsonify({"error":"로그인 필요"}), 401
    f = VillageEventFile.query.get_or_404(file_id)
    if f.event_id != event_id:
        return jsonify({"error":"잘못된 요청"}), 400
    import os as _os
    local_path = _os.path.join(current_app.root_path, f.file_path.lstrip('/'))
    if _os.path.exists(local_path):
        return send_file(local_path, as_attachment=True, download_name=f.filename)
    #FTP 폴백: 서버 로컬에 없으면 FTP에서 가져오기
    try:
        from services.security import ftp_retrieve_file
        data = ftp_retrieve_file('village_event_files', _os.path.basename(f.file_path))
        if data:
            resp = send_file(data, as_attachment=True, download_name=f.filename)
            resp.headers['X-Content-Type-Options'] = 'nosniff'
            return resp
    except Exception:
        pass
    return jsonify({"error":"파일이 없습니다."}), 404
