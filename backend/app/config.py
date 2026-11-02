import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./invoices.db")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(ROOT / "uploads"))).resolve()
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
OCR_SERVICE_URL = os.getenv("OCR_SERVICE_URL", "")
OCR_SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
OCR_REVIEW_THRESHOLD = float(os.getenv("OCR_REVIEW_THRESHOLD", "0.95"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
APP_ENV = os.getenv("APP_ENV", "development").lower()
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "")
if not SESSION_SECRET_KEY:
    if APP_ENV == "production":
        raise RuntimeError("SESSION_SECRET_KEY must be configured for production")
    SESSION_SECRET_KEY = secrets.token_urlsafe(48)
BOOTSTRAP_ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "").strip()
GCS_PROJECT_ID = os.getenv("GCS_PROJECT_ID", "").strip()
GCS_SERVICE_ACCOUNT_JSON = os.getenv("GCS_SERVICE_ACCOUNT_JSON", "")
