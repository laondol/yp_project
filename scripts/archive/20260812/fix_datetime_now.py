import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTE_DIR = os.path.join(BASE, 'route_modules')
OTHER = [os.path.join(BASE, 'run.py'), os.path.join(BASE, 'tongbot_routes.py')]

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content

    # has datetime.now() ?
    if 'datetime.now()' not in content:
        return False

    # add timezone to import
    content = re.sub(
        r'from datetime import (datetime)(.*)',
        r'from datetime import \1, timezone\2',
        content
    )
    content = re.sub(
        r'from datetime import(.*)import (.*)',
        r'from datetime import\1import \2',
        content
    )
    # handle: from datetime import datetime, timedelta
    # already handled above
    # handle: import datetime (unlikely but check)
    content = re.sub(
        r'import datetime\n',
        'from datetime import datetime, timezone\n',
        content
    )

    # replace all datetime.now() with datetime.now(timezone.utc)
    content = content.replace('datetime.now()', 'datetime.now(timezone.utc)')

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

count = 0
for fname in os.listdir(ROUTE_DIR):
    if fname.endswith('.py'):
        fpath = os.path.join(ROUTE_DIR, fname)
        if fix_file(fpath):
            print(f'  fixed {fname}')
            count += 1

for fpath in OTHER:
    if os.path.exists(fpath) and fix_file(fpath):
        print(f'  fixed {os.path.basename(fpath)}')
        count += 1

print(f'Done. {count} files updated.')
