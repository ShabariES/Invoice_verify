from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    # One approved Lead account is one isolated invoice workspace. Legacy rows
    # remain unassigned and are visible only to Admins.
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(120), default="")
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(240), default="Needs review")
    supplier_gstin: Mapped[str] = mapped_column(String(20), default="")
    currency: Mapped[str] = mapped_column(String(3), default="INR", server_default="INR")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    tax_calculation: Mapped[str] = mapped_column(String(24), default="amount", server_default="amount")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=0, server_default="0")
    interest_period_months: Mapped[int] = mapped_column(Integer, default=12, server_default="12")
    compounding_frequency: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    source_path: Mapped[str] = mapped_column(Text, default="")
    source_name: Mapped[str] = mapped_column(String(255), default="")
    ocr_status: Mapped[str] = mapped_column(String(24), default="not_run", server_default="not_run")
    ocr_provider: Mapped[str] = mapped_column(String(40), default="", server_default="")
    ocr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    ocr_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    ocr_fields: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(String(32), default="needs_review", index=True)
    reviewer: Mapped[str] = mapped_column(String(160), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    lines: Mapped[list["InvoiceLine"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(Text, default="")
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=1)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    invoice: Mapped[Invoice] = relationship(back_populates="lines")


class InvoiceEvent(Base):
    """Append-only record of material actions in the local invoice workflow."""
    __tablename__ = "invoice_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    actor: Mapped[str] = mapped_column(String(160), default="local user")
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    invoice: Mapped[Invoice] = relationship()


class InboundReceipt(Base):
    """Idempotency record for provider delivery retries."""
    __tablename__ = "inbound_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), index=True)
    external_id: Mapped[str] = mapped_column(String(255))
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="processing", index=True)
    invoice_ids: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    __table_args__ = (UniqueConstraint("provider", "external_id", name="uq_inbound_receipt_provider_external_id"), {"sqlite_autoincrement": True})


class Lead(Base):
    __tablename__ = "leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_name: Mapped[str] = mapped_column(String(240), index=True)
    contact_name: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    whatsapp_opt_in: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    source: Mapped[str] = mapped_column(String(80), default="Website")
    industry: Mapped[str] = mapped_column(String(120), default="")
    estimated_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)
    next_follow_up: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approval_status: Mapped[str] = mapped_column(String(24), default="pending", server_default="pending", index=True)
    approved_by: Mapped[str] = mapped_column(String(254), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    company_name: Mapped[str] = mapped_column(String(240), default="", server_default="")
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(32), default="", server_default="")
    whatsapp_opt_in: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(24), default="lead", server_default="lead")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    approval_status: Mapped[str] = mapped_column(String(24), default="approved", server_default="approved", index=True)
    approval_reviewed_by: Mapped[str] = mapped_column(String(254), default="", server_default="")
    approval_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_rejection_reason: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32), default="system", index=True)
    entity_type: Mapped[str] = mapped_column(String(32), default="")
    entity_id: Mapped[int | None] = mapped_column(nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
