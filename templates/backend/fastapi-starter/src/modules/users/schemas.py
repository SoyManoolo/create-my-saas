from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
            raise ValueError("Password must contain a letter and a number")
        return value

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    name: str
    email_verified: bool
    is_active: bool

class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)

class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

class ResetPasswordRequest(BaseModel): email: EmailStr
class ResetPasswordConfirm(BaseModel):
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=8, max_length=128)
class TokenRequest(BaseModel): token: str = Field(min_length=20)
