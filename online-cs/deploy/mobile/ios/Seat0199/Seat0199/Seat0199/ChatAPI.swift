import Foundation

enum ChatAPI {
    static let host = "https://cs.ojy0871.com"
    static let slug = "0199cai"

    struct Message: Hashable {
        let id: String
        let role: String
        let text: String
        let time: String
        let agent: String
    }

    struct Session {
        let id: String
        let token: String
        let assignedAgent: String
        let offline: Bool
    }

    static func normalize(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().filter { $0.isLetter || $0.isNumber }
    }

    static func agentCode(from url: URL) -> String? {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let a = items.first(where: { $0.name == "a" })?.value, !a.isEmpty {
            return normalize(a)
        }
        if url.scheme?.lowercased() == "seat0199", url.host?.lowercased() == "open" {
            let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !path.isEmpty { return normalize(path) }
        }
        return nil
    }

    static func deviceFp() -> String {
        let key = "seat0199.device_fp"
        if let v = UserDefaults.standard.string(forKey: key), !v.isEmpty { return v }
        let v = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(32).description
        UserDefaults.standard.set(v, forKey: key)
        return v
    }

    static func startSession(agentCode: String, forceNew: Bool) async throws -> Session {
        let body: [String: Any] = [
            "slug": slug,
            "name": "App访客",
            "agent_code": agentCode,
            "device_fp": deviceFp(),
            "force_new": forceNew,
            "from_host": "seat0199-ios"
        ]
        let j = try await postJSON(path: "/v1/visitor/sessions", body: body, token: nil)
        let sid = j["session_id"] as? String ?? ""
        let tok = j["visitor_token"] as? String ?? ""
        guard !sid.isEmpty, !tok.isEmpty else {
            throw NSError(domain: "ChatAPI", code: 1, userInfo: [NSLocalizedDescriptionKey: (j["detail"] as? String) ?? "无法创建会话"])
        }
        return Session(
            id: sid,
            token: tok,
            assignedAgent: (j["assigned_agent"] as? String) ?? agentCode,
            offline: (j["offline"] as? Bool) ?? false
        )
    }

    static func listMessages(sessionId: String, token: String, after: String?) async throws -> [Message] {
        var path = "/v1/visitor/sessions/\(enc(sessionId))/messages"
        if let after, !after.isEmpty { path += "?after=\(enc(after))" }
        let j = try await getJSON(path: path, token: token)
        let items = j["items"] as? [[String: Any]] ?? []
        return items.compactMap(parseMessage)
    }

    static func sendText(sessionId: String, token: String, text: String, clientMsgId: String) async throws -> [Message] {
        let body: [String: Any] = [
            "text": text,
            "msg_type": "text",
            "client_msg_id": clientMsgId
        ]
        let j = try await postJSON(path: "/v1/visitor/sessions/\(enc(sessionId))/messages", body: body, token: token)
        var out: [Message] = []
        if let m = j["message"] as? [String: Any], let parsed = parseMessage(m) { out.append(parsed) }
        if let items = j["items"] as? [[String: Any]] {
            out.append(contentsOf: items.compactMap(parseMessage))
        }
        return out
    }

    private static func parseMessage(_ o: [String: Any]) -> Message? {
        let id = o["id"] as? String ?? ""
        guard !id.isEmpty else { return nil }
        var text = o["text"] as? String ?? ""
        let fileName = o["file_name"] as? String ?? ""
        let fileUrl = o["file_url"] as? String ?? ""
        if text.isEmpty && (!fileUrl.isEmpty || !fileName.isEmpty) {
            text = fileName.isEmpty ? "[附件]" : "[附件] \(fileName)"
        }
        return Message(
            id: id,
            role: o["role"] as? String ?? "",
            text: text,
            time: o["time"] as? String ?? "",
            agent: o["agent"] as? String ?? ""
        )
    }

    private static func getJSON(path: String, token: String?) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: host + path)!)
        req.httpMethod = "GET"
        if let token, !token.isEmpty { req.setValue(token, forHTTPHeaderField: "X-Visitor-Token") }
        return try await exec(req)
    }

    private static func postJSON(path: String, body: [String: Any], token: String?) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: host + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token, !token.isEmpty { req.setValue(token, forHTTPHeaderField: "X-Visitor-Token") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await exec(req)
    }

    private static func exec(_ req: URLRequest) async throws -> [String: Any] {
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if !(200...299).contains(code) {
            let detail = obj["detail"] as? String ?? "请求失败 \(code)"
            throw NSError(domain: "ChatAPI", code: code, userInfo: [NSLocalizedDescriptionKey: detail])
        }
        return obj
    }

    private static func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }
}
