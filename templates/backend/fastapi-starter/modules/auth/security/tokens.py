from datetime import datetime, timedelta, timezone
import jwt

def encode_access_token(user_id: str):
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15)
    }
    return jwt.encode(
        payload,
        "your_secret_key",
        algorithm="HS256")

def decode_access_token(token: str):
    return ""