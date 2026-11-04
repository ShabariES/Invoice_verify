# Gmail to Invoice Verify (Apps Script)

This script polls a Gmail inbox every five minutes and relays supported PDF/image attachments to the Render API. It also exposes a token-protected web-app endpoint so the Render API can ask Gmail to send outbound notifications over HTTPS (avoiding Render Free's SMTP port restrictions). It does not require Mailgun or a custom domain. The API accepts inbound mail only when the sender matches an active, approved Lead account. Inbound delivery is idempotent by Gmail message ID.

## Render API environment

Set these on the API service, then deploy the updated API image:

- `INBOUND_INVOICE_EMAIL`: the exact Gmail address that receives the invoices.
- `APPS_SCRIPT_INBOUND_TOKEN`: a long random secret. Generate one locally with Python: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Keep it private and do not put it in source control.
- `GMAIL_APPS_SCRIPT_URL`: the Apps Script web-app deployment URL ending in `/exec`.
- `GMAIL_APPS_SCRIPT_TOKEN`: another long random secret, separate from the inbound token.

`MAILGUN_WEBHOOK_SIGNING_KEY` and SMTP are not needed for this integration. The existing Mailgun endpoint can remain unused.

## Create the Apps Script relay

1. Open [script.google.com](https://script.google.com/) while signed in to the Gmail account that receives invoices; create a **New project**.
2. Replace the editor contents with `Code.gs` from this folder and save.
3. Open **Project Settings → Script properties → Add script property**. Add:
   - `API_URL` = `https://invoice-verify-api-latest.onrender.com` (no trailing slash)
   - `INVOICE_EMAIL` = the same value as Render's `INBOUND_INVOICE_EMAIL`
   - `INBOUND_TOKEN` = the exact `APPS_SCRIPT_INBOUND_TOKEN` value from Render
   - `OUTBOUND_TOKEN` = the exact `GMAIL_APPS_SCRIPT_TOKEN` value from Render
4. In the function selector, choose `authorizeEmailSending` and click **Run**. Grant Gmail permission when prompted.
5. Click **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then deploy and authorize if prompted. Copy the web-app URL ending in `/exec` into Render's `GMAIL_APPS_SCRIPT_URL`.
6. Save the Render environment variables and redeploy the API. Then choose `installInvoiceTrigger` in Apps Script and click **Run** to authorize Gmail reading and install the inbound polling trigger.
7. In Gmail, send a test email with a PDF/JPG/PNG/WEBP invoice attached to the configured invoice address. It is checked about every five minutes. Successful threads get the `InvoiceVerify/Processed` label. Failed requests get `InvoiceVerify/NeedsReview`; inspect **Apps Script → Executions** for the HTTP status, then remove the failed label to retry.

The sender must already be an active, approved Lead in Invoice Verify. Each attachment must be a genuine supported PDF or image and no larger than 15 MB. The script skips other file types. The API's normal upload validation and duplicate-file protection still apply.
