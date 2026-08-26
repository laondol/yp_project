"""add legal_post file_path

Revision ID: e0f1a2b3c4d5
Revises: cdaf73f3ab38
"""
from alembic import op
import sqlalchemy as sa


revision = 'e0f1a2b3c4d5'
down_revision = 'cdaf73f3ab38'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('legal_post', sa.Column('file_path', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('legal_post', 'file_path')
