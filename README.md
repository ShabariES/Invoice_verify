# Invoice Desk — accounting CRM

A local-first invoice review and CRM app. It accepts an invoice PDF or photo, creates a review draft, and supports lead tracking with a Lead/Admin approval workflow. SQLite and local files are the development defaults; configure PostgreSQL and a private GCS bucket for hosting. It does not post approved invoices to an external accounting system.

## Requirements

- Python 3.11+
- Node.js 20+

## Start locally (Windows PowerShell)

Terminal 1 — API:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). API docs: `http://localhost:8000/docs`.

### Accounts and roles

Sign-up submits a **Lead** account access request. The account remains pending and cannot sign in until an **Admin** approves it. Admins review requests under **Leads → Lead accounts**; rejected accounts remain blocked. After approval, a Lead can manage their own CRM leads and use a private invoice workspace to upload, read, and edit invoice drafts. Invoice lists, source files, OCR, events, edits, and duplicate checks are scoped to the signed-in Lead account. Admins can review invoices across all accounts; only Admins can give final invoice approval or approve/reject CRM lead submissions. Existing invoices without an owner stay visible to Admins only.

Create the first Admin by setting `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `backend/.env` before starting the API. Use a password with at least 12 characters. The bootstrap runs once; changing those environment values later does not reset the existing account password. Set a persistent random `SESSION_SECRET_KEY` as well. In production set `APP_ENV=production`; the API refuses to start without these production values.

Sessions use signed, HTTP-only cookies. The browser calls the API with credentials enabled, so set `FRONTEND_ORIGIN` to the exact frontend origin in a hosted environment. Public sign-up cannot select the Admin role. In production, store records in Neon by setting `DATABASE_URL` to the Neon PostgreSQL connection string; SQLite is only the local fallback. See [DEPLOYMENT.md](DEPLOYMENT.md) for Neon, GCS, Render, and Jenkins setup.

The workspace header bell shows durable in-app notifications and refreshes every 30 seconds. Configure SMTP and Meta WhatsApp Cloud API values in `backend/.env` (or the API host’s secret environment) to enable outbound email and WhatsApp alerts. Users must provide a phone number and opt in before account notifications go to WhatsApp. Invoice attachments can also be received from an approved Lead’s authenticated email address through a signed Mailgun inbound route, or from the Lead’s saved WhatsApp number through a signed Meta Cloud API webhook. See [DEPLOYMENT.md](DEPLOYMENT.md) for provider setup and required secrets.

From **Leads → Send message**, a signed-in user can enter a recipient email directly or choose a saved CRM contact, then send by SMTP email or WhatsApp. Email supports up to 10 PDF/image attachments (15 MB each, 18 MB total). WhatsApp requires a saved contact number, recorded consent, and a Meta-approved message template; this composer sends WhatsApp text only. The UI confirms when the provider accepts the send request; configure provider delivery webhooks if you need final delivered/read receipts.

### Enable invoice OCR without containers

OCR runs as a separate Python process. Install Tesseract OCR on the host and make sure the `tesseract` executable is on `PATH`. From the `backend` directory, install OCR dependencies in the same Python environment as the API and start the service:

```powershell
python -m pip install -r ocr_service/requirements.txt
python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8001
```

Keep `OCR_SERVICE_URL=http://127.0.0.1:8001` in `backend/.env` and restart the API if you changed it. The API and OCR service must run on the same host when using this loopback URL. The first OCR request may take longer while PaddleOCR downloads its models. Check `http://localhost:8001/health` and `http://localhost:8000/ready` before using **Read with OCR**.

Do not open `frontend/index.html` directly from File Explorer. Its TypeScript entry point must be served by Vite; opening the HTML as `file://` causes the browser's CORS error. On Windows, double-click `Run TechJays.bat` to start Vite and open the correct local URL.

## Local workflow

1. Upload an invoice PDF or image in the UI.
2. The API saves the file locally and creates a `needs_review` draft.
3. Open the invoice and enter/correct supplier, invoice, tax, total, and line item fields.
4. Approve only after checking the source file and reconciling amounts.

Durable OCR queues and accounting posting are not connected. Email/WhatsApp invoice intake requires external provider setup and credentials before the inbound webhook endpoints become active. OCR uses the host Python environment and requires Tesseract on the host. Local sign-in uses the same Lead/Admin authorization flow; production still requires the safeguards listed in `LIVE_READINESS.md`.

## Jenkins

`Jenkinsfile` installs the API and OCR Python dependencies, checks that PaddleOCR and Tesseract are available on the Jenkins agent, builds the frontend, and invokes Render deploy hooks on successful `main` builds. Configure a Linux Jenkins agent with Python 3.11+, Node.js 20+, `tesseract-ocr`, and the GitHub/Credentials Binding plugins. Add Render deploy hooks in Jenkins credentials as described in [DEPLOYMENT.md](DEPLOYMENT.md). To serve OCR outside Render, run `python3 -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8001` from `backend`; the API must be on the same host or use an OCR service URL reachable from it.

For step-by-step GCP bucket, Render, and Jenkins webhook setup, see [DEPLOYMENT.md](DEPLOYMENT.md).
