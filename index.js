import { registerRootComponent } from 'expo';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';

global.Buffer = Buffer;

import App from './App';
import { pollAndPrint, POLL_INTERVAL_MS, generateEscPosBytes } from './relayCore';
import { RELAY_TASK_ID } from './relayService';

export { generateEscPosBytes };

try {
  if (Platform.OS === 'android') {
    // register() sans argument plante sur certaines versions — config vide obligatoire
    ReactNativeForegroundService.register({ config: {} });

    ReactNativeForegroundService.add_task(async () => {
      try {
        const shopName = await AsyncStorage.getItem('boutididact_shopName');
        const printerIp = await AsyncStorage.getItem('boutididact_printerIp');
        const isRunning = await AsyncStorage.getItem('boutididact_isRunning');

        if (isRunning !== 'true' || !shopName || !printerIp) return;

        await pollAndPrint(shopName, printerIp, (msg) => {
          console.log('[Relais]', msg);
        });
      } catch (e) {
        console.log('[Relais] Erreur tache:', e.message);
      }
    }, {
      delay: POLL_INTERVAL_MS,
      onLoop: true,
      taskId: RELAY_TASK_ID,
      onError: (e) => console.log('[Relais] Erreur service:', e),
    });
  }
} catch (e) {
  console.error('Foreground Service registration failed', e);
}

registerRootComponent(App);
