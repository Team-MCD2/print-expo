package com.boutididact.print.relay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Relance le relais natif apres redemarrage du telephone (si actif avant reboot).
 */
public class BootReceiver extends BroadcastReceiver {

  private static final String TAG = "BoutididactRelay";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

    SharedPreferences prefs = context.getSharedPreferences(RelayForegroundService.PREFS, Context.MODE_PRIVATE);
    if (!prefs.getBoolean(RelayForegroundService.KEY_RUNNING, false)) return;

    String shop = prefs.getString(RelayForegroundService.KEY_SHOP, "");
    String ip = prefs.getString(RelayForegroundService.KEY_IP, "");
    String key = prefs.getString(RelayForegroundService.KEY_RELAY, "");
    if (shop == null || shop.trim().isEmpty() || ip == null || ip.trim().isEmpty()) return;

    try {
      Intent service = new Intent(context, RelayForegroundService.class);
      service.putExtra(RelayForegroundService.KEY_SHOP, shop.trim());
      service.putExtra(RelayForegroundService.KEY_IP, ip.trim());
      service.putExtra(RelayForegroundService.KEY_RELAY, key != null ? key.trim() : "");
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service);
      } else {
        context.startService(service);
      }
      Log.i(TAG, "Relais restaure apres boot pour " + shop.trim());
    } catch (Exception e) {
      Log.e(TAG, "Boot restore failed: " + e.getMessage());
    }
  }
}
