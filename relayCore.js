import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';

export const CLOUD_URL = 'https://boutididact-backendd.vercel.app';
export const POLL_INTERVAL_MS = 5000;
export const PRINT_RETRY_MS = 15000;

const state = {
  processing: false,
  lastHandledId: null,
  lastFail: { id: null, at: 0 },
};

let globalLogHandler = null;

export function setRelayLogHandler(handler) {
  globalLogHandler = typeof handler === 'function' ? handler : null;
}

function emitLog(onLog, msg) {
  onLog?.(msg);
  globalLogHandler?.(msg);
}

export function resetRelayState() {
  state.processing = false;
  state.lastHandledId = null;
  state.lastFail = { id: null, at: 0 };
}

function resolvePrinterTarget(ticket, printerIp) {
  return {
    ip: String(ticket?.printer?.ip || printerIp || '').trim(),
    port: parseInt(ticket?.printer?.port || '9100', 10) || 9100,
  };
}

export function generateEscPosBytes(ticket, width = 32) {
  const buffers = [];
  const stripAccents = (str) => {
    if (!str) return '';
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };
  const add = (str) => buffers.push(Buffer.from(stripAccents(str), 'latin1'));
  const addBytes = (arr) => buffers.push(Buffer.from(arr));

  const drawLine = () => add(`${'-'.repeat(width)}\n`);
  const padLeftRight = (left, right) => {
    const spaces = Math.max(0, width - left.length - right.length);
    return left + ' '.repeat(spaces) + right;
  };
  const padCenterStr = (str, w) => {
    if (str.length >= w) return str.slice(0, w);
    const left = Math.floor((w - str.length) / 2);
    return ' '.repeat(left) + str + ' '.repeat(w - str.length - left);
  };

  addBytes([0x1B, 0x40]);
  addBytes([0x1B, 0x74, 19]);
  addBytes([0x1B, 0x61, 0x01]);
  addBytes([0x1B, 0x45, 0x01]);
  addBytes([0x1D, 0x21, 0x11]);
  add(`${(ticket.shop?.name || 'BOUTIDIDACT').toUpperCase()}\n`);
  addBytes([0x1D, 0x21, 0x00]);
  addBytes([0x1B, 0x45, 0x00]);
  if (ticket.shop?.address) add(`${ticket.shop.address}\n`);
  if (ticket.shop?.siret) add(`SIRET : ${ticket.shop.siret}\n`);
  if (ticket.shop?.tva) add(`TVA : ${ticket.shop.tva}\n`);
  drawLine();

  addBytes([0x1B, 0x61, 0x00]);
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR');
  add(`${padLeftRight(`Ticket : ${ticket.ticketId || `T-${Date.now()}`}`, dateStr)}\n`);
  if (ticket.saleId) {
    add(`${padLeftRight(`Vente : #${ticket.saleId}`, timeStr)}\n`);
  } else {
    add(`${padLeftRight('', timeStr)}\n`);
  }
  drawLine();

  const nameW = Math.floor(width * 0.55);
  const qtyW = Math.floor(width * 0.15);
  const totalW = width - nameW - qtyW;
  add(`${'Article'.padEnd(nameW)}${padCenterStr('Qte', qtyW)}${'Total'.padStart(totalW)}\n`);
  drawLine();

  (ticket.items || []).forEach((it) => {
    const name = String(it.name || '').slice(0, nameW - 1).padEnd(nameW);
    const qty = padCenterStr(String(it.quantity || 1), qtyW);
    const lineTotal = `${(Number(it.price || 0) * Number(it.quantity || 1)).toFixed(2)} EUR`;
    add(`${name}${qty}${lineTotal.padStart(totalW)}\n`);
    if (Number(it.quantity || 1) > 1) {
      add(`   ${Number(it.price || 0).toFixed(2)} EUR / unite\n`);
    }
  });
  drawLine();

  addBytes([0x1B, 0x61, 0x02]);
  addBytes([0x1B, 0x45, 0x01]);
  addBytes([0x1D, 0x21, 0x11]);
  add(`TOTAL TTC : ${Number(ticket.total || 0).toFixed(2)} EUR\n`);
  addBytes([0x1D, 0x21, 0x00]);
  addBytes([0x1B, 0x45, 0x00]);

  if (Array.isArray(ticket.taxBreakdown) && ticket.taxBreakdown.length) {
    addBytes([0x1B, 0x61, 0x00]);
    add('Detail TVA :\n');
    ticket.taxBreakdown.forEach((t) => {
      add(`  TVA ${t.rate}%  HT ${Number(t.base).toFixed(2)}  TVA ${Number(t.tax).toFixed(2)}\n`);
    });
  }

  addBytes([0x1B, 0x61, 0x00]);
  add(`Paiement : ${ticket.payment || 'CB'}\n`);
  drawLine();
  addBytes([0x1B, 0x61, 0x01]);
  if (ticket.shop?.footer) add(`${ticket.shop.footer}\n`);
  add(`${padCenterStr('Ticket non valable comme facture', width)}\n`);
  add(`${padCenterStr(`Edite le ${dateStr} a ${timeStr}`, width)}\n\n\n\n`);
  addBytes([0x1D, 0x56, 0x41, 0x00]);

  return Buffer.concat(buffers);
}

function printEscPos(ticket, printerIp) {
  const { ip, port } = resolvePrinterTarget(ticket, printerIp);
  if (!ip) return Promise.resolve({ ok: false, detail: 'IP manquante' });

  return new Promise((resolve) => {
    let done = false;
    let sent = false;
    let client = null;

    const finish = (ok, detail = '') => {
      if (done) return;
      done = true;
      if (hardTimeout) clearTimeout(hardTimeout);
      if (successTimeout) clearTimeout(successTimeout);
      try { client?.destroy(); } catch { /* ignore */ }
      resolve({ ok, detail });
    };

    let hardTimeout = null;
    let successTimeout = null;

    hardTimeout = setTimeout(() => {
      if (sent) finish(true, 'envoi ok (timeout)');
      else finish(false, 'timeout connexion imprimante');
    }, 12000);

    try {
      client = TcpSocket.createConnection({ host: ip, port, timeout: 10000 }, () => {
        try {
          client.write(generateEscPosBytes(ticket, 32));
          sent = true;
          successTimeout = setTimeout(() => finish(true, 'imprime'), 2000);
        } catch (e) {
          finish(false, e.message || 'erreur ecriture');
        }
      });

      client.on('error', (err) => {
        if (sent) return;
        finish(false, err?.message || 'erreur tcp');
      });
    } catch (e) {
      finish(false, e.message || 'erreur connexion');
    }
  });
}

async function ackTicket(shopName) {
  try {
    const res = await fetch(`${CLOUD_URL}/api/saas/ack-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopName }),
    });
    if (res.ok) return true;
  } catch { /* fallback */ }

  try {
    const res = await fetch(
      `${CLOUD_URL}/api/saas/poll-ticket?shopName=${encodeURIComponent(shopName)}`,
      { headers: { Accept: 'application/json' } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function pollAndPrint(shopName, printerIp, onLog) {
  if (state.processing) return;

  const shop = String(shopName || '').trim();
  const ip = String(printerIp || '').trim();
  if (!shop || !ip) return;

  try {
    const url = `${CLOUD_URL}/api/saas/poll-ticket?shopName=${encodeURIComponent(shop)}&peek=1`;
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return;

    const data = await response.json();
    if (!data?.ticket) return;

    const tid = data.ticket.ticketId || 'Inconnu';
    if (tid === state.lastHandledId) return;
    if (state.lastFail.id === tid && Date.now() - state.lastFail.at < PRINT_RETRY_MS) return;

    state.processing = true;
    const target = resolvePrinterTarget(data.ticket, ip);
    emitLog(onLog, `TICKET RECU : ID ${tid}`);
    emitLog(onLog, `Impression vers ${target.ip}:${target.port}...`);

    const result = await printEscPos(data.ticket, ip);
    if (result.ok) {
      const acked = await ackTicket(shop);
      state.lastHandledId = tid;
      state.lastFail = { id: null, at: 0 };
      emitLog(onLog, acked ? `Ticket ${tid} imprime.` : `Ticket ${tid} imprime (ack en attente).`);
    } else {
      state.lastFail = { id: tid, at: Date.now() };
      emitLog(onLog, `Echec impression ${tid} : ${result.detail || 'erreur'} — nouvel essai dans 15s.`);
    }
  } catch (error) {
    emitLog(onLog, `Erreur polling: ${error.message}`);
  } finally {
    state.processing = false;
  }
}

export async function testPrint(printerIp, onLog) {
  const ticket = {
    ticketId: 'TEST',
    total: 0,
    payment: 'TEST',
    items: [{ name: 'Test connexion', quantity: 1, price: 0 }],
  };
  const target = resolvePrinterTarget(ticket, printerIp);
  emitLog(onLog, `Test vers ${target.ip}:${target.port}...`);
  const result = await printEscPos(ticket, printerIp);
  emitLog(onLog, result.ok ? 'Test OK — imprimante joignable.' : `Test echoue : ${result.detail || 'erreur'}`);
  return result.ok;
}
