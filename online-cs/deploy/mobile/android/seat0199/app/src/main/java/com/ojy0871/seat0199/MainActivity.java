package com.ojy0871.seat0199;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * 0199cai 全座席通用访客壳：任意座席专属链接 /c/0199cai/?a={代号} 都可进 App 会话。
 * 首次无代号时手动输入；之后记住。用专属链接打开会覆盖并保存该代号。
 */
public class MainActivity extends Activity {
    private static final String CHAT_BASE = "https://cs.ojy0871.com/c/0199cai/";
    private static final String PREFS = "seat0199";
    private static final String KEY_AGENT = "agent_code";
    private static final int FILE_CHOOSER = 4101;

    private WebView webView;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private String agentCode = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#111111"));

        FrameLayout root = new FrameLayout(this);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        progress.setLayoutParams(pp);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);
        root.addView(progress);
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Seat0199/1.1");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String code = agentCodeFromUri(uri);
                if (code != null && !code.isEmpty()) {
                    saveAgent(code);
                    view.loadUrl(chatUrl(code));
                    return true;
                }
                return openExternalIfNeeded(uri);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? ProgressBar.GONE : ProgressBar.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                            FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        agentCode = prefs().getString(KEY_AGENT, "");
        String fromIntent = agentCodeFromUri(getIntent() != null ? getIntent().getData() : null);
        if (fromIntent != null && !fromIntent.isEmpty()) {
            saveAgent(fromIntent);
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else if (!agentCode.isEmpty()) {
            webView.loadUrl(chatUrl(agentCode));
        } else {
            askAgentCode(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String code = agentCodeFromUri(intent != null ? intent.getData() : null);
        if (code != null && !code.isEmpty()) {
            saveAgent(code);
            if (webView != null) webView.loadUrl(chatUrl(code));
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void saveAgent(String code) {
        agentCode = normalizeAgent(code);
        prefs().edit().putString(KEY_AGENT, agentCode).apply();
    }

    private static String normalizeAgent(String raw) {
        if (raw == null) return "";
        return raw.trim().toLowerCase().replaceAll("[^a-z0-9]", "");
    }

    private static String chatUrl(String code) {
        return CHAT_BASE + "?a=" + Uri.encode(code);
    }

    /** 从 https://cs.ojy0871.com/c/0199cai/?a=xxx 或 seat0199://0199cai?a=xxx 取座席代号 */
    private static String agentCodeFromUri(Uri uri) {
        if (uri == null) return null;
        String a = uri.getQueryParameter("a");
        if (a != null && !a.trim().isEmpty()) return normalizeAgent(a);
        // seat0199://open/eddqc
        String host = uri.getHost() == null ? "" : uri.getHost();
        if ("seat0199".equalsIgnoreCase(uri.getScheme()) && "open".equalsIgnoreCase(host)) {
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (path.startsWith("/")) path = path.substring(1);
            if (!path.isEmpty()) return normalizeAgent(path);
        }
        return null;
    }

    private void askAgentCode(boolean required) {
        final EditText input = new EditText(this);
        input.setHint("例如 eddqc");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(32)});
        if (!agentCode.isEmpty()) input.setText(agentCode);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("输入座席专属代号")
                .setMessage("打开后台「我的访客链接」里 ?a= 后面的代号。每个座席用自己的代号，App 会记住。")
                .setView(input)
                .setCancelable(!required)
                .setPositiveButton("进入会话", (d, w) -> {
                    String code = normalizeAgent(input.getText() != null ? input.getText().toString() : "");
                    if (code.isEmpty()) {
                        Toast.makeText(this, "请输入座席代号", Toast.LENGTH_SHORT).show();
                        askAgentCode(required);
                        return;
                    }
                    saveAgent(code);
                    webView.loadUrl(chatUrl(code));
                });
        if (!required) {
            b.setNeutralButton("切换座席", (d, w) -> askAgentCode(true));
            b.setNegativeButton("取消", null);
        }
        b.show();
    }

    private boolean openExternalIfNeeded(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if ("tel".equals(scheme) || "mailto".equals(scheme) || "sms".equals(scheme)) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
            return true;
        }
        if ("https".equals(scheme) || "http".equals(scheme)) {
            if (isAppHost(host) || host.contains("0199") || host.contains("vdokmj")
                    || host.contains("fgsas") || host.contains("aliyuncs")) {
                return false;
            }
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
            return true;
        }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
        return true;
    }

    private boolean isAppHost(String host) {
        return "cs.ojy0871.com".equals(host)
                || "m.ojy0871.com".equals(host)
                || host.endsWith(".ojy0871.com")
                || "0199w.com".equals(host)
                || host.endsWith(".0199w.com");
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // 长按返回可切换座席：连按两次间隔外用菜单更清晰——这里二次返回退出前提供切换
        if (webView != null && webView.canGoBack()) { webView.goBack(); return; }
        new AlertDialog.Builder(this)
                .setTitle("0199客服")
                .setItems(new String[]{"切换座席代号", "退出"}, (d, which) -> {
                    if (which == 0) askAgentCode(true);
                    else finish();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
