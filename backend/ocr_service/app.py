import io
import os
import tempfile
from pathlib import Path
from typing import Any

import pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 20
LOW_CONFIDENCE = 0.70
TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
app = FastAPI(title="Invoice OCR Service", version="1.0.0")
_paddle_pipeline = None


def check_token(value: str | None) -> None:
    if TOKEN and value != TOKEN:
        raise HTTPException(401, "Invalid OCR service token")


def load_paddle_pipeline():
    global _paddle_pipeline
    if _paddle_pipeline is None:
        from paddleocr import PPStructureV3

        _paddle_pipeline = PPStructureV3(
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_table_recognition=True,
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


def normalize_payload(value: Any) -> tuple[str, list[float]]:
    texts: list[str] = []
    scores: list[float] = []
    if isinstance(value, dict):
        for text_group in iter_values(value, "rec_texts"):
            if isinstance(text_group, list):
                texts.extend(str(item).strip() for item in text_group if str(item).strip())
        for score_group in iter_values(value, "rec_scores"):
            if isinstance(score_group, list):
                for score in score_group:
                    try:
                        scores.append(float(score))
                    except (TypeError, ValueError):
                        pass
        for key in ("markdown_texts", "markdown_text"):
            for block in iter_values(value, key):
                if isinstance(block, str) and block.strip():
                    texts.append(block.strip())
                elif isinstance(block, list):
                    texts.extend(str(item).strip() for item in block if str(item).strip())
    unique_text = list(dict.fromkeys(texts))
    return "\n".join(unique_text), [min(1.0, max(0.0, score)) for score in scores]


def paddle_extract(file_path: Path) -> tuple[str, float]:
    from paddleocr import PPStructureV3

    pipeline = load_paddle_pipeline()
    with tempfile.TemporaryDirectory(prefix="invoice-ocr-") as result_dir:
        pages = pipeline.predict(input=str(file_path))
        outputs = []
        for page in pages:
            page.save_to_json(save_path=result_dir)
            page_json = getattr(page, "json", None)
            if callable(page_json):
                page_json = page_json()
            if isinstance(page_json, dict):
                outputs.append(page_json)
            else:
                markdown = getattr(page, "markdown", None)
                if isinstance(markdown, dict):
                    outputs.append(markdown)
        if not outputs:
            import json

            for result_file in sorted(Path(result_dir).glob("*.json")):
                outputs.append(json.loads(result_file.read_text(encoding="utf-8")))
    text, scores = normalize_payload({"pages": outputs})
    confidence = sum(scores) / len(scores) if scores else (0.0 if not text else 0.45)
    return text, confidence


def page_images(data: bytes, suffix: str):
    if suffix == ".pdf":
        import fitz

        document = fitz.open(stream=data, filetype="pdf")
        if document.page_count > MAX_PAGES:
            raise HTTPException(413, f"PDF cannot exceed {MAX_PAGES} pages")
        for page in document:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            yield Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        return
    yield Image.open(io.BytesIO(data)).convert("RGB")


def tesseract_extract(data: bytes, suffix: str) -> tuple[str, float]:
    page_text: list[str] = []
    scores: list[float] = []
    for image in page_images(data, suffix):
        image = ImageOps.grayscale(image)
        image = ImageOps.autocontrast(image)
        image = ImageEnhance.Contrast(image).enhance(1.35).filter(ImageFilter.SHARPEN)
        parsed = pytesseract.image_to_data(image, config="--psm 6", output_type=pytesseract.Output.DICT)
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
    confidence = sum(scores) / len(scores) if scores else 0.0
    return "\n\n".join(page_text), confidence


@app.get("/health")
def health():
    return {"status": "ok", "paddle_loaded": _paddle_pipeline is not None}


@app.post("/v1/extract")
async def extract(file: UploadFile = File(...), x_ocr_service_token: str | None = Header(default=None)):
    check_token(x_ocr_service_token)
    suffix = Path(file.filename or "invoice").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(415, "Upload a PDF or image (PNG, JPG, WEBP)")
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "File must be between 1 byte and 15 MB")
    with tempfile.TemporaryDirectory(prefix="invoice-ocr-input-") as workdir:
        path = Path(workdir) / f"source{suffix}"
        path.write_bytes(data)
        primary_error = None
        try:
            primary_text, primary_confidence = paddle_extract(path)
        except Exception as exc:
            primary_text, primary_confidence = "", 0.0
            primary_error = type(exc).__name__
        provider = "paddleocr-pp-structure-v3"
        chosen_text, chosen_confidence = primary_text, primary_confidence
        fallback_used = False
        if not primary_text.strip() or primary_confidence < LOW_CONFIDENCE:
            fallback_used = True
            try:
                fallback_text, fallback_confidence = tesseract_extract(data, suffix)
            except Exception as exc:
                fallback_text, fallback_confidence = "", 0.0
                if primary_error is None:
                    primary_error = f"fallback:{type(exc).__name__}"
            if fallback_confidence > chosen_confidence or (not chosen_text and fallback_text):
                chosen_text, chosen_confidence = fallback_text, fallback_confidence
                provider = "tesseract-fallback"
        if not chosen_text.strip():
            raise HTTPException(422, f"No readable text found. Check OCR service setup. Detail: {primary_error or 'empty OCR output'}")
        return {
            "provider": provider,
            "raw_text": chosen_text[:100_000],
            "confidence": round(float(chosen_confidence), 4),
            "fallback_used": fallback_used,
            "low_confidence": chosen_confidence < 0.95,
            "human_review_required": True,
        }
