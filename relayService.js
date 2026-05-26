import { Platform } from 'react-native';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';

export const RELAY_TASK_ID = 'relay_task';
export const RELAY_NOTIFICATION_ID = 1244;

export function getRelayForegroundOptions(shopName) {
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
 * Demarre ou relance le service foreground + la boucle de taches (polling).
 * A appeler au demarrage du relais et quand l'app passe en arriere-plan.
 */
export async function ensureRelayForegroundRunning(shopName) {
  if (Platform.OS !== 'android') return;

  const opts = getRelayForegroundOptions(shopName);
  const running = ReactNativeForegroundService.is_running?.();
  const taskRunning = ReactNativeForegroundService.is_task_running?.(RELAY_TASK_ID);

  try {
    if (!running) {
      await ReactNativeForegroundService.start(opts);
    } else if (!taskRunning) {
      // Le flag JS dit actif mais la tache a disparu — relance propre
      try {
        if (ReactNativeForegroundService.stopAll) {
          await ReactNativeForegroundService.stopAll();
        } else {
          await ReactNativeForegroundService.stop();
        }
      } catch { /* ignore */ }
      await ReactNativeForegroundService.start(opts);
    } else {
      await ReactNativeForegroundService.update({
        ...opts,
        message: `Relais actif — ${String(shopName || '').trim() || 'boutique'}. Impression en arriere-plan.`,
      });
    }
  } catch (e) {
    console.warn('[relayService] ensureRelayForegroundRunning:', e?.message || e);
    try {
      await ReactNativeForegroundService.start(opts);
    } catch (e2) {
      console.warn('[relayService] start fallback failed:', e2?.message || e2);
    }
  }
}

export function stopRelayForeground() {
  if (Platform.OS !== 'android') return;
  try {
    if (ReactNativeForegroundService.stopAll) {
      ReactNativeForegroundService.stopAll();
    } else if (ReactNativeForegroundService.stop) {
      ReactNativeForegroundService.stop();
    }
  } catch (e) {
    console.warn('[relayService] stop:', e?.message || e);
  }
}
