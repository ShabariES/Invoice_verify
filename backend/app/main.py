import hashlib
import asyncio
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import APP_ENV, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, FRONTEND_ORIGIN, GROQ_API_KEY, GROQ_MODEL, OCR_REVIEW_THRESHOLD, OCR_SERVICE_TOKEN, OCR_SERVICE_URL, SESSION_SECRET_KEY, UPLOAD_DIR
from app.chat_knowledge import CHAT_SYSTEM_PROMPT
from app.database import Base, SessionLocal, engine, get_db
from app.models import Invoice, InvoiceEvent, InvoiceLine, Lead, User
from app.schemas import ChatRequest, InvoiceEventOut, InvoiceOut, InvoiceUpdate, LeadApprovalRequest, LeadCreate, LeadOut, LeadUpdate, LoginRequest, RegisterRequest, UserApprovalRequest, UserOut
from app.security import hash_password, verify_password
from app.storage import load_invoice_source, save_invoice_source

Base.metadata.create_all(bind=engine)
if "currency" not in {column["name"] for column in inspect(engine).get_columns("invoices")}:
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE invoices ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'INR'"))
invoice_columns = {column["name"] for column in inspect(engine).get_columns("invoices")}
with engine.begin() as connection:
    for name, ddl in {
        "ocr_status": "VARCHAR(24) NOT NULL DEFAULT 'not_run'",
        "ocr_provider": "VARCHAR(40) NOT NULL DEFAULT ''",
        "ocr_confidence": "NUMERIC(5,4)",
        "ocr_text": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in invoice_columns:
            connection.execute(text(f"ALTER TABLE invoices ADD COLUMN {name} {ddl}"))
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
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email address")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(name=payload.name.strip(), email=email, password_hash=hash_password(payload.password), role="lead", approval_status="pending")
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from exc
    db.refresh(user)
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


@app.get("/api/admin/access-requests", response_model=list[UserOut])
def list_access_requests(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list(db.scalars(select(User).where(User.role == "lead", User.approval_status == "pending").order_by(User.created_at.asc())).all())


@app.get("/api/admin/lead-accounts", response_model=list[UserOut])
def list_lead_accounts(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list(db.scalars(select(User).where(User.role == "lead").order_by(User.created_at.desc())).all())


@app.post("/api/admin/users/{user_id}/approval", response_model=UserOut)
def decide_user_access(user_id: int, payload: UserApprovalRequest, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
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
def list_invoices(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list(db.scalars(select(Invoice).order_by(Invoice.created_at.desc())).all())


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
def create_lead(payload: LeadCreate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    values = payload.model_dump()
    values["company_name"] = values["company_name"].strip()
    if not values["company_name"]:
        raise HTTPException(422, "Company name is required")
    lead = Lead(**values, owner_user_id=user.id, approval_status="pending")
    db.add(lead)
    db.commit()
    db.refresh(lead)
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
def decide_lead(lead_id: int, payload: LeadApprovalRequest, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    if lead.approval_status != "pending":
        raise HTTPException(409, "This lead has already been reviewed")
    lead.approval_status = payload.action
    lead.approved_by = admin.email if payload.action == "approved" else ""
    lead.approved_at = datetime.now(timezone.utc) if payload.action == "approved" else None
    lead.rejection_reason = payload.reason.strip() if payload.action == "rejected" else ""
    db.commit()
    db.refresh(lead)
    return lead


@app.get("/api/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    return invoice


@app.get("/api/invoices/{invoice_id}/events", response_model=list[InvoiceEventOut])
def invoice_events(invoice_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    if not db.get(Invoice, invoice_id):
        raise HTTPException(404, "Invoice not found")
    return list(db.scalars(select(InvoiceEvent).where(InvoiceEvent.invoice_id == invoice_id).order_by(InvoiceEvent.created_at.desc())).all())


@app.post("/api/invoices/{invoice_id}/extract")
async def extract_invoice(invoice_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    if not OCR_SERVICE_URL:
        raise HTTPException(503, "OCR service is not configured. Set OCR_SERVICE_URL to enable document reading.")
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
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
async def upload_invoice(file: UploadFile = File(...), db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    suffix = Path(file.filename or "invoice").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(415, "Upload a PDF or image (PNG, JPG, WEBP)")
    data = await file.read(15 * 1024 * 1024 + 1)
    if not data or len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "File must be between 1 byte and 15 MB")
    digest = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(Invoice).where(Invoice.source_path == digest))
    if existing:
        db.add(InvoiceEvent(invoice_id=existing.id, event_type="duplicate_upload", details=f"Rejected repeated source file: {Path(file.filename or 'invoice').name[:255]}"))
        db.commit()
        raise HTTPException(409, f"This exact file was already uploaded as invoice {existing.id}")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(file.filename or "invoice").name)[:150]
    try:
        await asyncio.to_thread(save_invoice_source, data, digest, safe_name)
    except Exception as exc:
        raise HTTPException(502, "Could not store the invoice source file") from exc
    invoice = Invoice(source_path=digest, source_name=safe_name, status="needs_review")
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    db.add(InvoiceEvent(invoice_id=invoice.id, event_type="uploaded", details=f"Source file received: {safe_name}"))
    db.commit()
    return invoice


@app.patch("/api/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: int, payload: InvoiceUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
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
        duplicate = db.scalar(select(Invoice).where(
            Invoice.id != invoice.id,
            Invoice.supplier_gstin == invoice.supplier_gstin,
            func.lower(Invoice.invoice_number) == invoice.invoice_number.lower(),
        ))
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
def approve_invoice(invoice_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
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
    db.commit()
    db.refresh(invoice)
    return invoice


@app.get("/api/files/{invoice_id}")
def invoice_file(invoice_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
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
