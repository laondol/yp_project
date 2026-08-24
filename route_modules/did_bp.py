from flask import Blueprint, request, jsonify, session
from models import db, User, DIDDocument, VerifiableCredential, QRSession
from datetime import datetime, timezone, timedelta
import json, base64, secrets
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PrivateFormat, PublicFormat

did_bp = Blueprint('did', __name__, url_prefix='/api/did')

def _load_master_key():
    from config import Config
    key_path = Config.SECRET_KEY
    try:
        with open('/yp_project/master_ec_key.pem', 'r') as f:
            return load_pem_private_key(f.read().encode(), password=None)
    except:
        return ec.generate_private_key(ec.SECP256R1())

@did_bp.route('/register', methods=['POST'])
def register_did():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    data = request.get_json()
    did = data.get('did')
    public_key_jwk = data.get('publicKeyJwk')
    if not did or not public_key_jwk: return jsonify({'error': 'did와 publicKeyJwk 필요'}), 400
    existing = DIDDocument.query.filter_by(user_id=uid).first()
    if existing: return jsonify({'error': '이미 DID가 등록되어 있습니다', 'did': existing.did}), 409
    doc = DIDDocument(did=did, user_id=uid, public_key_jwk=json.dumps(public_key_jwk))
    db.session.add(doc)
    db.session.commit()
    return jsonify({'success': True, 'did': did})

@did_bp.route('/document/<did>', methods=['GET'])
def get_did_document(did):
    doc = DIDDocument.query.filter_by(did=did).first()
    if not doc: return jsonify({'error': 'DID not found'}), 404
    return jsonify({
        '@context': 'https://www.w3.org/ns/did/v1',
        'id': doc.did,
        'verificationMethod': [{
            'id': doc.did + '#keys-1',
            'type': 'JsonWebKey2020',
            'controller': doc.did,
            'publicKeyJwk': json.loads(doc.public_key_jwk),
        }],
        'authentication': [doc.did + '#keys-1'],
    })

@did_bp.route('/issue-vc', methods=['POST'])
def issue_vc():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    issuer = User.query.get(uid)
    if not issuer or issuer.role not in ('admin', 'leader'):
        return jsonify({'error': '발급 권한 없음'}), 403
    data = request.get_json()
    user_did = data.get('did')
    subject_user_id = data.get('userId')
    if not user_did or not subject_user_id: return jsonify({'error': 'did와 userId 필요'}), 400
    subject = User.query.get(subject_user_id)
    if not subject: return jsonify({'error': '사용자 없음'}), 404
    vc_id = f'vc:yp:{secrets.token_hex(16)}'
    issuer_did = f'did:yp:{uid}'
    vc_payload = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        'id': vc_id,
        'type': ['VerifiableCredential', 'ResidentCredential'],
        'issuer': issuer_did,
        'issuanceDate': datetime.now().isoformat(),
        'credentialSubject': {
            'id': user_did,
            'resident': subject.is_verified_resident,
            'town': subject.town or '',
            'village': subject.village or '',
        },
    }
    master_key = _load_master_key()
    canonical = json.dumps(vc_payload, sort_keys=True, ensure_ascii=False).encode()
    signature = master_key.sign(canonical, ec.ECDSA(hashes.SHA256()))
    vc_payload['proof'] = {
        'type': 'EcdsaSecp256r1Signature2019',
        'created': vc_payload['issuanceDate'],
        'proofPurpose': 'assertionMethod',
        'verificationMethod': f'{issuer_did}#keys-1',
        'jws': base64.urlsafe_b64encode(signature).decode(),
    }
    vc = VerifiableCredential(
        vc_id=vc_id, issuer_did=issuer_did,
        subject_did=user_did, subject_user_id=subject_user_id,
        vc_json=json.dumps(vc_payload, ensure_ascii=False),
    )
    db.session.add(vc)
    db.session.commit()
    return jsonify(vc_payload)

@did_bp.route('/vc', methods=['GET'])
def list_vc():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    vcs = VerifiableCredential.query.filter_by(subject_user_id=uid, revoked=False)\
        .order_by(VerifiableCredential.issued_at.desc()).all()
    return jsonify([json.loads(v.vc_json) for v in vcs])

@did_bp.route('/verify', methods=['POST'])
def verify_vc():
    data = request.get_json()
    vc_json = data.get('vc')
    if not vc_json: return jsonify({'error': 'VC 필요'}), 400
    vc = json.loads(vc_json) if isinstance(vc_json, str) else vc_json
    proof = vc.get('proof', {})
    jws = proof.get('jws')
    if not jws: return jsonify({'error': 'proof.jws 없음'}), 400
    issuer_did = vc.get('issuer', '')
    doc = DIDDocument.query.filter_by(did=issuer_did).first()
    if not doc: return jsonify({'error': '발급자 DID 문서 없음'}), 404
    stored = VerifiableCredential.query.filter_by(vc_id=vc.get('id', '')).first()
    if not stored or stored.revoked:
        return jsonify({'error': 'VC가 폐기되었습니다'}), 400
    canonical = json.dumps({k: v for k, v in vc.items() if k != 'proof'}, sort_keys=True, ensure_ascii=False)
    try:
        public_jwk = json.loads(doc.public_key_jwk)
        from cryptography.hazmat.primitives.asymmetric import ec as ec2
        from cryptography.hazmat.backends import default_backend
        n_bytes = base64.urlsafe_b64decode(public_jwk['n'] + '==')
        e_bytes = base64.urlsafe_b64decode(public_jwk['e'] + '==')
        n_int = int.from_bytes(n_bytes, 'big')
        e_int = int.from_bytes(e_bytes, 'big')
        pub_num = ec2.EllipticCurvePublicNumbers(
            n_int, e_int, ec2.SECP256R1()
        )
        public_key = pub_num.public_key(default_backend())
        sig_bytes = base64.urlsafe_b64decode(jws + '==')
        public_key.verify(sig_bytes, canonical.encode(), ec2.ECDSA(hashes.SHA256()))
        return jsonify({'valid': True, 'subject': vc.get('credentialSubject', {})})
    except Exception as e:
        return jsonify({'valid': False, 'error': str(e)})

@did_bp.route('/qr-session', methods=['POST'])
def create_qr_session():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    user = User.query.get(uid)
    if user.role not in ('admin', 'leader'):
        return jsonify({'error': '권한 없음'}), 403
    session_id = secrets.token_hex(32)
    qs = QRSession(
        session_id=session_id,
        issuer_user_id=uid,
        purpose='issue_vc',
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=3),
    )
    db.session.add(qs)
    db.session.commit()
    return jsonify({'sessionId': session_id, 'expiresIn': 180})

def _get_issuer_village(issuer_id):
    issuer = User.query.get(issuer_id)
    if not issuer: return None, None
    mp = (issuer.managed_pages or '').split(',')
    for p in mp:
        if p.startswith('vi_'):
            parts = p[3:].split('_')
            if len(parts) >= 2:
                return parts[0], parts[1]
    return None, None

def _user_in_village(user_id, myeon, ri):
    if not myeon or not ri: return False
    user = User.query.get(user_id)
    if not user: return False
    return user.town == myeon and user.village == ri

@did_bp.route('/qr-session/claim', methods=['POST'])
def claim_qr_session():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    data = request.get_json()
    session_id = data.get('sessionId')
    if not session_id: return jsonify({'error': 'sessionId 필요'}), 400
    qs = QRSession.query.filter_by(session_id=session_id, status='pending').first()
    if not qs: return jsonify({'error': '세션 없음'}), 404
    if qs.expires_at < datetime.now(timezone.utc): return jsonify({'error': '세션 만료'}), 410
    myeon, ri = _get_issuer_village(qs.issuer_user_id)
    if not _user_in_village(uid, myeon, ri):
        return jsonify({'error': '해당 마을 회원만 발급받을 수 있습니다'}), 403
    qs.subject_user_id = uid
    qs.status = 'pending_approval'
    db.session.commit()
    return jsonify({'success': True, 'status': 'pending_approval'})

@did_bp.route('/qr-session/pending', methods=['GET'])
def pending_qr_sessions():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    user = User.query.get(uid)
    if user.role not in ('admin', 'leader'):
        return jsonify({'error': '권한 없음'}), 403
    sessions = QRSession.query.filter_by(issuer_user_id=uid, status='pending_approval')\
        .order_by(QRSession.created_at.desc()).all()
    result = []
    for s in sessions:
        subject = User.query.get(s.subject_user_id) if s.subject_user_id else None
        doc = DIDDocument.query.filter_by(user_id=s.subject_user_id).first() if s.subject_user_id else None
        result.append({
            'sessionId': s.session_id,
            'subjectUserId': s.subject_user_id,
            'subjectName': subject.real_name or subject.username if subject else '알 수 없음',
            'subjectEmail': subject.email if subject else '',
            'hasDid': bool(doc),
            'createdAt': s.created_at.isoformat() if s.created_at else None,
        })
    return jsonify(result)

@did_bp.route('/qr-session/approve', methods=['POST'])
def approve_qr_session():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    user = User.query.get(uid)
    if user.role not in ('admin', 'leader'):
        return jsonify({'error': '권한 없음'}), 403
    data = request.get_json()
    session_id = data.get('sessionId')
    if not session_id: return jsonify({'error': 'sessionId 필요'}), 400
    qs = QRSession.query.filter_by(session_id=session_id, status='pending_approval').first()
    if not qs: return jsonify({'error': '세션 없음'}), 404
    if qs.expires_at < datetime.now(timezone.utc): return jsonify({'error': '세션 만료'}), 410
    myeon, ri = _get_issuer_village(qs.issuer_user_id)
    if not _user_in_village(qs.subject_user_id, myeon, ri):
        return jsonify({'error': '마을 회원이 아닙니다'}), 403
    qs.status = 'approved'
    subject = User.query.get(qs.subject_user_id)
    if subject:
        doc = DIDDocument.query.filter_by(user_id=subject.id).first()
        if doc:
            issuer_did = f'did:yp:{uid}'
            vc_id = f'vc:yp:{secrets.token_hex(16)}'
            vc_payload = {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                'id': vc_id,
                'type': ['VerifiableCredential', 'ResidentCredential'],
                'issuer': issuer_did,
                'issuanceDate': datetime.now().isoformat(),
                'credentialSubject': {
                    'id': doc.did,
                    'resident': subject.is_verified_resident,
                    'town': subject.town or '',
                    'village': subject.village or '',
                },
            }
            master_key = _load_master_key()
            canonical = json.dumps(vc_payload, sort_keys=True, ensure_ascii=False).encode()
            signature = master_key.sign(canonical, ec.ECDSA(hashes.SHA256()))
            vc_payload['proof'] = {
                'type': 'EcdsaSecp256r1Signature2019',
                'created': vc_payload['issuanceDate'],
                'proofPurpose': 'assertionMethod',
                'verificationMethod': f'{issuer_did}#keys-1',
                'jws': base64.urlsafe_b64encode(signature).decode(),
            }
            vc = VerifiableCredential(
                vc_id=vc_id, issuer_did=issuer_did,
                subject_did=doc.did, subject_user_id=subject.id,
                vc_json=json.dumps(vc_payload, ensure_ascii=False),
            )
            db.session.add(vc)
    db.session.commit()
    return jsonify({'success': True, 'status': 'approved'})

@did_bp.route('/qr-session/reject', methods=['POST'])
def reject_qr_session():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    user = User.query.get(uid)
    if user.role not in ('admin', 'leader'):
        return jsonify({'error': '권한 없음'}), 403
    data = request.get_json()
    session_id = data.get('sessionId')
    if not session_id: return jsonify({'error': 'sessionId 필요'}), 400
    qs = QRSession.query.filter_by(session_id=session_id, status='pending_approval').first()
    if not qs: return jsonify({'error': '세션 없음'}), 404
    qs.status = 'rejected'
    db.session.commit()
    return jsonify({'success': True, 'status': 'rejected'})

@did_bp.route('/auto-issue', methods=['POST'])
def auto_issue_vc():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': '로그인'}), 401
    user = User.query.get(uid)
    if not user: return jsonify({'error': '사용자 없음'}), 404
    if not user.is_verified_resident:
        return jsonify({'error': '주민인증이 완료되지 않았습니다'}), 400
    existing = VerifiableCredential.query.filter_by(
        subject_user_id=uid, type='ResidentCredential', revoked=False
    ).first()
    if existing:
        return jsonify({'error': '이미 VC가 발급되었습니다', 'vcId': existing.vc_id}), 409
    doc = DIDDocument.query.filter_by(user_id=uid).first()
    if not doc:
        return jsonify({'error': '먼저 DID를 생성해주세요 (/my/did)'}), 400
    issuer_did = 'did:yp:admin'
    vc_id = f'vc:yp:{secrets.token_hex(16)}'
    vc_payload = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        'id': vc_id,
        'type': ['VerifiableCredential', 'ResidentCredential'],
        'issuer': issuer_did,
        'issuanceDate': datetime.now().isoformat(),
        'credentialSubject': {
            'id': doc.did,
            'resident': True,
            'town': user.town or '',
            'village': user.village or '',
        },
    }
    master_key = _load_master_key()
    canonical = json.dumps(vc_payload, sort_keys=True, ensure_ascii=False).encode()
    signature = master_key.sign(canonical, ec.ECDSA(hashes.SHA256()))
    vc_payload['proof'] = {
        'type': 'EcdsaSecp256r1Signature2019',
        'created': vc_payload['issuanceDate'],
        'proofPurpose': 'assertionMethod',
        'verificationMethod': f'{issuer_did}#keys-1',
        'jws': base64.urlsafe_b64encode(signature).decode(),
    }
    vc = VerifiableCredential(
        vc_id=vc_id, issuer_did=issuer_did,
        subject_did=doc.did, subject_user_id=uid,
        vc_json=json.dumps(vc_payload, ensure_ascii=False),
    )
    db.session.add(vc)
    db.session.commit()
    return jsonify(vc_payload)
