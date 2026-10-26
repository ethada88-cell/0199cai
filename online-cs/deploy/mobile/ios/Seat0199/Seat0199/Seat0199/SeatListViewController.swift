import UIKit

final class SeatListViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchResultsUpdating {
    private var seats: [Seat] = []
    private var filtered: [Seat] = []
    private let table = UITableView(frame: .zero, style: .plain)
    private let search = UISearchController(searchResultsController: nil)

    struct Seat {
        let name: String
        let code: String
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "0199客服"
        view.backgroundColor = UIColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1)
        navigationController?.navigationBar.prefersLargeTitles = true
        navigationItem.largeTitleDisplayMode = .always

        seats = Self.loadSeats()
        filtered = seats
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "手动输入",
            style: .plain,
            target: self,
            action: #selector(manualEntry)
        )

        search.searchResultsUpdater = self
        search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = "搜索座席名或代号"
        navigationItem.searchController = search
        definesPresentationContext = true

        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self
        table.delegate = self
        table.register(UITableViewCell.self, forCellReuseIdentifier: "seat")
        table.rowHeight = 64
        view.addSubview(table)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        let header = UILabel()
        header.numberOfLines = 0
        header.textAlignment = .left
        header.font = .systemFont(ofSize: 13)
        header.textColor = UIColor(red: 0.39, green: 0.45, blue: 0.55, alpha: 1)
        header.text = "  内置 \(seats.count) 个座席 · 原生会话（非网页套壳）"
        header.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: 36)
        table.tableHeaderView = header
    }

    func openIncomingURL(_ url: URL) {
        if let code = ChatAPI.agentCode(from: url), !code.isEmpty {
            open(code: code, name: nil)
        }
    }

    @objc private func manualEntry() {
        let alert = UIAlertController(title: "手动输入座席代号", message: "代号在专属链接 ?a= 后面", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "例如 eddqc"; $0.autocapitalizationType = .none }
        alert.addAction(UIAlertAction(title: "进入", style: .default, handler: { [weak self] _ in
            let raw = alert.textFields?.first?.text ?? ""
            let code = ChatAPI.normalize(raw)
            guard !code.isEmpty else { return }
            self?.open(code: code, name: nil)
        }))
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    private func open(code: String, name: String?) {
        let seat = seats.first(where: { $0.code == code })
        let chat = ChatViewController(agentCode: code, seatName: name ?? seat?.name ?? code)
        navigationController?.pushViewController(chat, animated: true)
    }

    func updateSearchResults(for searchController: UISearchController) {
        let q = ChatAPI.normalize(searchController.searchBar.text ?? "")
        if q.isEmpty {
            filtered = seats
        } else {
            filtered = seats.filter {
                $0.code.contains(q) || ChatAPI.normalize($0.name).contains(q)
            }
        }
        table.reloadData()
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        filtered.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "seat", for: indexPath)
        let s = filtered[indexPath.row]
        var conf = cell.defaultContentConfiguration()
        conf.text = s.name
        conf.secondaryText = "代号 \(s.code)  ·  /c/0199cai/?a=\(s.code)"
        conf.textProperties.font = .systemFont(ofSize: 16, weight: .semibold)
        conf.secondaryTextProperties.font = .systemFont(ofSize: 12)
        conf.secondaryTextProperties.color = .secondaryLabel
        cell.contentConfiguration = conf
        cell.accessoryType = .disclosureIndicator
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let s = filtered[indexPath.row]
        open(code: s.code, name: s.name)
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
