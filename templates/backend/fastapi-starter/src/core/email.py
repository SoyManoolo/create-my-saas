"""Secure SMTP delivery for credentials that must never enter API responses."""
import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from src.core.config import settings


class EmailDeliveryError(RuntimeError):
    pass


async def send_secure_email(*, recipient: str, subject: str, body: str) -> None:
    """Send over implicit TLS or STARTTLS. Development may intentionally suppress mail."""
    if not settings.smtp_configured:
        if settings.environment in {"production", "staging"}:
            raise EmailDeliveryError("Secure email delivery is not configured.")
        return
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    def deliver() -> None:
        client_class = smtplib.SMTP_SSL if settings.smtp_use_ssl else smtplib.SMTP
        context = ssl.create_default_context()
        with client_class(settings.smtp_host, settings.smtp_port, timeout=10, context=context) if settings.smtp_use_ssl else client_class(settings.smtp_host, settings.smtp_port, timeout=10) as client:
            if not settings.smtp_use_ssl:
                client.starttls(context=context)
            client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)

    try:
        await asyncio.to_thread(deliver)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError("Unable to deliver secure email.") from exc
