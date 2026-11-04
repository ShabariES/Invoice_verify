import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
APP_ENV = os.getenv("APP_ENV", "development").lower()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgres://")
elif DATABASE_URL.startswith("postgresql://"):
    # The backend installs psycopg v3, so explicitly select that SQLAlchemy driver
    # for standard Neon connection strings (which use postgresql://).
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgresql://")
if APP_ENV == "production" and not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must point to the hosted PostgreSQL database in production")
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./invoices.db"
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(ROOT / "uploads"))).resolve()
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
OCR_SERVICE_URL = os.getenv("OCR_SERVICE_URL", "")
OCR_SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
OCR_REVIEW_THRESHOLD = float(os.getenv("OCR_REVIEW_THRESHOLD", "0.95"))
OCR_MODEL = os.getenv("OCR_MODEL", "PP-OCRv5_server")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "")
if not SESSION_SECRET_KEY:
    if APP_ENV == "production":
        raise RuntimeError("SESSION_SECRET_KEY must be configured for production")
    SESSION_SECRET_KEY = secrets.token_urlsafe(48)
BOOTSTRAP_ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "").strip()
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes"}
WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_GRAPH_API_VERSION = os.getenv("WHATSAPP_GRAPH_API_VERSION", "v25.0")
WHATSAPP_TEMPLATE_NAME = os.getenv("WHATSAPP_TEMPLATE_NAME", "techjays_notification")
WHATSAPP_TEMPLATE_LANGUAGE = os.getenv("WHATSAPP_TEMPLATE_LANGUAGE", "en_US")
WHATSAPP_ADMIN_TO = os.getenv("WHATSAPP_ADMIN_TO", "")
ADMIN_WHATSAPP_PHONE = os.getenv("ADMIN_WHATSAPP_PHONE", "+916369035633").strip()
WHATSAPP_APP_SECRET = os.getenv("WHATSAPP_APP_SECRET", "")
WHATSAPP_WEBHOOK_VERIFY_TOKEN = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")
MAILGUN_WEBHOOK_SIGNING_KEY = os.getenv("MAILGUN_WEBHOOK_SIGNING_KEY", "")
INBOUND_INVOICE_EMAIL = os.getenv("INBOUND_INVOICE_EMAIL", "")
APPS_SCRIPT_INBOUND_TOKEN = os.getenv("APPS_SCRIPT_INBOUND_TOKEN", "")
GMAIL_APPS_SCRIPT_URL = os.getenv("GMAIL_APPS_SCRIPT_URL", "").strip()
GMAIL_APPS_SCRIPT_TOKEN = os.getenv("GMAIL_APPS_SCRIPT_TOKEN", "")
WHATSAPP_INBOUND_NUMBER = os.getenv("WHATSAPP_INBOUND_NUMBER", "")
