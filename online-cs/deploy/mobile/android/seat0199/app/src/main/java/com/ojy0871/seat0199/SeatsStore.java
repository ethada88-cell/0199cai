package com.ojy0871.seat0199;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class SeatsStore {
    private SeatsStore() {}

    static List<Seat> load(Context ctx) {
        List<Seat> out = new ArrayList<>();
        try (InputStream in = ctx.getAssets().open("seats.json");
             BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            JSONArray arr = new JSONArray(sb.toString());
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String code = normalize(o.optString("code", ""));
                String name = o.optString("name", code).trim();
                if (!code.isEmpty()) out.add(new Seat(name.isEmpty() ? code : name, code));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    static Seat find(List<Seat> seats, String code) {
        String n = normalize(code);
        if (n.isEmpty()) return null;
        for (Seat s : seats) if (s.code.equals(n)) return s;
        return null;
    }

    static String normalize(String raw) {
        if (raw == null) return "";
        return raw.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9]", "");
    }
}
