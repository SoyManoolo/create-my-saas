"""Compatibility marker for the OAuth-state migration.

Revision 0001 already created this table in the published baseline. Keeping this
revision as a no-op lets databases stamped with the old history advance safely
and makes a new database install deterministic.
"""

revision = "20260911_0002"
down_revision = "20260911_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
