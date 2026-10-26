package com.ojy0871.seat0199;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * 原生访客会话：REST 建会话 / 发消息 + WebSocket 收消息，无 WebView。
 */
public class ChatActivity extends Activity {
    public static final String EXTRA_CODE = "agent_code";
    public static final String EXTRA_NAME = "seat_name";

    private final ApiClient api = new ApiClient();
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, ChatMessage> messages = new LinkedHashMap<>();
    private final AtomicBoolean pulling = new AtomicBoolean(false);

    private String agentCode = "";
    private String seatName = "";
    private String sessionId = "";
    private String visitorToken = "";
    private String lastMsgId = "";
    private boolean closed = false;
    private boolean composerEnabled = true;

    private TextView titleView;
    private TextView statusView;
    private TextView errorBanner;
    private ListView msgList;
    private EditText input;
    private Button btnSend;
    private MsgAdapter adapter;
    private WebSocket webSocket;
    private Runnable pollRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#1e3a8a"));
        setContentView(R.layout.activity_chat);

        agentCode = SeatsStore.normalize(getIntent() != null ? getIntent().getStringExtra(EXTRA_CODE) : "");
        seatName = getIntent() != null ? getIntent().getStringExtra(EXTRA_NAME) : agentCode;
        if (seatName == null || seatName.trim().isEmpty()) seatName = agentCode;
        if (agentCode.isEmpty()) {
            Toast.makeText(this, "缺少座席代号", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        prefs().edit().putString("agent_code", agentCode).apply();

        titleView = findViewById(R.id.title);
        statusView = findViewById(R.id.status);
        errorBanner = findViewById(R.id.errorBanner);
        msgList = findViewById(R.id.msgList);
        input = findViewById(R.id.input);
        btnSend = findViewById(R.id.btnSend);

        titleView.setText(seatName);
        statusView.setText("代号 " + agentCode + " · 连接中…");

        adapter = new MsgAdapter();
        msgList.setAdapter(adapter);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
        findViewById(R.id.btnMenu).setOnClickListener(v -> showMenu());
        btnSend.setOnClickListener(v -> sendCurrent());

        connectSession(false);
    }

    @Override
    protected void onDestroy() {
        stopRealtime();
        io.shutdownNow();
        super.onDestroy();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("seat0199", MODE_PRIVATE);
    }

    private String deviceFp() {
        SharedPreferences p = prefs();
        String fp = p.getString("device_fp", "");
        if (fp.isEmpty()) {
            fp = UUID.randomUUID().toString().replace("-", "").substring(0, 32);
            p.edit().putString("device_fp", fp).apply();
        }
        return fp;
    }

    private void showMenu() {
        new AlertDialog.Builder(this)
                .setTitle(seatName)
                .setItems(new String[]{"刷新消息", "开始新会话", "返回座席列表"}, (d, which) -> {
                    if (which == 0) pull(false);
                    else if (which == 1) connectSession(true);
                    else finish();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void setStatus(String s) {
        main.post(() -> statusView.setText(s));
    }

    private void showError(String msg) {
        main.post(() -> {
            if (msg == null || msg.isEmpty()) {
                errorBanner.setVisibility(View.GONE);
            } else {
                errorBanner.setText(msg);
                errorBanner.setVisibility(View.VISIBLE);
            }
        });
    }

    private void setComposerEnabled(boolean on) {
        composerEnabled = on;
        main.post(() -> {
            input.setEnabled(on);
            btnSend.setEnabled(on);
            input.setHint(on ? "输入消息" : "会话已结束");
        });
    }

    private void connectSession(boolean forceNew) {
        stopRealtime();
        closed = false;
        setComposerEnabled(true);
        showError("");
        setStatus("代号 " + agentCode + " · 创建会话…");
        if (forceNew) {
            messages.clear();
            lastMsgId = "";
            adapter.notifyDataSetChanged();
        }
        io.execute(() -> {
            try {
                JSONObject j = api.startSession(agentCode, deviceFp(), forceNew);
                sessionId = j.optString("session_id", "");
                visitorToken = j.optString("visitor_token", "");
                if (sessionId.isEmpty() || visitorToken.isEmpty()) {
                    throw new IllegalStateException(j.optString("detail", "无法创建会话"));
                }
                String assigned = j.optString("assigned_agent", seatName);
                boolean offline = j.optBoolean("offline", false);
                main.post(() -> {
                    if (assigned != null && !assigned.isEmpty()) {
                        seatName = assigned;
                        titleView.setText(seatName);
                    }
                    setStatus(offline
                            ? ("代号 " + agentCode + " · 非工作时间可留言")
                            : ("代号 " + agentCode + " · 已连接"));
                });
                List<ChatMessage> items = api.listMessages(sessionId, visitorToken, null);
                main.post(() -> {
                    mergeMessages(items, true);
                    startRealtime();
                });
            } catch (Exception e) {
                showError(e.getMessage() == null ? "连接失败" : e.getMessage());
                setStatus("代号 " + agentCode + " · 连接失败");
            }
        });
    }

    private void startRealtime() {
        connectWs();
        schedulePoll();
    }

    private void stopRealtime() {
        if (pollRunnable != null) main.removeCallbacks(pollRunnable);
        pollRunnable = null;
        if (webSocket != null) {
            try { webSocket.close(1000, "bye"); } catch (Exception ignored) {}
            webSocket = null;
        }
    }

    private void schedulePoll() {
        if (pollRunnable != null) main.removeCallbacks(pollRunnable);
        pollRunnable = () -> {
            if (isFinishing() || closed) return;
            pull(true);
            main.postDelayed(pollRunnable, 3000);
        };
        main.postDelayed(pollRunnable, 3000);
    }

    private void connectWs() {
        if (sessionId.isEmpty() || visitorToken.isEmpty()) return;
        if (webSocket != null) {
            try { webSocket.cancel(); } catch (Exception ignored) {}
        }
        String url = "wss://cs.ojy0871.com/v1/ws/visitor?session_id="
                + enc(sessionId) + "&visitor_token=" + enc(visitorToken);
        Request req = new Request.Builder().url(url).build();
        webSocket = api.http().newWebSocket(req, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                setStatus("代号 " + agentCode + " · 实时已连接");
                pull(true);
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                try {
                    JSONObject msg = new JSONObject(text);
                    String ev = msg.optString("event", "");
                    if ("ping".equals(ev)) {
                        webSocket.send("pong");
                        return;
                    }
                    if ("pong".equals(ev) || "hello".equals(ev)) return;
                    if ("session_closed".equals(ev)) {
                        main.post(() -> onSessionClosed());
                        return;
                    }
                    if ("message".equals(ev)) {
                        JSONObject data = msg.optJSONObject("data");
                        JSONObject m = data == null ? null : data.optJSONObject("message");
                        ChatMessage cm = ChatMessage.fromJson(m);
                        if (cm != null) {
                            List<ChatMessage> one = new ArrayList<>();
                            one.add(cm);
                            main.post(() -> mergeMessages(one, false));
                        }
                        return;
                    }
                    if ("accepted".equals(ev) || "session_accepted".equals(ev)) {
                        pull(false);
                        return;
                    }
                } catch (Exception ignored) {
                }
                pull(true);
            }

            @Override
            public void onClosing(WebSocket webSocket, int code, String reason) {
                webSocket.close(code, reason);
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                setStatus("代号 " + agentCode + " · 轮询中");
            }
        });
    }

    private void pull(boolean delta) {
        if (sessionId.isEmpty() || visitorToken.isEmpty()) return;
        if (!pulling.compareAndSet(false, true)) return;
        final String after = delta ? lastMsgId : null;
        io.execute(() -> {
            try {
                List<ChatMessage> items = api.listMessages(sessionId, visitorToken, after);
                main.post(() -> mergeMessages(items, after == null || after.isEmpty()));
                String upTo = lastMsgId;
                if (!upTo.isEmpty()) api.markRead(sessionId, visitorToken, upTo);
            } catch (Exception e) {
                if (!delta) showError(e.getMessage());
            } finally {
                pulling.set(false);
            }
        });
    }

    private void mergeMessages(List<ChatMessage> items, boolean replace) {
        if (replace && items != null) {
            // keep existing if empty pull during reconnect? prefer server full list
            messages.clear();
        }
        boolean added = false;
        if (items != null) {
            for (ChatMessage m : items) {
                if (m == null || m.id.isEmpty()) continue;
                if (!messages.containsKey(m.id)) added = true;
                messages.put(m.id, m);
                lastMsgId = m.id;
            }
        }
        if (added || replace) {
            adapter.notifyDataSetChanged();
            msgList.post(() -> {
                int n = adapter.getCount();
                if (n > 0) msgList.setSelection(n - 1);
            });
        }
    }

    private void onSessionClosed() {
        closed = true;
        setComposerEnabled(false);
        setStatus("代号 " + agentCode + " · 会话已结束");
        stopRealtime();
    }

    private void sendCurrent() {
        if (!composerEnabled || sessionId.isEmpty()) return;
        String text = input.getText() == null ? "" : input.getText().toString().trim();
        if (text.isEmpty()) return;
        input.setText("");
        showError("");
        final String clientId = "c_" + Long.toString(System.currentTimeMillis(), 36)
                + "_" + UUID.randomUUID().toString().substring(0, 8);
        btnSend.setEnabled(false);
        io.execute(() -> {
            try {
                JSONObject j = api.sendText(sessionId, visitorToken, text, clientId);
                JSONObject message = j.optJSONObject("message");
                ChatMessage cm = ChatMessage.fromJson(message);
                List<ChatMessage> batch = new ArrayList<>();
                if (cm != null) batch.add(cm);
                org.json.JSONArray arr = j.optJSONArray("items");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        ChatMessage m = ChatMessage.fromJson(arr.optJSONObject(i));
                        if (m != null) batch.add(m);
                    }
                }
                main.post(() -> {
                    mergeMessages(batch, false);
                    btnSend.setEnabled(composerEnabled);
                });
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "发送失败" : e.getMessage();
                main.post(() -> {
                    btnSend.setEnabled(composerEnabled);
                    showError(msg);
                    if (msg.contains("会话已结束")) onSessionClosed();
                });
            }
        });
    }

    private static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private final class MsgAdapter extends BaseAdapter {
        private List<ChatMessage> snapshot() {
            return new ArrayList<>(messages.values());
        }

        @Override public int getCount() { return messages.size(); }
        @Override public ChatMessage getItem(int position) { return snapshot().get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            ChatMessage m = getItem(position);
            FrameLayout root = new FrameLayout(ChatActivity.this);
            root.setLayoutParams(new ListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            LinearLayout bubble = new LinearLayout(ChatActivity.this);
            bubble.setOrientation(LinearLayout.VERTICAL);
            int padH = dp(12);
            int padV = dp(8);
            bubble.setPadding(padH, padV, padH, padV);

            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(14));

            boolean visitor = "visitor".equals(m.role);
            boolean system = "system".equals(m.role);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (visitor) {
                lp.gravity = Gravity.END;
                bg.setColor(Color.parseColor("#1d4ed8"));
                bubble.setBackground(bg);
            } else if (system) {
                lp.gravity = Gravity.CENTER_HORIZONTAL;
                bg.setColor(Color.parseColor("#e2e8f0"));
                bubble.setBackground(bg);
            } else {
                lp.gravity = Gravity.START;
                bg.setColor(Color.WHITE);
                bubble.setBackground(bg);
            }
            lp.width = ViewGroup.LayoutParams.WRAP_CONTENT;
            bubble.setLayoutParams(lp);

            if (!visitor && !system && m.agent != null && !m.agent.isEmpty()) {
                TextView agent = new TextView(ChatActivity.this);
                agent.setText(m.agent);
                agent.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                agent.setTextColor(Color.parseColor("#64748b"));
                bubble.addView(agent);
            }

            TextView body = new TextView(ChatActivity.this);
            body.setText(m.displayText());
            body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            body.setTextColor(visitor ? Color.WHITE : Color.parseColor("#0f172a"));
            body.setMaxWidth(dp(280));
            bubble.addView(body);

            if (m.time != null && !m.time.isEmpty()) {
                TextView time = new TextView(ChatActivity.this);
                time.setText(m.time);
                time.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
                time.setTextColor(visitor ? Color.parseColor("#bfdbfe") : Color.parseColor("#94a3b8"));
                time.setPadding(0, dp(4), 0, 0);
                bubble.addView(time);
            }

            root.addView(bubble);
            return root;
        }

        private int dp(int v) {
            return Math.round(v * getResources().getDisplayMetrics().density);
        }
    }
}
