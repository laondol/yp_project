"""경로 제공자 비교 검증 실행

사용:
    docker exec -i yp_flask python3 scripts/route_eval.py --limit 12
    docker exec -i yp_flask python3 scripts/route_eval.py --summary
"""
import sys
sys.path.insert(0, '/yp_project')

from run import app
from services.route_eval import run_all, summary


def main():
    args = sys.argv[1:]
    with app.app_context():
        if '--summary' in args:
            print(summary())
            return
        limit = None
        if '--limit' in args:
            i = args.index('--limit')
            limit = int(args[i + 1]) if i + 1 < len(args) else None
        providers = None
        if '--providers' in args:
            i = args.index('--providers')
            providers = [x.strip() for x in args[i + 1].split(',') if x.strip()]
        ids = None
        if '--ids' in args:
            i = args.index('--ids')
            ids = args[i + 1] if i + 1 < len(args) else None
        res = run_all(limit=limit, providers=providers, ids_prefix=ids)
        print('RUN', res)
        s = summary()
        print('CASES', s['cases'])
        for p in s['providers']:
            print(f"  {p['provider']:9s} 성공 {p['ok']}/{p['runs']} "
                  f"평균 {p['avg_total']}분  ODsay대비 {p['avg_diff_vs_odsay']}  추정 {p['estimated_rate']}%")


if __name__ == '__main__':
    main()
