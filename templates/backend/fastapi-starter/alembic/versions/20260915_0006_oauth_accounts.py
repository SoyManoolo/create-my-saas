"""Persist stable OAuth provider identities separately from user email."""

from alembic import op
import sqlalchemy as sa

revision = "20260915_0006"
down_revision = "20260913_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("provider_account_id", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_account_id", name="uq_oauth_account_provider_subject"),
    )
    op.create_index("ix_oauth_accounts_user_id", "oauth_accounts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_oauth_accounts_user_id", table_name="oauth_accounts")
    op.drop_table("oauth_accounts")
