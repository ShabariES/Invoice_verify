@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo Creating the project Python 3.11 environment...
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo Python 3.11 is required. Install it and run this file again.
    pause
    exit /b 1
  )
)

".venv\Scripts\python.exe" -c "import paddle, paddleocr, easyocr, torch, cv2, fitz, PIL, pytesseract" >nul 2>&1
if errorlevel 1 (
  echo Installing open-source OCR dependencies. The first install can take several minutes...
  ".venv\Scripts\python.exe" -m pip install -r ocr_service\requirements.txt
  if errorlevel 1 (
    echo OCR dependency installation failed. Check your network and Python version.
    pause
    exit /b 1
  )
)

where tesseract >nul 2>&1
if errorlevel 1 echo Tesseract is not on PATH. PaddleOCR remains available; the secondary fallback will be disabled.

echo Starting TechJays OCR at http://127.0.0.1:8001
echo OCR models may be downloaded on first use, which can take a few minutes.
".venv\Scripts\python.exe" -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8001
pause
