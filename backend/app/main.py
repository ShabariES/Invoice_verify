import hashlib
import asyncio
import hmac
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import APP_ENV, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, FRONTEND_ORIGIN, GROQ_API_KEY, GROQ_MODEL, INBOUND_INVOICE_EMAIL, MAILGUN_WEBHOOK_SIGNING_KEY, OCR_REVIEW_THRESHOLD, OCR_SERVICE_TOKEN, OCR_SERVICE_URL, SESSION_SECRET_KEY, UPLOAD_DIR, WHATSAPP_ADMIN_TO, WHATSAPP_WEBHOOK_VERIFY_TOKEN
from app.chat_knowledge import CHAT_SYSTEM_PROMPT
from app.database import Base, SessionLocal, engine, get_db
from app.models import InboundReceipt, Invoice, InvoiceEvent, InvoiceLine, Lead, Notification, User
from app.inbound import ALLOWED_EXTENSIONS, MAX_INVOICE_BYTES, authenticated_mail_headers, download_whatsapp_media, normalize_phone, parse_sender, verify_mailgun_signature, verify_whatsapp_signature
from app.notifications import channel_status, send_email_notification, send_whatsapp_notification
from app.schemas import ChatRequest, InvoiceEventOut, InvoiceOut, InvoiceUpdate, LeadApprovalRequest, LeadCreate, LeadOut, LeadUpdate, LoginRequest, NotificationOut, NotificationPreferencesRequest, RegisterRequest, UserApprovalRequest, UserOut
from app.security import hash_password, verify_password
from app.storage import load_invoice_source, save_invoice_source

Base.metadata.create_all(bind=engine)
if "currency" not in {column["name"] for column in inspect(engine).get_columns("invoices")}:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE invoices ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'INR'"))
invoice_columns = {column["name"] for column in inspect(engine).get_columns("invoices")}
with engine.begin() as connection:
    for name, ddl in {
        "owner_user_id": "INTEGER",
        "ocr_status": "VARCHAR(24) NOT NULL DEFAULT 'not_run'",
        "ocr_provider": "VARCHAR(40) NOT NULL DEFAULT ''",
        "ocr_confidence": "NUMERIC(5,4)",
        "ocr_text": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in invoice_columns:
            connection.execute(text(f"ALTER TABLE invoices ADD COLUMN {name} {ddl}"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_owner_user_id ON invoices (owner_user_id)"))
lead_columns = {column["name"] for column in inspect(engine).get_columns("leads")}
timestamp_type = "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME"
with engine.begin() as connection:
    for name, ddl in {
        "owner_user_id": "INTEGER",
        "approval_status": "VARCHAR(24) NOT NULL DEFAULT 'approved'",
        "approved_by": "VARCHAR(254) NOT NULL DEFAULT ''",
        "approved_at": timestamp_type,
        "rejection_reason": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in lead_columns:
            connection.execute(text(f"ALTER TABLE leads ADD COLUMN {name} {ddl}"))
user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
with engine.begin() as connection:
    for name, ddl in {
        "approval_status": "VARCHAR(24) NOT NULL DEFAULT 'approved'",
        "approval_reviewed_by": "VARCHAR(254) NOT NULL DEFAULT ''",
        "approval_reviewed_at": timestamp_type,
        "approval_rejection_reason": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in user_columns:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
with engine.begin() as connection:
    for name, ddl in {
        "phone": "VARCHAR(32) NOT NULL DEFAULT ''",
        "whatsapp_opt_in": "BOOLEAN NOT NULL DEFAULT FALSE",
    }.items():
        if name not in user_columns:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Local Invoice Desk", version="0.1.0")
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET_KEY,
    session_cookie="techjays_session",
    max_age=8 * 60 * 60,
    same_site="lax",
    https_only=APP_ENV == "production",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    # Local development may be opened with either loopback hostname and Vite
    # can move to another port when 5173 is already occupied.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    user = db.get(User, user_id) if isinstance(user_id, int) else None
    if not user or not user.is_active:
        request.session.clear()
        raise HTTPException(401, "Sign in to continue")
    if user.approval_status != "approved":
        request.session.clear()
        raise HTTPException(403, "Your account is awaiting administrator approval" if user.approval_status == "pending" else "Your account access was not approved")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Administrator access is required")
    return user


def require_invoice_access(user: User = Depends(require_user)) -> User:
    if user.role not in {"admin", "lead"}:
        raise HTTPException(403, "Approved workspace access is required")
    return user


def ensure_invoice_access(invoice: Invoice, user: User) -> None:
    # Return 404 for another account's invoice to avoid confirming its existence.
    if user.role != "admin" and invoice.owner_user_id != user.id:
        raise HTTPException(404, "Invoice not found")


def queue_notification(db: Session, background_tasks: BackgroundTasks, recipients: list[User], title: str, message: str, category: str, entity_type: str = "", entity_id: int | None = None):
    unique_users = {recipient.id: recipient for recipient in recipients}
    channels = channel_status()
    for recipient in unique_users.values():
        db.add(Notification(recipient_user_id=recipient.id, title=title, message=message, category=category, entity_type=entity_type, entity_id=entity_id))
        if channels["email"]:
            background_tasks.add_task(send_email_notification, recipient.email, title, message)
        if channels["whatsapp"] and recipient.whatsapp_opt_in and recipient.phone:
            background_tasks.add_task(send_whatsapp_notification, recipient.phone, title, message)


def queue_admin_notification(db: Session, background_tasks: BackgroundTasks, title: str, message: str, category: str, entity_type: str = "", entity_id: int | None = None):
    admins = list(db.scalars(select(User).where(User.role == "admin", User.is_active.is_(True))).all())
    queue_notification(db, background_tasks, admins, title, message, category, entity_type, entity_id)
    if channel_status()["whatsapp"]:
        opted_in_admin_numbers = {re.sub(r"\D", "", admin.phone) for admin in admins if admin.whatsapp_opt_in and admin.phone}
        configured_numbers = {re.sub(r"\D", "", item.strip()) for item in WHATSAPP_ADMIN_TO.split(",") if item.strip()}
        for phone in configured_numbers - opted_in_admin_numbers:
            background_tasks.add_task(send_whatsapp_notification, phone, title, message)


def public_user(user: User) -> UserOut:
    return UserOut(id=user.id, name=user.name, email=user.email, role=user.role, approval_status=user.approval_status, created_at=user.created_at)


if BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD:
    if len(BOOTSTRAP_ADMIN_PASSWORD) < 12:
        raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters")
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == BOOTSTRAP_ADMIN_EMAIL))
        if not admin:
            db.add(User(name="Administrator", email=BOOTSTRAP_ADMIN_EMAIL, password_hash=hash_password(BOOTSTRAP_ADMIN_PASSWORD), role="admin", approval_status="approved"))
        else:
            admin.role = "admin"
            admin.is_active = True
            admin.approval_status = "approved"
            admin.approval_rejection_reason = ""
        db.commit()
elif APP_ENV == "production":
    raise RuntimeError("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before starting in production")


@app.post("/api/auth/register", response_model=UserOut, status_code=201)
def register(payload: RegisterRequest, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email address")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    phone = re.sub(r"[^+0-9]", "", payload.phone)[:32]
    user = User(name=payload.name.strip(), email=email, phone=phone, whatsapp_opt_in=bool(payload.whatsapp_opt_in and phone), password_hash=hash_password(payload.password), role="lead", approval_status="pending")
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from exc
    db.refresh(user)
    queue_admin_notification(db, background_tasks, "New workspace access request", f"{user.name} requested Lead access.", "account", "user", user.id)
    db.commit()
    return public_user(user)


@app.post("/api/auth/login", response_model=UserOut)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    if user.approval_status != "approved":
        if user.approval_status == "pending":
            raise HTTPException(403, "Your account is pending administrator approval. You can sign in after an Admin approves your access.")
        raise HTTPException(403, f"Your account access was not approved.{(' ' + user.approval_rejection_reason) if user.approval_rejection_reason else ''}")
    request.session.clear()
    request.session["user_id"] = user.id
    return public_user(user)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request):
    request.session.clear()


@app.get("/api/auth/me", response_model=UserOut)
def who_am_i(user: User = Depends(require_user)):
    return public_user(user)


@app.get("/api/notifications/status")
def notification_status(_user: User = Depends(require_user)):
    return channel_status()


@app.get("/api/auth/notification-preferences")
def get_notification_preferences(user: User = Depends(require_user)):
    return {"phone": user.phone, "whatsapp_opt_in": user.whatsapp_opt_in}


@app.patch("/api/auth/notification-preferences")
def update_notification_preferences(payload: NotificationPreferencesRequest, db: Session = Depends(get_db), user: User = Depends(require_user)):
    phone = re.sub(r"[^+0-9]", "", payload.phone)[:32]
    if payload.whatsapp_opt_in and not phone:
        raise HTTPException(422, "Enter a phone number before opting in to WhatsApp notifications")
    user.phone = phone
    user.whatsapp_opt_in = payload.whatsapp_opt_in
    db.commit()
    return {"phone": user.phone, "whatsapp_opt_in": user.whatsapp_opt_in}


@app.get("/api/notifications", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db), user: User = Depends(require_user)):
    return list(db.scalars(select(Notification).where(Notification.recipient_user_id == user.id).order_by(Notification.created_at.desc()).limit(50)).all())


@app.get("/api/notifications/channels")
def notification_channels(_admin: User = Depends(require_admin)):
    return channel_status()


@app.post("/api/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    notification = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.recipient_user_id == user.id))
    if not notification:
        raise HTTPException(404, "Notification not found")
    notification.read_at = notification.read_at or datetime.now(timezone.utc)
    db.commit()
    db.refresh(notification)
    return notification


@app.post("/api/notifications/read-all", status_code=204)
def mark_all_notifications_read(db: Session = Depends(get_db), user: User = Depends(require_user)):
    db.query(Notification).filter(Notification.recipient_user_id == user.id, Notification.read_at.is_(None)).update({Notification.read_at: datetime.now(timezone.utc)}, synchronize_session=False)
    db.commit()


@app.get("/api/admin/access-requests", response_model=list[UserOut])
def list_access_requests(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list(db.scalars(select(User).where(User.role == "lead", User.approval_status == "pending").order_by(User.created_at.asc())).all())


@app.get("/api/admin/lead-accounts", response_model=list[UserOut])
def list_lead_accounts(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list(db.scalars(select(User).where(User.role == "lead").order_by(User.created_at.desc())).all())


@app.post("/api/admin/users/{user_id}/approval", response_model=UserOut)
def decide_user_access(user_id: int, payload: UserApprovalRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user or user.role != "lead":
        raise HTTPException(404, "Pending Lead account not found")
    if user.approval_status != "pending":
        raise HTTPException(409, "This account request has already been reviewed")
    user.approval_status = payload.action
    user.approval_reviewed_by = admin.email
    user.approval_reviewed_at = datetime.now(timezone.utc)
    user.approval_rejection_reason = payload.reason.strip() if payload.action == "rejected" else ""
    user.is_active = payload.action == "approved"
    queue_notification(db, background_tasks, [user], "Workspace access approved" if payload.action == "approved" else "Workspace access not approved", "Your Lead account is ready to use." if payload.action == "approved" else (payload.reason.strip() or "Contact an administrator if you think this was a mistake."), "account", "user", user.id)
    db.commit()
    db.refresh(user)
    return public_user(user)


@app.get("/api/chat/status")
def chat_status():
    return {"configured": bool(GROQ_API_KEY), "provider": "groq", "model": GROQ_MODEL if GROQ_API_KEY else None}


@app.post("/api/chat")
async def chat_with_project(payload: ChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(503, "Groq is not configured. Set GROQ_API_KEY in the backend environment.")
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    messages.extend(message.model_dump() for message in payload.messages[-10:])
    body = json.dumps({
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_completion_tokens": 600,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
            # Groq's edge rejects Python's default urllib user agent (403/1010).
            "User-Agent": "groq-python/0.31.0",
        },
        method="POST",
    )
    try:
        def send_request():
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        result = await asyncio.to_thread(send_request)
    except urllib.error.HTTPError as exc:
        error_message = ""
        try:
            raw_error = exc.read().decode("utf-8", errors="replace")
            try:
                upstream_error = json.loads(raw_error)
                error_message = str(upstream_error.get("error", {}).get("message", ""))
            except ValueError:
                error_message = raw_error
            error_message = error_message.replace(GROQ_API_KEY, "[redacted]")[:240]
        except (AttributeError, UnicodeError):
            error_message = ""
        detail = f"Groq returned HTTP {exc.code}"
        if error_message:
            detail += f": {error_message}"
        raise HTTPException(502, detail) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Groq could not be reached. Try again in a moment.") from exc
    try:
        reply = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(502, "Groq returned an unexpected chat response.") from exc
    if not isinstance(reply, str) or not reply.strip():
        raise HTTPException(502, "Groq returned an empty response.")
    return {"reply": reply.strip(), "provider": "groq", "model": GROQ_MODEL}


@app.get("/ready")
def ready():
    return {"status": "ready", "ocr_configured": bool(OCR_SERVICE_URL)}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/invoices", response_model=list[InvoiceOut])
def list_invoices(db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    statement = select(Invoice)
    if user.role != "admin":
        statement = statement.where(Invoice.owner_user_id == user.id)
    return list(db.scalars(statement.order_by(Invoice.created_at.desc())).all())


@app.get("/api/leads", response_model=list[LeadOut])
def list_leads(q: str = "", status: str = "", db: Session = Depends(get_db), user: User = Depends(require_user)):
    statement = select(Lead)
    if user.role != "admin":
        statement = statement.where(Lead.owner_user_id == user.id)
    if q.strip():
        term = f"%{q.strip()}%"
        statement = statement.where(or_(Lead.company_name.ilike(term), Lead.contact_name.ilike(term), Lead.email.ilike(term), Lead.phone.ilike(term)))
    if status and status != "all":
        statement = statement.where(Lead.status == status)
    return list(db.scalars(statement.order_by(Lead.created_at.desc())).all())


@app.post("/api/leads", response_model=LeadOut, status_code=201)
def create_lead(payload: LeadCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(require_user)):
    values = payload.model_dump()
    values["company_name"] = values["company_name"].strip()
    if not values["company_name"]:
        raise HTTPException(422, "Company name is required")
    lead = Lead(**values, owner_user_id=user.id, approval_status="pending")
    db.add(lead)
    db.commit()
    db.refresh(lead)
    queue_admin_notification(db, background_tasks, "New CRM lead submitted", f"{lead.company_name} was added to the lead pipeline.", "lead", "lead", lead.id)
    db.commit()
    return lead


@app.patch("/api/leads/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: int, payload: LeadUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    if user.role != "admin" and lead.owner_user_id != user.id:
        raise HTTPException(403, "You can only manage leads assigned to your account")
    if user.role != "admin" and lead.approval_status != "pending":
        lead.approval_status = "pending"
        lead.approved_by = ""
        lead.approved_at = None
        lead.rejection_reason = ""
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "company_name" and value is not None:
            value = value.strip()
            if not value:
                raise HTTPException(422, "Company name is required")
        setattr(lead, key, value)
    db.commit()
    db.refresh(lead)
    return lead


@app.post("/api/leads/{lead_id}/approval", response_model=LeadOut)
def decide_lead(lead_id: int, payload: LeadApprovalRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    if lead.approval_status != "pending":
        raise HTTPException(409, "This lead has already been reviewed")
    lead.approval_status = payload.action
    lead.approved_by = admin.email if payload.action == "approved" else ""
    lead.approved_at = datetime.now(timezone.utc) if payload.action == "approved" else None
    lead.rejection_reason = payload.reason.strip() if payload.action == "rejected" else ""
    if lead.owner_user_id:
        owner = db.get(User, lead.owner_user_id)
        if owner:
            queue_notification(db, background_tasks, [owner], f"Lead {payload.action}", f"{lead.company_name} was {payload.action} by an Admin." + (f" Reason: {payload.reason.strip()}" if payload.action == "rejected" and payload.reason.strip() else ""), "lead", "lead", lead.id)
    db.commit()
    db.refresh(lead)
    return lead


@app.get("/api/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    ensure_invoice_access(invoice, user)
    return invoice


@app.get("/api/invoices/{invoice_id}/events", response_model=list[InvoiceEventOut])
def invoice_events(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    ensure_invoice_access(invoice, user)
    return list(db.scalars(select(InvoiceEvent).where(InvoiceEvent.invoice_id == invoice_id).order_by(InvoiceEvent.created_at.desc())).all())


@app.post("/api/invoices/{invoice_id}/extract")
async def extract_invoice(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    if not OCR_SERVICE_URL:
        raise HTTPException(503, "OCR service is not configured. Set OCR_SERVICE_URL to enable document reading.")
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    ensure_invoice_access(invoice, user)
    if invoice.status != "needs_review":
        raise HTTPException(409, "Only invoices awaiting review can be processed")
    source_data = await asyncio.to_thread(load_invoice_source, invoice.source_path, invoice.source_name)
    if source_data is None:
        raise HTTPException(404, "Invoice source file not found in configured storage")

    def request_ocr():
        boundary = "----TechJaysInvoiceOCRBoundary7MA4YWxkTrZu0gW"
        data = source_data
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{invoice.source_name}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("ascii")
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if OCR_SERVICE_TOKEN:
            headers["X-OCR-Service-Token"] = OCR_SERVICE_TOKEN
        request = urllib.request.Request(f"{OCR_SERVICE_URL.rstrip('/')}/v1/extract", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise HTTPException(502, f"OCR service returned HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", None)
            if isinstance(reason, (ConnectionError, OSError, TimeoutError)):
                detail = (
                    "OCR service is not running. Start it from the backend directory with "
                    "python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8001."
                )
            else:
                detail = "OCR service could not be reached. Check its URL and network settings."
            raise HTTPException(502, detail) from exc
        except (TimeoutError, json.JSONDecodeError) as exc:
            raise HTTPException(502, "OCR service timed out or returned an invalid response") from exc

    try:
        result = await asyncio.to_thread(request_ocr)
    except HTTPException:
        raise
    invoice.ocr_provider = str(result.get("provider", "unknown"))[:40]
    invoice.ocr_confidence = Decimal(str(result.get("confidence", 0)))
    invoice.ocr_text = str(result.get("raw_text", ""))[:100_000]
    confidence = float(invoice.ocr_confidence or 0)
    needs_review = confidence < OCR_REVIEW_THRESHOLD or bool(result.get("low_confidence"))
    invoice.ocr_status = "complete" if invoice.ocr_text.strip() and not needs_review else "low_confidence"
    db.add(InvoiceEvent(
        invoice_id=invoice.id,
        event_type="ocr_completed",
        details=f"OCR via {invoice.ocr_provider}; confidence {confidence:.0%}; human verification {'required' if needs_review else 'still required before approval'}.",
    ))
    db.commit()
    db.refresh(invoice)
    return {"invoice": InvoiceOut.model_validate(invoice), "confidence_threshold": OCR_REVIEW_THRESHOLD, "low_confidence": needs_review}


@app.post("/api/invoices/upload", response_model=InvoiceOut, status_code=201)
async def upload_invoice(background_tasks: BackgroundTasks, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    data = await file.read(MAX_INVOICE_BYTES + 1)
    return await create_invoice_from_upload(data, file.filename or "invoice", user, db, background_tasks)


async def create_invoice_from_upload(data: bytes, filename: str, user: User, db: Session, background_tasks: BackgroundTasks, source_channel: str = "workspace") -> Invoice:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Upload a PDF or image (PNG, JPG, WEBP)")
    if not data or len(data) > MAX_INVOICE_BYTES:
        raise HTTPException(413, "File must be between 1 byte and 15 MB")
    valid_signature = (
        (suffix == ".pdf" and data.startswith(b"%PDF-"))
        or (suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
        or (suffix in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8\xff"))
        or (suffix == ".webp" and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )
    if not valid_signature:
        raise HTTPException(415, "Attachment contents do not match a supported invoice file")
    digest = hashlib.sha256(data).hexdigest()
    duplicate_query = select(Invoice).where(Invoice.source_path == digest)
    if user.role != "admin":
        duplicate_query = duplicate_query.where(Invoice.owner_user_id == user.id)
    existing = db.scalar(duplicate_query)
    if existing:
        db.add(InvoiceEvent(invoice_id=existing.id, event_type="duplicate_upload", details=f"Rejected repeated source file: {Path(filename).name[:255]}"))
        db.commit()
        raise HTTPException(409, f"This exact file was already uploaded as invoice {existing.id}")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)[:150]
    try:
        await asyncio.to_thread(save_invoice_source, data, digest, safe_name)
    except Exception as exc:
        raise HTTPException(502, "Could not store the invoice source file") from exc
    invoice = Invoice(source_path=digest, source_name=safe_name, status="needs_review", owner_user_id=user.id)
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    db.add(InvoiceEvent(invoice_id=invoice.id, event_type="uploaded", actor=user.email, details=f"Source file received via {source_channel}: {safe_name}"))
    queue_admin_notification(db, background_tasks, "Invoice ready for review", f"{user.name} ({user.email}) uploaded a supplier invoice ({safe_name}).", "invoice", "invoice", invoice.id)
    if source_channel != "workspace":
        queue_notification(db, background_tasks, [user], "Invoice received", f"{safe_name} was received through {source_channel} and added to your private review workspace.", "invoice", "invoice", invoice.id)
    db.commit()
    return invoice


def claim_inbound_receipt(db: Session, provider: str, external_id: str, owner_user_id: int | None) -> tuple[InboundReceipt, bool]:
    external_id = external_id[:255]
    receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.provider == provider, InboundReceipt.external_id == external_id))
    if receipt:
        if receipt.status in {"complete", "ignored"}:
            return receipt, False
        if receipt.status == "processing" and (datetime.now(timezone.utc) - receipt.created_at.replace(tzinfo=timezone.utc)).total_seconds() < 600:
            return receipt, False
        receipt.owner_user_id = owner_user_id
        receipt.status = "processing"
        db.commit()
        return receipt, True
    receipt = InboundReceipt(provider=provider, external_id=external_id[:255], owner_user_id=owner_user_id)
    db.add(receipt)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.provider == provider, InboundReceipt.external_id == external_id[:255]))
        if receipt and receipt.status in {"complete", "ignored"}:
            return receipt, False
        if not receipt:
            raise
        receipt.status = "processing"
        db.commit()
    db.refresh(receipt)
    return receipt, True


@app.post("/api/inbound/email/mailgun")
async def inbound_email_mailgun(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if not MAILGUN_WEBHOOK_SIGNING_KEY or not INBOUND_INVOICE_EMAIL:
        raise HTTPException(503, "Inbound email is not configured")
    try:
        if int(request.headers.get("content-length", "0")) > 25 * 1024 * 1024:
            raise HTTPException(413, "Email message exceeds the 25 MB receive limit")
    except ValueError:
        raise HTTPException(400, "Invalid content length")
    form = await request.form()
    if not verify_mailgun_signature(str(form.get("timestamp", "")), str(form.get("token", "")), str(form.get("signature", ""))):
        raise HTTPException(406, "Invalid or expired email provider signature")
    sender = parse_sender(str(form.get("sender") or form.get("from") or ""))
    if not authenticated_mail_headers(form.get("message-headers"), sender):
        raise HTTPException(406, "Email sender authentication failed")
    recipients = {address.lower().strip(".,>") for address in re.findall(r"[^\s,<>;]+@[^\s,<>;]+", str(form.get("recipient") or form.get("To") or ""))}
    if INBOUND_INVOICE_EMAIL.lower() not in recipients:
        raise HTTPException(406, "Email was not addressed to the configured invoice mailbox")
    user = db.scalar(select(User).where(User.email == sender, User.role == "lead", User.approval_status == "approved", User.is_active.is_(True)))
    if not user:
        logger.warning("Ignored inbound invoice email from an unapproved sender")
        return {"accepted": False, "reason": "Sender is not an approved Lead account"}
    message_id = str(form.get("Message-Id") or form.get("message-id") or form.get("Message-ID") or form.get("token") or "").strip(" <>\t\r\n")
    if not message_id:
        raise HTTPException(422, "Email message identifier is missing")
    receipt, should_process = claim_inbound_receipt(db, "mailgun", message_id, user.id)
    if not should_process:
        return {"accepted": True, "duplicate_delivery": True, "invoice_ids": json.loads(receipt.invoice_ids or "[]")}
    created_ids: list[int] = []
    try:
        attachments = [(key, value) for key, value in form.multi_items() if key.startswith("attachment-") and isinstance(value, StarletteUploadFile)]
        for _key, attachment in attachments:
            data = await attachment.read(MAX_INVOICE_BYTES + 1)
            try:
                invoice = await create_invoice_from_upload(data, attachment.filename or "invoice", user, db, background_tasks, "email")
                created_ids.append(invoice.id)
            except HTTPException as exc:
                if exc.status_code not in {409, 413, 415}:
                    raise
                logger.info("Skipped inbound email attachment (%s)", exc.status_code)
        receipt.invoice_ids = json.dumps(created_ids)
        receipt.status = "complete" if created_ids else "ignored"
        db.commit()
        return {"accepted": bool(created_ids), "invoice_ids": created_ids, "skipped_attachments": len(attachments) - len(created_ids)}
    except Exception:
        db.rollback()
        receipt = db.get(InboundReceipt, receipt.id)
        if receipt:
            receipt.status = "failed"
            db.commit()
        raise


@app.get("/api/inbound/whatsapp")
def verify_whatsapp_webhook(request: Request):
    query = request.query_params
    if (query.get("hub.mode") == "subscribe" and WHATSAPP_WEBHOOK_VERIFY_TOKEN and hmac.compare_digest(query.get("hub.verify_token", ""), WHATSAPP_WEBHOOK_VERIFY_TOKEN)):
        return Response(content=query.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(403, "WhatsApp webhook verification failed")


@app.post("/api/inbound/whatsapp")
async def inbound_whatsapp(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    body = await request.body()
    if not verify_whatsapp_signature(body, request.headers.get("X-Hub-Signature-256")):
        raise HTTPException(401, "Invalid WhatsApp webhook signature")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Invalid WhatsApp webhook payload") from exc
    processed = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            for message in (change.get("value") or {}).get("messages", []):
                media_type = message.get("type")
                if media_type not in {"document", "image"}:
                    continue
                sender_phone = normalize_phone(message.get("from"))
                leads = db.scalars(select(User).where(User.role == "lead", User.approval_status == "approved", User.is_active.is_(True))).all()
                owner = next((candidate for candidate in leads if normalize_phone(candidate.phone) == sender_phone and 8 <= len(sender_phone) <= 15), None)
                if not owner:
                    logger.warning("Ignored WhatsApp invoice from an unapproved or unmatched number")
                    continue
                external_id = str(message.get("id") or "")
                media = message.get(media_type) or {}
                media_id = str(media.get("id") or "")
                if not external_id or not media_id:
                    continue
                receipt, should_process = claim_inbound_receipt(db, "whatsapp", external_id, owner.id)
                if not should_process:
                    processed.append({"duplicate_delivery": True, "invoice_ids": json.loads(receipt.invoice_ids or "[]")})
                    continue
                try:
                    data, content_type = await asyncio.to_thread(download_whatsapp_media, media_id)
                    filename = str(media.get("filename") or "")
                    if not filename:
                        extension = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(content_type, "")
                        filename = f"whatsapp-{external_id[-18:]}{extension}"
                    invoice = await create_invoice_from_upload(data, filename, owner, db, background_tasks, "WhatsApp")
                    receipt = db.get(InboundReceipt, receipt.id)
                    receipt.invoice_ids = json.dumps([invoice.id])
                    receipt.status = "complete"
                    db.commit()
                    processed.append({"invoice_ids": [invoice.id]})
                except (HTTPException, urllib.error.URLError, TimeoutError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
                    receipt = db.get(InboundReceipt, receipt.id)
                    if receipt:
                        receipt.status = "failed" if not isinstance(exc, HTTPException) or exc.status_code >= 500 else "ignored"
                        db.commit()
                    if isinstance(exc, (urllib.error.URLError, TimeoutError, RuntimeError)):
                        raise HTTPException(503, "WhatsApp media download failed; retry the delivery") from exc
                    if isinstance(exc, HTTPException) and exc.status_code not in {409, 413, 415}:
                        raise
                    logger.info("Skipped or failed WhatsApp invoice attachment (%s)", type(exc).__name__)
    return {"received": True, "messages": processed}


@app.patch("/api/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: int, payload: InvoiceUpdate, db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    ensure_invoice_access(invoice, user)
    if invoice.status != "needs_review":
        raise HTTPException(409, "Only invoices awaiting review can be edited")
    if payload.lines:
        for index, line in enumerate(payload.lines, start=1):
            if abs(line.quantity * line.rate - line.amount) > Decimal("0.01"):
                raise HTTPException(422, f"Line {index}: quantity × rate must reconcile to amount")
    if payload.currency not in {"INR", "USD", "EUR", "GBP"}:
        raise HTTPException(422, "Choose a supported currency: INR, USD, EUR, GBP")
    for key in ("invoice_number", "invoice_date", "supplier_name", "supplier_gstin", "currency", "subtotal", "tax_amount", "total"):
        setattr(invoice, key, getattr(payload, key))
    invoice.lines.clear()
    invoice.lines.extend(InvoiceLine(**line.model_dump()) for line in payload.lines)
    invoice.supplier_gstin = invoice.supplier_gstin.strip().upper()
    invoice.invoice_number = invoice.invoice_number.strip()
    if invoice.supplier_gstin and invoice.invoice_number:
        duplicate_query = select(Invoice).where(
            Invoice.id != invoice.id,
            Invoice.supplier_gstin == invoice.supplier_gstin,
            func.lower(Invoice.invoice_number) == invoice.invoice_number.lower(),
        )
        if user.role != "admin":
            duplicate_query = duplicate_query.where(Invoice.owner_user_id == user.id)
        duplicate = db.scalar(duplicate_query)
        if duplicate:
            db.rollback()
            raise HTTPException(409, f"Possible duplicate of invoice {duplicate.id}")
    try:
        db.add(InvoiceEvent(invoice_id=invoice.id, event_type="draft_saved", details="Invoice details and line items saved for review."))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Could not save invoice") from exc
    db.refresh(invoice)
    return invoice


@app.post("/api/invoices/{invoice_id}/approve", response_model=InvoiceOut)
def approve_invoice(invoice_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != "needs_review":
        raise HTTPException(409, "Invoice is not awaiting review")
    if not invoice.invoice_number or not invoice.supplier_name.strip():
        raise HTTPException(422, "Enter supplier name and invoice number before approval")
    if not invoice.lines:
        raise HTTPException(422, "Add at least one line item before approval")
    line_sum = sum((line.amount for line in invoice.lines), Decimal("0"))
    if any(abs(line.quantity * line.rate - line.amount) > Decimal("0.01") for line in invoice.lines):
        raise HTTPException(422, "Each line item quantity × rate must reconcile to its amount")
    if abs(line_sum - invoice.subtotal) > Decimal("0.01"):
        raise HTTPException(422, "Line item amounts must reconcile to subtotal")
    if abs(invoice.subtotal + invoice.tax_amount - invoice.total) > Decimal("0.01"):
        raise HTTPException(422, "Subtotal plus tax must reconcile to invoice total")
    invoice.status = "approved"
    invoice.reviewer = admin.name[:160]
    invoice.approved_at = datetime.now(timezone.utc)
    db.add(InvoiceEvent(invoice_id=invoice.id, event_type="approved", actor=invoice.reviewer, details="Human review completed; invoice approved in the local workspace."))
    queue_admin_notification(db, background_tasks, "Invoice approved", f"Invoice {invoice.invoice_number} was approved by {admin.name}.", "invoice", "invoice", invoice.id)
    db.commit()
    db.refresh(invoice)
    return invoice


@app.get("/api/files/{invoice_id}")
def invoice_file(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(require_invoice_access)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    ensure_invoice_access(invoice, user)
    source_data = load_invoice_source(invoice.source_path, invoice.source_name)
    if source_data is None:
        raise HTTPException(404, "Invoice source file not found in configured storage")
    import mimetypes
    media_type = mimetypes.guess_type(invoice.source_name)[0] or "application/octet-stream"
    return Response(
        content=source_data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{invoice.source_name}"'},
    )
