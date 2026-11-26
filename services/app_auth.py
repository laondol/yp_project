# services/app_auth.py - 모바일 앱 전용 JWT 발급/검증
# 웹 세션 쿠키와 완전히 분리한다. 토큰에는 이메일 등 개인식별정보를 넣지 않는다.
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

try:
    import jwt
except Exception:  # PyJWT 미설치 → 앱 토큰 기능만 비활성화 (서버 기동은 유지)
    jwt = None
from flask import current_app

_TOKEN_TYPE = 'app'
_ALG = 'HS256'


def jwt_secret():
    cfg = current_app.config
    raw = (cfg.get('APP_JWT_SECRET') or '').strip()
    if raw:
        return raw
    # 별도 키가 없으면 SECRET_KEY에서 용도 분리 파생 (키 원문을 그대로 쓰지 않음)
    base = (cfg.get('SECRET_KEY') or 'fallback_dev_key').encode('utf-8')
    return hmac.new(base, b'unocum-app-jwt-v1', hashlib.sha256).hexdigest()


def _need_jwt():
    if jwt is None:
        raise RuntimeError('PyJWT 미설치 — 앱 로그인 기능을 사용할 수 없습니다.')


def issue_token(user):
    """(token, expires_at) 반환. 만료 정책: 30일 단일 토큰(설정 가능)."""
    _need_jwt()
    days = int(current_app.config.get('APP_JWT_DAYS') or 30)
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=days)
    payload = {
        'sub': str(user.id),
        'typ': _TOKEN_TYPE,
        'iat': int(now.timestamp()),
        'exp': int(exp.timestamp()),
    }
    token = jwt.encode(payload, jwt_secret(), algorithm=_ALG)
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token, exp


def decode_token(token):
    _need_jwt()
    """유효하면 payload(dict), 아니면 None. 예외는 조용히 무시한다."""
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            jwt_secret(),
            algorithms=[_ALG],
            options={'require': ['exp', 'sub']},
        )
    except Exception:
        return None
    if payload.get('typ') != _TOKEN_TYPE:
        return None
    return payload


def bearer_token(req):
    raw = (req.headers.get('Authorization') or '').strip()
    if not raw.lower().startswith('bearer '):
        return None
    return raw[7:].strip() or None
