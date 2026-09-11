"""Persist OAuth state and its PKCE verifier server-side."""

from alembic import op
import sqlalchemy as sa

revision = "20260911_0002"
down_revision = "20260911_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("code_verifier", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash"),
    )


def downgrade() -> None:
    op.drop_table("oauth_states")
