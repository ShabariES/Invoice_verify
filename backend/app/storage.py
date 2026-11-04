from pathlib import Path

from app.config import UPLOAD_DIR


def save_invoice_source(data: bytes, digest: str, filename: str) -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / f"{digest[:16]}_{Path(filename).name}").write_bytes(data)


def load_invoice_source(digest: str, filename: str) -> bytes | None:
    path = next(iter(UPLOAD_DIR.glob(f"{digest[:16]}_*")), None)
    return path.read_bytes() if path and path.is_file() else None
