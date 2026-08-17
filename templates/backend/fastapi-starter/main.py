from fastapi import FastAPI
from modules.auth.router import router as auth_router

app = FastAPI(title="FastAPI Starter", description="A starter template for FastAPI applications", version="1.0.0")

@app.get("/")
def read_root():
    return {"message": "Running successfully!"}

app.include_router(auth_router)