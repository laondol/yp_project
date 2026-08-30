import os
from flask import Blueprint, request, jsonify, render_template, session, current_app, send_file
from models import db, Post, User, RampApplication, RampVolunteer, SiteSetting
from services.email_service import EmailService

service_bp = Blueprint('service', __name__)
from route_modules.user_bp import _cleanup_expired_posts

def _serve_spa():
    import os
    from flask import current_app, send_file
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    from flask import render_template
    return render_template('intro.html')

@service_bp.route('/go')
def go():
    url = request.args.get('url', '')
    title = request.args.get('title', '외부페이지')
    if not url:
        return "URL이 필요합니다.", 400
    from urllib.parse import quote
    back = request.args.get('back', request.headers.get('Referer', '/construction'))
    return _serve_spa()

# --- [소식 번역] ---
@service_bp.route('/api/news/translate')
def news_translate():
    url = request.args.get('url','')
    title = request.args.get('title','')
    if not url:
        return "<p>URL이 필요합니다.</p>"
    try:
        import requests as req
        r = req.get(url, headers={'User-Agent':'Mozilla/5.0'}, timeout=10)
        text = r.text[:3000]
        key = current_app.config.get('MOTIF_API_KEY','')
        if key:
            prompt = f"다음 웹페이지 내용을 한국어로 5문장 이내로 요약 번역하세요.\n\n제목: {title}\n내용: {text}"
            rr = req.post("https://chat.motiftech.io/openapi/v1/chat/completions",
                headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"},
                json={"model":"motif-12.7b","messages":[{"role":"user","content":prompt}],"max_tokens":500},
                timeout=20)
            if rr.status_code == 200:
                result = rr.json()["choices"][0]["message"]["content"]
                return f"<div style='padding:20px;font-size:0.9rem;line-height:1.8;'><h5>🌐 번역 요약</h5><a href='{url}' target='_blank' style='font-size:0.8rem;'>원문보기</a><hr>{result.replace(chr(10),'<br>')}</div>"
        return f"<p>번역을 불러올 수 없습니다. <a href='{url}' target='_blank'>원문보기</a></p>"
    except Exception as e:
        return f"<p>오류: {str(e)[:100]}</p>"

@service_bp.route('/service/legal')
def service_legal():
    return _serve_spa()

@service_bp.route('/service/legal/edit', methods=['GET', 'POST'])
def service_legal_edit():
    if session.get('role') not in ('admin', 'leader'):
        return "<script>alert('권한이 없습니다.'); history.back();</script>"
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        content = data.get('content', '')
        row = SiteSetting.query.get('service_legal_content')
        if row is None:
            row = SiteSetting(key='service_legal_content', value=content)
            db.session.add(row)
        else:
            row.value = content
        db.session.commit()
        return jsonify({"status": "success"})
    return _serve_spa()

@service_bp.route('/api/service/legal/content')
def api_service_legal_content():
    row = SiteSetting.query.get('service_legal_content')
    return jsonify({"content": row.value if row else ""})

@service_bp.route('/service/psycho')
def service_psycho():
    return _serve_spa()

@service_bp.route('/service/psycho/edit', methods=['GET', 'POST'])
def service_psycho_edit():
    if session.get('role') not in ('admin', 'leader') and 'psycho' not in (session.get('managed_pages', '')):
        return "<script>alert('권한이 없습니다.'); history.back();</script>"
    if request.method == 'POST':
        return "<script>alert('저장되었습니다.'); location.href='/service/psycho';</script>"
    return _serve_spa()

@service_bp.route('/service/ramp')
def service_ramp():
    _cleanup_expired_posts()
    uid = session.get('user_id')
    role = session.get('role')
    raw_posts = Post.query.filter(
        Post.title.contains('경사로') | Post.content.contains('경사로') | Post.content.contains('휠체어') | Post.title.contains('휠체어')
    ).order_by(Post.created_at.desc()).all()
    ramp_posts = [p for p in raw_posts if not (p.total_score <= -50 and p.user_id != uid and role not in ('admin', 'leader'))]
    waiting_count = RampApplication.query.filter_by(status='pending').count()
    # static/videos/ramp/ 폴더의 동영상 파일 목록
    ramp_videos = []
    video_dir = os.path.join(current_app.root_path, 'static', 'videos', 'ramp')
    if os.path.exists(video_dir):
        for f in sorted(os.listdir(video_dir), reverse=True):
            if f.lower().endswith(('.mp4', '.webm', '.mov', '.avi', '.mkv')):
                ramp_videos.append(f"/static/videos/ramp/{f}")
    return _serve_spa()

@service_bp.route('/service/ramp/apply', methods=['POST'])
def service_ramp_apply():
    open_row = SiteSetting.query.get('ramp_apply_open')
    if open_row is not None and open_row.value == 'false':
        return "<script>alert('현재 경사로 설치 신청을 받지 않고 있습니다.'); history.back();</script>"
    name = request.form['name']
    email = request.form['email']
    phone = request.form['phone']
    location = request.form['location']
    step_height = request.form['step_height']
    ownership = request.form['ownership']
    agree_removal = request.form.get('agree_removal') == 'on'
    agree_damage = request.form.get('agree_damage') == 'on'
    from datetime import datetime, timezone

    photo_path = None
    if 'photo' in request.files:
        file = request.files['photo']
        from services.security import validate_upload, secure_save
        ok, msg = validate_upload(file)
        if ok:
            try:
                target_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], 'ramp')
                if not os.path.exists(target_dir): os.makedirs(target_dir)
                photo_path = secure_save(file, target_dir)
            except Exception:
                pass

    appt = RampApplication(
        name=name, email=email, phone=phone, location=location,
        photo_path=photo_path, step_height=step_height,
        ownership=ownership, agree_removal=agree_removal,
        agree_damage=agree_damage, signed_at=datetime.now(),
        status='pending'
    )
    db.session.add(appt)
    db.session.commit()
    EmailService.send(email, "[함께사는양평] 경사로 설치 신청이 접수되었습니다",
        f"{name}님, 경사로 설치 신청이 접수되었습니다.\n\n접수 번호: {appt.id}번\n위치: {location}\n\n검토 후 연락드리겠습니다.\n\nhttps://unocum.kr")
    return "<script>alert('신청이 접수되었습니다. 검토 후 연락드립니다. (대기자 순번: " + str(appt.id) + "번)'); location.href='/service/ramp';</script>"


@service_bp.route('/service/ramp/apply-status')
def service_ramp_apply_status():
    return jsonify(_ramp_status())


@service_bp.route('/service/ramp/volunteer', methods=['POST'])
def service_ramp_volunteer():
    vol_row = SiteSetting.query.get('volunteer_apply_open')
    if vol_row is not None and vol_row.value == 'false':
        return jsonify({'status': 'error', 'msg': '현재 자원봉사 신청을 받지 않고 있습니다.'}), 400
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip()
    phone = (data.get('phone') or '').strip()
    if not name or not email:
        return jsonify({'status': 'error', 'msg': '이름과 이메일을 입력해주세요.'}), 400
    vol = RampVolunteer(name=name, email=email, phone=phone)
    db.session.add(vol)
    db.session.commit()
    return jsonify({'status': 'ok'})


@service_bp.route('/admin/ramp/apply-toggle', methods=['POST'])
def service_ramp_apply_toggle():
    if session.get('role') != 'leader':
        return jsonify({'status': 'error', 'msg': '권한이 없습니다.'}), 403
    data = request.get_json(silent=True) or {}
    section = data.get('section', 'ramp')
    open_val = 'true' if data.get('open') else 'false'
    key = 'volunteer_apply_open' if section == 'volunteer' else 'ramp_apply_open'
    row = SiteSetting.query.get(key)
    if row is None:
        row = SiteSetting(key=key, value=open_val)
        db.session.add(row)
    else:
        row.value = open_val
    db.session.commit()
    return jsonify(_ramp_status())


def _ramp_status():
    ramp = SiteSetting.query.get('ramp_apply_open')
    is_ramp = (ramp is None) or (ramp.value != 'false')
    vol = SiteSetting.query.get('volunteer_apply_open')
    is_vol = (vol is None) or (vol.value != 'false')
    return {
        'open': is_ramp,
        'volunteer_open': is_vol,
        'all_closed': (not is_ramp) and (not is_vol),
        'waiting': RampApplication.query.filter_by(status='pending').count(),
    }

