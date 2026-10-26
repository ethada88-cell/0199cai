package com.ojy0871.seat0199;

import org.json.JSONObject;

final class ChatMessage {
    final String id;
    final String role;
    final String text;
    final String time;
    final String agent;
    final String msgType;
    final String fileUrl;
    final String fileName;

    ChatMessage(String id, String role, String text, String time, String agent,
                String msgType, String fileUrl, String fileName) {
        this.id = id == null ? "" : id;
        this.role = role == null ? "" : role;
        this.text = text == null ? "" : text;
        this.time = time == null ? "" : time;
        this.agent = agent == null ? "" : agent;
        this.msgType = msgType == null ? "text" : msgType;
        this.fileUrl = fileUrl == null ? "" : fileUrl;
        this.fileName = fileName == null ? "" : fileName;
    }

    static ChatMessage fromJson(JSONObject o) {
        if (o == null) return null;
        String text = o.optString("text", "");
        String msgType = o.optString("msg_type", "text");
        String fileUrl = o.optString("file_url", "");
        String fileName = o.optString("file_name", "");
        if (("image".equals(msgType) || "file".equals(msgType)) && text.isEmpty()) {
            text = fileName.isEmpty() ? ("[附件] " + fileUrl) : ("[附件] " + fileName);
        }
        return new ChatMessage(
                o.optString("id", ""),
                o.optString("role", ""),
                text,
                o.optString("time", ""),
                o.isNull("agent") ? "" : o.optString("agent", ""),
                msgType,
                fileUrl,
                fileName
        );
    }

    String displayText() {
        if (!text.isEmpty()) return text;
        if (!fileUrl.isEmpty()) return fileName.isEmpty() ? "[图片/文件]" : "[附件] " + fileName;
        return "";
    }
}
