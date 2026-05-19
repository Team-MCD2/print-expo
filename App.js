import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import { useKeepAwake } from 'expo-keep-awake';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import * as IntentLauncher from 'expo-intent-launcher';

const CLOUD_URL = 'https://boutididact-backendd.vercel.app';
const POLL_INTERVAL_MS = 5000;

// ---- Global state et logique hors composant pour le Foreground Service ----
// Évite les fuites mémoire et les closures périmées quand le composant React
// se démonte ou se recrée. Le service en arrière-plan appelle directement cette structure globale.
const globalRelay = {
  logs: [],
  shopName: '',
  printerIp: '192.168.1.100',
  setLogsCallback: null,

  addLog(msg) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    this.logs = [entry, ...this.logs].slice(0, 50);
    console.log("[Relais]", entry);
    if (this.setLogsCallback) {
      try {
        this.setLogsCallback([...this.logs]);
      } catch (e) {
        console.error("Callback log error:", e);
      }
    }
  },

  async pollTicket() {
    try {
      const currentShopName = this.shopName.trim();
      if (!currentShopName) return;

      const url = `${CLOUD_URL}/api/saas/poll-ticket?shopName=${encodeURIComponent(currentShopName)}`;
      const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!response.ok) return;

      const data = await response.json();
      if (data && data.ticket) {
        this.addLog("TICKET RECU : ID " + (data.ticket.ticketId || 'Inconnu'));
        this.printTicket(data.ticket);
      }
    } catch (error) {
      this.addLog("Erreur Polling: " + error.message);
    }
  },

  printTicket(ticket) {
    const ip = this.printerIp.trim();
    const port = 9100;

    this.addLog("Connexion a l'imprimante " + ip + ":" + port + "...");

    const client = TcpSocket.createConnection({ host: ip, port: port, timeout: 5000 }, () => {
      this.addLog("Imprimante connectee. Envoi des données...");

      try {
        const commands = [];

        // 1. INIT
        commands.push(Buffer.from([0x1B, 0x40]));

        // 2. Alignement centré pour l'entête
        commands.push(Buffer.from([0x1B, 0x61, 0x01]));

        // 3. Infos Boutique
        const shop = ticket.shop || {};
        const sName = shop.name || 'BOUTIDIDACT';
        commands.push(Buffer.from([0x1B, 0x45, 0x01])); // BOLD ON
        commands.push(Buffer.from(`${sName}\n`, 'utf-8'));
        commands.push(Buffer.from([0x1B, 0x45, 0x00])); // BOLD OFF

        if (shop.address) commands.push(Buffer.from(`${shop.address}\n`, 'utf-8'));
        if (shop.siret) commands.push(Buffer.from(`SIRET : ${shop.siret}\n`, 'utf-8'));
        if (shop.tva) commands.push(Buffer.from(`TVA : ${shop.tva}\n`, 'utf-8'));
        commands.push(Buffer.from(`--------------------------------\n`, 'utf-8'));

        // 4. Métadonnées du Ticket
        commands.push(Buffer.from([0x1B, 0x61, 0x00])); // ALIGNEMENT GAUCHE
        const dateStr = new Date().toLocaleDateString('fr-FR');
        const timeStr = new Date().toLocaleTimeString('fr-FR');
        commands.push(Buffer.from(`Ticket ID : ${ticket.ticketId || 'Inconnu'}\n`, 'utf-8'));
        if (ticket.saleId) commands.push(Buffer.from(`Vente ID  : #${ticket.saleId}\n`, 'utf-8'));
        commands.push(Buffer.from(`Date      : ${dateStr} ${timeStr}\n`, 'utf-8'));
        commands.push(Buffer.from(`--------------------------------\n`, 'utf-8'));

        // 5. Entête des Articles
        commands.push(Buffer.from(`Article               Qte  Total\n`, 'utf-8'));
        commands.push(Buffer.from(`--------------------------------\n`, 'utf-8'));

        // 6. Boucle sur les Articles du Panier
        const items = ticket.items || [];
        items.forEach((it) => {
          const rawName = String(it.name || '');
          const qty = String(it.quantity || 1).padStart(3);
          const priceVal = (Number(it.price) * Number(it.quantity)).toFixed(2);
          const priceStr = `${priceVal} EUR`.padStart(9);

          // Si le nom de l'article dépasse 19 caractères, on le coupe proprement, sinon on padde
          const shortName = rawName.slice(0, 19).padEnd(20);
          commands.push(Buffer.from(`${shortName}${qty}${priceStr}\n`, 'utf-8'));
          
          // Si le nom était plus long, on affiche la suite en dessous
          if (rawName.length > 19) {
            commands.push(Buffer.from(`  ${rawName.slice(19, 50)}\n`, 'utf-8'));
          }
        });
        commands.push(Buffer.from(`--------------------------------\n`, 'utf-8'));

        // 7. Total Général
        commands.push(Buffer.from([0x1B, 0x61, 0x02])); // ALIGNEMENT DROITE
        commands.push(Buffer.from([0x1B, 0x45, 0x01])); // BOLD ON
        commands.push(Buffer.from(`TOTAL TTC : ${Number(ticket.total || 0).toFixed(2)} EUR\n`, 'utf-8'));
        commands.push(Buffer.from([0x1B, 0x45, 0x00])); // BOLD OFF

        // 8. Mode de Règlement
        commands.push(Buffer.from([0x1B, 0x61, 0x00])); // ALIGNEMENT GAUCHE
        commands.push(Buffer.from(`Paiement  : ${ticket.payment || 'CB'}\n`, 'utf-8'));
        commands.push(Buffer.from(`--------------------------------\n`, 'utf-8'));

        // 9. Pied de Page
        commands.push(Buffer.from([0x1B, 0x61, 0x01])); // ALIGNEMENT CENTRE
        commands.push(Buffer.from(`Merci pour votre confiance !\n\n\n\n`, 'utf-8'));

        // 10. Découpe du papier
        commands.push(Buffer.from([0x1D, 0x56, 0x41, 0x00]));

        // Envoi séquentiel des commandes de buffer
        commands.forEach(buf => client.write(buf));
        this.addLog("Données du ticket envoyées avec succès !");
      } catch (err) {
        this.addLog("Erreur écriture ticket: " + err.message);
      }

      setTimeout(() => client.destroy(), 1200);
    });

    client.on('error', (error) => {
      this.addLog("Erreur Imprimante: " + error.message);
    });

    client.on('close', () => {
      this.addLog("Connexion imprimante fermee.");
    });
  }
};

// Fonction globale d'arrière-plan appelée par l'index.js pour le Foreground Service
export async function runBackgroundPoll() {
  await globalRelay.pollTicket();
}

export default function App() {
  useKeepAwake(); // Keep screen on

  const [shopName, setShopName] = useState('');
  const [printerIp, setPrinterIp] = useState('192.168.1.100');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState(globalRelay.logs);
  const [isLoading, setIsLoading] = useState(false);

  // Synchronise les states locaux vers le global
  useEffect(() => {
    globalRelay.shopName = shopName;
  }, [shopName]);

  useEffect(() => {
    globalRelay.printerIp = printerIp;
  }, [printerIp]);

  // Enregistre le callback pour mettre à jour les logs de l'interface en direct
  useEffect(() => {
    globalRelay.setLogsCallback = (newLogs) => {
      setLogs(newLogs);
    };
    return () => {
      globalRelay.setLogsCallback = null;
    };
  }, []);

  useEffect(() => {
    loadSettings();
    if (Platform.OS === 'android') {
      setTimeout(() => {
        requestBatteryOptimization();
      }, 1500);
    }
  }, []);

  const requestBatteryOptimization = () => {
    Alert.alert(
      "Fonctionnement en arrière-plan",
      "Pour que l'impression fonctionne même quand le téléphone est en veille, veuillez autoriser l'application à fonctionner sans restrictions de batterie.",
      [
        { text: "Plus tard", style: "cancel" },
        { 
          text: "Autoriser", 
          onPress: () => {
            IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
          } 
        }
      ]
    );
  };

  const stopRelayInternal = () => {
    globalRelay.addLog("Demande d'arret du service...");
    try {
      if (ReactNativeForegroundService.stop_all) {
        ReactNativeForegroundService.stop_all();
      } else if (ReactNativeForegroundService.stopAll) {
        ReactNativeForegroundService.stopAll();
      } else if (ReactNativeForegroundService.stop) {
        ReactNativeForegroundService.stop();
      }

      if (ReactNativeForegroundService.remove_all_tasks) {
        ReactNativeForegroundService.remove_all_tasks();
      } else if (ReactNativeForegroundService.remove_task) {
        ReactNativeForegroundService.remove_task('relay_task');
      }

      globalRelay.addLog("Service et taches arretes.");
    } catch(e) {
      globalRelay.addLog("Erreur arret: " + (e ? e.message : "erreur inconnue"));
    }
  };

  // React-side polling loop to ensure continuous polling regardless of Headless task constraints
  useEffect(() => {
    let intervalId = null;
    if (isRunning) {
      intervalId = setInterval(() => {
        globalRelay.pollTicket();
      }, POLL_INTERVAL_MS);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRunning]);

  const loadSettings = async () => {
    try {
      const storedShop = await AsyncStorage.getItem('boutididact_shopName');
      const storedIp = await AsyncStorage.getItem('boutididact_printerIp');
      const storedRunning = await AsyncStorage.getItem('boutididact_isRunning');
      if (storedShop) {
        setShopName(storedShop);
        globalRelay.shopName = storedShop;
      }
      if (storedIp) {
        setPrinterIp(storedIp);
        globalRelay.printerIp = storedIp;
      }
      if (storedRunning === 'true') {
        setIsRunning(true);
        ReactNativeForegroundService.start({
          id: 1244,
          title: "Boutididact Relay",
          message: `En attente de tickets pour ${storedShop || 'votre boutique'}...`,
          icon: "ic_launcher",
          button: false,
        });
      }
    } catch (e) {
      globalRelay.addLog("Erreur chargement: " + (e ? e.message : ""));
    }
  };

  const saveSettings = async (running = false) => {
    try {
      await AsyncStorage.setItem('boutididact_shopName', globalRelay.shopName.trim());
      await AsyncStorage.setItem('boutididact_printerIp', globalRelay.printerIp.trim());
      await AsyncStorage.setItem('boutididact_isRunning', running ? 'true' : 'false');
    } catch (e) {
      globalRelay.addLog("Erreur sauvegarde: " + (e ? e.message : ""));
    }
  };

  const toggleRelay = async () => {
    if (!globalRelay.shopName.trim() || !globalRelay.printerIp.trim()) {
      Alert.alert("Erreur", "Veuillez renseigner le nom de la boutique et l'IP de l'imprimante.");
      return;
    }

    if (isRunning) {
      stopRelayInternal();
      setIsRunning(false);
      await saveSettings(false);
      globalRelay.addLog("Relais ARRETE");
    } else {
      setIsLoading(true);
      try {
        const check = await fetch(`${CLOUD_URL}/api/saas/check-shop?shopName=${encodeURIComponent(globalRelay.shopName.trim())}`);
        const checkData = await check.json();
        
        if (!check.ok || !checkData.ok) {
          Alert.alert("Erreur", checkData.message || "Boutique introuvable ou non activée.");
          setIsLoading(false);
          return;
        }

        const validName = checkData.name || globalRelay.shopName.trim();
        setShopName(validName);
        globalRelay.shopName = validName;

        setIsRunning(true);
        await saveSettings(true);
        globalRelay.addLog("Relais DEMARRE pour " + validName);
        
        ReactNativeForegroundService.start({
          id: 1244,
          title: "Boutididact Relay",
          message: `En attente de tickets pour ${validName}...`,
          icon: "ic_launcher",
          button: false,
        });

        // Enregistre aussi la tâche de service en arrière-plan
        try {
          ReactNativeForegroundService.add_task(() => globalRelay.pollTicket(), {
            delay: POLL_INTERVAL_MS,
            onLoop: true,
            taskId: 'relay_task',
            onError: (e) => console.log(`Error logging:`, e),
          });
        } catch (e) { /* ignore task fail if already added */ }
  
        globalRelay.pollTicket(); // Run once immediately
      } catch (e) {
        Alert.alert("Erreur Réseau", "Impossible de vérifier la boutique : " + e.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Text style={styles.title}>Boutididact Print</Text>
        <Text style={styles.subtitle}>Relais d'Impression Android</Text>
      </View>

      <View style={styles.card}>
        <View style={[styles.statusBadge, isRunning ? styles.statusOnline : styles.statusOffline]}>
          <Text style={[styles.statusText, isRunning ? styles.statusTextOnline : styles.statusTextOffline]}>
            {isRunning ? 'RELAIS ACTIF' : 'RELAIS INACTIF'}
          </Text>
        </View>

        <Text style={styles.label}>Nom de la boutique</Text>
        <TextInput
          style={styles.input}
          value={shopName}
          onChangeText={setShopName}
          placeholder="ex: Restaurant Le Gourmet"
          placeholderTextColor="#64748b"
          editable={!isRunning}
        />

        <Text style={styles.label}>IP Imprimante Locale</Text>
        <TextInput
          style={styles.input}
          value={printerIp}
          onChangeText={setPrinterIp}
          placeholder="192.168.1.100"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          editable={!isRunning}
        />

        <TouchableOpacity 
          style={[styles.button, isRunning ? styles.buttonStop : styles.buttonStart, isLoading && styles.buttonDisabled]} 
          onPress={toggleRelay}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : isRunning ? (
            <Text style={[styles.buttonText, { color: '#fff' }]}>Arrêter le relais</Text>
          ) : (
            <Text style={styles.buttonText}>Démarrer le relais</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.logTitle}>Journal d'activité</Text>
      <ScrollView style={styles.logContainer}>
        {logs.length === 0 ? (
          <Text style={styles.logTextEmpty}>Aucune activité...</Text>
        ) : (
          logs.map((log, index) => (
            <Text key={index} style={styles.logText}>{log}</Text>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20, paddingTop: 60 },
  header: { alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 28, fontWeight: '900', color: '#fbbf24', marginBottom: 5 },
  subtitle: { fontSize: 14, color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: '#1e293b', padding: 24, borderRadius: 24, borderWidth: 1, borderColor: '#334155', marginBottom: 24 },
  statusBadge: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, marginBottom: 24, borderWidth: 1 },
  statusOnline: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  statusOffline: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' },
  statusText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  statusTextOnline: { color: '#10b981' },
  statusTextOffline: { color: '#ef4444' },
  label: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8, marginLeft: 4, letterSpacing: 0.5 },
  input: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 16, padding: 16, color: '#fff', fontSize: 16, marginBottom: 20, fontWeight: '500' },
  button: { padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 10 },
   buttonStart: { backgroundColor: '#fbbf24' },
   buttonStop: { backgroundColor: '#ef4444' },
   buttonDisabled: { opacity: 0.5 },
   buttonText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  logTitle: { fontSize: 12, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', marginBottom: 12, marginLeft: 4 },
  logContainer: { flex: 1, backgroundColor: '#000', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1e293b' },
  logText: { color: '#10b981', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, marginBottom: 6 },
  logTextEmpty: { color: '#475569', fontStyle: 'italic', fontSize: 12, textAlign: 'center', marginTop: 20 },
});
