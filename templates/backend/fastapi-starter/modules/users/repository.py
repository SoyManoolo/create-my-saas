class UserRepository:
    def __init__(self, db):
        self.db = db

    def create_user(self, email: str, password_hash: str):
        return ""

    def get_user_by_email(self, email: str):
        return ""

    def edit_user(self):
        return ""

    def delete_user(self, user_id: str):
        return ""