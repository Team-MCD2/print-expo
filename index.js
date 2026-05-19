import { registerRootComponent } from 'expo';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';

// Polyfill Buffer
global.Buffer = Buffer;

import App, { runBackgroundPoll } from './App';

// Register the foreground service only on Android
try {
  if (Platform.OS === 'android') {
    ReactNativeForegroundService.register();
    
    // Enregistrement de la tâche d'arrière-plan à la racine
    ReactNativeForegroundService.register_task('relay_task', async () => {
      try {
        await runBackgroundPoll();
      } catch (err) {
        console.error("Background task error:", err);
      }
    });
  }
} catch (e) {
  console.error("Foreground Service registration failed", e);
}

registerRootComponent(App);
