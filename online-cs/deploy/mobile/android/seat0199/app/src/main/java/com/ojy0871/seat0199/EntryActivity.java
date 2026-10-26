package com.ojy0871.seat0199;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.List;

/**
 * 入口：从专属链接自动识别座席进入会话，不展示座席选择列表。
 */
public class EntryActivity extends Activity {
    private List<Seat> seats;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#1e3a8a"));
        seats = SeatsStore.load(this);
        route(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        route(intent);
    }

    private void route(Intent intent) {
        String fromLink = agentFromUri(intent != null ? intent.getData() : null);
        if (fromLink != null && !fromLink.isEmpty()) {
            prefs().edit().putString("agent_code", fromLink).apply();
            openChat(fromLink);
            return;
        }
        String saved = prefs().getString("agent_code", "");
        if (!saved.isEmpty()) {
            openChat(saved);
            return;
        }
        // 下载落地页会把 seat0199://open/{代号} 写入剪贴板，装好后首次打开可识别
        String fromClip = agentFromClipboard();
        if (fromClip != null && !fromClip.isEmpty()) {
            prefs().edit().putString("agent_code", fromClip).apply();
            openChat(fromClip);
            return;
        }
        showGate();
    }

    private String agentFromClipboard() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return null;
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() < 1) return null;
            CharSequence raw = clip.getItemAt(0).coerceToText(this);
            if (raw == null) return null;
            String text = raw.toString().trim();
            if (text.isEmpty()) return null;
            Uri uri = null;
            try { uri = Uri.parse(text); } catch (Exception ignored) {}
            String fromUri = agentFromUri(uri);
            if (fromUri != null && !fromUri.isEmpty()) return fromUri;
            // bare code
            String n = SeatsStore.normalize(text);
            if (!n.isEmpty() && SeatsStore.find(seats, n) != null) return n;
        } catch (Exception ignored) {
        }
        return null;
    }

    private void showGate() {
        setContentView(R.layout.activity_entry);
        ProgressBar busy = findViewById(R.id.busy);
        if (busy != null) busy.setVisibility(View.GONE);
        TextView hint = findViewById(R.id.hint);
        if (hint != null) {
            hint.setText("请通过座席专属链接打开本 App\n会自动识别客服，无需选择代号");
        }
    }

    private void openChat(String code) {
        String n = SeatsStore.normalize(code);
        if (n.isEmpty()) {
            showGate();
            return;
        }
        Seat seat = SeatsStore.find(seats, n);
        String name = seat != null ? seat.name : n;
        Intent i = new Intent(this, ChatActivity.class);
        i.putExtra(ChatActivity.EXTRA_CODE, n);
        i.putExtra(ChatActivity.EXTRA_NAME, name);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("seat0199", MODE_PRIVATE);
    }

    static String agentFromUri(Uri uri) {
        if (uri == null) return null;
        String a = uri.getQueryParameter("a");
        if (a != null && !a.trim().isEmpty()) return SeatsStore.normalize(a);
        String host = uri.getHost() == null ? "" : uri.getHost();
        if ("seat0199".equalsIgnoreCase(uri.getScheme()) && "open".equalsIgnoreCase(host)) {
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (path.startsWith("/")) path = path.substring(1);
            if (!path.isEmpty()) return SeatsStore.normalize(path);
        }
        return null;
    }
}
