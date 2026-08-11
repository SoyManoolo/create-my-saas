from fastapi import APIRouter, HTTPException, Query, status


router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
async def login(email: str, password: str):
    return ""

@router.post("/register")
async def register(email: str, password: str):
    return ""

@router.post("/logout")
async def logout(token: str):
    return ""