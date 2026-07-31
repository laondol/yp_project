"""memo end_date, schedule lastday, facility community, facility_report

Revision ID: cdaf73f3ab38
Revises: 74e6852263db
Create Date: 2026-07-31

Safe additive-only migration (no type changes / no data loss).
"""
from alembic import op
import sqlalchemy as sa


revision = 'cdaf73f3ab38'
down_revision = '74e6852263db'
branch_labels = None
depends_on = None


def _has_column(table, column):
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return any(c['name'] == column for c in insp.get_columns(table))


def _has_table(table):
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return table in insp.get_table_names()


def upgrade():
    if not _has_column('tong_bot_memo', 'end_date'):
        op.add_column('tong_bot_memo', sa.Column('end_date', sa.DateTime(), nullable=True))

    if not _has_column('tong_bot_schedule', 'repeat_lastday'):
        op.add_column('tong_bot_schedule', sa.Column('repeat_lastday', sa.Boolean(), server_default=sa.text('false'), nullable=True))

    pf_cols = {
        'is_community': sa.Column('is_community', sa.Boolean(), server_default=sa.text('false'), nullable=True),
        'submitted_by': sa.Column('submitted_by', sa.Integer(), nullable=True),
        'status': sa.Column('status', sa.String(length=20), server_default='active', nullable=True),
        'verified_count': sa.Column('verified_count', sa.Integer(), server_default='0', nullable=True),
        'reject_count': sa.Column('reject_count', sa.Integer(), server_default='0', nullable=True),
        'notes': sa.Column('notes', sa.Text(), server_default='', nullable=True),
        'photo_url': sa.Column('photo_url', sa.String(length=300), nullable=True),
        'gender_type': sa.Column('gender_type', sa.String(length=20), nullable=True),
        'accessible': sa.Column('accessible', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    }
    if _has_table('public_facility'):
        for name, col in pf_cols.items():
            if not _has_column('public_facility', name):
                op.add_column('public_facility', col)
        # FK optional - only if user table exists and FK not already present
        try:
            if not _has_column('public_facility', 'submitted_by'):
                pass
            else:
                insp = sa.inspect(op.get_bind())
                fks = [fk['constrained_columns'] for fk in insp.get_foreign_keys('public_facility')]
                if ['submitted_by'] not in fks and 'submitted_by' in [c['name'] for c in insp.get_columns('public_facility')]:
                    op.create_foreign_key(
                        'fk_public_facility_submitted_by',
                        'public_facility', 'user',
                        ['submitted_by'], ['id']
                    )
        except Exception:
            pass

    if not _has_table('facility_report'):
        op.create_table(
            'facility_report',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('facility_id', sa.Integer(), sa.ForeignKey('public_facility.id'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=False),
            sa.Column('report_type', sa.String(length=20), nullable=False),
            sa.Column('comment', sa.Text(), server_default='', nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )


def downgrade():
    if _has_table('facility_report'):
        op.drop_table('facility_report')
    if _has_table('public_facility'):
        for name in ('accessible', 'gender_type', 'photo_url', 'notes', 'reject_count',
                     'verified_count', 'status', 'submitted_by', 'is_community'):
            if _has_column('public_facility', name):
                op.drop_column('public_facility', name)
    if _has_column('tong_bot_schedule', 'repeat_lastday'):
        op.drop_column('tong_bot_schedule', 'repeat_lastday')
    if _has_column('tong_bot_memo', 'end_date'):
        op.drop_column('tong_bot_memo', 'end_date')
