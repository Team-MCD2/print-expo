import { NativeModules, Platform } from 'react-native';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';

const NativeRelay = NativeModules.BoutididactRelay;

export const RELAY_TASK_ID = 'relay_task';
export const RELAY_NOTIFICATION_ID = 1244;

/** true si le module natif est present (APK compile avec prebuild/EAS) */
export function hasNativeRelay() {
  return Platform.OS === 'android' && NativeRelay != null && typeof NativeRelay.startRelay === 'function';
}

function getLegacyForegroundOptions(shopName) {
  const name = String(shopName || 'votre boutique').trim() || 'votre boutique';
  return {
    id: RELAY_NOTIFICATION_ID,
    title: 'Boutididact Relay',
    message: `En attente de tickets pour ${name}...`,
    icon: 'ic_launcher',
    button: false,
    importance: 'max',
    visibility: 'public',
    ServiceType: 'dataSync',
    ongoing: true,
  };
}

/**
 * Demarre le relais en arriere-plan.
 * Priorite : service Android natif (polling Java). Secours : supersami (dev uniquement).
 */
export async function ensureRelayForegroundRunning(shopName, printerIp) {
  if (Platform.OS !== 'android') return;

  const shop = String(shopName || '').trim();
  const ip = String(printerIp || '').trim();
  if (!shop || !ip) return;

  if (hasNativeRelay()) {
    try {
      await NativeRelay.startRelay(shop, ip);
      return;
    } catch (e) {
      console.warn('[relayService] native startRelay:', e?.message || e);
    }
  }

  // Secours Expo Go / ancienne APK sans module natif
  const opts = getLegacyForegroundOptions(shop);
  try {
    const running = ReactNativeForegroundService.is_running?.();
    if (!running) {
      await ReactNativeForegroundService.start(opts);
    } else {
      await ReactNativeForegroundService.update({
        ...opts,
        message: `Relais actif — ${shop} (mode legacy)`,
      });
    }
  } catch (e) {
    console.warn('[relayService] legacy foreground:', e?.message || e);
  }
}

export async function stopRelayForeground() {
  if (Platform.OS !== 'android') return;

  if (hasNativeRelay()) {
    try {
      await NativeRelay.stopRelay();
    } catch (e) {
      console.warn('[relayService] native stopRelay:', e?.message || e);
    }
  }

  try {
    if (ReactNativeForegroundService.stopAll) {
      ReactNativeForegroundService.stopAll();
    } else if (ReactNativeForegroundService.stop) {
      ReactNativeForegroundService.stop();
    }
  } catch (e) {
    console.warn('[relayService] legacy stop:', e?.message || e);
  }
}
