from users.repository import UserRepository
from auth.repository import AuthRepository
from users.schemas import UserRegister, UserLogin
from auth.security.tokens import encode_access_token
from auth.security.password import verify_password, hash_password
from users.model import User

class AuthService:
    def __init__(self, user_repository: UserRepository, auth_repository: AuthRepository):
        self.user_repository = user_repository
        self.auth_repository = auth_repository

    def login(self, user_login: UserLogin):
        user = self.user_repository.get_user_by_email(user_login.email)
        if user is None or user.is_active is False:
            return None

        if not verify_password(user_login.password, user.password):
            return None
        
        token = encode_access_token(str(user.id))
        return user, token

    def register(self, user_register: UserRegister) -> User:
        existing_user = self.user_repository.get_user_by_email(user_register.email)
        if existing_user is not None:
            return None

        password_hash = hash_password(user_register.password)
        user = {
            "email": user_register.email,
            "name": user_register.name,
            "password_hash": password_hash,
        }

        return self.user_repository.create_user(user)

    def logout(self, token: str):
        
        return ""