# services/app_push.py - 모바일 앱 푸시(APNs/FCM) 발송 유틸
# 자격증명이 없으면 조용히 건너뛴다(no-op). 토큰·좌표·이메일 원문은 로그에 남기지 않는다.
import json
import os
import threading
import time

import jwt
import requests

_FCM_TOKEN_CACHE = {'access_token': None, 'expires_at': 0}
_APNS_JWT_CACHE = {'token': None, 'issued_at': 0}
_LOG_LOCK = threading.Lock()
_LOGGED = set()


def _log_once(key, msg):
    with _LOG_LOCK:
        if key in _LOGGED:
            return
        _LOGGED.add(key)
    print(msg)


def _project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_json_setting(env_name):
    """env 값이 JSON 문자열이거나 파일 경로일 수 있다."""
    raw = (os.getenv(env_name) or '').strip()
    if not raw:
        return None
    if raw.startswith('{'):
        try:
            return json.loads(raw)
        except Exception:
            return None
    path = raw if os.path.isabs(raw) else os.path.join(_project_root(), raw)
    try:
        with open(path, 'r', encoding='utf-8') as fp:
            return json.load(fp)
    except Exception:
        return None


# ---------------------------------------------------------------- FCM (Android)
def _fcm_service_account():
    return _load_json_setting('FCM_SERVICE_ACCOUNT_JSON')


def _fcm_access_token(sa):
    now = time.time()
    if _FCM_TOKEN_CACHE['access_token'] and _FCM_TOKEN_CACHE['expires_at'] > now + 60:
        return _FCM_TOKEN_CACHE['access_token']
    token_uri = sa.get('token_uri') or 'https://oauth2.googleapis.com/token'
    assertion = jwt.encode(
        {
            'iss': sa.get('client_email'),
            'scope': 'https://www.googleapis.com/auth/firebase.messaging',
            'aud': token_uri,
            'iat': int(now),
            'exp': int(now) + 3600,
        },
        sa.get('private_key'),
        algorithm='RS256',
    )
    try:
        resp = requests.post(
            token_uri,
            data={
                'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion': assertion,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
    except Exception:
        return None
    access = data.get('access_token')
    if not access:
        return None
    _FCM_TOKEN_CACHE['access_token'] = access
    _FCM_TOKEN_CACHE['expires_at'] = now + int(data.get('expires_in') or 3000)
    return access


def send_fcm(push_token, title, body, data=None):
    """returns: sent | invalid | failed | skipped"""
    sa = _fcm_service_account()
    if not sa or not sa.get('project_id') or not sa.get('client_email'):
        _log_once('fcm_config', '[APP_PUSH] FCM service account not configured - skip')
        return 'skipped'
    access = _fcm_access_token(sa)
    if not access:
        return 'failed'
    url = 'https://fcm.googleapis.com/v1/projects/%s/messages:send' % sa['project_id']
    msg_data = {str(k): str(v) for k, v in (data or {}).items()}
    payload = {
        'message': {
            'token': push_token,
            'notification': {'title': title or '', 'body': body or ''},
            'data': msg_data,
            'android': {'priority': 'high'},
        }
    }
    try:
        resp = requests.post(
            url,
            headers={'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'},
            json=payload,
            timeout=10,
        )
    except Exception:
        return 'failed'
    if resp.status_code == 200:
        return 'sent'
    try:
        err = (resp.json().get('error') or {})
        details = err.get('details') or []
        for d in details:
            if (d.get('errorCode') or '') in ('UNREGISTERED', 'INVALID_ARGUMENT'):
                return 'invalid'
        if err.get('status') in ('NOT_FOUND', 'INVALID_ARGUMENT'):
            return 'invalid'
    except Exception:
        pass
    return 'failed'


# ---------------------------------------------------------------- APNs (iOS)
def _apns_settings():
    key_id = (os.getenv('APNS_KEY_ID') or '').strip()
    team_id = (os.getenv('APNS_TEAM_ID') or '').strip()
    topic = (os.getenv('APNS_TOPIC') or os.getenv('APP_APNS_TOPIC') or '').strip()
    raw_key = (os.getenv('APNS_AUTH_KEY') or '').strip()
    if not raw_key:
        path = (os.getenv('APNS_KEY_PATH') or '').strip()
        if path:
            try:
                full = path if os.path.isabs(path) else os.path.join(_project_root(), path)
                with open(full, 'r', encoding='utf-8') as fp:
                    raw_key = fp.read()
            except Exception:
                raw_key = ''
    if not (key_id and team_id and topic and raw_key):
        return None
    return {
        'key_id': key_id,
        'team_id': team_id,
        'topic': topic,
        'key': raw_key,
        'sandbox': (os.getenv('APNS_USE_SANDBOX', 'false').lower() == 'true'),
    }


def _apns_provider_token(cfg):
    now = time.time()
    if _APNS_JWT_CACHE['token'] and (now - _APNS_JWT_CACHE['issued_at']) < 3000:
        return _APNS_JWT_CACHE['token']
    try:
        token = jwt.encode(
            {'iss': cfg['team_id'], 'iat': int(now)},
            cfg['key'],
            algorithm='ES256',
            headers={'kid': cfg['key_id']},
        )
    except Exception:
        return None
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    _APNS_JWT_CACHE['token'] = token
    _APNS_JWT_CACHE['issued_at'] = now
    return token


def send_apns(push_token, title, body, data=None):
    """returns: sent | invalid | failed | skipped"""
    cfg = _apns_settings()
    if not cfg:
        _log_once('apns_config', '[APP_PUSH] APNs key not configured - skip')
        return 'skipped'
    provider = _apns_provider_token(cfg)
    if not provider:
        return 'failed'
    try:
        import httpx  # httpx[http2] 필요
    except Exception:
        _log_once('apns_httpx', '[APP_PUSH] httpx[http2] not installed - APNs disabled')
        return 'skipped'
    host = 'https://api.sandbox.push.apple.com' if cfg['sandbox'] else 'https://api.push.apple.com'
    url = host + '/3/device/' + push_token
    payload = {
        'aps': {
            'alert': {'title': title or '', 'body': body or ''},
            'sound': 'default',
            'interruption-level': 'time-sensitive',
        }
    }
    if data:
        payload.update({str(k): v for k, v in data.items()})
    headers = {
        'authorization': 'bearer ' + provider,
        'apns-topic': cfg['topic'],
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
    }
    try:
        with httpx.Client(http2=True, timeout=10) as client:
            resp = client.post(url, headers=headers, content=json.dumps(payload))
    except Exception:
        return 'failed'
    if resp.status_code == 200:
        return 'sent'
    try:
        reason = (resp.json() or {}).get('reason')
    except Exception:
        reason = None
    if resp.status_code == 410 or reason in ('BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'):
        return 'invalid'
    return 'failed'


# ---------------------------------------------------------------- public helper
def send_to_user(user_id, title, body, data=None):
    """사용자의 등록된 모든 기기로 발송. 무효 토큰은 행을 제거한다."""
    from models import db, AppDevice

    stats = {'sent': 0, 'invalid': 0, 'failed': 0, 'skipped': 0}
    devices = AppDevice.query.filter_by(user_id=user_id).all()
    dirty = False
    for dev in devices:
        if dev.platform == 'ios':
            result = send_apns(dev.push_token, title, body, data)
        else:
            result = send_fcm(dev.push_token, title, body, data)
        stats[result] = stats.get(result, 0) + 1
        if result == 'invalid':
            db.session.delete(dev)
            dirty = True
    if dirty:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
    return stats
