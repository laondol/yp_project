# WSL root 권한 사용 방법

## 개요
- 로컬 패리티 저장소(`/root/yp_parity/yp_project`)는 WSL 안에서 **`root` 소유**임.
- assistant(에이전트)는 `wsl -d yp_ubuntu -u root ...` 로 root 권한으로 작업함. 동일하게 사용 가능.

## 명령어
```powershell
# 1) root로 단일 명령 실행 (가장 많이 씀)
wsl -d yp_ubuntu -u root bash -c "cd /root/yp_parity/yp_project && git status"

# 2) root 대화형 셸 열기
wsl -d yp_ubuntu -u root

# 3) root 비밀번호 설정 (추후 su/sudo 용)
wsl -d yp_ubuntu -u root bash -c "passwd root"

# 4) (선택) WSL 기본 사용자를 root로 지정
wsl --manage yp_ubuntu --default-user root
```

## 왜 이게 필요한가
- Windows에서 `\\wsl$\yp_ubuntu\root\yp_parity\yp_project` UNC 경로로 접근해 **Windows Git**을 쓰면,
  저장소 소유주(root)와 Windows 사용자가 달라 **"dubious ownership"** 경고가 남.
  - 해결 A: Windows 쪽에 예외 등록 (이미 됨)
    `git config --global --add safe.directory '//wsl$/yp_ubuntu/root/yp_parity/yp_project'`
  - 해결 B: **WSL 안에서 root로 직접 실행**하면 소유주 일치로 경고 없음.

## GitHub 푸시는 Windows에서
- GitHub 인증(토큰)은 Windows `gh` CLI에 있음 (`gh auth status` → laondol, repo 권한).
- WSL 안에는 `gh`가 없어 푸시 인증이 안 됨 → **푸시는 Windows에서**:
  - remote를 HTTPS로: `git remote set-url origin https://github.com/laondol/yp_project.git`
  - `gh auth setup-git` (자격 증명 헬퍼 등록, 이미 됨)
  - `git -C \\wsl$\yp_ubuntu\root\yp_parity\yp_project push origin dev`
- 참고: SSH 키 `C:\Users\i0wil\.ssh\id_ed25519`(주석 yp-server)는 GitHub 계정에 등록 안 돼 있어
  SSH push는 거부됨. `gh` 설정상 git 프로토콜은 ssh이나 실제 push는 HTTPS+토큰 사용.

## 요약
- 로컬 작업/검증: `wsl -u root bash -c "..."`
- GitHub 푸시: Windows에서 (safe.directory 예외 + HTTPS/gh 자격증명)
