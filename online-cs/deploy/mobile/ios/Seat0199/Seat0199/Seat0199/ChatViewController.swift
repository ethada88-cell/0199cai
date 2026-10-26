import UIKit

final class ChatViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextFieldDelegate {
    private let agentCode: String
    private var seatName: String

    private var sessionId = ""
    private var visitorToken = ""
    private var messages: [ChatAPI.Message] = []
    private var lastMsgId = ""
    private var closed = false

    private let table = UITableView(frame: .zero, style: .plain)
    private let input = UITextField()
    private let sendBtn = UIButton(type: .system)
    private let statusLabel = UILabel()
    private var pollTimer: Timer?
    private var webSocket: URLSessionWebSocketTask?
    private let wsSession = URLSession(configuration: .default)

    init(agentCode: String, seatName: String) {
        self.agentCode = ChatAPI.normalize(agentCode)
        self.seatName = seatName
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1)
        title = seatName
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "菜单",
            style: .plain,
            target: self,
            action: #selector(showMenu)
        )

        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabel
        statusLabel.text = "代号 \(agentCode) · 连接中…"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self
        table.delegate = self
        table.separatorStyle = .none
        table.backgroundColor = .clear
        table.register(BubbleCell.self, forCellReuseIdentifier: "msg")
        table.keyboardDismissMode = .interactive

        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = .white

        input.translatesAutoresizingMaskIntoConstraints = false
        input.placeholder = "输入消息"
        input.borderStyle = .roundedRect
        input.delegate = self
        input.returnKeyType = .send

        sendBtn.translatesAutoresizingMaskIntoConstraints = false
        sendBtn.setTitle("发送", for: .normal)
        sendBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        sendBtn.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)

        view.addSubview(statusLabel)
        view.addSubview(table)
        view.addSubview(bar)
        bar.addSubview(input)
        bar.addSubview(sendBtn)

        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),

            table.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 4),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: bar.topAnchor),

            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            bar.heightAnchor.constraint(equalToConstant: 56),

            input.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 12),
            input.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            input.trailingAnchor.constraint(equalTo: sendBtn.leadingAnchor, constant: -8),
            input.heightAnchor.constraint(equalToConstant: 36),

            sendBtn.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -12),
            sendBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            sendBtn.widthAnchor.constraint(equalToConstant: 56)
        ])

        connect(forceNew: false)
    }

    deinit {
        stopRealtime()
    }

    @objc private func showMenu() {
        let sheet = UIAlertController(title: seatName, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "刷新消息", style: .default, handler: { [weak self] _ in
            Task { await self?.pull(delta: false) }
        }))
        sheet.addAction(UIAlertAction(title: "开始新会话", style: .default, handler: { [weak self] _ in
            self?.connect(forceNew: true)
        }))
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel))
        if let pop = sheet.popoverPresentationController {
            pop.barButtonItem = navigationItem.rightBarButtonItem
        }
        present(sheet, animated: true)
    }

    private func connect(forceNew: Bool) {
        stopRealtime()
        closed = false
        sendBtn.isEnabled = true
        input.isEnabled = true
        statusLabel.text = "代号 \(agentCode) · 创建会话…"
        if forceNew {
            messages = []
            lastMsgId = ""
            table.reloadData()
        }
        Task {
            do {
                let s = try await ChatAPI.startSession(agentCode: agentCode, forceNew: forceNew)
                sessionId = s.id
                visitorToken = s.token
                if !s.assignedAgent.isEmpty {
                    seatName = s.assignedAgent
                    title = seatName
                }
                statusLabel.text = s.offline
                    ? "代号 \(agentCode) · 非工作时间可留言"
                    : "代号 \(agentCode) · 已连接"
                let items = try await ChatAPI.listMessages(sessionId: sessionId, token: visitorToken, after: nil)
                merge(items, replace: true)
                startRealtime()
            } catch {
                statusLabel.text = "代号 \(agentCode) · 连接失败"
                presentError(error.localizedDescription)
            }
        }
    }

    private func startRealtime() {
        connectWs()
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { await self?.pull(delta: true) }
        }
    }

    private func stopRealtime() {
        pollTimer?.invalidate()
        pollTimer = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
    }

    private func connectWs() {
        guard !sessionId.isEmpty, !visitorToken.isEmpty else { return }
        var comps = URLComponents(string: "wss://cs.ojy0871.com/v1/ws/visitor")!
        comps.queryItems = [
            URLQueryItem(name: "session_id", value: sessionId),
            URLQueryItem(name: "visitor_token", value: visitorToken)
        ]
        guard let url = comps.url else { return }
        webSocket?.cancel(with: .goingAway, reason: nil)
        let task = wsSession.webSocketTask(with: url)
        webSocket = task
        task.resume()
        receiveWs()
        statusLabel.text = "代号 \(agentCode) · 实时已连接"
    }

    private func receiveWs() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.statusLabel.text = "代号 \(self.agentCode) · 轮询中" }
            case .success(let message):
                if case .string(let text) = message {
                    self.handleWs(text)
                }
                self.receiveWs()
            }
        }
    }

    private func handleWs(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            Task { await pull(delta: true) }
            return
        }
        let ev = obj["event"] as? String ?? ""
        if ev == "ping" {
            webSocket?.send(.string("pong")) { _ in }
            return
        }
        if ev == "pong" || ev == "hello" { return }
        if ev == "session_closed" {
            DispatchQueue.main.async { self.onClosed() }
            return
        }
        if ev == "message",
           let dataObj = obj["data"] as? [String: Any],
           let m = dataObj["message"] as? [String: Any],
           let id = m["id"] as? String, !id.isEmpty {
            let msg = ChatAPI.Message(
                id: id,
                role: m["role"] as? String ?? "",
                text: (m["text"] as? String)?.isEmpty == false ? (m["text"] as! String) : "[附件]",
                time: m["time"] as? String ?? "",
                agent: m["agent"] as? String ?? ""
            )
            DispatchQueue.main.async { self.merge([msg], replace: false) }
            return
        }
        Task { await pull(delta: true) }
    }

    private func pull(delta: Bool) async {
        guard !sessionId.isEmpty else { return }
        do {
            let items = try await ChatAPI.listMessages(
                sessionId: sessionId,
                token: visitorToken,
                after: delta ? lastMsgId : nil
            )
            await MainActor.run { merge(items, replace: !delta) }
        } catch {
            if !delta {
                await MainActor.run { presentError(error.localizedDescription) }
            }
        }
    }

    private func merge(_ items: [ChatAPI.Message], replace: Bool) {
        var ordered: [ChatAPI.Message] = []
        var ids = Set<String>()
        if replace {
            for m in items where ids.insert(m.id).inserted { ordered.append(m) }
        } else {
            for m in messages where ids.insert(m.id).inserted { ordered.append(m) }
            for m in items where ids.insert(m.id).inserted { ordered.append(m) }
        }
        messages = ordered
        lastMsgId = messages.last?.id ?? lastMsgId
        table.reloadData()
        if !messages.isEmpty {
            table.scrollToRow(at: IndexPath(row: messages.count - 1, section: 0), at: .bottom, animated: true)
        }
    }

    private func onClosed() {
        closed = true
        input.isEnabled = false
        sendBtn.isEnabled = false
        statusLabel.text = "代号 \(agentCode) · 会话已结束"
        stopRealtime()
    }

    @objc private func sendTapped() {
        sendCurrent()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        sendCurrent()
        return true
    }

    private func sendCurrent() {
        guard !closed, !sessionId.isEmpty else { return }
        let text = (input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input.text = ""
        let clientId = "c_\(Int(Date().timeIntervalSince1970))_\(UUID().uuidString.prefix(8))"
        sendBtn.isEnabled = false
        Task {
            do {
                let items = try await ChatAPI.sendText(
                    sessionId: sessionId,
                    token: visitorToken,
                    text: text,
                    clientMsgId: clientId
                )
                await MainActor.run {
                    merge(items, replace: false)
                    sendBtn.isEnabled = !closed
                }
            } catch {
                await MainActor.run {
                    sendBtn.isEnabled = !closed
                    presentError(error.localizedDescription)
                    if error.localizedDescription.contains("会话已结束") { onClosed() }
                }
            }
        }
    }

    private func presentError(_ msg: String) {
        let alert = UIAlertController(title: "提示", message: msg, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        present(alert, animated: true)
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { messages.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "msg", for: indexPath) as! BubbleCell
        cell.bind(messages[indexPath.row])
        return cell
    }
}

private final class BubbleCell: UITableViewCell {
    private let bubble = UILabel()
    private let meta = UILabel()
    private let stack = UIStackView()
    private var leading: NSLayoutConstraint!
    private var trailing: NSLayoutConstraint!

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .clear
        contentView.backgroundColor = .clear

        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        stack.layer.cornerRadius = 14
        stack.clipsToBounds = true

        bubble.numberOfLines = 0
        bubble.font = .systemFont(ofSize: 15)
        meta.font = .systemFont(ofSize: 10)
        meta.textColor = .secondaryLabel

        stack.addArrangedSubview(bubble)
        stack.addArrangedSubview(meta)
        contentView.addSubview(stack)

        leading = stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12)
        trailing = stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
            stack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.78),
            leading,
            trailing
        ])
        trailing.isActive = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    func bind(_ m: ChatAPI.Message) {
        let visitor = m.role == "visitor"
        let system = m.role == "system"
        bubble.text = m.text
        meta.text = m.time
        if visitor {
            stack.backgroundColor = UIColor(red: 0.11, green: 0.31, blue: 0.85, alpha: 1)
            bubble.textColor = .white
            meta.textColor = UIColor(white: 1, alpha: 0.75)
            leading.isActive = false
            trailing.isActive = true
        } else if system {
            stack.backgroundColor = UIColor(red: 0.89, green: 0.91, blue: 0.94, alpha: 1)
            bubble.textColor = UIColor(red: 0.2, green: 0.25, blue: 0.33, alpha: 1)
            meta.textColor = .secondaryLabel
            leading.isActive = true
            trailing.isActive = true
            leading.constant = 40
            trailing.constant = -40
        } else {
            stack.backgroundColor = .white
            bubble.textColor = UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1)
            meta.textColor = .secondaryLabel
            leading.isActive = true
            trailing.isActive = false
            leading.constant = 12
        }
        if !visitor && !system && !m.agent.isEmpty {
            meta.text = "\(m.agent)  \(m.time)"
        }
    }
}
