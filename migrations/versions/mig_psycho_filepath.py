"""psycho_post file_path

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
"""
from alembic import op
import sqlalchemy as sa

revision = 'f1a2b3c4d5e6'
down_revision = 'e0f1a2b3c4d5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('psycho_post', sa.Column('file_path', sa.String(length=500), nullable=True))


def downgrade():
    op.drop_column('psycho_post', 'file_path')
