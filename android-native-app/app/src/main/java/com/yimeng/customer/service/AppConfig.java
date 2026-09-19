// 忆梦云团队开发
package com.user.ymykf;

final class AppConfig {
    static final String ORIGIN = "https://user.by0.me";
    static final String MESSAGES_URL = ORIGIN + "/m/messages";
    static final String ANNOUNCEMENTS_URL = ORIGIN + "/m/announcements";
    static final String ANNOUNCEMENTS_API_URL = ORIGIN + "/api/app/announcements";
    static final String VERSION_CHECK_URL = ORIGIN + "/api/app/android/check-update";
    static final String TOKEN_KEY = "tenant_token";
    static final String PREFS_NAME = "yimeng_native";
    static final String EXTRA_CONVERSATION_ID = "conversation_id";

    private AppConfig() {}

    static String conversationUrl(String conversationId) {
        if (conversationId == null || !conversationId.matches("[A-Za-z0-9_-]{1,128}")) {
            return MESSAGES_URL;
        }
        return MESSAGES_URL + "/" + conversationId;
    }
}
