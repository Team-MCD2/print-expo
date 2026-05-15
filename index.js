import { registerRootComponent } from 'expo';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';

// Polyfill Buffer
global.Buffer = Buffer;

import App from './App';

// Register the foreground service only on Android
try {
  if (Platform.OS === 'android') {
    ReactNativeForegroundService.register();
  }
} catch (e) {
  console.error("Foreground Service registration failed", e);
}

registerRootComponent(App);
