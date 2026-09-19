// 忆梦云团队开发
package com.user.ymykf;

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
import io.socket.client.IO;
import io.socket.client.Socket;
import org.json.JSONObject;
import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;

public class MessageSocketService extends Service {
    public static final String ACTION_SYNC_TOKEN = "com.user.ymykf.SYNC_TOKEN";
    public static final String EXTRA_TOKEN = "tenant_token";
    private static final String SERVICE_CHANNEL = "socket_connection";
    private static final String MESSAGE_CHANNEL = "customer_messages";
    private static final int SERVICE_NOTIFICATION_ID = 1001;
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
        if (intent != null && ACTION_SYNC_TOKEN.equals(intent.getAction())) {
            String token = safeToken(intent.getStringExtra(EXTRA_TOKEN));
            getPreferences().edit().putString(AppConfig.TOKEN_KEY, token).apply();
        }
        connectWithStoredToken();
        return START_STICKY;
    }

    private void connectWithStoredToken() {
        String token = safeToken(getPreferences().getString(AppConfig.TOKEN_KEY, ""));
        if (token.isEmpty()) {
            disconnectSocket();
            stopSelf();
            return;
        }
        if (socket != null && token.equals(activeToken) && socket.connected()) return;
        disconnectSocket();
        activeToken = token;
        try {
            Map<String, String> auth = new HashMap<>();
            auth.put("type", "tenant_user");
            auth.put("token", token);
            IO.Options options = IO.Options.builder()
                    .setAuth(auth)
                    .setTransports(new String[]{"polling", "websocket"})
                    .setReconnection(true)
                    .build();
            socket = IO.socket(AppConfig.ORIGIN, options);
            socket.on("message.new", args -> {
                if (args.length > 0 && args[0] instanceof JSONObject) {
                    notifyCustomerMessage((JSONObject) args[0]);
                }
            });
            socket.connect();
        } catch (URISyntaxException ignored) {
            activeToken = "";
        }
    }

    private void notifyCustomerMessage(JSONObject message) {
        if (!"customer".equals(message.optString("senderType"))) return;
        if (AppVisibility.isForeground()) return;
        String conversationId = extractId(message.opt("conversationId"));
        if (conversationId.isEmpty()) return;
        String content = message.optString("content").trim();
        String type = message.optString("messageType", "text");
        if (content.isEmpty()) content = mediaSummary(type);

        Intent open = new Intent(this, MainActivity.class)
                .putExtra(AppConfig.EXTRA_CONVERSATION_ID, conversationId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, conversationId.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, MESSAGE_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("客户发来新消息")
                .setContentText(content)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setContentIntent(pendingIntent)
                .build();
        getSystemService(NotificationManager.class)
                .notify((conversationId + message.optString("_id")).hashCode(), notification);
    }

    private String extractId(Object value) {
        if (value instanceof JSONObject) return ((JSONObject) value).optString("_id");
        return value == null ? "" : String.valueOf(value);
    }

    private String mediaSummary(String type) {
        if ("image".equals(type)) return "[图片]";
        if ("video".equals(type)) return "[视频]";
        if ("file".equals(type)) return "[文件]";
        return "您有一条客户新消息";
    }

    private SharedPreferences getPreferences() {
        return getSharedPreferences(AppConfig.PREFS_NAME, MODE_PRIVATE);
    }

    private String safeToken(String token) {
        if (token == null) return "";
        String normalized = token.trim();
        return normalized.length() <= 4096 ? normalized : "";
    }

    private Notification createServiceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
                SERVICE_CHANNEL, getString(R.string.service_channel_name), NotificationManager.IMPORTANCE_LOW);
        service.setDescription(getString(R.string.service_channel_description));
        service.setSound(null, null);
        NotificationChannel messages = new NotificationChannel(
                MESSAGE_CHANNEL, getString(R.string.message_channel_name), NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription(getString(R.string.message_channel_description));
        messages.enableVibration(true);
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
