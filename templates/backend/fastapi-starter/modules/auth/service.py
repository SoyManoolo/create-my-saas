from users.repository import UserRepository
class AuthService:
    def __init__(self, user_repository: UserRepository):
        self.user_repository = user_repository