from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_db
from auth.service import AuthService
from users.repository import UserRepository


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    user_repository = UserRepository(db)
    return AuthService(user_repository)