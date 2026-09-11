"""Create users, auth sessions, organizations and billing domain."""
from alembic import op
from db.base import Base
import modules.users.model

revision = "20260911_0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    Base.metadata.create_all(op.get_bind())

def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
