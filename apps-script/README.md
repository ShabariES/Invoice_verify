# Gmail to Invoice Verify (Apps Script)

This script polls a Gmail inbox every five minutes and relays supported PDF/image attachments to the Render API. It does not require Mailgun or a custom domain. The API accepts mail only when the sender matches an active, approved Lead account. Delivery is idempotent by Gmail message ID.

## Render API environment

Set these on the API service, then deploy the updated API image:

- `INBOUND_INVOICE_EMAIL`: the exact Gmail address that receives the invoices.
- `APPS_SCRIPT_INBOUND_TOKEN`: a long random secret. Generate one locally with Python: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Keep it private and do not put it in source control.

`MAILGUN_WEBHOOK_SIGNING_KEY` is not needed for this integration. The existing Mailgun endpoint can remain unused.

## Create the Apps Script relay

1. Open [script.google.com](https://script.google.com/) while signed in to the Gmail account that receives invoices; create a **New project**.
2. Replace the editor contents with `Code.gs` from this folder and save.
3. Open **Project Settings → Script properties → Add script property**. Add:
   - `API_URL` = `https://invoice-verify-api-latest.onrender.com` (no trailing slash)
   - `INVOICE_EMAIL` = the same value as Render's `INBOUND_INVOICE_EMAIL`
   - `INBOUND_TOKEN` = the exact `APPS_SCRIPT_INBOUND_TOKEN` value from Render
4. In the function selector, choose `installInvoiceTrigger` and click **Run**. Review and grant permissions for Gmail, external requests, and time-based triggers.
5. In Gmail, send a test email with a PDF/JPG/PNG/WEBP invoice attached to the configured invoice address. It is checked about every five minutes. Successful threads get the `InvoiceVerify/Processed` label. Failed requests get `InvoiceVerify/NeedsReview`; inspect **Apps Script → Executions** for the HTTP status, then remove the failed label to retry.

The sender must already be an active, approved Lead in Invoice Verify. Each attachment must be a genuine supported PDF or image and no larger than 15 MB. The script skips other file types. The API's normal upload validation and duplicate-file protection still apply.
