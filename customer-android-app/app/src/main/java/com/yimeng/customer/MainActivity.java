// 忆梦云团队开发
package com.chat.ymykf;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ProgressBar loading;
    private AttachmentStore attachmentStore;
    private ValueCallback<Uri[]> fileChooserCallback;
    private AlertDialog activeStartupDialog;
    private AlertDialog activeUpdateDialog;
    private boolean initialResumeCompleted;
    private boolean startupChecksCompleted;
    private boolean updateCheckInProgress;

    private final ActivityResultLauncher<String> notificationPermission =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {});
    private final ActivityResultLauncher<Intent> fileChooser =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileChooserCallback == null) return;
                fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(
                        result.getResultCode(), result.getData()));
                fileChooserCallback = null;
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.web_view);
        loading = findViewById(R.id.loading);
        attachmentStore = new AttachmentStore(this, webView);
        configureWebView();
        handleIntent(getIntent());
        requestNotificationPermission();
        startMessageService(null, null);
        runStartupChecks();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack(); else finish();
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        AppVisibility.setForeground(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (initialResumeCompleted && startupChecksCompleted) checkForUpdates(true);
        initialResumeCompleted = true;
    }

    @Override
    protected void onStop() {
        AppVisibility.setForeground(false);
        super.onStop();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(
                android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        String defaultUserAgent = webView.getSettings().getUserAgentString();
        String appUserAgent = "YiMengCustomerAndroid/" + getVersionName();
        if (!defaultUserAgent.contains(appUserAgent)) {
            webView.getSettings().setUserAgentString(defaultUserAgent + " " + appUserAgent);
        }
        webView.addJavascriptInterface(new NativeBridge(), "YiMengCustomerAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loading.setVisibility(View.VISIBLE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                loading.setVisibility(View.GONE);
                installNativeStateObserver();
            }

            @Override public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("chat.by0.me".equalsIgnoreCase(uri.getHost())
                        && "https".equalsIgnoreCase(uri.getScheme())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    fileChooser.launch(params.createIntent());
                    return true;
                } catch (RuntimeException error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }

            @Override public boolean onJsAlert(
                    WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }
        });
    }

    private void handleIntent(Intent intent) {
        String channelToken = intent == null
                ? null : intent.getStringExtra(AppConfig.EXTRA_CHANNEL_TOKEN);
        String targetUrl = AppConfig.channelUrl(channelToken);
        String currentUrl = webView == null ? null : webView.getUrl();
        if (webView != null && (currentUrl == null || channelToken != null)) {
            webView.loadUrl(targetUrl);
        }
    }

    private void installNativeStateObserver() {
        String script = "(function(){"
                + "var sync=function(){"
                + "var t=localStorage.getItem('client_token')||sessionStorage.getItem('client_token')||'';"
                + "var c=localStorage.getItem('client_channel_token')||sessionStorage.getItem('client_channel_token')||'';"
                + "YiMengCustomerAndroid.syncClientToken(t);"
                + "YiMengCustomerAndroid.syncChannelToken(c);};"
                + "window.__yimengCustomerNativeSync=sync;"
                + "if(!window.__yimengCustomerStorageWrapped){"
                + "['setItem','removeItem','clear'].forEach(function(n){var o=Storage.prototype[n];"
                + "Storage.prototype[n]=function(){var r=o.apply(this,arguments);"
                + "var k=arguments[0];if(!arguments.length||k==='client_token'||k==='client_channel_token')sync();return r;};});"
                + "window.__yimengCustomerStorageWrapped=true;"
                + "window.addEventListener('storage',sync);}"
                + "sync();})();";
        webView.evaluateJavascript(script, null);
    }

    private void startMessageService(String token, String channelToken) {
        Intent service = new Intent(this, MessageSocketService.class);
        if (token != null || channelToken != null) {
            service.setAction(MessageSocketService.ACTION_SYNC_STATE);
            if (token != null) service.putExtra(MessageSocketService.EXTRA_TOKEN, token);
            if (channelToken != null) {
                service.putExtra(MessageSocketService.EXTRA_CHANNEL_TOKEN, channelToken);
            }
        }
        ContextCompat.startForegroundService(this, service);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    private long getVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException ignored) {
            return 1;
        }
    }

    private String getVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "unknown" : info.versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            return "unknown";
        }
    }

    private JSONObject getJson(String endpoint) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status);
            }
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONObject root = new JSONObject(body.toString());
            if (root.optInt("code", -1) != 0) {
                throw new IllegalStateException(root.optString("message"));
            }
            return root;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private JSONObject loadLatestAnnouncement() throws Exception {
        JSONObject data = getJson(
                AppConfig.ANNOUNCEMENTS_API_URL + "?page=1&limit=1").optJSONObject("data");
        JSONArray items = data == null ? null : data.optJSONArray("items");
        return items == null ? null : items.optJSONObject(0);
    }

    private void runStartupChecks() {
        new Thread(() -> {
            JSONObject announcement = null;
            try {
                announcement = loadLatestAnnouncement();
            } catch (Exception ignored) {}
            JSONObject latestAnnouncement = announcement;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (latestAnnouncement == null) {
                    startupChecksCompleted = true;
                    checkForUpdates(true);
                    return;
                }
                String title = latestAnnouncement.optString("title").trim();
                String content = latestAnnouncement.optString("content").trim();
                activeStartupDialog = new AlertDialog.Builder(this)
                        .setTitle(title.isEmpty()
                                ? getString(R.string.customer_announcement) : title)
                        .setMessage(content)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                            activeStartupDialog = null;
                            startupChecksCompleted = true;
                            checkForUpdates(true);
                        })
                        .create();
                activeStartupDialog.setCancelable(false);
                activeStartupDialog.setCanceledOnTouchOutside(false);
                activeStartupDialog.show();
            });
        }).start();
    }

    private void checkForUpdates(boolean silent) {
        if (updateCheckInProgress || activeStartupDialog != null) return;
        updateCheckInProgress = true;
        new Thread(() -> {
            try {
                JSONObject root = getJson(
                        AppConfig.VERSION_CHECK_URL + "?versionCode=" + getVersionCode());
                JSONObject data = root.optJSONObject("data");
                if (data == null) throw new IllegalStateException("Missing update data");
                boolean hasUpdate = data.optBoolean("hasUpdate", false);
                JSONObject details = data.optJSONObject("version");
                String latestVersion = details == null
                        ? "" : details.optString("versionName", "");
                String changelog = details == null
                        ? "" : details.optString("releaseNotes", "");
                String downloadUrl = details == null
                        ? "" : details.optString("downloadUrl", "");
                boolean forceUpdate = details != null
                        && details.optBoolean("forceUpdate", false);
                runOnUiThread(() -> {
                    updateCheckInProgress = false;
                    if (isFinishing() || isDestroyed()) return;
                    if (hasUpdate && isHttpsUrl(downloadUrl)) {
                        showUpdateDialog(latestVersion, changelog, downloadUrl, forceUpdate);
                    } else if (!silent) {
                        Toast.makeText(this,
                                hasUpdate ? R.string.invalid_update_url : R.string.latest_version,
                                Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception ignored) {
                runOnUiThread(() -> {
                    updateCheckInProgress = false;
                    if (!silent) {
                        Toast.makeText(this, R.string.update_check_failed,
                                Toast.LENGTH_SHORT).show();
                    }
                });
            }
        }).start();
    }

    private boolean isHttpsUrl(String value) {
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
    }

    private void showUpdateDialog(
            String version, String changelog, String downloadUrl, boolean forceUpdate) {
        if (activeUpdateDialog != null && activeUpdateDialog.isShowing()) {
            activeUpdateDialog.dismiss();
        }
        String title = version.isEmpty() ? "发现新版本" : "发现新版本 " + version;
        String message = changelog.isEmpty() ? "新版本已发布，是否前往下载？" : changelog;
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(R.string.download_update,
                        (dialog, which) -> startActivity(
                                new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))));
        if (!forceUpdate) builder.setNegativeButton(R.string.update_later, null);
        activeUpdateDialog = builder.create();
        activeUpdateDialog.setCancelable(!forceUpdate);
        activeUpdateDialog.setCanceledOnTouchOutside(false);
        activeUpdateDialog.setOnDismissListener(dialog -> activeUpdateDialog = null);
        activeUpdateDialog.show();
        if (forceUpdate) {
            activeUpdateDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view ->
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))));
        }
    }

    private final class NativeBridge {
        @JavascriptInterface public void syncClientToken(String token) {
            String safeToken = token == null ? "" : token.trim();
            getSharedPreferences(AppConfig.PREFS_NAME, MODE_PRIVATE).edit()
                    .putString(AppConfig.TOKEN_KEY, safeToken).commit();
            attachmentStore.syncIdentity(safeToken);
            runOnUiThread(() -> startMessageService(safeToken, null));
        }

        @JavascriptInterface public String getSavedAttachmentState(String attachmentId) {
            return attachmentStore.state(attachmentId);
        }

        @JavascriptInterface public String saveAttachment(String attachmentId, String fileName, String mimeType) {
            return attachmentStore.save(attachmentId, fileName, mimeType);
        }

        @JavascriptInterface public String openSavedAttachment(String attachmentId) {
            return attachmentStore.open(attachmentId);
        }

        @JavascriptInterface public void syncChannelToken(String token) {
            runOnUiThread(() -> startMessageService(null, token == null ? "" : token));
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("YiMengCustomerAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
