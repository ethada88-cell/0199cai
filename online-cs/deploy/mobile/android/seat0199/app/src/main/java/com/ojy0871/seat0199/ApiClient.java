package com.ojy0871.seat0199;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class ApiClient {
    static final String HOST = "https://cs.ojy0871.com";
    static final String SLUG = "0199cai";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build();

    OkHttpClient http() {
        return http;
    }

    JSONObject startSession(String agentCode, String deviceFp, boolean forceNew) throws Exception {
        JSONObject body = new JSONObject();
        body.put("slug", SLUG);
        body.put("name", "App访客");
        body.put("agent_code", agentCode);
        body.put("device_fp", deviceFp == null ? "" : deviceFp);
        body.put("force_new", forceNew);
        body.put("from_host", "seat0199-android");
        return postJson("/v1/visitor/sessions", body, null);
    }

    List<ChatMessage> listMessages(String sid, String token, String afterId) throws Exception {
        String path = "/v1/visitor/sessions/" + enc(sid) + "/messages";
        if (afterId != null && !afterId.isEmpty()) path += "?after=" + enc(afterId);
        JSONObject j = getJson(path, token);
        JSONArray items = j.optJSONArray("items");
        List<ChatMessage> out = new ArrayList<>();
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                ChatMessage m = ChatMessage.fromJson(items.optJSONObject(i));
                if (m != null && !m.id.isEmpty()) out.add(m);
            }
        }
        return out;
    }

    JSONObject sendText(String sid, String token, String text, String clientMsgId) throws Exception {
        JSONObject body = new JSONObject();
        body.put("text", text);
        body.put("msg_type", "text");
        body.put("client_msg_id", clientMsgId);
        return postJson("/v1/visitor/sessions/" + enc(sid) + "/messages", body, token);
    }

    void markRead(String sid, String token, String upToId) {
        try {
            String path = "/v1/visitor/sessions/" + enc(sid) + "/read";
            if (upToId != null && !upToId.isEmpty()) path += "?up_to_id=" + enc(upToId);
            Request req = new Request.Builder()
                    .url(HOST + path)
                    .header("X-Visitor-Token", token)
                    .post(RequestBody.create("", null))
                    .build();
            try (Response r = http.newCall(req).execute()) {
                // best-effort
            }
        } catch (Exception ignored) {
        }
    }

    private JSONObject getJson(String path, String visitorToken) throws Exception {
        Request.Builder b = new Request.Builder().url(HOST + path).get();
        if (visitorToken != null && !visitorToken.isEmpty()) {
            b.header("X-Visitor-Token", visitorToken);
        }
        return exec(b.build());
    }

    private JSONObject postJson(String path, JSONObject body, String visitorToken) throws Exception {
        Request.Builder b = new Request.Builder()
                .url(HOST + path)
                .post(RequestBody.create(body.toString(), JSON));
        if (visitorToken != null && !visitorToken.isEmpty()) {
            b.header("X-Visitor-Token", visitorToken);
        }
        return exec(b.build());
    }

    private JSONObject exec(Request req) throws Exception {
        try (Response r = http.newCall(req).execute()) {
            ResponseBody rb = r.body();
            String raw = rb == null ? "" : rb.string();
            JSONObject j;
            try {
                j = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
            } catch (Exception e) {
                j = new JSONObject();
            }
            if (!r.isSuccessful()) {
                String detail = j.optString("detail", "");
                if (detail.isEmpty()) detail = "请求失败 " + r.code();
                throw new IOException(detail);
            }
            return j;
        }
    }

    private static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}
