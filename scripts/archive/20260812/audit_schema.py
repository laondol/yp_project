import os, sys
sys.path.insert(0, "/home/ubuntu/yp_project_dev")
os.chdir("/home/ubuntu/yp_project_dev")
os.environ.setdefault("DATABASE_URL", "postgresql://yp_dev:yp_dev_2026@127.0.0.1:5432/yp_dev_db")
os.environ.setdefault("SECRET_KEY", "audit")
from flask import Flask
from config import Config
from models import db
app = Flask(__name__)
app.config.from_object(Config)
app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://yp_dev:yp_dev_2026@127.0.0.1:5432/yp_dev_db"
db.init_app(app)
from sqlalchemy import inspect
with app.app_context():
    inspector = inspect(db.engine)
    db_tables = inspector.get_table_names()
    issues = []
    for model_name, model in db.Model.registry._class_registry.items():
        if not hasattr(model, "__tablename__") or model_name.startswith("_"):
            continue
        tn = model.__tablename__
        if tn not in db_tables:
            continue
        model_cols = {c.name for c in model.__table__.columns}
        db_cols = {c["name"] for c in inspector.get_columns(tn)}
        missing = model_cols - db_cols
        if missing:
            for c in sorted(missing):
                col = model.__table__.columns[c]
                default = ""
                if col.default is not None:
                    v = col.default.arg
                    if isinstance(v, str):
                        default = f" DEFAULT '{v}'"
                    elif isinstance(v, bool):
                        default = f" DEFAULT {'TRUE' if v else 'FALSE'}"
                    elif v is not None:
                        default = f" DEFAULT {v}"
                nullable = "" if col.nullable else " NOT NULL"
                issues.append(f"  {tn}.{c}  ({col.type}{nullable}{default})")
    if issues:
        print("MISSING COLUMNS:")
        for i in issues:
            print(i)
    else:
        print("ALL COLUMNS MATCH")
