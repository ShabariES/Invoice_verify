import hashlib
import hmac
import json
import logging
import re
import time
import urllib.error
import urllib.request
from email.utils import parseaddr

from app.config import (
    MAILGUN_WEBHOOK_SIGNING_KEY,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_APP_SECRET,
    WHATSAPP_GRAPH_API_VERSION,
    WHATSAPP_PHONE_NUMBER_ID,
)

logger = logging.getLogger(__name__)
MAX_INVOICE_BYTES = 15 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}


def valid_invoice_attachment(data: bytes, filename: str) -> bool:
    suffix = filename.rpartition(".")[2].lower()
    if suffix:
        suffix = "." + suffix
    return bool(data) and (
        (suffix == ".pdf" and data.startswith(b"%PDF-"))
        or (suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
        or (suffix in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8\xff"))
        or (suffix == ".webp" and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def verify_mailgun_signature(timestamp: str, token: str, signature: str) -> bool:
    if not MAILGUN_WEBHOOK_SIGNING_KEY or not timestamp or not token or not signature:
        return False
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        return False
    # Mailgun may retry a delivery for hours; rely on the message id for
    # idempotency while rejecting signatures older than a day.
    if abs(time.time() - sent_at) > 24 * 60 * 60:
        return False
    expected = hmac.new(
        MAILGUN_WEBHOOK_SIGNING_KEY.encode("utf-8"),
        f"{timestamp}{token}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def authenticated_mail_headers(raw_headers: str | list | None, sender: str) -> bool:
    """Require provider-reported SPF or DKIM pass before trusting From."""
    try:
        headers = json.loads(raw_headers) if isinstance(raw_headers, str) else raw_headers
    except json.JSONDecodeError:
        return False
    if not isinstance(headers, list):
        return False
    sender_domain = sender.rpartition("@")[2].lower()
    if not sender_domain:
        return False
    auth_results = []
    for item in headers:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            name, value = str(item[0]).lower(), str(item[1]).lower()
            if name in {"authentication-results", "received-spf"}:
                auth_results.append((name, value))
    return any(
        ("dkim=pass" in value and re.search(r"header\.d=" + re.escape(sender_domain) + r"(?:[;\s]|$)", value))
        or (
            value.startswith("pass")
            and "received-spf" in name
            and bool(re.search(r"(?:envelope-from|smtp\.mailfrom)=<?[^\s@<>]+@" + re.escape(sender_domain) + r">?", value))
        )
        for name, value in auth_results
    )


def parse_sender(value: str | None) -> str:
    return parseaddr(value or "")[1].strip().lower()


def normalize_phone(value: str | None) -> str:
    return "".join(character for character in (value or "") if character.isdigit())


def verify_whatsapp_signature(body: bytes, signature: str | None) -> bool:
    if not WHATSAPP_APP_SECRET or not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(WHATSAPP_APP_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def download_whatsapp_media(media_id: str) -> tuple[bytes, str]:
    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_NUMBER_ID:
        raise RuntimeError("WhatsApp media download is not configured")
    headers = {"Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}"}
    metadata_request = urllib.request.Request(
        f"https://graph.facebook.com/{WHATSAPP_GRAPH_API_VERSION}/{media_id}", headers=headers
    )
    with urllib.request.urlopen(metadata_request, timeout=20) as response:
        metadata = json.loads(response.read(64 * 1024).decode("utf-8"))
    media_url = metadata.get("url")
    if not isinstance(media_url, str) or not media_url.startswith("https://"):
        raise RuntimeError("WhatsApp did not return a secure media URL")
    expected_size = metadata.get("file_size")
    if expected_size and int(expected_size) > MAX_INVOICE_BYTES:
        raise ValueError("WhatsApp invoice files must be 15 MB or smaller")
    media_request = urllib.request.Request(media_url, headers=headers)
    with urllib.request.urlopen(media_request, timeout=45) as response:
        data = response.read(MAX_INVOICE_BYTES + 1)
        content_type = response.headers.get_content_type()
    if len(data) > MAX_INVOICE_BYTES:
        raise ValueError("WhatsApp invoice files must be 15 MB or smaller")
    if not data:
        raise ValueError("The WhatsApp attachment was empty")
    return data, str(metadata.get("mime_type") or content_type).split(";")[0].strip().lower()
