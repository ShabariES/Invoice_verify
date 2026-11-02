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

Generate `SESSION_SECRET_KEY` and `OCR_SERVICE_TOKEN` separately. Do not reuse the Groq key for either. Set secrets in Render’s Environment page, never in source files.

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
2. Sign in with the bootstrap Admin account. In **Leads → Workspace access requests**, approve or reject a test Lead account.
3. Create a Lead account. Confirm the account is pending and cannot sign in until the Admin approves it. After approval, confirm it can create and edit only its own leads.
4. Confirm the Admin can review/reject lead submissions and open the invoice desk.
5. Upload a non-sensitive test invoice. Confirm it appears in the private bucket, can be opened through the authenticated API, and OCR returns text/confidence. Delete the test invoice and its object when finished.

## Current limitations

This adds basic Lead/Admin authorization and manual Lead-account access approval, but does not yet include email verification, password reset, MFA, rate limiting, user deactivation tooling, or tenant/workspace isolation. The initial Admin password is bootstrapped once; changing Render’s bootstrap environment variables does not reset an existing user. Do not use this pilot with customer financial records until these controls, retention, backups, migrations, and recovery have been reviewed.

Local SQLite records and files are not copied to Render by deployment. Start with a clean hosted database/bucket or arrange a reviewed migration separately.
