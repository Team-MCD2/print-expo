package com.boutididact.print.relay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Service Android natif : poll cloud + impression TCP.
 * Fonctionne en arriere-plan (pas de bridge React Native).
 */
public class RelayForegroundService extends Service {

  private static final String TAG = "BoutididactRelay";
  private static final String CHANNEL_ID = "boutididact_relay_channel";
  private static final int NOTIFICATION_ID = 1244;
  private static final String CLOUD_URL = "https://boutididact-backendd.vercel.app";
  private static final long POLL_MS = 5000;
  private static final long PRINT_RETRY_MS = 15000;

  public static final String PREFS = "boutididact_relay_prefs";
  public static final String KEY_SHOP = "shopName";
  public static final String KEY_IP = "printerIp";
  public static final String KEY_RELAY = "relayKey";
  public static final String KEY_RUNNING = "isRunning";

  public static volatile boolean isRunning = false;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private OkHttpClient http;
  private Runnable pollRunnable;
  private PowerManager.WakeLock wakeLock;

  private String shopName = "";
  private String printerIp = "";
  private String relayKey = "";
  private boolean processing = false;
  private String lastHandledId = null;
  private String lastFailId = null;
  private long lastFailAt = 0;

  @Override
  public void onCreate() {
    super.onCreate();
    http = new OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build();
    createNotificationChannel();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    if (intent != null) {
      if (intent.hasExtra(KEY_SHOP)) {
        shopName = intent.getStringExtra(KEY_SHOP);
      }
      if (intent.hasExtra(KEY_IP)) {
        printerIp = intent.getStringExtra(KEY_IP);
      }
      if (intent.hasExtra(KEY_RELAY)) {
        relayKey = intent.getStringExtra(KEY_RELAY);
      }
    }
    if (shopName == null || shopName.isEmpty()) {
      shopName = prefs.getString(KEY_SHOP, "");
    }
    if (printerIp == null || printerIp.isEmpty()) {
      printerIp = prefs.getString(KEY_IP, "");
    }
    if (relayKey == null || relayKey.isEmpty()) {
      relayKey = prefs.getString(KEY_RELAY, "");
    }

    prefs.edit()
        .putString(KEY_SHOP, shopName)
        .putString(KEY_IP, printerIp)
        .putString(KEY_RELAY, relayKey != null ? relayKey : "")
        .putBoolean(KEY_RUNNING, true)
        .apply();

    acquireWakeLock();
    startForeground(NOTIFICATION_ID, buildNotification(shopName));
    isRunning = true;
    startPolling();
    return START_STICKY;
  }

  private void acquireWakeLock() {
    try {
      if (wakeLock != null && wakeLock.isHeld()) return;
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      if (pm == null) return;
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BoutididactRelay::Poll");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire();
    } catch (Exception e) {
      Log.w(TAG, "WakeLock: " + e.getMessage());
    }
  }

  private void releaseWakeLock() {
    try {
      if (wakeLock != null && wakeLock.isHeld()) {
        wakeLock.release();
      }
    } catch (Exception e) {
      Log.w(TAG, "WakeLock release: " + e.getMessage());
    }
    wakeLock = null;
  }

  private void startPolling() {
    if (pollRunnable != null) {
      mainHandler.removeCallbacks(pollRunnable);
    }
    pollRunnable = new Runnable() {
      @Override
      public void run() {
        executor.execute(() -> {
          try {
            pollOnce();
          } catch (Exception e) {
            Log.e(TAG, "pollOnce: " + e.getMessage());
          }
        });
        mainHandler.postDelayed(this, POLL_MS);
      }
    };
    mainHandler.post(pollRunnable);
  }

  private void pollOnce() {
    if (processing) return;
    String shop = shopName != null ? shopName.trim() : "";
    String ip = printerIp != null ? printerIp.trim() : "";
    if (shop.isEmpty() || ip.isEmpty()) return;

    try {
      String encoded = URLEncoder.encode(shop, StandardCharsets.UTF_8.name());
      String url = CLOUD_URL + "/api/saas/poll-ticket?shopName=" + encoded + "&peek=1";
      Request.Builder reqBuilder = new Request.Builder()
          .url(url)
          .header("Accept", "application/json");
      if (relayKey != null && !relayKey.trim().isEmpty()) {
        reqBuilder.header("X-Relay-Key", relayKey.trim());
      }
      Request request = reqBuilder.get().build();

      try (Response response = http.newCall(request).execute()) {
        if (!response.isSuccessful() || response.body() == null) return;
        String body = response.body().string();
        JSONObject json = new JSONObject(body);
        if (!json.has("ticket") || json.isNull("ticket")) return;

        JSONObject ticket = json.getJSONObject("ticket");
        String tid = ticket.optString("ticketId", "Inconnu");

        if (tid.equals(lastHandledId)) return;
        if (tid.equals(lastFailId) && (System.currentTimeMillis() - lastFailAt) < PRINT_RETRY_MS) {
          return;
        }

        processing = true;
        Log.i(TAG, "Ticket recu: " + tid);

        JSONObject printer = ticket.optJSONObject("printer");
        String targetIp = ip;
        int targetPort = 9100;
        if (printer != null) {
          String ticketIp = printer.optString("ip", "").trim();
          if (!ticketIp.isEmpty()) targetIp = ticketIp;
          targetPort = printer.optInt("port", 9100);
        }

        boolean printed = printTicket(ticket, targetIp, targetPort);
        if (printed) {
          ackTicket(shop);
          lastHandledId = tid;
          lastFailId = null;
          lastFailAt = 0;
          Log.i(TAG, "Ticket " + tid + " imprime.");
        } else {
          lastFailId = tid;
          lastFailAt = System.currentTimeMillis();
          Log.w(TAG, "Echec impression " + tid);
        }
      }
    } catch (Exception e) {
      Log.e(TAG, "Erreur polling: " + e.getMessage());
    } finally {
      processing = false;
    }
  }

  private boolean printTicket(JSONObject ticket, String ip, int port) {
    Socket socket = null;
    try {
      byte[] payload;
      String b64 = ticket.optString("escposB64", "").trim();
      if (!b64.isEmpty()) {
        payload = Base64.decode(b64, Base64.DEFAULT);
      } else {
        payload = EscPosBuilder.build(ticket);
      }
      socket = new Socket();
      socket.connect(new InetSocketAddress(ip, port), 10000);
      socket.setSoTimeout(5000);
      OutputStream out = socket.getOutputStream();
      out.write(payload);
      out.flush();
      try {
        Thread.sleep(500);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
      }
      return true;
    } catch (Exception e) {
      Log.e(TAG, "Print error: " + e.getMessage());
      return false;
    } finally {
      if (socket != null) {
        try {
          socket.close();
        } catch (Exception ignored) {
        }
      }
    }
  }

  private void ackTicket(String shop) {
    try {
      JSONObject body = new JSONObject();
      body.put("shopName", shop);
      Request.Builder ackBuilder = new Request.Builder()
          .url(CLOUD_URL + "/api/saas/ack-ticket")
          .post(RequestBody.create(body.toString(), MediaType.parse("application/json")));
      if (relayKey != null && !relayKey.trim().isEmpty()) {
        ackBuilder.header("X-Relay-Key", relayKey.trim());
      }
      Request request = ackBuilder.build();
      try (Response response = http.newCall(request).execute()) {
        if (response.isSuccessful()) return;
      }
    } catch (Exception e) {
      Log.w(TAG, "ack POST failed: " + e.getMessage());
    }
    try {
      String encoded = URLEncoder.encode(shop, StandardCharsets.UTF_8.name());
      Request.Builder fbBuilder = new Request.Builder()
          .url(CLOUD_URL + "/api/saas/poll-ticket?shopName=" + encoded);
      if (relayKey != null && !relayKey.trim().isEmpty()) {
        fbBuilder.header("X-Relay-Key", relayKey.trim());
      }
      Request fallback = fbBuilder.get().build();
      http.newCall(fallback).execute().close();
    } catch (Exception e) {
      Log.w(TAG, "ack fallback failed: " + e.getMessage());
    }
  }

  private Notification buildNotification(String shop) {
    String label = shop != null && !shop.isEmpty() ? shop : "votre boutique";
    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Boutididact Relay")
        .setContentText("En attente de tickets pour " + label + "...")
        .setSmallIcon(getApplicationInfo().icon)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build();
  }

  private void createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
          CHANNEL_ID,
          "Relais Boutididact",
          NotificationManager.IMPORTANCE_LOW
      );
      channel.setDescription("Maintient l'impression en arriere-plan active.");
      NotificationManager manager = getSystemService(NotificationManager.class);
      if (manager != null) {
        manager.createNotificationChannel(channel);
      }
    }
  }

  @Override
  public void onDestroy() {
    isRunning = false;
    if (pollRunnable != null) {
      mainHandler.removeCallbacks(pollRunnable);
    }
    executor.shutdownNow();
    releaseWakeLock();
    getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_RUNNING, false)
        .apply();
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
