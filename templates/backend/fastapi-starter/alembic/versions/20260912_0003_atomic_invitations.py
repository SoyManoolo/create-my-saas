"""Make organization invitations safe to retry and accept concurrently."""

from alembic import op
import sqlalchemy as sa


revision = "20260912_0003"
down_revision = "20260911_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invitations", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    # Keep the most recent pending invite usable before enforcing the invariant.
    # Older pending rows were never accepted and must not block retries forever.
    op.execute("""
        WITH ranked AS (
            SELECT id, row_number() OVER (
                PARTITION BY organization_id, email
                ORDER BY created_at DESC, id DESC
            ) AS position
            FROM invitations
            WHERE accepted_at IS NULL
        )
        UPDATE invitations
        SET cancelled_at = created_at
        WHERE id IN (SELECT id FROM ranked WHERE position > 1)
    """)
    op.create_index(
        "uq_invitations_active_org_email",
        "invitations",
        ["organization_id", "email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND cancelled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_invitations_active_org_email", table_name="invitations")
    op.drop_column("invitations", "cancelled_at")
