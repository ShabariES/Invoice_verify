from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LineData(BaseModel):
    description: str = ""
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    # Negative rates/amounts are allowed for invoice-level discounts or credits.
    rate: Decimal = Field(default=Decimal("0"))
    amount: Decimal = Field(default=Decimal("0"))


class InvoiceUpdate(BaseModel):
    invoice_number: str = ""
    invoice_date: date | None = None
    supplier_name: str = ""
    supplier_gstin: str = ""
    currency: str = "INR"
    subtotal: Decimal = Field(default=Decimal("0"), ge=0)
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    tax_calculation: Literal["amount", "percentage", "simple_interest", "compound_interest"] = "amount"
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    interest_period_months: int = Field(default=12, ge=1, le=120)
    compounding_frequency: Literal[1, 2, 4, 12] = 1
    total: Decimal = Field(default=Decimal("0"), ge=0)
    lines: list[LineData] = []


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    invoice_date: date | None
    supplier_name: str
    supplier_gstin: str
    currency: str
    subtotal: Decimal
    tax_amount: Decimal
    tax_calculation: str = "amount"
    tax_rate: Decimal
    interest_period_months: int
    compounding_frequency: int
    total: Decimal
    source_path: str
    source_name: str
    ocr_status: str
    ocr_provider: str
    ocr_confidence: Decimal | None
    ocr_text: str
    ocr_fields: dict[str, Any] = Field(default_factory=dict)
    status: str
    reviewer: str
    approved_at: datetime | None
    created_at: datetime
    lines: list[LineData]


class InvoiceEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    event_type: str
    actor: str
    details: str
    created_at: datetime


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=3000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=12)


class LeadCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=240)
    contact_name: str = Field(default="", max_length=160)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=40)
    whatsapp_opt_in: bool = False
    source: str = Field(default="Website", max_length=80)
    industry: str = Field(default="", max_length=120)
    estimated_value: Decimal = Field(default=Decimal("0"), ge=0)
    status: Literal["new", "contacted", "qualified", "proposal", "won", "lost"] = "new"
    next_follow_up: date | None = None
    notes: str = Field(default="", max_length=4000)


class LeadUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=240)
    contact_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=40)
    whatsapp_opt_in: bool | None = None
    source: str | None = Field(default=None, max_length=80)
    industry: str | None = Field(default=None, max_length=120)
    estimated_value: Decimal | None = Field(default=None, ge=0)
    status: Literal["new", "contacted", "qualified", "proposal", "won", "lost"] | None = None
    next_follow_up: date | None = None
    notes: str | None = Field(default=None, max_length=4000)


class LeadMessageRequest(BaseModel):
    channel: Literal["email", "whatsapp"]
    message: str = Field(min_length=1, max_length=700)


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_name: str
    contact_name: str
    email: str
    phone: str
    whatsapp_opt_in: bool = False
    source: str
    industry: str
    estimated_value: Decimal
    status: str
    next_follow_up: date | None
    notes: str
    owner_user_id: int | None
    approval_status: str
    approved_by: str
    approved_at: datetime | None
    rejection_reason: str
    created_at: datetime
    updated_at: datetime


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    company_name: str = Field(min_length=1, max_length=240)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=256)
    phone: str = Field(default="", max_length=32)
    whatsapp_opt_in: bool = False


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    company_name: str = ""
    email: str
    role: str
    approval_status: str = "approved"
    created_at: datetime | None = None


class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    category: str
    entity_type: str
    entity_id: int | None
    read_at: datetime | None
    created_at: datetime


class NotificationPreferencesRequest(BaseModel):
    phone: str = Field(default="", max_length=32)
    whatsapp_opt_in: bool = False


class UserApprovalRequest(BaseModel):
    action: Literal["approved", "rejected"]
    reason: str = Field(default="", max_length=1000)


class LeadApprovalRequest(BaseModel):
    action: Literal["approved", "rejected"]
    reason: str = Field(default="", max_length=1000)
