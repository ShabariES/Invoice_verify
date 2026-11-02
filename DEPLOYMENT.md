# GCP, Render, and Jenkins setup

This repository stores application records in PostgreSQL (use Neon for hosting) and invoice files in private Google Cloud Storage. When `GCS_BUCKET_NAME` is blank, local development continues to use `backend/uploads`. The deployment below uses Neon, a private GCS bucket, Render API/OCR services, and a static frontend.

## 1. Create a private GCP bucket

1. In Google Cloud Console, select or create the project you will use for this app. Enable billing and the **Cloud Storage API**.
2. Open **Cloud Storage → Buckets → Create**. Pick a globally unique bucket name and a location close to your users and Render region. `asia-south1` is an example for users in India; select the location that meets your data-residency and latency needs.
3. Choose **Standard** storage. Enable **Uniform bucket-level access** and keep **Public access prevention** enforced. Do not grant `allUsers` or `allAuthenticatedUsers` access.
4. Create a service account for the application, for example `invoice-verify-render`. In the bucket’s **Permissions** page, grant that service account **Storage Object Admin** on this bucket only.
5. Create a JSON key for this service account and store it securely. Render will need the key JSON as a secret environment value. Do not add it to this repository, Jenkins source, or a committed `.env` file. Rotate/delete the key if it is exposed.

The backend stores invoice objects under `invoices/` and serves them through authenticated API routes. The bucket itself stays private.

## 2. Create the Render services

Connect the GitHub repository to Render and create the API, private OCR web service, and static site. Keep the Neon project and Render services in nearby regions to reduce database latency. The API and OCR service need a paid always-on plan for dependable use; Paddle model initialization is CPU and memory intensive. Check current Render plans and pricing before creating services.

### Neon PostgreSQL

1. In the [Neon Console](https://console.neon.tech/), create a project, choose a region close to your Render services, and create/select the application database and role.
2. Open the project’s **Connect** panel. Select the application database and role; copy the connection string. Use the pooled connection option for the Render API, and keep the URL private. Neon’s project setup provides a PostgreSQL connection URI containing the database and role credentials. See [Neon project creation](https://neon.tech/docs/manage/projects) and [Neon connection strings](https://neon.tech/docs/connect/connect-from-any-app).
3. In Render, set the API service `DATABASE_URL` to that Neon URL. Retain `sslmode=require` in the query parameters. The application uses PostgreSQL through psycopg; `DATABASE_URL` must be set in production. SQLite remains a local-development default only.
4. Neon stores users, leads, invoices, line items, approvals, and invoice content hashes/metadata. The original invoice files remain in the private GCS bucket.

### API web service

- Repository: `ShabariES/Invoice_verify`, branch `main`
- Root directory: `backend`
- Runtime: Python
- Build command: `pip install -r requirements.txt`
- Start command: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`

Set these environment variables on the API service:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` |
| `DATABASE_URL` | Neon PostgreSQL pooled connection URL with TLS |
| `FRONTEND_ORIGIN` | Exact static-site origin, e.g. `https://invoice-verify-ui.onrender.com` |
| `SESSION_SECRET_KEY` | A newly generated random secret, at least 32 bytes |
| `BOOTSTRAP_ADMIN_EMAIL` | Email for the first Admin account |
| `BOOTSTRAP_ADMIN_PASSWORD` | New password with at least 12 characters |
| `GCS_BUCKET_NAME` | Name of the private bucket |
| `GCS_PROJECT_ID` | Google Cloud project ID |
| `GCS_SERVICE_ACCOUNT_JSON` | Full service-account JSON key, stored as a secret |
| `OCR_SERVICE_URL` | Internal address shown for the Render OCR service |
| `OCR_SERVICE_TOKEN` | Long random secret shared only with the OCR service |
| `OCR_REVIEW_THRESHOLD` | `0.95` to keep the current conservative default |
| `GROQ_API_KEY` | Optional Groq API key; store as a secret |
| `GROQ_MODEL` | `openai/gpt-oss-20b` or the model selected for your Groq account |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server and port (typically port `587` with STARTTLS) |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | SMTP credentials; store the password as a secret |
| `SMTP_FROM_EMAIL` | Verified sender address |
| `SMTP_USE_SSL` | `false` for STARTTLS on port `587`; `true` for implicit TLS, commonly port `465` |
| `INBOUND_INVOICE_EMAIL` | Dedicated receiving address such as `invoices@yourdomain.com` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Mailgun account HTTP webhook signing key; store as a secret |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API token; store as a secret |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API sender phone-number ID |
| `WHATSAPP_GRAPH_API_VERSION` | Graph API version supported by your Meta app |
| `WHATSAPP_APP_SECRET` | Meta app secret used to verify incoming webhook signatures |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Random token used when Meta verifies the webhook URL |
| `WHATSAPP_INBOUND_NUMBER` | Human-readable business number shown to workspace users |
| `WHATSAPP_TEMPLATE_NAME` | Approved Utility template with one body placeholder (`{{1}}`) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code, e.g. `en_US` |
| `WHATSAPP_ADMIN_TO` | Optional comma-separated Admin notification destinations in international format |

Generate `SESSION_SECRET_KEY` and `OCR_SERVICE_TOKEN` separately. Do not reuse the Groq key for either. Set secrets in Render’s Environment page, never in source files.

### Email, WhatsApp, and in-app notifications

The app records notifications in the database and shows them from the bell in the workspace header. New workspace access requests and CRM lead submissions notify Admins; approval decisions notify the Lead; invoice upload and approval actions notify Admins. Email uses SMTP for outbound notifications. WhatsApp uses Meta’s Cloud API template messages for outbound notifications; only accounts that enter a phone number and check the WhatsApp opt-in receive those account-specific messages. Admin WhatsApp destinations are explicitly configured with `WHATSAPP_ADMIN_TO`.

1. Choose an SMTP provider, create app-specific SMTP credentials, and configure the `SMTP_*` values on the API service. For Gmail, use an app password with SMTP AUTH rather than a normal account password.
2. In Meta Business/Developer tools, configure WhatsApp Cloud API, add a sending number, create and get approval for a Utility template whose body has a single `{{1}}` placeholder, and create a long-lived access token. Set the `WHATSAPP_*` API values in the API service. Meta’s [template message API](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/) uses the configured template name, language, and body parameter.
3. Locally, add these values to `backend/.env`; in Render, add them to the API service Environment settings. Restart/redeploy the API after changing them. Keep tokens and SMTP passwords out of Git and the frontend.
4. In **Leads**, click **Send message**. Enter any recipient email directly or select a saved CRM contact. Email supports PDF/image attachments up to 15 MB each and 18 MB total. WhatsApp requires a saved contact, a number, recorded consent, and the configured approved template; file attachments are email-only. The app reports provider acceptance, not final inbox delivery or read status.
5. For invoice intake by email, configure a Mailgun receiving domain and its MX records. Set `INBOUND_INVOICE_EMAIL` to the exact receiving address and `MAILGUN_WEBHOOK_SIGNING_KEY` to the account HTTP webhook signing key. In Mailgun Routes, match that exact recipient and forward to `https://<api-service>.onrender.com/api/inbound/email/mailgun`. Use the multipart route-forward action so attachments and the signed timestamp/token/signature fields reach the app. Publish SPF and DKIM for Lead sender domains; the API accepts mail only when Mailgun verifies SPF or aligned DKIM and the envelope sender exactly matches an approved Lead account email. Each PDF or image must be 15 MB or less.
6. For invoice intake by WhatsApp, configure the WhatsApp Business Cloud API webhook callback as `https://<api-service>.onrender.com/api/inbound/whatsapp`, set the verify token to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, subscribe to the `messages` field, and set `WHATSAPP_APP_SECRET` to the Meta app secret. Set the existing Graph API access token and phone-number ID so the API can retrieve media. Set `WHATSAPP_INBOUND_NUMBER` for display. Approved Leads must save their WhatsApp number under the workspace notification preferences; invoice attachments from that exact number are stored in that Lead account. PDF, PNG, JPG, and WEBP files up to 15 MB are accepted.
7. Sign in as Admin and open the notification bell. It shows inbound/outbound channel configuration. Test with a registered approved Lead email and WhatsApp number, and verify the draft appears only in that account while Admin can review it. Inbound webhook retries are deduplicated by provider message ID and exact file content.

In-app notifications are available for signed-in users even when external providers are not configured. Provider delivery runs after the app saves its notification. Configure provider secrets only on the backend.

SMTP and WhatsApp outbound sends currently use FastAPI background tasks and are best-effort: in-app notifications are persisted, but external delivery failures are logged and are not retried. Inbound providers retry failed webhook responses and message IDs are deduplicated; file downloads still run during webhook handling. For high-volume or delivery-critical production use, move inbound downloads and notifications to a durable queue/outbox with retry and dead-letter handling.

### OCR private web service

Create a **Private Service** (no public ingress) using the same repository and branch:

- Root directory: `backend`
- Runtime: Python
- Build command:

```bash
apt-get update && apt-get install -y tesseract-ocr libgomp1 libglib2.0-0 libgl1 && \
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ && \
python -m pip install -r ocr_service/requirements.txt
```

- Start command: `python -m uvicorn ocr_service.app:app --host 0.0.0.0 --port $PORT`

Set `OCR_SERVICE_TOKEN` to the same random value as the API and set `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`. Copy the service’s **internal address** into the API’s `OCR_SERVICE_URL`. Keep the OCR service private. The first OCR request downloads PaddleOCR models, so allow for a slow cold start and monitor memory.

If the native Render build cannot install the required OS packages, stop before routing real invoices to OCR. The current no-container setup requires Tesseract and PaddlePaddle native dependencies on the OCR host.

### Frontend static site

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Environment variable at build time: `VITE_API_URL=https://<your-api-service>.onrender.com`

After the site is created, copy its exact `https://` origin into the API’s `FRONTEND_ORIGIN`, save, and redeploy the API. The browser sends the HTTP-only session cookie with API requests.

## 3. Configure Jenkins to build and deploy on GitHub pushes

The root `Jenkinsfile` runs on pushes, installs Python/OCR dependencies, checks for Tesseract, builds the frontend, compiles the Python packages, then calls the three Render deploy hooks on `main`.

1. Make Jenkins reachable from GitHub over HTTPS, or use the Jenkins SCM polling fallback if your Jenkins controller is private.
2. Install/enable the **GitHub plugin**, **Pipeline**, and **Credentials Binding** plugins.
3. In Jenkins, create a **Multibranch Pipeline** or Pipeline job using “Pipeline script from SCM”. Set SCM to Git, repository to `https://github.com/ShabariES/Invoice_verify.git`, branch `main`, and script path `Jenkinsfile`. Add GitHub credentials if the repository is private.
4. In Render, open each of the API, OCR, and frontend services and create a **Deploy Hook**. Add the URLs to Jenkins as **Secret text** credentials with these exact IDs:
   - `render-api-deploy-hook`
   - `render-ocr-deploy-hook`
   - `render-frontend-deploy-hook`
5. In GitHub, open **Settings → Webhooks → Add webhook**. Set the payload URL to `https://<your-jenkins-host>/github-webhook/`, content type to `application/json`, and choose **Just the push event**. Enable the webhook.
6. Turn off each Render service’s automatic Git deploy so a direct GitHub push cannot deploy before the Jenkins build finishes.
7. Push a commit to `main`. GitHub triggers Jenkins; when its stages succeed, Jenkins invokes the three Render hooks. Check the Jenkins console output and each Render service’s deploy logs.

The Jenkins controller must be publicly reachable for GitHub webhooks. If it is not, configure SCM polling on the job instead; the Render deploy-hook stage remains gated on a successful `main` build.

## 4. Verify the hosted setup

1. Open `https://<api-service>.onrender.com/health` and confirm it returns `{"status":"ok"}`.
2. Sign in with the bootstrap Admin account. In **Leads → Lead accounts**, approve or reject a test Lead account.
3. Create two Lead accounts. Confirm each account is pending and cannot sign in until approved. After approval, upload an invoice as each Lead. Confirm each sees and can read/edit only its own invoice and source file; OCR and invoice events must also be inaccessible across accounts. Identical file or invoice numbers uploaded in different Lead accounts should not be treated as cross-account duplicates.
4. Confirm Admin can see both accounts' invoices and review/approve them, while a Lead cannot perform final invoice approval or access another Lead's invoice by changing the ID in an API URL. Existing unassigned invoices should appear only to Admin.
5. Upload a non-sensitive test invoice. Confirm it appears in the private bucket, can be opened through the authenticated API, and OCR returns text/confidence. Delete the test invoice and its object when finished.

## Current limitations

This adds basic Lead/Admin authorization and manual Lead-account access approval, with invoice data isolated per Lead account. It does not yet include email verification, password reset, MFA, rate limiting, user deactivation tooling, or shared multi-user company workspaces. The initial Admin password is bootstrapped once; changing Render’s bootstrap environment variables does not reset an existing user. Do not use this pilot with customer financial records until these controls, retention, backups, migrations, and recovery have been reviewed.

Local SQLite records and files are not copied to Render by deployment. Start with a clean hosted database/bucket or arrange a reviewed migration separately.
