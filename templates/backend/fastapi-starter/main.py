from fastapi import FastAPI

app = FastAPI(title="FastAPI Starter", description="A starter template for FastAPI applications", version="1.0.0")

@app.get("/")
def read_root():
    return {"message": "Running successfully!"}