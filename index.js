import { registerRootComponent } from 'expo';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Polyfill Buffer
global.Buffer = Buffer;

import App from './App';

const CLOUD_URL = 'https://boutididact-backendd.vercel.app';

/**
 * Formate un ticket ESC/POS à l'identique d'un ticket Hiboutik réel.
 */
export const generateEscPosBytes = (ticket, width = 32) => {
  const buffers = [];
  const add = (str) => buffers.push(Buffer.from(str, 'utf-8'));
  const addBytes = (arr) => buffers.push(Buffer.from(arr));

  const drawLine = () => add("-".repeat(width) + "\n");
  const padLeftRight = (left, right) => {
    const spaces = Math.max(0, width - left.length - right.length);
    return left + " ".repeat(spaces) + right;
  };
  const padCenterStr = (str, w) => {
    if (str.length >= w) return str.slice(0, w);
    const left = Math.floor((w - str.length) / 2);
    return ' '.repeat(left) + str + ' '.repeat(w - str.length - left);
  };

  // 1. Initialisation de l'imprimante
  addBytes([0x1B, 0x40]);

  // 2. En-tête commerce
  addBytes([0x1B, 0x61, 0x01]); // Aligné au centre
  addBytes([0x1B, 0x45, 0x01]); // Gras ON
  addBytes([0x1D, 0x21, 0x11]); // Double taille (largeur & hauteur)
  add((ticket.shop?.name || 'BOUTIDIDACT').toUpperCase() + "\n");
  
  addBytes([0x1D, 0x21, 0x00]); // Taille normale
  addBytes([0x1B, 0x45, 0x00]); // Gras OFF
  if (ticket.shop?.address) add(ticket.shop.address + "\n");
  if (ticket.shop?.siret) add(`SIRET : ${ticket.shop.siret}\n`);
  if (ticket.shop?.tva) add(`TVA : ${ticket.shop.tva}\n`);
  drawLine();

  // 3. Métadonnées ticket
  addBytes([0x1B, 0x61, 0x00]); // Aligné à gauche
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR');
  add(padLeftRight(`Ticket : ${ticket.ticketId || `T-${Date.now()}`}`, dateStr) + "\n");
  if (ticket.saleId) {
    add(padLeftRight(`Vente : #${ticket.saleId}`, timeStr) + "\n");
  } else {
    add(padLeftRight('', timeStr) + "\n");
  }
  drawLine();

  // 4. Lignes articles (Colonnes alignées)
  const nameW = Math.floor(width * 0.55); // 17 caractères
  const qtyW = Math.floor(width * 0.15);  // 4 caractères
  const totalW = width - nameW - qtyW;   // 11 caractères

  const header = "Article".padEnd(nameW) + padCenterStr("Qte", qtyW) + "Total".padStart(totalW);
  add(header + "\n");
  drawLine();

  (ticket.items || []).forEach((it) => {
    const name = String(it.name || '').slice(0, nameW - 1).padEnd(nameW);
    const qty = padCenterStr(String(it.quantity || 1), qtyW);
    const lineTotal = (Number(it.price || 0) * Number(it.quantity || 1)).toFixed(2) + " EUR";
    const lineTotalPadded = lineTotal.padStart(totalW);
    add(name + qty + lineTotalPadded + "\n");
    if (Number(it.quantity || 1) > 1) {
      add(`   ${Number(it.price || 0).toFixed(2)} EUR / unite\n`);
    }
  });
  drawLine();

  // 5. Total TTC
  addBytes([0x1B, 0x61, 0x02]); // Aligné à droite
  addBytes([0x1B, 0x45, 0x01]); // Gras ON
  addBytes([0x1D, 0x21, 0x11]); // Double taille
  add(`TOTAL TTC : ${Number(ticket.total || 0).toFixed(2)} EUR\n`);
  addBytes([0x1D, 0x21, 0x00]); // Taille normale
  addBytes([0x1B, 0x45, 0x00]); // Gras OFF

  // Détail TVA
  if (Array.isArray(ticket.taxBreakdown) && ticket.taxBreakdown.length) {
    addBytes([0x1B, 0x61, 0x00]); // Aligné à gauche
    add('Detail TVA :\n');
    ticket.taxBreakdown.forEach((t) => {
      add(`  TVA ${t.rate}%  HT ${Number(t.base).toFixed(2)}  TVA ${Number(t.tax).toFixed(2)}\n`);
    });
  }

  // 6. Mode de paiement
  addBytes([0x1B, 0x61, 0x00]); // Aligné à gauche
  add(`Paiement : ${ticket.payment || 'CB'}\n`);
  drawLine();

  // 7. Pied de page
  addBytes([0x1B, 0x61, 0x01]); // Aligné au centre
  if (ticket.shop?.footer) add(ticket.shop.footer + "\n");
  add(padCenterStr('Ticket non valable comme facture', width) + "\n");
  add(padCenterStr(`Edite le ${dateStr} a ${timeStr}`, width) + "\n\n\n\n");

  // 8. Coupe automatique
  addBytes([0x1D, 0x56, 0x41, 0x00]);

  return Buffer.concat(buffers);
};

// 1. Enregistrement du service de premier plan (Foreground Service)
try {
  if (Platform.OS === 'android') {
    ReactNativeForegroundService.register();

    // 2. Définition de la tâche d'arrière-plan globale (Headless)
    ReactNativeForegroundService.add_task(async () => {
      try {
        const shopName = await AsyncStorage.getItem('boutididact_shopName');
        const printerIp = await AsyncStorage.getItem('boutididact_printerIp');
        const isRunning = await AsyncStorage.getItem('boutididact_isRunning');

        if (isRunning === 'true' && shopName && printerIp) {
          const url = `${CLOUD_URL}/api/saas/poll-ticket?shopName=${encodeURIComponent(shopName.trim())}`;
          const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
          if (!response.ok) return;

          const data = await response.json();
          if (data && data.ticket) {
            console.log("[Service Arrière-plan] Ticket reçu ID:", data.ticket.ticketId);

            const ip = printerIp.trim();
            const port = 9100;

            const client = TcpSocket.createConnection({ host: ip, port: port, timeout: 5000 }, () => {
              // Génère le ticket ESC/POS à l'identique de Hiboutik
              const ticketBytes = generateEscPosBytes(data.ticket, 32);
              client.write(ticketBytes);
              setTimeout(() => client.destroy(), 1500);
            });

            client.on('error', (e) => {
              console.log("[Service Arrière-plan] Erreur imprimante:", e.message);
            });
          }
        }
      } catch (e) {
        console.log("[Service Arrière-plan] Erreur tâche:", e.message);
      }
    }, {
      delay: 5000,
      onLoop: true,
      taskId: 'relay_task',
      onError: (e) => console.log("[Service Arrière-plan] Erreur:", e),
    });
  }
} catch (e) {
  console.error("Foreground Service registration failed", e);
}

registerRootComponent(App);
