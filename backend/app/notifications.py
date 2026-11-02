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
    MAILGUN_WEBHOOK_SIGNING_KEY,
    INBOUND_INVOICE_EMAIL,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_APP_SECRET,
    WHATSAPP_GRAPH_API_VERSION,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    WHATSAPP_INBOUND_NUMBER,
    WHATSAPP_TEMPLATE_LANGUAGE,
    WHATSAPP_TEMPLATE_NAME,
)

logger = logging.getLogger(__name__)


def channel_status() -> dict[str, bool | str]:
    return {
        "in_app": True,
        "email": bool(SMTP_HOST and SMTP_FROM_EMAIL),
        "whatsapp": bool(WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME),
        "email_inbound": bool(MAILGUN_WEBHOOK_SIGNING_KEY and INBOUND_INVOICE_EMAIL),
        "email_inbound_address": INBOUND_INVOICE_EMAIL,
        "whatsapp_inbound": bool(WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN),
        "whatsapp_inbound_number": WHATSAPP_INBOUND_NUMBER,
    }


def send_email_notification(recipient: str, subject: str, message: str) -> bool:
    if not SMTP_HOST or not SMTP_FROM_EMAIL or not recipient:
        return False
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
        return True
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("Email notification delivery failed (%s)", type(exc).__name__)
        return False


def send_whatsapp_notification(recipient: str, title: str, message: str) -> bool:
    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_NUMBER_ID or not recipient:
        return False
    recipient = re.sub(r"\D", "", recipient)
    if not recipient:
        return False
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
        return True
    except (OSError, urllib.error.URLError) as exc:
        logger.warning("WhatsApp notification delivery failed (%s)", type(exc).__name__)
        return False
