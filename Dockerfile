# Build the API image with --target api, or the OCR image with --target ocr.
FROM python:3.11-slim AS python-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

FROM python-base AS api
COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY backend/app ./app
ENV UPLOAD_DIR=/var/data/uploads
EXPOSE 10000
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]

FROM python-base AS ocr
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
COPY backend/ocr_service/requirements-docker.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY backend/ocr_service ./ocr_service
ENV OCR_NEURAL_FALLBACKS=False
EXPOSE 10000
CMD ["sh", "-c", "python -m uvicorn ocr_service.app:app --host 0.0.0.0 --port ${PORT:-10000}"]
