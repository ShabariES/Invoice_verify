"""Invoice OCR using Groq Qwen vision with local OCR fallbacks.

PDF pages and images are sent to the configured Groq vision model first. When
Groq is unavailable, PaddleOCR and EasyOCR are tried locally. OCR values remain
suggestions; a human reviewer verifies them against the original.
"""

import io
import asyncio
import base64
import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from difflib import SequenceMatcher
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from statistics import mean
from typing import Any

import pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
pytesseract.pytesseract.tesseract_cmd = os.getenv("TESSERACT_CMD", "tesseract")

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 20
LOW_CONFIDENCE = 0.70
TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
OCR_MODEL = os.getenv("OCR_MODEL", "PP-OCRv5_server")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b").strip()
OCR_NEURAL_FALLBACKS = os.getenv("OCR_NEURAL_FALLBACKS", "true").strip().lower() in {"1", "true", "yes"}
app = FastAPI(title="Invoice OCR Service", version="3.1.0")
_easyocr_reader = None
_paddle_pipeline = None


def check_token(value: str | None) -> None:
    if TOKEN and value != TOKEN:
        raise HTTPException(401, "Invalid OCR service token")


def load_easyocr_reader():
    """Load EasyOCR's English detector/recognizer once, on CPU."""
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr

        model_dir = os.getenv("EASYOCR_MODEL_DIR") or None
        _easyocr_reader = easyocr.Reader(
            ["en"], gpu=False, model_storage_directory=model_dir, verbose=False,
        )
    return _easyocr_reader


def load_paddle_pipeline():
    """Load PaddleOCR PP-OCRv5 lazily as the primary invoice recognizer."""
    global _paddle_pipeline
    if _paddle_pipeline is None:
        from paddleocr import PaddleOCR

        _paddle_pipeline = PaddleOCR(
            text_detection_model_name="PP-OCRv5_server_det",
            text_recognition_model_name=(
                "en_PP-OCRv5_mobile_rec" if OCR_MODEL == "PP-OCRv5_server" else OCR_MODEL
            ),
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_textline_orientation=True,
        )
    return _paddle_pipeline


def iter_values(value: Any, key: str):
    if isinstance(value, dict):
        for child_key, child in value.items():
            if child_key == key:
                yield child
            yield from iter_values(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from iter_values(child, key)


def deskew_image(image: Image.Image) -> Image.Image:
    """Estimate notebook/page-rule angle and rotate it level before recognition."""
    try:
        import cv2
        import numpy as np

        gray = np.asarray(ImageOps.grayscale(image))
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 720, threshold=max(50, gray.shape[1] // 8),
            minLineLength=max(80, gray.shape[1] // 5), maxLineGap=24,
        )
        if lines is None:
            return image
        angles = []
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            if -40 <= angle <= 40 and abs(angle) > 1.5:
                angles.append(float(angle))
        if len(angles) < 3:
            return image
        angle = float(np.median(angles))
        if abs(angle) < 1.5 or abs(angle) > 35:
            return image
        return image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
    except Exception:
        # Deskew is an enhancement; keep OCR available if OpenCV is unavailable.
        return image


def enhance_image(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    image = deskew_image(image)
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1)
    gray = ImageEnhance.Contrast(gray).enhance(1.35)
    return gray.filter(ImageFilter.UnsharpMask(radius=1.7, percent=145, threshold=3)).convert("RGB")


def page_images(data: bytes, suffix: str):
    if suffix == ".pdf":
        import fitz

        document = fitz.open(stream=data, filetype="pdf")
        if document.page_count > MAX_PAGES:
            raise HTTPException(413, f"PDF cannot exceed {MAX_PAGES} pages")
        for page in document:
            pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
            yield Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        return
    try:
        with Image.open(io.BytesIO(data)) as image:
            yield ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise HTTPException(415, "Could not decode the uploaded image") from exc


def easyocr_extract(data: bytes, suffix: str) -> tuple[str, float]:
    reader = load_easyocr_reader()
    import numpy as np

    page_text: list[str] = []
    page_scores: list[float] = []
    for page in page_images(data, suffix):
        prepared = enhance_image(page)
        results = reader.readtext(
            np.asarray(prepared), detail=1, paragraph=False, batch_size=1,
            workers=0, min_size=8, text_threshold=0.55, low_text=0.25,
            link_threshold=0.3, canvas_size=2560, mag_ratio=1.5,
        )
        # EasyOCR returns detections in reading order for normal documents.
        # Sorting by vertical center also keeps neighboring handwriting rows
        # stable when the source was photographed at an angle.
        results.sort(key=lambda item: (
            sum(point[1] for point in item[0]) / max(len(item[0]), 1),
            min(point[0] for point in item[0]),
        ))
        for _box, text, score in results:
            text = str(text).strip()
            if text:
                page_text.append(text)
                page_scores.append(min(1.0, max(0.0, float(score))))
    return "\n\n".join(page_text), mean(page_scores) if page_scores else (0.0 if not page_text else 0.4)


def groq_extract(data: bytes, suffix: str) -> tuple[str, float, dict[str, dict[str, Any]]]:
    """Use Groq's Qwen vision model for page transcription and invoice fields."""
    if not GROQ_API_KEY:
        raise RuntimeError("Groq vision is not configured")

    page_texts: list[str] = []
    page_fields: dict[str, dict[str, Any]] = {}
    for page_number, page in enumerate(page_images(data, suffix), start=1):
        page = ImageOps.exif_transpose(page).convert("RGB")
        variants = [page]
        corrected = deskew_image(page)
        if corrected.size != page.size:
            variants.append(corrected)

        content: list[dict[str, Any]] = [{
            "type": "text",
            "text": (
                "Read this supplier invoice for an accounting reviewer. The first image is the uploaded source; "
                "a second image, if present, is the same page rotated to make handwriting easier to read. "
                "Transcribe only what is actually visible. Do not infer missing values. For uncertain fields, "
                "return an empty value and confidence 0. Return JSON only with this schema: "
                "{\"recognized_text\": string, \"fields\": {\"supplier_name\": {\"value\": string, \"confidence\": number}, "
                "\"supplier_gstin\": {\"value\": string, \"confidence\": number}, "
                "\"invoice_number\": {\"value\": string, \"confidence\": number}, "
                "\"invoice_date\": {\"value\": string, \"confidence\": number}, "
                "\"currency\": {\"value\": string, \"confidence\": number}, "
                "\"subtotal\": {\"value\": string, \"confidence\": number}, "
                "\"tax_rate\": {\"value\": string, \"confidence\": number}, "
                "\"tax_amount\": {\"value\": string, \"confidence\": number}, "
                "\"total\": {\"value\": string, \"confidence\": number}}}. "
                "Date should be YYYY-MM-DD when readable; currency should be an ISO code. "
                "If tax is written as a percentage (for example, 10%), put 10 in tax_rate and leave tax_amount empty; "
                "never treat a percentage as a currency amount. tax_amount is only a written currency amount. "
                "Confidence is your estimate from 0 to 1. This is page " + str(page_number) + "."
            ),
        }]
        for image in variants:
            image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
            })

        payload = json.dumps({
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0,
            "max_completion_tokens": 1800,
            "response_format": {"type": "json_object"},
        }).encode("utf-8")
        request = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "groq-python/0.31.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            # Never log or return the authorization header or key.
            raise RuntimeError(f"Groq vision returned HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError("Groq vision request failed") from exc

        try:
            answer = json.loads(response_data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError("Groq vision returned invalid structured data") from exc

        recognized = str(answer.get("recognized_text", "")).strip()
        if recognized:
            page_texts.append(recognized)
        supplied_fields = answer.get("fields", {})
        if not isinstance(supplied_fields, dict):
            continue
        for field in (*FIELD_LABELS, "tax_rate"):
            item = supplied_fields.get(field, {})
            if not isinstance(item, dict):
                continue
            value = clean_value(str(item.get("value", "")))
            try:
                confidence = min(1.0, max(0.0, float(item.get("confidence", 0))))
            except (TypeError, ValueError):
                confidence = 0.0
            if not value or confidence < 0.35:
                continue
            if field == "supplier_gstin":
                match = re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]", value.upper())
                if not match:
                    continue
                value = match.group(0)
            elif field == "invoice_date":
                parsed_date = parse_date(value)
                if not parsed_date:
                    continue
                value = parsed_date
            elif field == "tax_rate":
                rate_match = re.search(r"-?\d+(?:\.\d+)?", value)
                try:
                    rate = Decimal(rate_match.group(0)) if rate_match else Decimal("-1")
                except InvalidOperation:
                    rate = Decimal("-1")
                if rate < 0 or rate > 100:
                    continue
                value = f"{rate:.2f}"
            elif field in {"subtotal", "tax_amount", "total"}:
                if field == "tax_amount" and "%" in value:
                    rate_match = re.search(r"\d+(?:\.\d+)?\s*%", value)
                    if rate_match:
                        numeric_rate = re.search(r"\d+(?:\.\d+)?", rate_match.group(0))
                        if numeric_rate:
                            page_fields["tax_rate"] = {"value": f"{Decimal(numeric_rate.group(0)):.2f}", "confidence": round(confidence, 3)}
                        page_fields["tax_calculation"] = {"value": "percentage", "confidence": round(confidence, 3)}
                    continue
                parsed_money = parse_money(value)
                if not parsed_money:
                    continue
                value = parsed_money
            elif field == "currency":
                currency = re.search(r"\b(INR|USD|EUR|GBP|AUD|CAD|AED|SGD)\b", value.upper())
                value = currency.group(1) if currency else ("INR" if "₹" in value or "Rs" in value else "")
                if not value:
                    continue
            existing = page_fields.get(field)
            if not existing or confidence > existing["confidence"]:
                page_fields[field] = {"value": value[:240], "confidence": round(confidence, 3)}

    recognized_text = "\n\n".join(page_texts)
    normalize_percentage_tax(page_fields, recognized_text)
    return recognized_text, mean([f["confidence"] for f in page_fields.values()]) if page_fields else 0.0, page_fields


def paddle_extract(data: bytes, suffix: str) -> tuple[str, float]:
    pipeline = load_paddle_pipeline()
    import json

    page_text: list[str] = []
    page_scores: list[float] = []
    with tempfile.TemporaryDirectory(prefix="invoice-paddle-") as workdir:
        for page_index, page in enumerate(page_images(data, suffix)):
            path = Path(workdir) / f"page-{page_index + 1}.png"
            enhance_image(page).save(path, format="PNG", optimize=True)
            for result in pipeline.predict(input=str(path)):
                payload = getattr(result, "json", {})
                payload = payload() if callable(payload) else payload
                if isinstance(payload, str):
                    payload = json.loads(payload)
                if not isinstance(payload, dict):
                    continue
                texts = []
                scores = []
                for group in iter_values(payload, "rec_texts"):
                    if isinstance(group, list):
                        texts.extend(str(item).strip() for item in group if str(item).strip())
                for group in iter_values(payload, "rec_scores"):
                    if isinstance(group, list):
                        for item in group:
                            try:
                                scores.append(min(1.0, max(0.0, float(item))))
                            except (TypeError, ValueError):
                                pass
                if texts:
                    page_text.append("\n".join(texts))
                page_scores.extend(scores)
    return "\n\n".join(page_text), mean(page_scores) if page_scores else (0.0 if not page_text else 0.4)


def tesseract_extract(data: bytes, suffix: str) -> tuple[str, float]:
    page_text: list[str] = []
    scores: list[float] = []
    for page in page_images(data, suffix):
        image = enhance_image(page)
        parsed = pytesseract.image_to_data(
            image, config="--oem 1 --psm 11", output_type=pytesseract.Output.DICT,
        )
        words = []
        for word, raw_score in zip(parsed.get("text", []), parsed.get("conf", [])):
            word = word.strip()
            try:
                score = float(raw_score) / 100.0
            except (TypeError, ValueError):
                continue
            if word and score >= 0:
                words.append(word)
                scores.append(min(1.0, score))
        if words:
            page_text.append(" ".join(words))
    return "\n\n".join(page_text), mean(scores) if scores else 0.0


FIELD_LABELS: dict[str, tuple[str, ...]] = {
    "supplier_name": ("supplier name", "supplies name", "vendor name", "supplier", "vendor", "from"),
    "supplier_gstin": ("supplier gstin", "gstin", "gst no", "gst number", "tax id"),
    "invoice_number": ("invoice number", "invoice no", "invoice #", "invoice num", "bill number", "bill no"),
    "invoice_date": ("invoice date", "bill date", "date"),
    "currency": ("currency",),
    "subtotal": ("subtotal", "sub total", "taxable amount", "net amount"),
    "tax_amount": ("tax total", "total tax", "tax amount", "gst amount", "tax"),
    "total": ("invoice total", "total amount", "grand total", "total"),
}


def clean_value(value: str) -> str:
    return re.sub(r"^[\s:;.,|=_–—-]+|[\s|]+$", "", value).strip()


def parse_date(value: str) -> str:
    match = re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b", value)
    if not match:
        match = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", value)
        if match:
            try:
                return datetime(int(match[1]), int(match[2]), int(match[3])).date().isoformat()
            except ValueError:
                return ""
        return ""
    a, b, year = map(int, match.groups())
    year += 2000 if year < 100 else 0
    # Invoice dates in India are normally DD/MM/YYYY; retain the unambiguous order.
    try:
        return datetime(year, b, a).date().isoformat()
    except ValueError:
        try:
            return datetime(year, a, b).date().isoformat()
        except ValueError:
            return ""


def parse_money(value: str) -> str:
    cleaned = value.replace(",", "")
    matches = re.findall(r"(?<![A-Za-z])(?:₹|Rs\.?\s*)?\s*(-?\d+(?:\.\d{1,2})?)", cleaned, re.I)
    if not matches:
        return ""
    try:
        # If a rate/approximation is written beside the amount (e.g. 10% ~ 200),
        # the last numeric token is the monetary value.
        return f"{float(matches[-1] if '%' in cleaned or '~' in cleaned else matches[0]):.2f}"
    except ValueError:
        return ""


def normalize_percentage_tax(fields: dict[str, dict[str, Any]], raw_text: str) -> None:
    """Interpret an explicitly written tax/interest percent as a rate, not money."""
    rate_item = fields.get("tax_rate")
    detected_rate = ""
    if isinstance(rate_item, dict):
        detected_rate = parse_money(str(rate_item.get("value", "")))
    if not detected_rate:
        for line in raw_text.splitlines():
            if "%" not in line or not re.search(r"\b(?:tax|gst|vat|interest)\b", line, re.I):
                continue
            match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
            if match:
                detected_rate = match.group(1)
                confidence = 0.9
                if isinstance(fields.get("tax_amount"), dict):
                    confidence = float(fields["tax_amount"].get("confidence", confidence))
                fields["tax_rate"] = {"value": f"{Decimal(detected_rate):.2f}", "confidence": confidence}
                break
    if not detected_rate:
        return
    try:
        rate = Decimal(detected_rate)
    except InvalidOperation:
        return
    if rate < 0 or rate > 100:
        return
    confidence = float(fields.get("tax_rate", {}).get("confidence", 0.9))
    fields["tax_calculation"] = {"value": "percentage", "confidence": confidence}
    subtotal = fields.get("subtotal", {}).get("value")
    if subtotal:
        try:
            amount = (Decimal(str(subtotal)) * rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            fields["tax_amount"] = {"value": f"{amount:.2f}", "confidence": confidence}
            return
        except (InvalidOperation, ValueError):
            pass
    fields.pop("tax_amount", None)


def extract_invoice_fields(raw_text: str, confidence: float) -> dict[str, dict[str, Any]]:
    """Conservative label/value extraction; never invent values that aren't present."""
    lines = [clean_value(line) for line in raw_text.splitlines() if clean_value(line)]
    found: dict[str, dict[str, Any]] = {}

    def identify_label(line: str):
        folded = line.casefold()
        for field, aliases in FIELD_LABELS.items():
            for alias in aliases:
                match = re.search(rf"\b{re.escape(alias)}\b", folded)
                if match:
                    return field, alias, match.end()
        # Handwritten OCR often confuses a small number of letters. Permit only
        # strong prefix matches, leaving ambiguous labels for manual entry.
        words = re.findall(r"[a-z0-9]+", folded)
        for field, aliases in FIELD_LABELS.items():
            for alias in aliases:
                alias_words = alias.split()
                for count in range(max(1, len(alias_words) - 1), len(alias_words) + 1):
                    if len(words) < count:
                        continue
                    candidate = "".join(words[:count])
                    target = "".join(alias_words)
                    if SequenceMatcher(None, candidate, target).ratio() >= 0.78:
                        return field, alias, len(" ".join(line.split()[:count]))
        return None

    labels = {index: identify_label(line) for index, line in enumerate(lines)}
    labels = {index: label for index, label in labels.items() if label}
    for field, aliases in FIELD_LABELS.items():
        for index, line in enumerate(lines):
            label = labels.get(index)
            if not label or label[0] != field:
                continue
            _, alias, end = label
            value = clean_value(line[end:])
            field_confidence = confidence
            if not value and index + 1 < len(lines) and index + 1 not in labels:
                value = lines[index + 1]
            if field == "invoice_date":
                value = parse_date(value)
            elif field in {"subtotal", "tax_amount", "total"}:
                value = parse_money(value)
            elif field == "supplier_gstin":
                # A GSTIN has a strict 15-character structure. OCR frequently
                # turns handwritten IDs into plausible-looking fragments; do
                # not place those fragments in the accounting form as facts.
                gstin = re.search(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b", value.upper())
                value = gstin.group(0) if gstin else ""
            elif field == "currency":
                currency = re.search(r"\b(INR|USD|EUR|GBP|AUD|CAD|AED|SGD)\b", value.upper())
                value = currency.group(1) if currency else ""
            else:
                value = clean_value(value)
            if not value and field in {"subtotal", "tax_amount"}:
                # Some handwritten pages put the amount in a separate column,
                # and OCR may return it before the corresponding label. Keep
                # these geometry/order heuristics explicitly low confidence.
                nearby = range(max(0, index - 4), min(len(lines), index + 4))
                candidates = []
                for candidate_index in nearby:
                    if candidate_index == index or candidate_index in labels:
                        continue
                    candidate = lines[candidate_index]
                    if field == "tax_amount":
                        if "%" not in candidate and "~" not in candidate:
                            continue
                        amount = parse_money(candidate)
                    else:
                        if "%" in candidate or "~" in candidate or not re.fullmatch(r"[₹$€£\sIO.,:=+-]*\d[\d,.]*", candidate, re.I):
                            continue
                        amount = parse_money(candidate)
                    if amount:
                        candidates.append((abs(candidate_index - index), candidate_index, amount))
                if candidates:
                    _, _, value = min(candidates)
                    field_confidence = min(confidence, 0.55)
            if value:
                found[field] = {"value": value[:240], "confidence": round(field_confidence, 3)}
                break
    if "currency" not in found and ("₹" in raw_text or re.search(r"\bINR\b|\bRs\.?\b", raw_text, re.I)):
        found["currency"] = {"value": "INR", "confidence": round(min(confidence, 0.9), 3)}
    normalize_percentage_tax(found, raw_text)
    return found


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": GROQ_MODEL,
        "provider": "groq-vision",
        "groq_configured": bool(GROQ_API_KEY),
        "paddle_loaded": _paddle_pipeline is not None,
        "easyocr_loaded": _easyocr_reader is not None,
        "neural_fallbacks_enabled": OCR_NEURAL_FALLBACKS,
        "tesseract_available": shutil.which(os.getenv("TESSERACT_CMD", "tesseract")) is not None,
    }


@app.post("/v1/extract")
async def extract(file: UploadFile = File(...), x_ocr_service_token: str | None = Header(default=None)):
    check_token(x_ocr_service_token)
    suffix = Path(file.filename or "invoice").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(415, "Upload a PDF or image (PNG, JPG, WEBP)")
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "File must be between 1 byte and 15 MB")

    errors: list[str] = []
    chosen_text, chosen_confidence, fields = "", 0.0, {}
    provider = "groq-qwen-vision"
    fallback_used = False
    if GROQ_API_KEY:
        try:
            chosen_text, chosen_confidence, fields = await asyncio.to_thread(groq_extract, data, suffix)
        except Exception as exc:
            # Keep the cloud key and provider response private; only record the
            # exception class so a UI error cannot disclose credentials.
            errors.append(f"Groq vision: {type(exc).__name__}")
    else:
        errors.append("Groq vision is not configured")

    # A local OCR fallback keeps the workflow usable if Groq is unconfigured or
    # temporarily unavailable. The configured Qwen model remains the primary.
    if not chosen_text.strip() and not fields:
        fallback_used = True
        if OCR_NEURAL_FALLBACKS:
            try:
                local_text, local_confidence = paddle_extract(data, suffix)
                local_fields = extract_invoice_fields(local_text, local_confidence) if local_text.strip() else {}
                if local_text.strip() and local_fields:
                    chosen_text, chosen_confidence, fields = local_text, local_confidence, local_fields
                    provider = "paddleocr-local-fallback"
            except Exception as exc:
                errors.append(f"PaddleOCR fallback: {type(exc).__name__}")
            if not chosen_text.strip() and not fields:
                try:
                    local_text, local_confidence = easyocr_extract(data, suffix)
                    local_fields = extract_invoice_fields(local_text, local_confidence) if local_text.strip() else {}
                    if local_text.strip() or local_fields:
                        chosen_text, chosen_confidence, fields = local_text, local_confidence, local_fields
                        provider = "easyocr-local-fallback"
                except Exception as exc:
                    errors.append(f"EasyOCR fallback: {type(exc).__name__}")

        # Tesseract is intentionally the last local fallback: it is lighter
        # than the neural models and is commonly installed on desktop hosts.
        if not chosen_text.strip() and not fields and shutil.which(os.getenv("TESSERACT_CMD", "tesseract")):
            try:
                local_text, local_confidence = tesseract_extract(data, suffix)
                local_fields = extract_invoice_fields(local_text, local_confidence) if local_text.strip() else {}
                if local_text.strip() or local_fields:
                    chosen_text, chosen_confidence, fields = local_text, local_confidence, local_fields
                    provider = "tesseract-local-fallback"
            except Exception as exc:
                errors.append(f"Tesseract fallback: {type(exc).__name__}")

    if not chosen_text.strip():
        if fields:
            chosen_text = "\n".join(f"{name.replace('_', ' ').title()}: {field['value']}" for name, field in fields.items())
        else:
            detail = "; ".join(errors) or "OCR did not return readable text."
            raise HTTPException(502, f"OCR could not read this document. {detail}")

    amount_values = [fields.get(key, {}).get("value") for key in ("subtotal", "tax_amount", "total")]
    amount_mismatch = False
    if all(value not in (None, "") for value in amount_values):
        try:
            amount_mismatch = abs(float(amount_values[0]) + float(amount_values[1]) - float(amount_values[2])) > 0.01
        except (TypeError, ValueError):
            amount_mismatch = True
    low_confidence = (
        not fields
        or chosen_confidence < 0.75
        or any(field["confidence"] < 0.65 for field in fields.values())
        or amount_mismatch
    )

    return {
        "provider": provider,
        "raw_text": chosen_text[:100_000],
        "confidence": round(float(chosen_confidence), 4),
        "extracted_fields": fields,
        "fallback_used": fallback_used,
        "low_confidence": low_confidence,
        "human_review_required": True,
    }
