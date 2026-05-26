import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, PermissionsAndroid, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import * as IntentLauncher from 'expo-intent-launcher';

import { pollAndPrint, resetRelayState, setRelayLogHandler, testPrint, verifyRelay, CLOUD_URL } from './relayCore';
import { ensureRelayForegroundRunning, stopRelayForeground, hasNativeRelay } from './relayService';

const globalRelay = {
  logs: [],
  shopName: '',
  printerIp: '192.168.1.100',
  relayKey: '',
  setLogsCallback: null,

  addLog(msg) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    this.logs = [entry, ...this.logs].slice(0, 50);
    console.log('[Relais]', entry);
    if (this.setLogsCallback) {
      try {
        this.setLogsCallback([...this.logs]);
      } catch (e) {
        console.error('Callback log error:', e);
      }
    }
  },
};

export default function App() {
  useKeepAwake();

  const [shopName, setShopName] = useState('');
  const [printerIp, setPrinterIp] = useState('192.168.1.100');
  const [relayKey, setRelayKey] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState(globalRelay.logs);
  const [isLoading, setIsLoading] = useState(false);
  const isRunningRef = useRef(false);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    globalRelay.shopName = shopName;
  }, [shopName]);

  useEffect(() => {
    globalRelay.printerIp = printerIp;
  }, [printerIp]);

  useEffect(() => {
    globalRelay.relayKey = relayKey;
  }, [relayKey]);

  useEffect(() => {
    globalRelay.setLogsCallback = (newLogs) => {
      setLogs(newLogs);
    };
    setRelayLogHandler((msg) => globalRelay.addLog(msg));
    return () => {
      globalRelay.setLogsCallback = null;
      setRelayLogHandler(null);
    };
  }, []);

  const requestNotificationPermission = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Autoriser les notifications',
            message: "L'application a besoin d'afficher une notification persistante pour maintenir l'impression en arriere-plan active.",
            buttonNeutral: 'Plus tard',
            buttonNegative: 'Refuser',
            buttonPositive: 'Autoriser',
          },
        );
      } catch (err) {
        console.warn(err);
      }
    }
  };

  useEffect(() => {
    loadSettings();
    if (Platform.OS === 'android') {
      requestNotificationPermission();
      setTimeout(() => {
        requestBatteryOptimization();
      }, 1500);
    }
  }, []);

  // Quand l'app passe en arriere-plan, Android peut couper la boucle JS :
  // on verifie que le service foreground + la tache de polling sont toujours actifs.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (!isRunningRef.current || Platform.OS !== 'android') return;
      if (nextState === 'background' || nextState === 'inactive' || nextState === 'active') {
        const name = globalRelay.shopName?.trim();
        if (!name) return;
        await ensureRelayForegroundRunning(name, globalRelay.printerIp, globalRelay.relayKey);
        if (nextState === 'active' && !hasNativeRelay()) {
          await pollAndPrint(name, globalRelay.printerIp, (msg) => globalRelay.addLog(msg), globalRelay.relayKey);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const requestBatteryOptimization = () => {
    Alert.alert(
      'Fonctionnement en arriere-plan',
      "Pour que l'impression fonctionne meme quand le telephone est en veille, veuillez autoriser l'application a fonctionner sans restrictions de batterie.",
      [
        { text: 'Plus tard', style: 'cancel' },
        {
          text: 'Autoriser',
          onPress: () => {
            IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
          },
        },
      ],
    );
  };

  const stopRelayInternal = () => {
    globalRelay.addLog("Demande d'arret du service...");
    try {
      stopRelayForeground();
      resetRelayState();
      globalRelay.addLog('Relais arrete.');
    } catch (e) {
      globalRelay.addLog(`Erreur arret: ${e ? e.message : 'erreur inconnue'}`);
    }
  };

  const loadSettings = async () => {
    try {
      const storedShop = await AsyncStorage.getItem('boutididact_shopName');
      const storedIp = await AsyncStorage.getItem('boutididact_printerIp');
      const storedKey = await AsyncStorage.getItem('boutididact_relayKey');
      const storedRunning = await AsyncStorage.getItem('boutididact_isRunning');
      if (storedShop) {
        setShopName(storedShop);
        globalRelay.shopName = storedShop;
      }
      if (storedIp) {
        setPrinterIp(storedIp);
        globalRelay.printerIp = storedIp;
      }
      if (storedKey) {
        setRelayKey(storedKey);
        globalRelay.relayKey = storedKey;
      }
      if (storedRunning === 'true') {
        setIsRunning(true);
        isRunningRef.current = true;
        await ensureRelayForegroundRunning(
          storedShop || globalRelay.shopName,
          storedIp || globalRelay.printerIp,
          storedKey || globalRelay.relayKey,
        );
        globalRelay.addLog(
          hasNativeRelay()
            ? 'Relais natif restaure (impression arriere-plan).'
            : 'Relais restaure au demarrage.',
        );
      }
    } catch (e) {
      globalRelay.addLog(`Erreur chargement: ${e ? e.message : ''}`);
    }
  };

  const saveSettings = async (running = false) => {
    try {
      await AsyncStorage.setItem('boutididact_shopName', globalRelay.shopName.trim());
      await AsyncStorage.setItem('boutididact_printerIp', globalRelay.printerIp.trim());
      await AsyncStorage.setItem('boutididact_relayKey', (globalRelay.relayKey || '').trim());
      await AsyncStorage.setItem('boutididact_isRunning', running ? 'true' : 'false');
    } catch (e) {
      globalRelay.addLog(`Erreur sauvegarde: ${e ? e.message : ''}`);
    }
  };

  const toggleRelay = async () => {
    if (!globalRelay.shopName.trim() || !globalRelay.printerIp.trim()) {
      Alert.alert('Erreur', "Veuillez renseigner le nom de la boutique et l'IP de l'imprimante.");
      return;
    }

    if (isRunning) {
      stopRelayInternal();
      setIsRunning(false);
      await saveSettings(false);
      globalRelay.addLog('Relais ARRETE');
    } else {
      setIsLoading(true);
      try {
        const verified = await verifyRelay(globalRelay.shopName.trim(), globalRelay.relayKey.trim());
        if (!verified.ok) {
          Alert.alert('Erreur', verified.message || 'Boutique introuvable.');
          setIsLoading(false);
          return;
        }

        const validName = verified.name || globalRelay.shopName.trim();
        setShopName(validName);
        globalRelay.shopName = validName;
        resetRelayState();

        setIsRunning(true);
        isRunningRef.current = true;
        await saveSettings(true);
        globalRelay.addLog(`Relais DEMARRE pour ${validName} (Android → imprimante WiFi)`);

        await ensureRelayForegroundRunning(validName, globalRelay.printerIp, globalRelay.relayKey);

        if (hasNativeRelay()) {
          globalRelay.addLog('Service natif demarre — vous pouvez quitter l\'app.');
        } else {
          await pollAndPrint(validName, globalRelay.printerIp, (msg) => globalRelay.addLog(msg), globalRelay.relayKey);
        }
      } catch (e) {
        Alert.alert('Erreur Reseau', `Impossible de verifier la boutique : ${e.message}`);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Text style={styles.title}>Boutididact Print</Text>
        <Text style={styles.subtitle}>Relais Cloud → Imprimante WiFi (sans PC)</Text>
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

        <Text style={styles.label}>Cle relais (optionnel)</Text>
        <TextInput
          style={styles.input}
          value={relayKey}
          onChangeText={(v) => {
            setRelayKey(v);
            globalRelay.relayKey = v;
          }}
          placeholder="Recommande : Admin web > Relais"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
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
            <Text style={[styles.buttonText, { color: '#fff' }]}>Arreter le relais</Text>
          ) : (
            <Text style={styles.buttonText}>Demarrer le relais</Text>
          )}
        </TouchableOpacity>

        {!isRunning && (
          <TouchableOpacity
            style={[styles.button, styles.buttonTest]}
            onPress={() => testPrint(globalRelay.printerIp, (msg) => globalRelay.addLog(msg))}
          >
            <Text style={styles.buttonText}>Tester l&apos;imprimante</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.logTitle}>Journal d'activite</Text>
      <ScrollView style={styles.logContainer}>
        {logs.length === 0 ? (
          <Text style={styles.logTextEmpty}>Aucune activite...</Text>
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
  buttonTest: { backgroundColor: '#334155', marginTop: 0 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  logTitle: { fontSize: 12, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', marginBottom: 12, marginLeft: 4 },
  logContainer: { flex: 1, backgroundColor: '#000', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1e293b' },
  logText: { color: '#10b981', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, marginBottom: 6 },
  logTextEmpty: { color: '#475569', fontStyle: 'italic', fontSize: 12, textAlign: 'center', marginTop: 20 },
});
