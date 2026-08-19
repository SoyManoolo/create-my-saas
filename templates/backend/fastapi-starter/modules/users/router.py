from fastapi import APIRouter, Query, Depends
from modules.auth.security.tokens import get_current_user

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me")
async def get_me(current_user = Depends(get_current_user)):
    return current_user