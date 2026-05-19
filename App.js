import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import { useKeepAwake } from 'expo-keep-awake';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import * as IntentLauncher from 'expo-intent-launcher';

const CLOUD_URL = 'https://boutididact-backendd.vercel.app';
const POLL_INTERVAL_MS = 5000;

export default function App() {
  useKeepAwake(); // Keep screen on

  const [shopName, setShopName] = useState('');
  const [printerIp, setPrinterIp] = useState('192.168.1.100');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  


  useEffect(() => {
    loadSettings();
    if (Platform.OS === 'android') {
      // Un petit délai pour éviter de bloquer l'affichage au démarrage
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
    addLog("Demande d'arret du service...");
    try {
      // Tentative d'arrêt avec les différentes méthodes possibles selon la version
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

      addLog("Service et taches arretes.");
    } catch(e) {
      addLog("Erreur arret: " + (e ? e.message : "erreur inconnue"));
    }
  };

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  };

  const loadSettings = async () => {
    try {
      const storedShop = await AsyncStorage.getItem('boutididact_shopName');
      const storedIp = await AsyncStorage.getItem('boutididact_printerIp');
      if (storedShop) setShopName(storedShop);
      if (storedIp) setPrinterIp(storedIp);
    } catch (e) {
      addLog("Erreur chargement: " + (e ? e.message : ""));
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('boutididact_shopName', shopName.trim());
      await AsyncStorage.setItem('boutididact_printerIp', printerIp.trim());
    } catch (e) {
      addLog("Erreur sauvegarde: " + (e ? e.message : ""));
    }
  };

  const toggleRelay = async () => {
    if (!shopName.trim() || !printerIp.trim()) {
      Alert.alert("Erreur", "Veuillez renseigner le nom de la boutique et l'IP de l'imprimante.");
      return;
    }

    if (isRunning) {
      stopRelayInternal();
      setIsRunning(false);
      addLog("Relais ARRETE");
    } else {
      setIsLoading(true);
      try {
        const check = await fetch(`${CLOUD_URL}/api/saas/check-shop?shopName=${encodeURIComponent(shopName.trim())}`);
        const checkData = await check.json();
        
        if (!check.ok || !checkData.ok) {
          Alert.alert("Erreur", checkData.message || "Boutique introuvable ou non activée.");
          setIsLoading(false);
          return;
        }

        const validName = checkData.name || shopName.trim();
        setShopName(validName); // Sync with exact name from DB

        await saveSettings();
        setIsRunning(true);
        addLog("Relais DEMARRE pour " + validName);
        
        // Start Foreground Service
        ReactNativeForegroundService.start({
          id: 1244,
          title: "Boutididact Relay",
          message: `En attente de tickets pour ${validName}...`,
          icon: "ic_launcher",
          button: false,
        });

        // Register the polling task
        ReactNativeForegroundService.add_task(() => pollTicket(), {
          delay: POLL_INTERVAL_MS,
          onLoop: true,
          taskId: 'relay_task',
          onError: (e) => console.log(`Error logging:`, e),
        });
  
        pollTicket(); // Run once immediately
      } catch (e) {
        Alert.alert("Erreur Réseau", "Impossible de vérifier la boutique.");
      } finally {
        setIsLoading(false);
      }
    }
  };

  const pollTicket = async () => {
    try {
      const url = `${CLOUD_URL}/api/saas/poll-ticket?shopName=${encodeURIComponent(shopName.trim())}`;
      const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }});
      if (!response.ok) return;

      const data = await response.json();
      if (data && data.ticket) {
        addLog("TICKET RECU : ID " + (data.ticket.ticketId || 'Inconnu'));
        printTicket(data.ticket);
      }
    } catch (error) {
      addLog("Erreur Polling: " + error.message);
    }
  };

  const printTicket = (ticket) => {
    const ip = printerIp.trim();
    const port = 9100;
    
    addLog("Connexion a l'imprimante " + ip + ":" + port + "...");
    
    const client = TcpSocket.createConnection({ host: ip, port: port, timeout: 5000 }, () => {
      addLog("Imprimante connectee. Envoi des données...");
      
      // ESC/POS Commands
      // INIT
      client.write(Buffer.from([0x1B, 0x40]));
      // CENTER
      client.write(Buffer.from([0x1B, 0x61, 0x01]));
      // BOLD ON
      client.write(Buffer.from([0x1B, 0x45, 0x01]));
      
      client.write(Buffer.from(`BOUTIDIDACT TICKET\nID: ${ticket.ticketId || 'Inconnu'}\n\n`, 'utf-8'));
      
      // BOLD OFF
      client.write(Buffer.from([0x1B, 0x45, 0x00]));
      
      // Cut Paper
      client.write(Buffer.from([0x1D, 0x56, 0x41, 0x00]));
      
      // Close connection
      setTimeout(() => client.destroy(), 1000);
    });

    client.on('error', (error) => {
      addLog("Erreur Imprimante: " + error.message);
    });

    client.on('close', () => {
      addLog("Connexion imprimante fermee.");
    });
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
