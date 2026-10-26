import UIKit
import WebKit

final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private static let chatBase = "https://cs.ojy0871.com/c/0199cai/"
    private static let prefsKey = "seat0199.agent_code"

    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .default)
    private var agentCode: String = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(progress)
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: progress.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        webView.addObserver(self, forKeyPath: "estimatedProgress", options: .new, context: nil)

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "切换座席",
            style: .plain,
            target: self,
            action: #selector(promptAgent)
        )

        agentCode = Self.normalize(UserDefaults.standard.string(forKey: Self.prefsKey) ?? "")
        if agentCode.isEmpty {
            promptAgent(required: true)
        } else {
            loadChat()
        }
    }

    deinit {
        webView?.removeObserver(self, forKeyPath: "estimatedProgress")
    }

    func openIncomingURL(_ url: URL) {
        if let code = Self.agentCode(from: url), !code.isEmpty {
            save(code)
            loadChat()
        }
    }

    private func save(_ code: String) {
        agentCode = Self.normalize(code)
        UserDefaults.standard.set(agentCode, forKey: Self.prefsKey)
    }

    private func loadChat() {
        guard !agentCode.isEmpty,
              let url = URL(string: Self.chatBase + "?a=" + agentCode.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)
        else { return }
        webView.load(URLRequest(url: url))
    }

    @objc private func promptAgent() {
        promptAgent(required: false)
    }

    private func promptAgent(required: Bool) {
        let alert = UIAlertController(
            title: "输入座席专属代号",
            message: "后台「我的访客链接」里 ?a= 后面的代号。每个座席用自己的代号。",
            preferredStyle: .alert
        )
        alert.addTextField { field in
            field.placeholder = "例如 eddqc"
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.text = self.agentCode
        }
        alert.addAction(UIAlertAction(title: "进入会话", style: .default, handler: { [weak self] _ in
            guard let self else { return }
            let raw = alert.textFields?.first?.text ?? ""
            let code = Self.normalize(raw)
            if code.isEmpty {
                if required { self.promptAgent(required: true) }
                return
            }
            self.save(code)
            self.loadChat()
        }))
        if !required {
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        }
        present(alert, animated: true)
    }

    private static func normalize(_ raw: String) -> String {
        let lowered = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return lowered.filter { $0.isLetter || $0.isNumber }
    }

    private static func agentCode(from url: URL) -> String? {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            if let a = items.first(where: { $0.name == "a" })?.value, !a.isEmpty {
                return normalize(a)
            }
        }
        // seat0199://open/eddqc
        if url.scheme?.lowercased() == "seat0199", url.host?.lowercased() == "open" {
            let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !path.isEmpty { return normalize(path) }
        }
        return nil
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        if keyPath == "estimatedProgress" {
            progress.progress = Float(webView.estimatedProgress)
            progress.isHidden = webView.estimatedProgress >= 1
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if let code = Self.agentCode(from: url), !code.isEmpty, code != agentCode {
            save(code)
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "tel" || scheme == "mailto" || scheme == "sms" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
