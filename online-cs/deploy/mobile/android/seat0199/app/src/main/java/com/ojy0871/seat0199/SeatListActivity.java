package com.ojy0871.seat0199;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * 原生座席列表：内置 100 个 0199cai 座席代号，点选后进入原生会话页。
 */
public class SeatListActivity extends Activity {
    private final List<Seat> all = new ArrayList<>();
    private final List<Seat> shown = new ArrayList<>();
    private SeatAdapter adapter;
    private EditText search;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#1e3a8a"));
        setContentView(R.layout.activity_seat_list);

        all.clear();
        all.addAll(SeatsStore.load(this));
        shown.clear();
        shown.addAll(all);

        TextView subtitle = findViewById(R.id.subtitle);
        subtitle.setText("内置 " + all.size() + " 个座席 · 原生会话（非网页套壳）");

        search = findViewById(R.id.search);
        ListView list = findViewById(R.id.seatList);
        adapter = new SeatAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> openSeat(shown.get(position)));

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { filter(s.toString()); }
            @Override public void afterTextChanged(Editable s) {}
        });

        findViewById(R.id.manualHint).setOnClickListener(v -> askManual());

        // Deep link / last seat → go straight to chat
        String fromIntent = agentFromUri(getIntent() != null ? getIntent().getData() : null);
        if (fromIntent != null && !fromIntent.isEmpty()) {
            openCode(fromIntent);
            return;
        }
        String last = prefs().getString("agent_code", "");
        if (!last.isEmpty() && getIntent() != null
                && Intent.ACTION_MAIN.equals(getIntent().getAction())
                && prefs().getBoolean("auto_resume", true)) {
            // stay on list; user picks. No auto-jump so 100 seats stay visible.
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String code = agentFromUri(intent != null ? intent.getData() : null);
        if (code != null && !code.isEmpty()) openCode(code);
    }

    private void filter(String q) {
        String n = SeatsStore.normalize(q);
        shown.clear();
        if (n.isEmpty()) {
            shown.addAll(all);
        } else {
            for (Seat s : all) {
                if (s.code.contains(n) || SeatsStore.normalize(s.name).contains(n)) shown.add(s);
            }
        }
        adapter.notifyDataSetChanged();
    }

    private void openSeat(Seat seat) {
        prefs().edit().putString("agent_code", seat.code).apply();
        Intent i = new Intent(this, ChatActivity.class);
        i.putExtra(ChatActivity.EXTRA_CODE, seat.code);
        i.putExtra(ChatActivity.EXTRA_NAME, seat.name);
        startActivity(i);
    }

    private void openCode(String code) {
        String n = SeatsStore.normalize(code);
        Seat seat = SeatsStore.find(all, n);
        if (seat != null) openSeat(seat);
        else {
            prefs().edit().putString("agent_code", n).apply();
            Intent i = new Intent(this, ChatActivity.class);
            i.putExtra(ChatActivity.EXTRA_CODE, n);
            i.putExtra(ChatActivity.EXTRA_NAME, n);
            startActivity(i);
        }
    }

    private void askManual() {
        final EditText input = new EditText(this);
        input.setHint("例如 eddqc");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(32)});
        new AlertDialog.Builder(this)
                .setTitle("手动输入座席代号")
                .setMessage("代号在专属链接 ?a= 后面。")
                .setView(input)
                .setPositiveButton("进入", (d, w) -> {
                    String code = SeatsStore.normalize(input.getText() != null ? input.getText().toString() : "");
                    if (code.isEmpty()) {
                        Toast.makeText(this, "请输入代号", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    openCode(code);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("seat0199", MODE_PRIVATE);
    }

    private static String agentFromUri(Uri uri) {
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

    private final class SeatAdapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public Seat getItem(int position) { return shown.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView;
            if (v == null) v = getLayoutInflater().inflate(R.layout.item_seat, parent, false);
            Seat s = getItem(position);
            ((TextView) v.findViewById(R.id.seatName)).setText(s.name);
            ((TextView) v.findViewById(R.id.seatCode)).setText("代号 " + s.code + "  ·  /c/0199cai/?a=" + s.code);
            return v;
        }
    }
}
