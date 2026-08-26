"""psycho_post viewed_at

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
"""
from alembic import op
import sqlalchemy as sa

revision = 'a2b3c4d5e6f7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE psycho_post ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP WITHOUT TIME ZONE")


def downgrade():
    op.execute("ALTER TABLE psycho_post DROP COLUMN IF EXISTS viewed_at")
