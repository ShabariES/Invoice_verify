import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 10000);
const API_BASE_URL = (process.env.API_BASE_URL || '').replace(/\/+$/, '');
const WEBHOOK_TOKEN = process.env.BAILEYS_WEBHOOK_TOKEN || '';
const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || '/var/data/baileys-auth';
const DASHBOARD_USER = process.env.DASHBOARD_USER || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FORWARD_BYTES = 22 * 1024 * 1024;
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

if (!API_BASE_URL.startsWith('https://') || !WEBHOOK_TOKEN || !DASHBOARD_USER || !DASHBOARD_PASSWORD) {
  throw new Error('Set an HTTPS API_BASE_URL, BAILEYS_WEBHOOK_TOKEN, DASHBOARD_USER, and DASHBOARD_PASSWORD');
}

let socket;
let connectionState = 'starting';
let qrCodeDataUrl = '';
let connectionError = '';
let isConnecting = false;
const activeMessageIds = new Set();

function equalSecret(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function hasDashboardAuth(request) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let credentials;
  try {
    credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = credentials.indexOf(':');
  if (separator < 0) return false;
  return equalSecret(credentials.slice(0, separator), DASHBOARD_USER)
    && equalSecret(credentials.slice(separator + 1), DASHBOARD_PASSWORD);
}

function respondJson(response, statusCode, data) {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return respondJson(response, 200, { status: 'ok', connection: connectionState });
  }
  if (!hasDashboardAuth(request)) {
    response.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="WhatsApp link status", charset="UTF-8"',
      'Cache-Control': 'no-store',
    });
    return response.end('Authentication required');
  }
  if (request.method === 'GET' && url.pathname === '/status') {
    return respondJson(response, 200, { status: connectionState, error: connectionError, qr_available: Boolean(qrCodeDataUrl) });
  }
  if (request.method === 'GET' && url.pathname === '/qr') {
    if (!qrCodeDataUrl) return respondJson(response, 404, { error: 'QR is not currently available', status: connectionState });
    const image = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length, 'Cache-Control': 'no-store' });
    return response.end(image);
  }
  if (request.method === 'GET' && url.pathname === '/') {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice WhatsApp link</title><style>body{font:16px system-ui,sans-serif;background:#eef5fb;color:#16324f;margin:0;padding:32px}.card{max-width:560px;margin:8vh auto;background:white;border:1px solid #d4e3f1;border-radius:18px;padding:28px;box-shadow:0 12px 35px #18334b18}h1{font-size:24px;margin-top:0}.state{padding:12px;background:#f2f7fc;border-radius:10px}img{display:block;width:min(100%,320px);margin:24px auto}.muted{color:#61758a;font-size:14px}</style><main class="card"><h1>WhatsApp invoice inbox</h1><div class="state" id="state">Loading connection status…</div><img id="qr" alt="WhatsApp linking QR code" hidden><p class="muted">Scan the QR using WhatsApp → Linked devices. This page is private; do not share it.</p></main><script>async function refresh(){try{const r=await fetch('/status',{cache:'no-store'});const s=await r.json();document.querySelector('#state').textContent='Connection: '+s.status+(s.error?' — '+s.error:'');const q=document.querySelector('#qr');q.hidden=!s.qr_available;if(s.qr_available)q.src='/qr?ts='+Date.now()}catch{document.querySelector('#state').textContent='Could not read the worker status.'}}refresh();setInterval(refresh,5000)</script></html>`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
    return response.end(html);
  }
  return respondJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => log.info({ port: PORT }, 'Baileys worker web server listening'));

function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const wrapper = current.ephemeralMessage
      || current.viewOnceMessageV2
      || current.viewOnceMessage
      || current.documentWithCaptionMessage
      || current.viewOnceMessageV2Extension;
    if (!wrapper?.message) break;
    current = wrapper.message;
  }
  return current;
}

function phoneFromJid(key) {
  const jidCandidates = [key.remoteJidAlt, key.participantAlt, key.senderPn, key.participant, key.remoteJid];
  for (const candidate of jidCandidates) {
    if (typeof candidate !== 'string' || candidate.endsWith('@g.us')) continue;
    const number = candidate.split('@')[0].replace(/\D/g, '');
    if (number.length >= 8 && number.length <= 15 && !candidate.endsWith('@lid')) return number;
  }
  return '';
}

function fileForMessage(content) {
  if (content.documentMessage) {
    const file = content.documentMessage;
    return { file, filename: file.fileName || '', mimetype: file.mimetype || 'application/octet-stream' };
  }
  if (content.imageMessage) {
    const file = content.imageMessage;
    const mimetype = file.mimetype || 'image/jpeg';
    const extension = ({ 'image/png': '.png', 'image/webp': '.webp' })[mimetype] || '.jpg';
    return { file, filename: `whatsapp-image${extension}`, mimetype };
  }
  return null;
}

async function forwardInvoice(message, sock) {
  const key = message.key || {};
  const jid = key.remoteJid || '';
  const id = String(key.id || '').trim();
  if (!id || key.fromMe || jid.endsWith('@g.us') || jid === 'status@broadcast') return;
  if (activeMessageIds.has(id)) return;
  const content = unwrapMessage(message.message || {});
  const attachment = fileForMessage(content);
  if (!attachment) return;
  const senderPhone = phoneFromJid(key);
  if (!senderPhone) {
    log.warn({ messageId: id }, 'Skipped direct message because Baileys did not provide a phone number for this LID');
    return;
  }
  if (Number(attachment.file.fileLength || 0) > MAX_FILE_BYTES) {
    log.warn({ messageId: id }, 'Skipped WhatsApp invoice larger than 15 MiB');
    return;
  }

  activeMessageIds.add(id);
  try {
    const data = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger: log, reuploadRequest: sock.updateMediaMessage },
    );
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_FILE_BYTES) {
      log.warn({ messageId: id }, 'Skipped empty or oversized downloaded attachment');
      return;
    }
    const filename = path.basename(String(attachment.filename || `whatsapp-${id}`)).slice(0, 200);
    const jsonBody = JSON.stringify({
      message_id: id,
      sender_phone: senderPhone,
      filename,
      mimetype: attachment.mimetype,
      data_base64: data.toString('base64'),
    });
    if (Buffer.byteLength(jsonBody) > MAX_FORWARD_BYTES) {
      log.warn({ messageId: id }, 'Skipped WhatsApp invoice because encoded payload exceeds API limit');
      return;
    }

    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await fetch(`${API_BASE_URL}/api/inbound/whatsapp/baileys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Baileys-Token': WEBHOOK_TOKEN },
          body: jsonBody,
          signal: AbortSignal.timeout(60_000),
        });
        const responseText = await result.text();
        if (result.ok) {
          log.info({ messageId: id, status: result.status }, 'Forwarded WhatsApp attachment to invoice API');
          return;
        }
        lastError = new Error(`Invoice API returned HTTP ${result.status}: ${responseText.slice(0, 300)}`);
        if (result.status < 500 && result.status !== 429) break;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    log.error({ messageId: id, error: lastError?.message || 'unknown error' }, 'Could not forward WhatsApp invoice');
  } catch (error) {
    log.error({ messageId: id, error: error?.message || 'unknown error' }, 'Could not download WhatsApp media');
  } finally {
    activeMessageIds.delete(id);
  }
}

async function connectWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;
  connectionState = 'connecting';
  connectionError = '';
  try {
    await mkdir(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Invoice Verify'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: pino({ level: 'silent' }),
    });
    socket = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        qrCodeDataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 2, width: 360 });
        connectionState = 'awaiting_qr_scan';
        log.info('WhatsApp QR is available on the protected worker page');
      }
      if (connection === 'open') {
        qrCodeDataUrl = '';
        connectionState = 'connected';
        connectionError = '';
        log.info('WhatsApp linked device connected');
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        connectionState = statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'disconnected';
        connectionError = statusCode === DisconnectReason.loggedOut ? 'The linked device logged out. Delete its saved auth state and scan a fresh QR.' : '';
        log.warn({ statusCode }, 'WhatsApp connection closed');
        if (statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => connectWhatsApp().catch((error) => log.error({ error: error.message }, 'Reconnect failed')), 3000);
        }
      }
    });
    sock.ev.on('messages.upsert', async ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const message of messages || []) await forwardInvoice(message, sock);
    });
  } finally {
    isConnecting = false;
  }
}

connectWhatsApp().catch((error) => {
  connectionState = 'error';
  connectionError = 'Could not start the WhatsApp connection; check service logs.';
  log.error({ error: error.message }, 'Baileys startup failed');
});

async function shutdown() {
  log.info('Shutting down Baileys worker');
  try { socket?.end(undefined); } catch { /* process is exiting */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
