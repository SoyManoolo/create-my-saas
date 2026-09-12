from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

def validate_password_strength(value: str) -> str:
    if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("Password must contain a letter and a number")
    return value

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_password_strength(value)

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
    model_config = ConfigDict(populate_by_name=True)
    current_password: str = Field(validation_alias="currentPassword")
    new_password: str = Field(min_length=8, max_length=128, validation_alias="newPassword")
    _validate_password = field_validator("new_password")(validate_password_strength)

class ResetPasswordRequest(BaseModel): email: EmailStr
class ResetPasswordConfirm(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=8, max_length=128, validation_alias="newPassword")
    _validate_password = field_validator("new_password")(validate_password_strength)
class TokenRequest(BaseModel): token: str = Field(min_length=20)
