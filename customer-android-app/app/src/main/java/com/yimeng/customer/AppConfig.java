// 忆梦云团队开发
package com.chat.ymykf;

import android.net.Uri;

final class AppConfig {
    static final String ORIGIN = "https://chat.by0.me";
    static final String ACCOUNT_URL = ORIGIN + "/account";
    static final String ANNOUNCEMENTS_API_URL =
            ORIGIN + "/api/app/customer-center/announcements";
    static final String VERSION_CHECK_URL =
            ORIGIN + "/api/app/customer-center/android/check-update";

    static final String PREFS_NAME = "yimeng_customer_native";
    static final String TOKEN_KEY = "client_token";
    static final String CHANNEL_TOKEN_KEY = "client_channel_token";
    static final String EXTRA_CHANNEL_TOKEN = "channel_token";

    private AppConfig() {}

    static String channelUrl(String publicToken) {
        String token = publicToken == null ? "" : publicToken.trim();
        if (!token.matches("^[A-Za-z0-9_-]{1,160}$")) return ACCOUNT_URL;
        return ORIGIN + "/c/" + Uri.encode(token);
    }
}
