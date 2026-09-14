from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from src.modules.users.model import MembershipRole


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,158}[a-z0-9]$")


class OrganizationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class MembershipUpdate(BaseModel):
    role: MembershipRole


class InviteCreate(BaseModel):
    email: EmailStr
    role: MembershipRole = MembershipRole.MEMBER


class AcceptInvite(BaseModel):
    token: str


class OwnershipTransfer(BaseModel):
    user_id: UUID
