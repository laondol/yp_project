import os
from datetime import datetime
from werkzeug.utils import secure_filename

ALLOWED_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".pdf",
    ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx",
    ".txt", ".zip", ".ppt", ".pptx",
}

_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SERVICE_DIR)


def save_upload(file, subdir="uploads"):
    if not file or not getattr(file, "filename", ""):
        return None
    filename = secure_filename(file.filename)
    if not filename:
        return None
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return None
    base = os.path.join(_PROJECT_ROOT, "static", "uploads", subdir)
    os.makedirs(base, exist_ok=True)
    unique = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
    save_path = os.path.join(base, unique)
    file.save(save_path)
    return f"/static/uploads/{subdir}/{unique}"
