import os
from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, current_app, send_file
from models import db, LegalPost, User, Message, LawyerSchedule, LegalAppointment, TongBotSchedule, BlockedEmail
from route_modules.common import is_privileged_viewer, mask_name, mask_title, mask_post_item, masked_email, is_legal_manager, LEGAL_MANAGER_EMAIL

legal_bp = Blueprint('legal', __name__)

def _serve_spa():
    import os
    from flask import current_app, send_file
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    from flask import render_template
    return render_template('intro.html')

@legal_bp.route('/legal/list')
def legal_list():
    return _serve_spa()

@legal_bp.route('/legal/issues')
def legal_issues():
    posts = LegalPost.query.filter(LegalPost.password == '', LegalPost.labor_approved == True).order_by(LegalPost.created_at.desc()).limit(30).all()
    return _serve_spa()

@legal_bp.route('/legal/issues/write', methods=['GET','POST'])
def legal_issues_write():
    if not is_legal_manager():
        return "<script>alert('노동이슈 작성 권한이 없습니다.'); history.back();</script>"
    if request.method == 'POST':
        title = request.form['title']
        content = request.form.get('content','').strip()
        # AI로 노동 관련 내용 가져오기
        if not content:
            keyword = request.form.get('keyword', title)
            try:
                from openai import OpenAI
                client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=current_app.config.get('GROQ_API_KEY',''))
                resp = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=[{"role":"system","content":"한국의 최신 노동 관련 이슈에 대해 500자 내외로 정리해줘. 마크다운 없이 일반 텍스트로."},
                              {"role":"user","content":keyword}],
                    temperature=0.5, max_tokens=600
                )
                content = resp.choices[0].message.content
            except Exception as e:
                content = f'AI 콘텐츠 생성 실패: {e}'
        post = LegalPost(title=title, content=content, email=session.get('email',''),
                       author_name=session.get('real_name') or session.get('username','이훈노무사'),
                       user_id=session.get('user_id'), password='', labor_approved=True)
        db.session.add(post)
        db.session.commit()
        return redirect(url_for('.'))
    return _serve_spa()

@legal_bp.route('/legal/issues/<int:post_id>')
def legal_issue_detail(post_id):
    post = LegalPost.query.get_or_404(post_id)
    return _serve_spa()

@legal_bp.route('/legal/issues/comment/<int:post_id>', methods=['POST'])
def legal_issue_comment(post_id):
    content = request.form.get('content','').strip()
    if not content:
        return redirect(url_for('legal_issue_detail', post_id=post_id))
    from services.ai_service import moderate_comment
    ok, reason = moderate_comment(content)
    if not ok:
        return f"<script>alert('{reason}'); history.back();</script>"
    post = LegalPost.query.get_or_404(post_id)
    comments = post.comments or ''
    name = session.get('real_name') or session.get('username','익명')
    comments += f'\n[{name}] {content} ({datetime.now(timezone.utc).strftime("%m/%d %H:%M")})'
    post.comments = comments
    db.session.commit()
    from services.email_service import EmailService
    EmailService.send('daerilee@gmail.com', f'[노동이슈 댓글] {post.title}',
        f'작성자: {name}\n내용: {content}\n게시글: {post.title}')
    return redirect(url_for('legal_issue_detail', post_id=post_id))

@legal_bp.route('/legal/issues/admin')
def legal_issues_admin():
    if session.get('role') not in ['admin', 'leader']:
        return "권한 없음", 403
    posts = LegalPost.query.filter(LegalPost.password == '').order_by(LegalPost.created_at.desc()).limit(50).all()
    return _serve_spa()

@legal_bp.route('/legal/issues/ai-suggest', methods=['POST'])
def legal_issues_ai_suggest():
    if not is_legal_manager():
        return jsonify({"error":"권한 없음"}), 403
    count = 0
    try:
        import requests as req_lib
        naver_id = current_app.config.get('NAVER_SEARCH_CLIENT_ID','')
        naver_secret = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET','')
        if naver_id and naver_secret:
            # 여러 키워드로 검색
            keywords = ['노동법', '임금체불', '부당해고', '노동위원회']
            all_items = []
            for kw in keywords:
                try:
                    resp = req_lib.get('https://openapi.naver.com/v1/search/news.json',
                        headers={'X-Naver-Client-Id':naver_id,'X-Naver-Client-Secret':naver_secret},
                        params={'query':kw,'display':5,'sort':'date'}, timeout=10)
                    items = resp.json().get('items',[])
                    all_items.extend(items)
                except:
                    pass
            # 중복 제거 (link 기준)
            seen_links = set()
            unique_items = []
            for item in all_items:
                link = item.get('link','')
                if link not in seen_links:
                    seen_links.add(link)
                    unique_items.append(item)
            # 최대 10개
            for item in unique_items[:10]:
                title = item.get('title','').replace('<b>','').replace('</b>','')
                desc = item.get('description','').replace('<b>','').replace('</b>','')
                link = item.get('link','')
                content = f'{desc}\n\n<a href="{link}" target="_blank">원문보기</a>'
                post = LegalPost(title=title, content=content, email=session.get('email',''),
                                author_name=session.get('real_name','이훈노무사'),
                                user_id=session.get('user_id'), password='', labor_approved=False)
                db.session.add(post)
                count += 1
            db.session.commit()
            if count == 0:
                return jsonify({"status":"error","error":"검색 결과를 찾지 못했습니다."})
        else:
            # Naver API 없는 경우 AI로 대체
            from openai import OpenAI
            client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=current_app.config.get('GROQ_API_KEY',''))
            resp = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role":"system","content":"한국 최신 노동 이슈 10개. JSON: [{\"title\":\"...\",\"content\":\"...\"}]"},
                          {"role":"user","content":"노동법 임금체불 부당해고"}],
                temperature=0.7, max_tokens=2000
            )
            import json as _json
            items = _json.loads(resp.choices[0].message.content)
            for item in items:
                post = LegalPost(title=item['title'], content=item['content'], email=session.get('email',''),
                                author_name=session.get('real_name','이훈노무사'),
                                user_id=session.get('user_id'), password='', labor_approved=False)
                db.session.add(post)
                count += 1
            db.session.commit()
            if count == 0:
                return jsonify({"status":"error","error":"AI 생성 결과를 찾지 못했습니다."})
    except Exception as e:
        return jsonify({"status":"error","error":f"오류: {str(e)[:80]}"})
    return jsonify({"status":"success","count":count})

@legal_bp.route('/legal/issues/import-url', methods=['POST'])
def legal_issues_import_url():
    if not is_legal_manager():
        return jsonify({"error":"권한 없음"}), 403
    url = request.form.get('url','').strip()
    if not url:
        return jsonify({"error":"URL 필요"})
    try:
        import requests as req_lib
        from bs4 import BeautifulSoup
        resp = req_lib.get(url, headers={'User-Agent':'Mozilla/5.0'}, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        title = soup.title.string if soup.title else url[:50]
        # 본문 추출 시도
        body = ''
        for p in soup.find_all('p')[:10]:
            if len(p.get_text(strip=True)) > 20:
                body += p.get_text(strip=True) + '\n'
        content = body[:2000] or title
    except Exception as e:
        title, content = url[:50], f'URL 가져오기 실패: {e}'
    post = LegalPost(title=title, content=content, email=session.get('email',''),
                    author_name=session.get('real_name','이훈노무사'),
                    user_id=session.get('user_id'), password='', labor_approved=False)
    db.session.add(post)
    db.session.commit()
    return jsonify({"status":"success","id":post.id})

@legal_bp.route('/legal/issues/toggle/<int:post_id>', methods=['POST'])
def legal_issues_toggle(post_id):
    if not is_legal_manager():
        return jsonify({"error":"권한 없음"}), 403
    post = LegalPost.query.get_or_404(post_id)
    post.labor_approved = not post.labor_approved
    db.session.commit()
    return jsonify({"status":"success","approved":post.labor_approved})

@legal_bp.route('/legal/schedule')
def legal_schedule():
    return _serve_spa()

# --- API endpoints ---

@legal_bp.route('/api/legal/posts')
def api_legal_posts():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    posts = LegalPost.query.order_by(LegalPost.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    items = []
    for p in posts.items:
        d = {
            'id': p.id, 'title': p.title, 'author_name': p.author_name,
            'status': p.status, 'is_public': p.is_public,
            'answer': p.answer, 'created_at': p.created_at.isoformat() if p.created_at else None,
            'answered_at': p.answered_at.isoformat() if p.answered_at else None,
            'has_attachment': bool(p.file_path),
        }
        if not is_privileged_viewer(p.user_id, 'legal'):
            d['title'] = mask_title(p.title, keep=0.4)
            d['answer'] = ''
            d['can_view_content'] = False
        items.append(d)
    return jsonify(items)

@legal_bp.route('/api/legal/post/<int:post_id>')
def api_legal_post(post_id):
    post = LegalPost.query.get_or_404(post_id)
    if not is_privileged_viewer(post.user_id, 'legal'):
        return jsonify({
            'id': post.id, 'title': mask_title(post.title, keep=0.4), 'content': '',
            'author_name': post.author_name, 'email': masked_email(post.email),
            'answer': '', 'comments': '', 'status': post.status,
        'has_attachment': bool(post.file_path),
            'is_public': post.is_public, 'fee': post.fee,
            'created_at': post.created_at.isoformat() if post.created_at else None,
            'answered_at': post.answered_at.isoformat() if post.answered_at else None,
            'can_view_content': False,
        })
    return jsonify({
        'id': post.id, 'user_id': post.user_id, 'title': post.title, 'content': post.content,
        'author_name': post.author_name, 'answer': post.answer,
        'comments': post.comments, 'status': post.status,
        'file_path': post.file_path,
        'is_public': post.is_public, 'fee': post.fee,
        'created_at': post.created_at.isoformat() if post.created_at else None,
        'answered_at': post.answered_at.isoformat() if post.answered_at else None,
    })

@legal_bp.route('/api/legal/appointments')
def api_legal_appointments():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'login'}), 401
    appts = LegalAppointment.query.filter_by(user_id=uid).order_by(LegalAppointment.date.desc()).limit(20).all()
    return jsonify([{
        'id': a.id, 'name': a.name, 'date': a.date.isoformat() if a.date else None,
        'time_slot': a.time_slot, 'status': a.status, 'location': a.location,
    } for a in appts])

@legal_bp.route('/api/legal/appointments/all')
def api_legal_appointments_all():
    if not is_legal_manager():
        return jsonify({'error': 'forbidden'}), 403
    appts = LegalAppointment.query.order_by(LegalAppointment.date.desc()).limit(100).all()
    return jsonify([{
        'id': a.id, 'name': a.name, 'email': a.email, 'phone': a.phone,
        'date': a.date.isoformat() if a.date else None, 'time_slot': a.time_slot,
        'location': a.location, 'status': a.status, 'content': a.content,
    } for a in appts])


@legal_bp.route('/api/legal/create', methods=['POST'])
def api_legal_create():
    title = request.form.get('title', '').strip()
    content = request.form.get('content', '').strip()
    if not title or not content:
        return jsonify({'status': 'error', 'msg': '제목과 내용을 입력하세요.'})
    uid = session.get('user_id')
    email = request.form.get('email', '').strip()
    if uid:
        _u = User.query.get(uid)
        if _u and _u.email:
            email = _u.email
    else:
        if not (session.get('email_verified_for_legal') and session.get('verify_email')):
            return jsonify({'status': 'error', 'msg': '이메일 인증을 먼저 완료해 주세요.'})
        email = session.get('verify_email')
    post = LegalPost(
        title=title, content=content,
        author_name=request.form.get('author_name', '익명'),
        email=email,
        password=request.form.get('password', ''),
        user_id=uid,
    )
    if request.files.get('attachment'):
        try:
            from services.file_service import save_upload
            path = save_upload(request.files['attachment'], subdir='legal')
            if path:
                post.file_path = path
        except Exception as _e:
            current_app.logger.warning(f'legal attachment save failed: {_e}')
    db.session.add(post)
    db.session.commit()
    _notify_legal_new_post(post)
    return jsonify({'status': 'success', 'id': post.id})

@legal_bp.route('/api/legal/post/<int:post_id>/comment', methods=['POST'])
def api_legal_comment(post_id):
    if not is_legal_manager():
        return jsonify({'status': 'error', 'msg': '권한 없음'}), 403
    content = request.form.get('content', '').strip()
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력하세요.'})
    post = LegalPost.query.get_or_404(post_id)
    comments = post.comments or ''
    name = session.get('real_name') or session.get('username', '익명')
    from datetime import datetime, timezone
    comments += f'\n[{name}] {content} ({datetime.now(timezone.utc).strftime("%m/%d %H:%M")})'
    post.comments = comments
    db.session.commit()
    return jsonify({'status': 'success'})

@legal_bp.route('/api/legal/schedules')
def api_legal_schedules():
    from datetime import date, timedelta
    schedule_rows = LawyerSchedule.query.filter_by(is_available=True).all()
    available_day_ids = {s.day_of_week for s in schedule_rows}
    booked = db.session.query(LegalAppointment.date).filter(LegalAppointment.status.in_(['pending', 'approved'])).distinct().all()
    booked_dates = {b[0] for b in booked}
    available_dates = []
    today = date.today()
    for i in range(2, 62):
        d = today + timedelta(days=i)
        if d.weekday() in available_day_ids and d not in booked_dates:
            available_dates.append(d.isoformat())
    all_slots = []
    for s in schedule_rows:
        for h in range(s.start_hour, s.end_hour, s.slot_hours):
            all_slots.append({"start": f"{h:02d}:00", "end": f"{h+s.slot_hours:02d}:00"})
    return jsonify({'available_dates': available_dates, 'time_slots': all_slots})


def _schedule_time_conflict(user_id, appt_date, time_slot):
    if not user_id:
        return False
    parts = (time_slot or '').split('-')
    if len(parts) != 2:
        return False
    try:
        sh, sm = (int(x) for x in parts[0].split(':'))
        eh, em = (int(x) for x in parts[1].split(':'))
    except ValueError:
        return False
    from datetime import datetime
    slot_start = datetime(appt_date.year, appt_date.month, appt_date.day, sh, sm)
    slot_end = datetime(appt_date.year, appt_date.month, appt_date.day, eh, em)
    items = TongBotSchedule.query.filter(
        TongBotSchedule.user_id == user_id,
        db.func.date(TongBotSchedule.event_date) == appt_date
    ).all()
    for it in items:
        if it.is_allday:
            return True
        ev_start = it.event_date.replace(tzinfo=None) if it.event_date else None
        ev_end = (it.end_date or it.event_date).replace(tzinfo=None)
        if ev_start and slot_start < ev_end and slot_end > ev_start:
            return True
    return False


@legal_bp.route('/legal/appointment/book', methods=['POST'])
def legal_appointment_book():
    name = request.form.get('name', '').strip()
    email = request.form.get('email', '').strip()
    if not name or not email:
        return jsonify({'status': 'error', 'msg': '이름과 이메일을 입력하세요.'})
    if BlockedEmail.query.filter_by(email=email).first():
        return jsonify({'status': 'error', 'msg': '이 이메일은 예약이 제한되었습니다.'})
    phone = request.form.get('phone', '')
    date_str = request.form.get('date', '').strip()
    time_slot = request.form.get('time_slot', '').strip()
    if not date_str or not time_slot:
        return jsonify({'status': 'error', 'msg': '날짜와 시간대를 선택하세요.'})
    from datetime import date, timedelta
    try:
        appt_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'status': 'error', 'msg': '날짜 형식이 올바르지 않습니다.'})
    if appt_date <= date.today() + timedelta(days=1):
        return jsonify({'status': 'error', 'msg': '이틀 후부터 예약 가능합니다.'})
    counselor = User.query.filter_by(email='daerilee@gmail.com').first()
    if counselor and _schedule_time_conflict(counselor.id, appt_date, time_slot):
        return jsonify({'status': 'error', 'msg': '상담사의 개인 일정과 겹칩니다. 다른 시간대를 선택해 주세요.'})
    uid = session.get('user_id')
    location_parts = [request.form.get('location', ''), request.form.get('location_detail', '')]
    location = ' '.join(p for p in location_parts if p)
    content = request.form.get('content', '')
    appt = LegalAppointment(
        user_id=uid, name=name, email=email, phone=phone,
        date=appt_date, time_slot=time_slot, location=location, content=content
    )
    db.session.add(appt)
    db.session.commit()
    _notify_legal_appointment(appt, name, email, phone, date_str, time_slot, location, content)
    return jsonify({'status': 'success', 'id': appt.id})

@legal_bp.route('/api/legal/issues')
def api_legal_issues():
    from models import LaborNewsArticle
    posts = LegalPost.query.filter(LegalPost.password == '', LegalPost.labor_approved == True).order_by(LegalPost.created_at.desc()).limit(30).all()
    news = LaborNewsArticle.query.filter(LaborNewsArticle.is_selected == True).order_by(LaborNewsArticle.created_at.desc()).limit(20).all()
    post_items = [{
        'id': p.id, 'title': p.title, 'content': (p.content or '')[:200],
        'author_name': p.author_name, 'comments_count': len(p.comments.split('\n')) if p.comments else 0,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'type': 'post',
    } for p in posts]
    items = post_items + [{
        'id': n.id, 'title': n.title, 'summary': n.summary or '',
        'content': n.content or '', 'source_url': n.source_url or '',
        'author_name': n.source_name or '뉴스',
        'comment_count': 0,
        'created_at': n.created_at.isoformat() if n.created_at else None,
        'type': 'news',
    } for n in news]
    items.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    return jsonify(items[:50])

@legal_bp.route('/api/legal/issue/<int:post_id>')
def api_legal_issue(post_id):
    post = LegalPost.query.get_or_404(post_id)
    comments = []
    if post.comments:
        for line in post.comments.split('\n'):
            line = line.strip()
            if line:
                comments.append({'text': line})
    is_labor = (post.password == '' and post.labor_approved)
    if not is_labor and not is_privileged_viewer(post.user_id, 'legal'):
        return jsonify({
            'id': post.id, 'title': mask_title(post.title, keep=0.4), 'content': '',
            'author_name': post.author_name, 'email': masked_email(post.email),
            'comments': [], 'can_view_content': False,
            'created_at': post.created_at.isoformat() if post.created_at else None,
        })
    return jsonify({
        'id': post.id, 'user_id': post.user_id, 'title': post.title, 'content': post.content,
        'author_name': post.author_name, 'email': masked_email(post.email),
        'comments': comments,
        'created_at': post.created_at.isoformat() if post.created_at else None,
    })

@legal_bp.route('/api/legal/issues/write', methods=['POST'])
def api_legal_issues_write():
    if not is_legal_manager():
        return jsonify({'status': 'error', 'msg': '권한 없음'}), 403
    data = request.form
    title = data.get('title', '')
    content = data.get('content', '').strip()
    if not content:
        keyword = data.get('keyword', title)
        from services.ai_service import call_groq
        prompt = f"다음 주제에 대한 노동법률 정보를 한국어로 500자 내외로 작성해주세요: {keyword}"
        content = call_groq(prompt) or '내용 생성 실패'
    post = LegalPost(title=title, content=content, email=session.get('email', ''),
                   author_name=session.get('real_name') or session.get('username', '이훈노무사'),
                   user_id=session.get('user_id'), password='', labor_approved=True)
    db.session.add(post)
    db.session.commit()
    return jsonify({'status': 'success', 'id': post.id})

@legal_bp.route('/api/legal/issues/comment/<int:post_id>', methods=['POST'])
def api_legal_issue_comment(post_id):
    post = LegalPost.query.get_or_404(post_id)
    content = request.form.get('content', '').strip()
    if not content:
        return jsonify({'status': 'error', 'msg': '내용을 입력해주세요.'}), 400
    from services.ai_service import moderate_comment
    moderate_comment(content)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime('%m/%d %H:%M')
    name = session.get('real_name') or session.get('username', '익명')
    entry = f'[{name}] {content} ({now})'
    post.comments = (post.comments or '') + '\n' + entry
    db.session.commit()
    return jsonify({'status': 'success'})

# --- [심리상담소] ---



def _system_sender_id():
    su = User.query.filter(User.role.in_(['admin', 'leader'])).first() or User.query.first()
    return su.id if su else 1

def _delete_upload(rel_path):
    if not rel_path:
        return
    try:
        p = os.path.join(current_app.root_path, rel_path.lstrip('/'))
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        pass


def _notify_legal_new_post(post):
    from services.email_service import EmailService
    manager = User.query.filter_by(email=LEGAL_MANAGER_EMAIL).first()
    view_link = f"{request.host_url}legal/{post.id}"
    edit_link = f"{request.host_url}legal/edit/{post.id}"
    view_link_rel = f"/legal/{post.id}"
    edit_link_rel = f"/legal/edit/{post.id}"
    body = f"새 법률상담 글 등록\n제목: {post.title}\n작성자: {post.author_name}\n이메일: {post.email}\n내용: {(post.content or '')[:500]}"
    if manager:
        try:
            EmailService.send(manager.email, f'[법률상담 글 등록] {post.title}', body)
        except Exception:
            pass
        try:
            db.session.add(Message(
                sender_id=post.user_id or _system_sender_id(),
                sender_name=post.author_name or '익명',
                receiver_id=manager.id,
                subject=f'[법률상담 글 등록] {post.title}',
                content=body + f"\n\n관리자 확인 링크: {view_link_rel}", letter_type='private'))
            db.session.commit()
        except Exception:
            pass
    if post.user_id:
        try:
            db.session.add(Message(
                sender_id=manager.id if manager else _system_sender_id(),
                sender_name=manager.real_name if (manager and manager.real_name) else '양평마을',
                receiver_id=post.user_id,
                subject='[법률상담] 글 접수되었습니다',
                content=f"{post.author_name}님, 법률상담 글이 접수되었습니다.\n제목: {post.title}\n수정 링크: {edit_link_rel}",
                letter_type='private'))
            db.session.commit()
        except Exception:
            pass
    else:
        try:
            EmailService.send(post.email, '[법률상담] 글 접수되었습니다',
                f"{post.author_name}님, 법률상담 글이 접수되었습니다.\n제목: {post.title}\n확인 링크: {link}")
        except Exception:
            pass


def _notify_legal_appointment(appt, name, email, phone, date_str, time_slot, location, content):
    from services.email_service import EmailService
    manager = User.query.filter_by(email=LEGAL_MANAGER_EMAIL).first()
    view_link = f"{request.host_url}legal/schedule"
    edit_link = f"{request.host_url}legal/appointment/edit/{appt.id}"
    view_link_rel = f"/legal/schedule"
    edit_link_rel = f"/legal/appointment/edit/{appt.id}"
    body = f"새 법률상담 예약\n신청자: {name}\n이메일: {email}\n연락처: {phone}\n날짜: {date_str} {time_slot}\n장소: {location}\n내용: {content}"
    if manager:
        try:
            EmailService.send(manager.email, f'[법률상담 예약] {name}', body)
        except Exception:
            pass
        try:
            db.session.add(Message(
                sender_id=appt.user_id or _system_sender_id(),
                sender_name=name or '익명',
                receiver_id=manager.id,
                subject=f'[법률상담 예약] {name}',
                content=body + f"\n\n관리자 확인 링크: {view_link_rel}", letter_type='private'))
            db.session.commit()
        except Exception:
            pass
    if appt.user_id:
        try:
            db.session.add(Message(
                sender_id=manager.id if manager else _system_sender_id(),
                sender_name=manager.real_name if (manager and manager.real_name) else '양평마을',
                receiver_id=appt.user_id,
                subject='[법률상담 예약] 접수되었습니다',
                content=f'{name}님, 법률상담 예약이 접수되었습니다.\n날짜: {date_str} {time_slot}\n수정 링크: {edit_link_rel}',
                letter_type='private'))
            db.session.commit()
        except Exception:
            pass
    else:
        try:
            EmailService.send(email, '[법률상담 예약] 접수되었습니다',
                f'{name}님, 법률상담 예약이 접수되었습니다.\n날짜: {date_str} {time_slot}\n확인 링크: {link}')
        except Exception:
            pass


@legal_bp.route('/legal/post/<int:post_id>/edit', methods=['GET', 'POST'])
def legal_post_edit(post_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    post = LegalPost.query.get_or_404(post_id)
    if post.user_id != uid:
        return jsonify({'status': 'error', 'msg': '권한이 없습니다.'}), 403
    if post.status == 'approved':
        return jsonify({'status': 'error', 'msg': '관리자 확인 후에는 수정할 수 없습니다.'}), 403
    if request.method == 'POST':
        post.title = request.form.get('title', post.title)
        post.content = request.form.get('content', post.content)
        post.author_name = request.form.get('author_name', post.author_name)
        if request.form.get('remove_attachment') in ('1', 'true', 'on', 'yes'):
            if post.file_path:
                _delete_upload(post.file_path)
            post.file_path = None
        f = request.files.get('attachment')
        if f and f.filename:
            try:
                from services.file_service import save_upload
                if post.file_path:
                    _delete_upload(post.file_path)
                post.file_path = save_upload(f, 'legal')
            except Exception as _e:
                current_app.logger.warning(f'legal edit attachment save failed: {_e}')
        db.session.commit()
        return jsonify({'status': 'success', 'file_path': post.file_path})
    return jsonify({'id': post.id, 'user_id': post.user_id, 'title': post.title, 'content': post.content, 'author_name': post.author_name, 'status': post.status, 'file_path': post.file_path})


@legal_bp.route('/legal/post/<int:post_id>/confirm', methods=['POST'])
def legal_post_confirm(post_id):
    if not is_legal_manager():
        return jsonify({'status': 'error', 'msg': '권한이 없습니다.'}), 403
    post = LegalPost.query.get_or_404(post_id)
    post.status = 'approved'
    db.session.commit()
    return jsonify({'status': 'success'})


@legal_bp.route('/legal/appointment/<int:appt_id>/edit', methods=['GET', 'POST'])
def legal_appointment_edit(appt_id):
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'msg': '로그인이 필요합니다.'}), 401
    appt = LegalAppointment.query.get_or_404(appt_id)
    if appt.user_id != uid:
        return jsonify({'status': 'error', 'msg': '권한이 없습니다.'}), 403
    if appt.status == 'approved':
        return jsonify({'status': 'error', 'msg': '확정된 예약은 수정할 수 없습니다.'}), 403
    if request.method == 'POST':
        from datetime import date as _date
        appt.name = request.form.get('name', appt.name)
        appt.email = request.form.get('email', appt.email)
        appt.phone = request.form.get('phone', appt.phone)
        _d = request.form.get('date')
        if _d:
            try:
                appt.date = _date.fromisoformat(_d)
            except ValueError:
                pass
        appt.time_slot = request.form.get('time_slot', appt.time_slot)
        appt.location = request.form.get('location', appt.location)
        appt.content = request.form.get('content', appt.content)
        db.session.commit()
        return jsonify({'status': 'success'})
    return jsonify({
        'id': appt.id, 'user_id': appt.user_id, 'name': appt.name, 'email': appt.email, 'phone': appt.phone,
        'date': appt.date.isoformat() if appt.date else None, 'time_slot': appt.time_slot,
        'location': appt.location, 'content': appt.content, 'status': appt.status,
    })


@legal_bp.route('/legal/appointment/<int:appt_id>/approve', methods=['POST'])
def legal_appointment_approve(appt_id):
    from datetime import datetime, timezone
    if not is_legal_manager():
        return jsonify({'status': 'error', 'msg': '권한이 없습니다.'}), 403
    appt = LegalAppointment.query.get_or_404(appt_id)
    appt.status = 'approved'
    appt.approved_at = datetime.now(timezone.utc)
    appt.approved_by = session.get('user_id')
    db.session.commit()
    return jsonify({'status': 'success'})
