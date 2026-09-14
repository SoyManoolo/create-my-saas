from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import AppError
from src.db.database import get_db
from src.modules.auth.security.tokens import get_current_user
from src.modules.organizations.access import require_role
from src.modules.users.model import AuditLog, MembershipRole, User

router = APIRouter(prefix="/organizations", tags=["audit"])


class AuditLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: UUID
    organization_id: UUID = Field(serialization_alias="organizationId")
    actor_user_id: UUID | None = Field(serialization_alias="actorUserId")
    action: str
    target_type: str = Field(serialization_alias="targetType")
    target_id: str | None = Field(serialization_alias="targetId")
    metadata_: dict = Field(validation_alias="metadata_", serialization_alias="metadata")
    created_at: datetime = Field(serialization_alias="createdAt")


class AuditLogPage(BaseModel):
    items: list[AuditLogPublic]
    next_cursor: UUID | None = Field(serialization_alias="nextCursor")


@router.get("/{org_id}/audit-logs", response_model=AuditLogPage)
async def list_audit_logs(
    org_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    statement = select(AuditLog).where(AuditLog.organization_id == org_id)
    if cursor is not None:
        cursor_row = await db.get(AuditLog, cursor)
        if cursor_row is None or cursor_row.organization_id != org_id:
            raise AppError("Audit log cursor is invalid.", code="INVALID_AUDIT_CURSOR", status_code=400)
        statement = statement.where(or_(
            AuditLog.created_at < cursor_row.created_at,
            and_(AuditLog.created_at == cursor_row.created_at, AuditLog.id < cursor_row.id),
        ))
    rows = list((await db.execute(statement.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit + 1))).scalars())
    page = rows[:limit]
    return {"items": page, "next_cursor": page[-1].id if len(rows) > limit else None}
