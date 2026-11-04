# Live deployment and OCR readiness

## OCR added in this project

The invoice review page now has a **Read with OCR** action. The API sends the uploaded source to an internal OCR service. That service uses PaddleOCR PP-StructureV3 for document layout, tables, and text; if PaddleOCR fails or has low confidence, it tries Tesseract after image enhancement. The OCR result and confidence are stored on the invoice and displayed for a person to check. The invoice still needs human approval.

PaddleOCR is the OCR/layout engine, not a guarantee of correct invoice-field extraction. This implementation returns recognized text; it does not reliably turn arbitrary supplier layouts into supplier/date/line-item fields. That requires a separately evaluated extraction step with a strict schema and reconciliation rules. Current OCR is manually initiated from the invoice review screen.

PaddleOCR's current documentation describes PaddlePaddle 3.x inference, PP-StructureV3, PDF page processing, and structured result output. The OCR container uses PaddlePaddle 3.2.0 CPU wheels and PaddleOCR 3.x; verify CPU/GPU wheel compatibility and benchmark on the final host before production. [PaddleOCR quick start](https://www.paddleocr.ai/main/en/quick_start.html), [PP-StructureV3 usage](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html)

## Run OCR locally with Docker

1. Copy `backend/.env.example` to `backend/.env` and set `OCR_SERVICE_TOKEN` to a long random value.
2. Build the OCR image from `backend/ocr_service`:

   ```powershell
   docker build -t techjays-ocr .
   ```

3. Run it on a private network reachable by the API, with the same `OCR_SERVICE_TOKEN`. Do not expose port 8001 publicly.
4. Set the API's `OCR_SERVICE_URL` to the private OCR service URL and restart the API.
5. Upload an invoice, open it, and choose **Read with OCR**. Confirm all OCR values against the original.

The first model initialization downloads PaddleOCR models. For production, bake pinned model weights into the image or provide a controlled model cache, then verify cold-start behavior and memory/CPU usage. The current OCR request is synchronous and can take up to three minutes; it is suitable for a pilot, not a high-volume queue.

## Do not expose the current app publicly yet

The product still has local-only assumptions that need to be replaced before a live launch:

1. **Authentication hardening:** email/password registration, signed HTTP-only sessions, Lead/Admin roles, server-side lead/invoice authorization, and manual Admin approval of new Lead accounts are implemented. Each Lead account has an isolated invoice workspace; only Admins can review across accounts and finalize invoice approval. Before a public launch, add email verification, password reset, MFA as required, rate limits/lockout, account deactivation tooling, and security review of cookie/CORS settings.
2. **Workspace membership:** invoice isolation currently follows the Lead user account (one login = one invoice workspace). If a business needs multiple staff logins sharing the same records, add an organization/workspace membership model before onboarding those users. Add automated isolation checks for invoices, source files, OCR, events, and edits.
3. **Production database and migrations:** configure managed PostgreSQL, create Alembic migrations, and stop changing the database schema inside API startup. Back up and rehearse restores before importing real data.
4. **Private durable file storage:** optional private GCS storage is implemented for invoice sources. Add malware scanning, retention/deletion policies, actual MIME/file-signature checks, PDF page/dimension limits, and per-workspace storage quotas before production use.
5. **Background processing:** put OCR and extraction jobs on a durable queue with idempotency, retries, timeouts, dead-letter handling, and job status polling. Keep CPU/GPU OCR workers separate from web API workers.
6. **Invoice extraction and accounting controls:** map OCR/layout output into a typed invoice schema; keep field-level confidence and source locations; normalize supplier identity; enforce duplicate constraints at the database level; validate GST/tax rules for the target jurisdiction; and require explicit human review for uncertain fields and every posting action.
7. **Secrets and network boundaries:** use a secrets manager, HTTPS, restrictive CORS, request rate limits, audit logs with authenticated actor IDs, and private networking between API, database, queue, storage, and OCR. Never commit production secrets or expose the OCR service directly.
8. **Operations:** add structured logs, error reporting, metrics, queue/worker health checks, backup alerts, dependency/image scanning, staging, and a rollback plan. Deploy the frontend and API behind a real domain with TLS and automatic restart/health checks. [FastAPI deployment concepts](https://fastapi.tiangolo.com/deployment/concepts/)
9. **External services:** signed Mailgun and Meta WhatsApp Cloud webhook intake is implemented for invoice attachments, alongside SMTP/WhatsApp outbound notifications. Configure provider credentials, domains, webhook subscriptions, and registered Lead sender identity before enabling it. ERP/accounting posting and any semantic AI extraction provider still need to be selected and verified in sandbox accounts.
10. **Legal and business readiness:** decide data residency, retention, privacy notice, customer data-processing terms, tax jurisdictions, and incident response before handling customer financial documents.

## Configuration needed for a live environment

- `DATABASE_URL`: managed PostgreSQL connection string.
- `FRONTEND_ORIGIN`: exact production frontend origin (not a wildcard).
- `UPLOAD_DIR`: directory for uploaded invoice files. On Render, attach a persistent disk mounted at this path or files can be lost when the service restarts or redeploys.
- `OCR_SERVICE_URL` and `OCR_SERVICE_TOKEN`: private OCR service endpoint and shared secret.
- `OCR_REVIEW_THRESHOLD`: field/document confidence threshold after calibration on real invoices; the current default is conservative and is not a validated accuracy claim.
- `GROQ_API_KEY` and `GROQ_MODEL`: set the Groq key only in the backend environment; the landing chat sends requests through the backend and never receives the key.
- `SESSION_SECRET_KEY`, bootstrap Admin credentials, OCR service token, and Groq key: store as Render/Jenkins secrets, never in source control.

The OCR code is a first integration slice, not a validated production workload. The repository does not include cloud credentials, a durable OCR or inbound-media queue, email verification/password recovery/MFA, multi-user organization membership, or versioned production database migrations. Follow `DEPLOYMENT.md` for the pilot configuration and review the remaining controls before importing customer financial records.
