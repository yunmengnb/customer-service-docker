// 忆梦云团队开发
package com.chat.ymykf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import io.socket.client.IO;
import io.socket.client.Socket;

public class MessageSocketService extends Service {
    public static final String ACTION_SYNC_STATE =
            "com.chat.ymykf.SYNC_NOTIFICATION_STATE";
    public static final String EXTRA_TOKEN = "client_token";
    public static final String EXTRA_CHANNEL_TOKEN = "client_channel_token";

    private static final String SERVICE_CHANNEL = "customer_socket_connection";
    private static final String MESSAGE_CHANNEL = "customer_service_messages_v5";
    private static final int SERVICE_NOTIFICATION_ID = 2001;
    private static final int MAX_RECENT_MESSAGE_IDS = 200;

    private final LinkedHashMap<String, Boolean> recentMessageIds =
            new LinkedHashMap<String, Boolean>(MAX_RECENT_MESSAGE_IDS + 1, .75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > MAX_RECENT_MESSAGE_IDS;
                }
            };

    private Socket socket;
    private String activeToken = "";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        startForeground(SERVICE_NOTIFICATION_ID, createServiceNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_SYNC_STATE.equals(intent.getAction())) {
            syncState(intent);
        }
        connectWithStoredToken();
        return START_STICKY;
    }

    private void syncState(Intent intent) {
        SharedPreferences.Editor editor = getPreferences().edit();
        if (intent.hasExtra(EXTRA_TOKEN)) {
            editor.putString(AppConfig.TOKEN_KEY,
                    safeValue(intent.getStringExtra(EXTRA_TOKEN), 4096));
        }
        if (intent.hasExtra(EXTRA_CHANNEL_TOKEN)) {
            editor.putString(AppConfig.CHANNEL_TOKEN_KEY,
                    safeValue(intent.getStringExtra(EXTRA_CHANNEL_TOKEN), 160));
        }
        editor.apply();
    }

    private void connectWithStoredToken() {
        String token = safeValue(
                getPreferences().getString(AppConfig.TOKEN_KEY, ""), 4096);
        if (token.isEmpty()) {
            disconnectSocket();
            stopSelf();
            return;
        }
        if (socket != null && token.equals(activeToken)) {
            if (!socket.connected()) socket.connect();
            return;
        }

        disconnectSocket();
        activeToken = token;
        try {
            Map<String, String> auth = new HashMap<>();
            auth.put("type", "customer");
            auth.put("token", token);
            IO.Options options = IO.Options.builder()
                    .setAuth(auth)
                    .setTransports(new String[]{"polling", "websocket"})
                    .setReconnection(true)
                    .build();
            socket = IO.socket(AppConfig.ORIGIN, options);
            socket.on("message.new", args -> {
                if (args.length > 0 && args[0] instanceof JSONObject) {
                    handleMessage((JSONObject) args[0]);
                }
            });
            socket.connect();
        } catch (URISyntaxException ignored) {
            activeToken = "";
        }
    }

    private void handleMessage(JSONObject message) {
        String senderType = message.optString("senderType");
        if (!"agent".equals(senderType) && !"bot".equals(senderType)) return;

        String messageId = firstNonEmpty(
                extractId(message.opt("_id")),
                message.optString("clientMessageId").trim());
        if (!messageId.isEmpty() && isDuplicate(messageId)) return;

        if (AppVisibility.isForeground()) return;
        showMessageNotification(message, messageId);
    }

    private synchronized boolean isDuplicate(String messageId) {
        if (recentMessageIds.containsKey(messageId)) return true;
        recentMessageIds.put(messageId, Boolean.TRUE);
        return false;
    }

    private void showMessageNotification(JSONObject message, String messageId) {
        String content = message.optString("content").trim();
        if (content.isEmpty()) {
            content = mediaSummary(message.optString("messageType", "text"));
        }

        String publicToken = firstNonEmpty(
                message.optString("publicToken").trim(),
                message.optString("channelToken").trim(),
                getPreferences().getString(AppConfig.CHANNEL_TOKEN_KEY, ""));
        Intent open = new Intent(this, MainActivity.class)
                .putExtra(AppConfig.EXTRA_CHANNEL_TOKEN, publicToken)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int requestCode = firstNonEmpty(publicToken, messageId, content).hashCode();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                requestCode,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, MESSAGE_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.new_message_title))
                .setContentText(content)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setVibrate(new long[]{0, 180, 100, 180})
                .setContentIntent(pendingIntent)
                .build();
        int notificationId = firstNonEmpty(messageId, publicToken + content).hashCode();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(notificationId, notification);
    }

    private String extractId(Object value) {
        if (value instanceof JSONObject) return ((JSONObject) value).optString("_id").trim();
        return value == null ? "" : String.valueOf(value).trim();
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value.trim();
        }
        return "";
    }

    private String mediaSummary(String type) {
        if ("image".equals(type)) return "[图片]";
        if ("video".equals(type)) return "[视频]";
        if ("file".equals(type)) return "[文件]";
        return getString(R.string.new_message_fallback);
    }

    private String safeValue(String value, int maxLength) {
        if (value == null) return "";
        String normalized = value.trim();
        return normalized.length() <= maxLength ? normalized : "";
    }

    private SharedPreferences getPreferences() {
        return getSharedPreferences(AppConfig.PREFS_NAME, MODE_PRIVATE);
    }

    private Notification createServiceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, SERVICE_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.service_notification_title))
                .setContentText(getString(R.string.service_notification_text))
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .build();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel service = new NotificationChannel(
                SERVICE_CHANNEL,
                getString(R.string.service_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        service.setDescription(getString(R.string.service_channel_description));
        service.setSound(null, null);
        NotificationChannel messages = new NotificationChannel(
                MESSAGE_CHANNEL,
                getString(R.string.message_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription(getString(R.string.message_channel_description));
        messages.enableVibration(true);
        messages.setVibrationPattern(new long[]{0, 180, 100, 180});
        manager.createNotificationChannel(service);
        manager.createNotificationChannel(messages);
    }

    private void disconnectSocket() {
        if (socket != null) {
            socket.off();
            socket.disconnect();
            socket.close();
            socket = null;
        }
        activeToken = "";
    }

    @Override
    public void onDestroy() {
        disconnectSocket();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
