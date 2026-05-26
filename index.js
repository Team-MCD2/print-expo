import { registerRootComponent } from 'expo';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';

global.Buffer = Buffer;

import App from './App';
import { pollAndPrint, POLL_INTERVAL_MS, generateEscPosBytes } from './relayCore';
import { RELAY_TASK_ID, hasNativeRelay } from './relayService';

export { generateEscPosBytes };

// Polling JS uniquement si le module natif n'est pas disponible (Expo Go / vieille APK)
if (Platform.OS === 'android' && !hasNativeRelay()) {
  try {
    ReactNativeForegroundService.register({ config: {} });

    ReactNativeForegroundService.add_task(async () => {
      try {
        const shopName = await AsyncStorage.getItem('boutididact_shopName');
        const printerIp = await AsyncStorage.getItem('boutididact_printerIp');
        const relayKey = await AsyncStorage.getItem('boutididact_relayKey');
        const isRunning = await AsyncStorage.getItem('boutididact_isRunning');

        if (isRunning !== 'true' || !shopName || !printerIp) return;

        await pollAndPrint(shopName, printerIp, (msg) => {
          console.log('[Relais]', msg);
        }, relayKey || '');
      } catch (e) {
        console.log('[Relais] Erreur tache:', e.message);
      }
    }, {
      delay: POLL_INTERVAL_MS,
      onLoop: true,
      taskId: RELAY_TASK_ID,
      onError: (e) => console.log('[Relais] Erreur service:', e),
    });
  } catch (e) {
    console.error('Foreground Service registration failed', e);
  }
} else if (Platform.OS === 'android') {
  console.log('[Relais] Module natif actif — polling en Java (arriere-plan)');
}

registerRootComponent(App);
