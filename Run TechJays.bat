@echo off
setlocal
cd /d "%~dp0frontend"

if not exist node_modules (
  echo Frontend dependencies are missing. Installing them now...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm run dev -- --open
if errorlevel 1 pause
