from modules.users.repository import UserRepository
from modules.users.schemas import UserRegister, UserLogin
from modules.auth.security.tokens import encode_access_token
from modules.auth.security.password import verify_password, hash_password
from modules.users.model import User

class AuthService:
    def __init__(self, user_repository: UserRepository):
        self.user_repository = user_repository

    async def login(self, user_login: UserLogin):
        user = await self.user_repository.get_user_by_email(user_login.email)
        if user is None or user.is_active is False:
            return None

        if not verify_password(user_login.password, user.password_hash):
            return None
        
        token = encode_access_token(str(user.id))
        return user, token

    async def register(self, user_register: UserRegister) -> User:
        existing_user = await self.user_repository.get_user_by_email(user_register.email)
        if existing_user is not None:
            return None

        password_hash = hash_password(user_register.password)

        user = User(
            email=user_register.email,
            name=user_register.name,
            password_hash=password_hash,
        )

        return self.user_repository.create_user(user)

    async def logout(self, token: str):
        return ""