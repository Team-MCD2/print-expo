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

// 1. Enregistrement du service de premier plan (Foreground Service)
try {
  if (Platform.OS === 'android') {
    ReactNativeForegroundService.register();

    // 2. Définition de la tâche d'arrière-plan globale (Headless)
    // Elle s'exécutera de manière persistante en arrière-plan, même si l'application est minimisée ou fermée !
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

            // Impression ESC/POS du ticket complet
            const ip = printerIp.trim();
            const port = 9100;

            const client = TcpSocket.createConnection({ host: ip, port: port, timeout: 5000 }, () => {
              const buffers = [];

              // Initialisation
              buffers.push(Buffer.from([0x1B, 0x40])); 

              // En-tête (Center, Bold, Large)
              buffers.push(Buffer.from([0x1B, 0x61, 0x01])); 
              buffers.push(Buffer.from([0x1B, 0x45, 0x01])); 
              buffers.push(Buffer.from([0x1D, 0x21, 0x11])); 
              buffers.push(Buffer.from(`${data.ticket.shop?.name || 'BOUTIDIDACT'}\n\n`, 'utf-8'));

              // Normal size, keeping Center and Bold
              buffers.push(Buffer.from([0x1D, 0x21, 0x00])); 
              buffers.push(Buffer.from("TICKET CLIENT\n", 'utf-8'));
              buffers.push(Buffer.from(`ID: ${data.ticket.ticketId || 'Inconnu'}\n`, 'utf-8'));
              
              const dateStr = new Date().toLocaleDateString('fr-FR');
              const timeStr = new Date().toLocaleTimeString('fr-FR');
              buffers.push(Buffer.from(`${dateStr} - ${timeStr}\n`, 'utf-8'));
              buffers.push(Buffer.from("--------------------------------\n", 'utf-8'));

              // Articles (Left, Normal)
              buffers.push(Buffer.from([0x1B, 0x61, 0x00])); 
              buffers.push(Buffer.from([0x1B, 0x45, 0x00])); 

              const w = 32; 
              (data.ticket.items || []).forEach(it => {
                const name = String(it.name || '').slice(0, 16);
                const qty = String(it.quantity || 1) + "x";
                const price = Number(it.price || 0).toFixed(2) + "E";
                const line = `${qty} ${name}`.padEnd(w - price.length) + price;
                buffers.push(Buffer.from(`${line}\n`, 'utf-8'));
              });

              buffers.push(Buffer.from("--------------------------------\n", 'utf-8'));

              // Total (Right, Bold)
              buffers.push(Buffer.from([0x1B, 0x61, 0x02])); 
              buffers.push(Buffer.from([0x1B, 0x45, 0x01])); 
              buffers.push(Buffer.from(`TOTAL: ${Number(data.ticket.total || 0).toFixed(2)} EUR\n`, 'utf-8'));
              buffers.push(Buffer.from([0x1B, 0x45, 0x00])); 
              buffers.push(Buffer.from(`Paiement: ${data.ticket.payment || 'CB'}\n\n`, 'utf-8'));

              // Footer (Center)
              buffers.push(Buffer.from([0x1B, 0x61, 0x01])); 
              if (data.ticket.shop?.footer) {
                buffers.push(Buffer.from(`${data.ticket.shop.footer}\n`, 'utf-8'));
              }
              buffers.push(Buffer.from("Merci de votre visite !\n\n\n\n", 'utf-8'));

              // Coupe
              buffers.push(Buffer.from([0x1D, 0x56, 0x41, 0x00])); 

              client.write(Buffer.concat(buffers));
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
