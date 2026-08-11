from users.repository import UserRepository
class AuthService:
    def __init__(self, user_repository: UserRepository):
        self.user_repository = user_repository

    def login(self, email: str, password: str):

        return ""

    def register(self, email: str, password: str):

        return ""

    def logout(self, token: str):
        
        return ""