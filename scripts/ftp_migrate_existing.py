#!/usr/bin/env python3
import os, sys, ftplib, socket
sys.path.insert(0, '/yp_project')
os.chdir('/yp_project')

def get_ftp():
    ftp = ftplib.FTP()
    ip = socket.getaddrinfo('unocum.ipdisk.co.kr', 990, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    ftp.connect(ip, 990, timeout=15)
    ftp.login('yangsaham', 'laon0811^%$')
    return ftp

def ensure_dir(ftp, path):
    cur = ftp.pwd()
    for p in path.split('/'):
        if not p: continue
        try: ftp.cwd(p)
        except ftplib.error_perm:
            try: ftp.mkd(p); ftp.cwd(p)
            except: pass
    r = ftp.pwd()
    ftp.cwd(cur)
    return r

def main():
    from run import create_app
    app = create_app()
    with app.app_context():
        uploads = os.path.join(app.root_path, 'static', 'uploads')
        mapping = {
            'share_reports': 'share_reports', 'post_images': 'post_images',
            'legal': 'legal', 'psycho': 'psycho',
            'village_event_files': 'village_event_files', 'village_msg': 'village_msg',
            'village_map': 'village_map', 'village_members': 'village_members',
            'profiles': 'profiles', 'news': 'news', 'ramp': 'ramp',
            'epub_media': 'epub_media', 'general_files': 'general_files',
        }
        print("FTP 연결...")
        ftp = get_ftp()
        print("연결 성공")
        root = '/HDD1/unocum'
        ensure_dir(ftp, root)
        total = uploaded = skipped = 0
        for local_name, remote_name in mapping.items():
            local_dir = os.path.join(uploads, local_name)
            if not os.path.exists(local_dir): continue
            print(f"\n--- {local_name}/ ---")
            remote_dir = f"{root}/{remote_name}"
            ensure_dir(ftp, remote_dir)
            existing = set()
            try:
                cur = ftp.pwd()
                ftp.cwd(remote_dir)
                fl = []; ftp.retrlines('LIST', fl.append)
                for l in fl:
                    parts = l.split()
                    if parts: existing.add(parts[-1])
                ftp.cwd(cur)
            except: pass
            for r2, dirs, files in os.walk(local_dir):
                for fname in files:
                    total += 1
                    lpath = os.path.join(r2, fname)
                    rel = os.path.relpath(r2, local_dir)
                    if rel != '.':
                        sub = f"{remote_dir}/{rel}"
                        ensure_dir(ftp, sub)
                        tdir = sub
                    else:
                        tdir = remote_dir
                    if fname in existing:
                        skipped += 1
                        continue
                    try:
                        with open(lpath, 'rb') as f:
                            ftp.storbinary(f'STOR {tdir}/{fname}', f)
                        uploaded += 1
                        print(f"  OK {fname}")
                    except Exception as e:
                        print(f"  FAIL {fname}: {e}")
        print(f"\n=== 완료: 총 {total}, 업로드 {uploaded}, 스킵 {skipped} ===")
        ftp.quit()

if __name__ == '__main__':
    main()
