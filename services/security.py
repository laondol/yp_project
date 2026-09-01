import os
import uuid
import io
import struct
import ftplib
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'}

MAGIC_BYTES = {
    b'\xff\xd8\xff': ('jpg', 'jpeg'),
    b'\x89PNG\r\n\x1a\n': ('png',),
    b'GIF87a': ('gif',),
    b'GIF89a': ('gif',),
    b'RIFF': ('webp',),  # WEBP는 "RIFF....WEBP" 형태
    b'\x00\x00\x00\x18ftypheic': ('heic', 'heif'),
    b'\x00\x00\x00\x1cftypheic': ('heic', 'heif'),
    b'\x00\x00\x00\x20ftypheif': ('heic', 'heif'),
}

def check_magic_bytes(data):
    for magic, exts in MAGIC_BYTES.items():
        if data[:len(magic)] == magic:
            return exts
    return None

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

ALLOWED_MIMETYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}

def validate_upload(file, max_mb=20):
    if not file:
        return False, '파일이 없습니다.'

    ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return False, f'허용되지 않는 확장자: .{ext}'

    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > max_mb * 1024 * 1024:
        return False, f'파일 크기가 {max_mb}MB를 초과합니다.'

    header = file.read(32)
    file.seek(0)

    # HEIC/HEIF: iPhone/카메라에 따라 ftyp 브랜드가 heic/heix/hevc/heif/mif1 등 다양하므로
    # 'ftyp' 마커만 확인 (PIL/pillow_heif가 실제 디코딩 검증을 담당)
    if ext in ('heic', 'heif'):
        if b'ftyp' in header and (b'heic' in header or b'heif' in header or b'mif1' in header or b'avif' in header or b'msf1' in header):
            return True, 'OK'
        return False, '이미지 파일이 아닙니다 (HEIC 형식 불일치).'

    magic_exts = check_magic_bytes(header)
    if not magic_exts:
        return False, '이미지 파일이 아닙니다 (매직바이트 불일치).'

    if ext not in magic_exts:
        return False, f'확장자(.{ext})와 실제 파일 형식이 일치하지 않습니다.'

    return True, 'OK'

def sanitize_image(file):
    from PIL import Image
    ext = (file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else '')
    try:
        # Always register HEIF opener — handles .heic, .heif AND misnamed .jpg with HEIC content
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except Exception:
            pass
        img = Image.open(file)
        # EXIF orientation 자동 적용 (회전 깨짐 방지)
        try:
            exif = img.getexif()
            if exif is not None:
                orientation = exif.get(0x0112)
                if orientation and orientation != 1:
                    rotations = {3: 180, 6: 270, 8: 90}
                    if orientation in rotations:
                        img = img.rotate(rotations[orientation], expand=True)
        except Exception:
            pass
        fmt = 'JPEG'
        if file.filename.rsplit('.', 1)[1].lower() == 'png':
            fmt = 'PNG'
            img = img.convert('RGBA')   # 투명 배경 유지 (다른 포맷과 달리 알파 채널 보존)
        elif file.filename.rsplit('.', 1)[1].lower() == 'gif':
            fmt = 'GIF'
            img = img.convert('P')
        else:
            img = img.convert('RGB')
        out = io.BytesIO()
        save_kwargs = {'optimize': True}
        if fmt == 'JPEG':
            # 회전을 이미 적용했으므로 EXIF orientation 태그를 제거 (다시 돌아가는 것 방지)
            try:
                new_exif = img.getexif()
                if 0x0112 in new_exif:
                    del new_exif[0x0112]
                save_kwargs['exif'] = new_exif
            except Exception:
                pass
        img.save(out, format=fmt, **save_kwargs)
        out.seek(0)
        return out
    except Exception:
        return None

def save_village_file(file, upload_folder, town, village):
    if not file or not allowed_file(file.filename):
        return None

    folder_name = f"{town}_{village}"
    target_dir = os.path.join(upload_folder, folder_name)

    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    clean_name = secure_filename(file.filename)
    safe_name = f"{uuid.uuid4().hex}_{clean_name}"

    save_path = os.path.join(target_dir, safe_name)

    sanitized = sanitize_image(file)
    if sanitized:
        with open(save_path, 'wb') as f:
            f.write(sanitized.read())
    else:
        file.seek(0)
        file.save(save_path)

    return f"/static/uploads/{folder_name}/{safe_name}"

def secure_save(file, save_dir, max_mb=20):
    ok, msg = validate_upload(file, max_mb)
    if not ok:
        raise ValueError(msg)

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    ext = file.filename.rsplit('.', 1)[1].lower()
    if ext in ('heic', 'heif'):
        ext = 'jpg'
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(save_dir, safe_name)

    try:
        file.seek(0)
        _raw = file.read()
        from PIL import Image as _PI
        try:
            _o = _PI.open(io.BytesIO(_raw))
            _oex = _o.getexif().get(0x0112, 'none')
        except Exception:
            _oex = 'err'
    except Exception:
        _raw = b''
        _oex = 'err'

    sanitized = sanitize_image(file)
    if sanitized:
        with open(save_path, 'wb') as f:
            f.write(sanitized.read())
    else:
        file.seek(0)
        file.save(save_path)

    try:
        from PIL import Image as _PI2
        _r = _PI2.open(save_path)
        _rex = _r.getexif().get(0x0112, 'none')
        _rsize = _r.size
    except Exception as e:
        _rex = f'err:{e}'; _rsize = '?'
    try:
        with open('/tmp/save_dbg.log', 'a') as _lf:
            _lf.write(f"save {safe_name} | incoming_EXIF={_oex} | result_EXIF={_rex} result_size={_rsize}\n")
            _lf.flush()
    except Exception:
        pass

    return f"/static/uploads/{os.path.basename(save_dir)}/{safe_name}"


def apply_watermark(image_path, text, position='bottom-right', opacity=0.5, font_scale=0.04):
    """이미지에 워터마크 텍스트 추가. 처리 후 덮어씀."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.open(image_path).convert('RGBA')
        overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        font_size = max(12, int(min(img.size) * font_scale))
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        except Exception:
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", font_size)
            except Exception:
                font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        padding = int(font_size * 0.5)

        positions = {
            'bottom-right': (img.width - tw - padding, img.height - th - padding),
            'bottom-left': (padding, img.height - th - padding),
            'top-right': (img.width - tw - padding, padding),
            'top-left': (padding, padding),
            'center': ((img.width - tw) // 2, (img.height - th) // 2),
        }
        pos = positions.get(position, positions['bottom-right'])

        alpha = int(255 * opacity)
        draw.text(pos, text, font=font, fill=(255, 255, 255, alpha))

        result = Image.alpha_composite(img, overlay).convert('RGB')
        result.save(image_path, format='JPEG', optimize=True)
        return True
    except Exception as e:
        try:
            with open('/tmp/watermark_dbg.log', 'a') as f:
                f.write(f"watermark error: {e}\n")
        except Exception:
            pass
        return False


# ============================================================
# FTP 백업 (이중저장: 서버 primary + ipDisk backup)
# ============================================================
_ftp_cache = {'ok': None, 'ts': 0.0, 'ttl': 60.0}


def _ftp_config():
    """Flask config에서 FTP 설정 읽기"""
    try:
        from flask import current_app
        cfg = current_app.config
    except RuntimeError:
        return None
    if not cfg.get('FTP_ENABLED'):
        return None
    host = cfg.get('FTP_HOST', '')
    if not host:
        return None
    return {
        'host': host,
        'port': int(cfg.get('FTP_PORT', 21)),
        'user': cfg.get('FTP_USER', ''),
        'pass': cfg.get('FTP_PASS', ''),
        'remote_dir': (cfg.get('FTP_REMOTE_DIR') or '/').strip(),
        'use_tls': bool(cfg.get('FTP_USE_TLS', False)),
        'passive_min': int(cfg.get('FTP_PASSIVE_MIN', 50000)),
        'passive_max': int(cfg.get('FTP_PASSIVE_MAX', 50100)),
    }


def _ftp_connect(cfg):
    """FTP 서버에 연결 (캐싱: 실패 시 60초간 재시도 안 함)"""
    import time
    now = time.time()
    if _ftp_cache['ok'] is False and (now - _ftp_cache['ts']) < _ftp_cache['ttl']:
        return None
    try:
        if cfg['use_tls']:
            ftp = ftplib.FTP_TLS()
        else:
            ftp = ftplib.FTP()
        # IPv4 강제 (Docker/Tailnet 환경에서 IPv6 불안정 대응)
        host = cfg['host']
        try:
            import socket
            infos = socket.getaddrinfo(host, cfg['port'], socket.AF_INET, socket.SOCK_STREAM)
            if infos:
                host = infos[0][4][0]
        except Exception:
            pass
        ftp.connect(host, cfg['port'], timeout=10)
        ftp.login(cfg['user'], cfg['pass'])
        if cfg['use_tls']:
            ftp.prot_p()
        #被动 모드 활성화
        try:
            ftp.set_pasv(True)
        except Exception:
            pass
        # 디렉토리 이동 (없으면 생성)
        rdir = cfg['remote_dir']
        if rdir and rdir not in ('/', ''):
            parts = [p for p in rdir.split('/') if p]
            try:
                ftp.cwd(rdir)
            except ftplib.error_perm:
                ftp.cwd('/')
                for p in parts:
                    try:
                        ftp.cwd(p)
                    except ftplib.error_perm:
                        ftp.mkd(p)
                        ftp.cwd(p)
        _ftp_cache['ok'] = True
        _ftp_cache['ts'] = now
        return ftp
    except Exception as e:
        try:
            from flask import current_app
            current_app.logger.warning('FTP 연결 실패: %s', e)
        except Exception:
            pass
        _ftp_cache['ok'] = False
        _ftp_cache['ts'] = now
        return None


def _ftp_store(ftp, remote_path, local_path):
    """FTP에 파일 업로드. 성공 True / 실패 False"""
    try:
        with open(local_path, 'rb') as f:
            ftp.storbinary('STOR ' + remote_path, f)
        return True
    except Exception as e:
        try:
            from flask import current_app
            current_app.logger.warning('FTP 업로드 실패 (%s): %s', remote_path, e)
        except Exception:
            pass
        return False


def _ftp_retrieve(ftp, remote_path):
    """FTP에서 파일 바이트 반환. 실패/없음 시 None"""
    try:
        buf = io.BytesIO()
        ftp.retrbinary('RETR ' + remote_path, buf.write)
        buf.seek(0)
        return buf
    except Exception as e:
        try:
            from flask import current_app
            current_app.logger.warning('FTP 다운로드 실패 (%s): %s', remote_path, e)
        except Exception:
            pass
        return None


def ftp_backup(local_path, sub_dir):
    """
    로컬 파일을 ipDiskFTP로 백업 (이중저장).
    - local_path: 절대 경로 (예: /yp_project/static/uploads/share_reports/rejected/abc.jpg)
    - sub_dir: FTP 서브디렉토리 (예: 'share_reports/rejected')
    성공 시 True, 실패 시 False (로컬 저장은 성공으로 유지).
    """
    cfg = _ftp_config()
    if not cfg:
        return False
    if not os.path.exists(local_path):
        return False
    ftp = _ftp_connect(cfg)
    if not ftp:
        return False
    try:
        # 서브디렉토리 생성
        if sub_dir:
            parts = [p for p in sub_dir.split('/') if p]
            cur = ftp.pwd()
            for p in parts:
                try:
                    ftp.cwd(p)
                except ftplib.error_perm:
                    try:
                        ftp.mkd(p)
                        ftp.cwd(p)
                    except Exception:
                        pass
            remote_dir = ftp.pwd()
            ftp.cwd(cur)
        else:
            remote_dir = cfg['remote_dir'] or '/'
        # 파일 업로드
        fname = os.path.basename(local_path)
        remote_path = f"{remote_dir.rstrip('/')}/{fname}"
        return _ftp_store(ftp, remote_path, local_path)
    except Exception as e:
        try:
            from flask import current_app
            current_app.logger.warning('FTP 백업 실패: %s', e)
        except Exception:
            pass
        return False
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


def ftp_retrieve_file(sub_dir, filename):
    """
    ipDiskFTP에서 파일 가져오기 (서버 로컬에 없을 때 사용).
    - sub_dir: FTP 서브디렉토리 (예: 'share_reports/rejected')
    - filename: 파일명 (예: 'abc123.jpg')
    성공 시 BytesIO 객체 반환, 실패 시 None.
    """
    cfg = _ftp_config()
    if not cfg:
        return None
    ftp = _ftp_connect(cfg)
    if not ftp:
        return None
    try:
        # 서브디렉토리 이동
        if sub_dir:
            parts = [p for p in sub_dir.split('/') if p]
            for p in parts:
                try:
                    ftp.cwd(p)
                except ftplib.error_perm:
                    return None
        return _ftp_retrieve(ftp, filename)
    except Exception:
        return None
    finally:
        try:
            ftp.quit()
        except Exception:
            pass