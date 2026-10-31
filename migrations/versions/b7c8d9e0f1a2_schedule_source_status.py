"""schedule source/source_id/status for laon sync

Revision ID: b7c8d9e0f1a2
Revises: a2b3c4d5e6f7
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7c8d9e0f1a2'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE tong_bot_schedule ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT ''")
    op.execute("ALTER TABLE tong_bot_schedule ADD COLUMN IF NOT EXISTS source_id VARCHAR(64)")
    op.execute("ALTER TABLE tong_bot_schedule ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'active'")
    op.execute("ALTER TABLE tong_bot_schedule ADD COLUMN IF NOT EXISTS busy BOOLEAN DEFAULT TRUE")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_source_source_id ON tong_bot_schedule (source, source_id)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS uq_schedule_source_source_id")
    op.execute("ALTER TABLE tong_bot_schedule DROP COLUMN IF EXISTS busy")
    op.execute("ALTER TABLE tong_bot_schedule DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE tong_bot_schedule DROP COLUMN IF EXISTS source_id")
    op.execute("ALTER TABLE tong_bot_schedule DROP COLUMN IF EXISTS source")
