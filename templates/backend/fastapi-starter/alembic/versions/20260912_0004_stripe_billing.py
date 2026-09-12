"""Add Stripe billing state, entitlements, trusted usage, and webhook receipts."""

from alembic import op
import sqlalchemy as sa


revision = "20260912_0004"
down_revision = "20260912_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subscriptions", sa.Column("current_period_start", sa.DateTime(timezone=True)))
    op.add_column("subscriptions", sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_table(
        "billing_entitlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("limit_value", sa.Integer()),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source", sa.String(length=60), nullable=False, server_default="free"),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "key", name="uq_billing_entitlement_org_key"),
    )
    op.create_index("ix_billing_entitlements_organization_id", "billing_entitlements", ["organization_id"])
    op.create_table(
        "usage_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("metric", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("reported_to_provider", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_usage_record_org_idempotency"),
    )
    op.create_index("ix_usage_records_organization_metric_recorded", "usage_records", ["organization_id", "metric", "recorded_at"])
    op.create_table(
        "billing_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("provider_event_id", sa.String(length=255), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_event_id", name="uq_billing_webhook_provider_event"),
    )


def downgrade() -> None:
    op.drop_table("billing_webhook_events")
    op.drop_index("ix_usage_records_organization_metric_recorded", table_name="usage_records")
    op.drop_table("usage_records")
    op.drop_index("ix_billing_entitlements_organization_id", table_name="billing_entitlements")
    op.drop_table("billing_entitlements")
    op.drop_column("subscriptions", "cancel_at_period_end")
    op.drop_column("subscriptions", "current_period_start")
