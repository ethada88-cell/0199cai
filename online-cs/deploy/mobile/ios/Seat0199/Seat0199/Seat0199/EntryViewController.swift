import UIKit

/// 入口：专属链接自动识别座席，不展示座席选择列表。
final class EntryViewController: UIViewController {
    private let seats: [Seat]

    struct Seat {
        let name: String
        let code: String
    }

    init() {
        self.seats = Self.loadSeats()
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1)
        navigationController?.setNavigationBarHidden(true, animated: false)

        let title = UILabel()
        title.text = "0199客服"
        title.font = .systemFont(ofSize: 28, weight: .bold)
        title.textColor = UIColor(red: 0.11, green: 0.31, blue: 0.85, alpha: 1)
        title.translatesAutoresizingMaskIntoConstraints = false

        let hint = UILabel()
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.font = .systemFont(ofSize: 15)
        hint.textColor = .secondaryLabel
        hint.text = "请通过座席专属链接打开本 App\n会自动识别客服，无需选择代号"
        hint.translatesAutoresizingMaskIntoConstraints = false

        let example = UILabel()
        example.numberOfLines = 0
        example.textAlignment = .center
        example.font = .systemFont(ofSize: 13)
        example.textColor = UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1)
        example.text = "专属链接示例\nhttps://cs.ojy0871.com/c/0199cai/?a=座席代号"
        example.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(title)
        view.addSubview(hint)
        view.addSubview(example)
        NSLayoutConstraint.activate([
            title.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 80),
            hint.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 16),
            hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            example.topAnchor.constraint(equalTo: hint.bottomAnchor, constant: 24),
            example.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            example.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let code = UserDefaults.standard.string(forKey: "seat0199.agent_code") {
            let n = ChatAPI.normalize(code)
            if !n.isEmpty { openChat(code: n, animated: false); return }
        }
        if let clip = UIPasteboard.general.string, !clip.isEmpty {
            if let url = URL(string: clip), let code = ChatAPI.agentCode(from: url), !code.isEmpty {
                openChat(code: code, animated: false)
                return
            }
            let n = ChatAPI.normalize(clip)
            if !n.isEmpty, seats.contains(where: { $0.code == n }) {
                openChat(code: n, animated: false)
            }
        }
    }

    func openIncomingURL(_ url: URL) {
        if let code = ChatAPI.agentCode(from: url), !code.isEmpty {
            UserDefaults.standard.set(code, forKey: "seat0199.agent_code")
            openChat(code: code, animated: true)
        }
    }

    private func openChat(code: String, animated: Bool) {
        let n = ChatAPI.normalize(code)
        guard !n.isEmpty else { return }
        UserDefaults.standard.set(n, forKey: "seat0199.agent_code")
        let name = seats.first(where: { $0.code == n })?.name ?? n
        let chat = ChatViewController(agentCode: n, seatName: name)
        navigationController?.setNavigationBarHidden(false, animated: animated)
        navigationController?.setViewControllers([self, chat], animated: animated)
    }

    private static func loadSeats() -> [Seat] {
        guard let url = Bundle.main.url(forResource: "seats", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return arr.compactMap { item in
            let code = ChatAPI.normalize((item["code"] as? String) ?? "")
            guard !code.isEmpty else { return nil }
            let name = ((item["name"] as? String) ?? code).trimmingCharacters(in: .whitespacesAndNewlines)
            return Seat(name: name.isEmpty ? code : name, code: code)
        }
    }
}
