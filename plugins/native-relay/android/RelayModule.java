package com.boutididact.print.relay;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class RelayModule extends ReactContextBaseJavaModule {

  public RelayModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "BoutididactRelay";
  }

  @ReactMethod
  public void startRelay(String shopName, String printerIp, String relayKey, Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      String shop = shopName != null ? shopName.trim() : "";
      String ip = printerIp != null ? printerIp.trim() : "";
      String key = relayKey != null ? relayKey.trim() : "";
      if (shop.isEmpty() || ip.isEmpty()) {
        promise.reject("INVALID", "shopName et printerIp requis");
        return;
      }

      SharedPreferences prefs = ctx.getSharedPreferences(RelayForegroundService.PREFS, Context.MODE_PRIVATE);
      prefs.edit()
          .putString(RelayForegroundService.KEY_SHOP, shop)
          .putString(RelayForegroundService.KEY_IP, ip)
          .putString(RelayForegroundService.KEY_RELAY, key)
          .putBoolean(RelayForegroundService.KEY_RUNNING, true)
          .apply();

      Intent intent = new Intent(ctx, RelayForegroundService.class);
      intent.putExtra(RelayForegroundService.KEY_SHOP, shop);
      intent.putExtra(RelayForegroundService.KEY_IP, ip);
      intent.putExtra(RelayForegroundService.KEY_RELAY, key);

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent);
      } else {
        ctx.startService(intent);
      }

      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("START_FAILED", e.getMessage(), e);
    }
  }

  @ReactMethod
  public void stopRelay(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      ctx.getSharedPreferences(RelayForegroundService.PREFS, Context.MODE_PRIVATE)
          .edit()
          .putBoolean(RelayForegroundService.KEY_RUNNING, false)
          .apply();
      ctx.stopService(new Intent(ctx, RelayForegroundService.class));
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("STOP_FAILED", e.getMessage(), e);
    }
  }

  @ReactMethod
  public void isRelayRunning(Promise promise) {
    promise.resolve(RelayForegroundService.isRunning);
  }
}
