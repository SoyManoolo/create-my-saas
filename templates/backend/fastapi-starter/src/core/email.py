"""Secure HTTPS delivery for credentials that must never enter API responses."""
import asyncio
import json
from urllib import error, request

from src.core.config import settings


class EmailDeliveryError(RuntimeError):
    pass


async def send_secure_email(*, recipient: str, subject: str, body: str) -> None:
    """Send through the shared authenticated adapter. Development may suppress mail."""
    if not settings.email_delivery_configured:
        if settings.environment in {"production", "staging"}:
            raise EmailDeliveryError("Secure email delivery is not configured.")
        return

    def deliver() -> None:
        payload = json.dumps({"to": recipient, "subject": subject, "text": body}).encode("utf-8")
        email_request = request.Request(
            settings.email_delivery_url,
            data=payload,
            headers={
                "Authorization": f"Bearer {settings.email_delivery_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with request.urlopen(email_request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise EmailDeliveryError("Secure email delivery is unavailable.")

    try:
        await asyncio.to_thread(deliver)
    except EmailDeliveryError:
        raise
    except (error.URLError, OSError, TimeoutError, ValueError) as exc:
        raise EmailDeliveryError("Secure email delivery is unavailable.") from exc
