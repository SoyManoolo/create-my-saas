from fastapi import APIRouter, Query, Depends
from users.schemas import UserRegister, UserUpdate, UserLogin
from auth.service import AuthService
from auth.dependencies import get_auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
async def login(user_login: UserLogin, auth_service: AuthService = Depends(get_auth_service)):
    return auth_service.login(user_login)

@router.post("/register")
async def register(user_register: UserRegister, auth_service: AuthService = Depends(get_auth_service)):
    return auth_service.register(user_register)

@router.post("/logout")
async def logout(token: str, auth_service: AuthService = Depends(get_auth_service)):
    return auth_service.logout(token)