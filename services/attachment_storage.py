"""첨부파일 로컬/NAS 보관 정책.

- NAS 업로드가 확인된 큰 파일은 로컬 사본을 제거한다.
- 오래된 로컬 파일도 NAS에 동일 크기 파일이 있을 때만 제거한다.
- NAS 확인이 안 되면 로컬 파일은 절대 지우지 않는다.
"""
import os
import time

from flask import current_app
from services.security import ftp_file_size


def _local_attachment_dirs():
    dirs = []
    private_dir = current_app.config.get('ATTACHMENT_FOLDER')
    if private_dir:
        dirs.append(os.path.abspath(private_dir))
    dirs.append(os.path.abspath(os.path.join(current_app.config['UPLOAD_FOLDER'], 'general_files')))
    return list(dict.fromkeys(dirs))


def archive_local_attachments(dry_run=False):
    """큰 파일/오래된 파일을 NAS-only로 전환한다.

    Returns: dict(scanned, archived, skipped, errors, dry_run)
    """
    if not current_app.config.get('FTP_ENABLED'):
        return {'scanned': 0, 'archived': 0, 'skipped': 0, 'errors': 0, 'dry_run': dry_run, 'disabled': True}

    size_threshold = int(current_app.config.get('NAS_ONLY_ATTACHMENT_MB', 10)) * 1024 * 1024
    retention_days = int(current_app.config.get('LOCAL_ATTACHMENT_RETENTION_DAYS', 30))
    cutoff = time.time() - retention_days * 86400
    stats = {'scanned': 0, 'archived': 0, 'skipped': 0, 'errors': 0, 'dry_run': dry_run}

    for base in _local_attachment_dirs():
        if not os.path.isdir(base):
            continue
        for name in os.listdir(base):
            full = os.path.join(base, name)
            if not os.path.isfile(full):
                continue
            stats['scanned'] += 1
            try:
                st = os.stat(full)
                old_enough = st.st_mtime < cutoff
                large_enough = st.st_size >= size_threshold
                if not old_enough and not large_enough:
                    continue

                remote_size = ftp_file_size(name)
                if remote_size is None or remote_size < 0:
                    stats['skipped'] += 1
                    continue
                if remote_size != st.st_size:
                    stats['skipped'] += 1
                    current_app.logger.warning(
                        '[ATTACHMENT-ARCHIVE] NAS 크기 불일치, 로컬 유지: %s (%s != %s)',
                        name, st.st_size, remote_size,
                    )
                    continue

                if dry_run:
                    stats['archived'] += 1
                    continue
                os.remove(full)
                stats['archived'] += 1
            except Exception as e:
                stats['errors'] += 1
                current_app.logger.warning('[ATTACHMENT-ARCHIVE] 실패 %s: %s', name, e)

    return stats
