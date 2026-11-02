import json
import mimetypes
from pathlib import Path

from app.config import GCS_BUCKET_NAME, GCS_PROJECT_ID, GCS_SERVICE_ACCOUNT_JSON, UPLOAD_DIR


def _object_name(digest: str, filename: str) -> str:
    return f"invoices/{digest[:16]}_{Path(filename).name}"


def _bucket():
    if not GCS_BUCKET_NAME:
        return None
    from google.cloud import storage

    credentials = None
    if GCS_SERVICE_ACCOUNT_JSON:
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_info(json.loads(GCS_SERVICE_ACCOUNT_JSON))
    return storage.Client(project=GCS_PROJECT_ID or None, credentials=credentials).bucket(GCS_BUCKET_NAME)


def save_invoice_source(data: bytes, digest: str, filename: str) -> None:
    bucket = _bucket()
    if bucket is None:
        (UPLOAD_DIR / f"{digest[:16]}_{Path(filename).name}").write_bytes(data)
        return
    blob = bucket.blob(_object_name(digest, filename))
    blob.upload_from_string(data, content_type=mimetypes.guess_type(filename)[0] or "application/octet-stream")


def load_invoice_source(digest: str, filename: str) -> bytes | None:
    bucket = _bucket()
    if bucket is None:
        path = next(iter(UPLOAD_DIR.glob(f"{digest[:16]}_*")), None)
        return path.read_bytes() if path and path.is_file() else None
    blob = bucket.blob(_object_name(digest, filename))
    if not blob.exists():
        return None
    return blob.download_as_bytes()
