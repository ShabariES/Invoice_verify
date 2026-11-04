/**
 * Gmail invoice relay for Invoice Verify.
 * Configure API_URL, INVOICE_EMAIL, and INBOUND_TOKEN in Script Properties.
 * Run installInvoiceTrigger() once, then authorize Gmail and trigger access.
 */
const PROCESSED_LABEL = 'InvoiceVerify/Processed';
const FAILED_LABEL = 'InvoiceVerify/NeedsReview';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function installInvoiceTrigger() {
  const props = PropertiesService.getScriptProperties();
  ['API_URL', 'INVOICE_EMAIL', 'INBOUND_TOKEN'].forEach(function (key) {
    if (!props.getProperty(key)) throw new Error('Set Script Property ' + key + ' first.');
  });
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === 'checkInvoiceMailbox'; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('checkInvoiceMailbox').timeBased().everyMinutes(5).create();
  checkInvoiceMailbox();
}

function checkInvoiceMailbox() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL').replace(/\/$/, '') + '/api/inbound/email/apps-script';
  const invoiceEmail = props.getProperty('INVOICE_EMAIL').trim().toLowerCase();
  const token = props.getProperty('INBOUND_TOKEN');
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const failed = getOrCreateLabel_(FAILED_LABEL);
  const threads = GmailApp.search('to:' + invoiceEmail + ' has:attachment -label:"' + PROCESSED_LABEL + '" -label:"' + FAILED_LABEL + '"', 0, 25);

  threads.forEach(function (thread) {
    let allAccepted = true;
    thread.getMessages().forEach(function (message) {
      if (!allAccepted) return;
      const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
      const files = [];
      attachments.forEach(function (blob) {
        const filename = blob.getName() || 'invoice';
        const bytes = blob.getBytes();
        if (bytes.length > MAX_ATTACHMENT_BYTES) return;
        if (!/\.(pdf|png|jpe?g|webp)$/i.test(filename)) return;
        files.push({ filename: filename, data_base64: Utilities.base64Encode(bytes) });
      });
      if (!files.length) return;

      const payload = {
        sender: message.getFrom(),
        recipient: invoiceEmail,
        message_id: message.getId(),
        attachments: files
      };
      try {
        const response = UrlFetchApp.fetch(apiUrl, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'X-Inbound-Token': token },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        const status = response.getResponseCode();
        if (status < 200 || status >= 300) {
          console.error('Invoice relay failed with HTTP ' + status + ': ' + response.getContentText().slice(0, 500));
          allAccepted = false;
        }
      } catch (error) {
        console.error('Invoice relay request failed: ' + error);
        allAccepted = false;
      }
    });
    if (allAccepted) {
      thread.addLabel(processed);
    } else {
      // Keep failed mail out of the automatic retry loop; inspect and remove this label to retry.
      thread.addLabel(failed);
    }
  });
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
