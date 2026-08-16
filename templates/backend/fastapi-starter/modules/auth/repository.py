from sqlalchemy.orm import Session
from auth.security.password import verify_password

class AuthRepository:
    def __init__(self, db: Session):
        self.db = db

    def logout(self, token: str):
        
        return ""