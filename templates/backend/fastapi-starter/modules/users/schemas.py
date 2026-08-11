from pydantic import BaseModel, EmailStr, field_validator
from datetime import datetime, timezone


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str

    @field_validator("password")
    def validate_password(cls, value):
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return value

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserPublic(BaseModel):
    email: EmailStr
    name: str
    email_verified: bool = False
    is_active: bool = True