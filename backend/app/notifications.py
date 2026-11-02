import logging
import json
import re
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage

from app.config import (
    SMTP_FROM_EMAIL,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USE_SSL,
    SMTP_USERNAME,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_GRAPH_API_VERSION,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TEMPLATE_LANGUAGE,
    WHATSAPP_TEMPLATE_NAME,
)

logger = logging.getLogger(__name__)


def channel_status() -> dict[str, bool]:
    return {
        "in_app": True,
        "email": bool(SMTP_HOST and SMTP_FROM_EMAIL),
        "whatsapp": bool(WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME),
    }


def send_email_notification(recipient: str, subject: str, message: str) -> None:
    if not SMTP_HOST or not SMTP_FROM_EMAIL or not recipient:
        return
    email = EmailMessage()
    email["Subject"] = subject[:180]
    email["From"] = SMTP_FROM_EMAIL
    email["To"] = recipient
    email.set_content(f"{message}\n\nOpen TechJays Accounting CRM to review this notification.")
    try:
        context = ssl.create_default_context()
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=8, context=context) as client:
                if SMTP_USERNAME:
                    client.login(SMTP_USERNAME, SMTP_PASSWORD)
                client.send_message(email)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=8) as client:
                client.ehlo()
                client.starttls(context=context)
                client.ehlo()
                if SMTP_USERNAME:
                    client.login(SMTP_USERNAME, SMTP_PASSWORD)
                client.send_message(email)
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("Email notification delivery failed (%s)", type(exc).__name__)


def send_whatsapp_notification(recipient: str, title: str, message: str) -> None:
    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_NUMBER_ID or not recipient:
        return
    recipient = re.sub(r"\D", "", recipient)
    if not recipient:
        return
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "template",
        "template": {
            "name": WHATSAPP_TEMPLATE_NAME,
            "language": {"code": WHATSAPP_TEMPLATE_LANGUAGE},
            "components": [{"type": "body", "parameters": [{"type": "text", "text": f"{title}: {message}"[:900]}]}],
        },
    }
    request = urllib.request.Request(
        f"https://graph.facebook.com/{WHATSAPP_GRAPH_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            response.read(1024)
    except (OSError, urllib.error.URLError) as exc:
        logger.warning("WhatsApp notification delivery failed (%s)", type(exc).__name__)
