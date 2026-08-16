from sqlalchemy.orm import Session
from users.model import User

class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_user(self, user: User):
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_user_by_email(self, email: str):
        return self.db.query(User).filter(User.email == email).first()

    def get_user_by_id(self, user_id: str):
        return self.db.query(User).filter(User.id == user_id).first()

    def edit_user(self, id: str, user: User):
        user = self.get_user_by_id(id)
        if not user:
            return None

        return user

    def delete_user(self, user_id: str):
        return ""