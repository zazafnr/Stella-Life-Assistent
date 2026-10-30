import SwiftUI

@MainActor
struct InboxView: View {
    @State private var entries: [InboxEntry]?
    @State private var filter: Filter = .important
    @State private var toast: String?
    @State private var reading: InboxEntry?

    enum Filter: String, CaseIterable {
        case important = "Wichtig", normal = "Neutral", newsletter = "Unwichtig", trash = "Papierkorb", all = "Alles"

        func matches(_ e: InboxEntry) -> Bool {
            switch self {
            case .important: return e.tab == .important
            case .normal: return e.tab == .normal
            case .newsletter: return e.tab == .newsletter
            case .trash: return e.tab == .trash
            case .all: return true
            }
        }

        var symbol: String {
            switch self {
            case .important: return "star.fill"
            case .normal: return "tray.fill"
            case .newsletter: return "bell.slash.fill"
            case .trash: return "trash.fill"
            case .all: return "tray.full.fill"
            }
        }
    }

    private var focus: [InboxEntry] { (entries ?? []).filter(\.focus) }
    private var shown: [InboxEntry] { (entries ?? []).filter { filter.matches($0) && !(filter == .important && $0.focus) } }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Theme.bg.ignoresSafeArea()
                Sky(clouds: false, height: 240)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Inbox").font(Theme.display(32)).foregroundStyle(Theme.text).padding(.top, 12)
                        if filter == .important, !focus.isEmpty {
                            Text("WICHTIG FÜR DICH")
                                .font(.system(size: 13, weight: .bold))
                                .tracking(1)
                                .foregroundStyle(Theme.pinkText)
                            ForEach(Array(focus.enumerated()), id: \.element.id) { index, e in
                                FocusCard(entry: e) { msg in
                                    if !msg.isEmpty { show(msg) }
                                    Task { await load() }
                                }
                                .rise(min(index, 6))
                            }
                        }
                        counters
                        if entries == nil {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                        } else if shown.isEmpty && !(filter == .important && !focus.isEmpty) {
                            VStack(spacing: 12) {
                                Cloud(width: 90)
                                Text(emptyText)
                                    .foregroundStyle(Theme.muted)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                        } else {
                            LazyVStack(spacing: 10) {
                                ForEach(Array(shown.enumerated()), id: \.element.id) { index, e in
                                    InboxRow(entry: e, restore: { Task { await restore(e) } })
                                        .contentShape(Rectangle())
                                        .onTapGesture { if e.source == "email" { reading = e } }
                                        .rise(min(index, 8))
                                }
                            }
                            .id(filter)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await load(check: true) }

                if let toast {
                    Text(toast)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Theme.text.opacity(0.9), in: Capsule())
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 20)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
            .sheet(item: $reading) { e in
                MailReaderSheet(entry: e) { msg in
                    if !msg.isEmpty { show(msg) }
                    Task { await load() }
                }
            }
        }
    }

    private var emptyText: String {
        switch filter {
        case .important: return "Nichts Wichtiges – alles ruhig."
        case .normal: return "Nichts Neutrales da."
        case .newsletter: return "Nichts Unwichtiges da. Newsletter und Social-Benachrichtigungen landen hier."
        case .trash: return "Der Papierkorb ist leer – Stella hat noch keine Werbung weggeräumt."
        case .all: return "Hier ist gerade nichts."
        }
    }

    private var counters: some View {
        let all = entries ?? []
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Filter.allCases, id: \.self) { f in
                    let n = all.filter(f.matches).count
                    let on = f == filter
                    Button { withAnimation(.spring(response: 0.35)) { filter = f } } label: {
                        HStack(spacing: 6) {
                            Image(systemName: f.symbol).font(.system(size: 12))
                            Text(f.rawValue)
                            if f != .all { Text("\(n)").fontWeight(.bold).opacity(0.8) }
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(on ? .white : Theme.text)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(on ? Theme.blue : .white, in: Capsule())
                        .shadow(color: Theme.blue.opacity(on ? 0.3 : 0.06), radius: 8, y: 3)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func load(check: Bool = false) async {
        if check { _ = try? await API.shared.send("POST", "/api/mail/check", as: [MailAccountStub].self) }
        if let list: [InboxEntry] = try? await API.shared.get("/api/inbox?limit=300") { entries = list }
        else if entries == nil { entries = [] }
    }

    private func restore(_ e: InboxEntry) async {
        do {
            _ = try await API.shared.send("POST", "/api/inbox/\(e.id)/restore", as: OK.self)
            show("Zurück im Posteingang")
            await load()
        } catch {
            show(error.localizedDescription)
        }
    }

    private func show(_ text: String) {
        withAnimation(.spring) { toast = text }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            withAnimation { toast = nil }
        }
    }
}

private struct MailAccountStub: Decodable {}

struct InboxRow: View {
    var entry: InboxEntry
    var restore: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(entry.sender ?? entry.platform ?? "Unbekannt")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer()
                    Text(when).font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
                if let s = entry.summary ?? entry.text {
                    Text(s)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(3)
                }
                HStack(spacing: 6) {
                    if let acc = entry.account { Pill(text: acc) }
                    if entry.important { Pill(text: "wichtig", icon: "star.fill", tone: .pink) }
                    if entry.trashed {
                        Pill(text: "im Papierkorb", icon: "trash", tone: .gray)
                        Spacer()
                        Button("Zurückholen", action: restore)
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                .padding(.top, 2)
            }
        }
        .card(padding: 14)
        .opacity(entry.trashed ? 0.8 : 1)
    }

    private var avatar: some View {
        let name = entry.sender ?? entry.platform ?? "?"
        let palette: [(Color, Color)] = [(Theme.blueTint, Theme.blue), (Theme.pinkTint, Theme.pinkText), (Theme.greenTint, Theme.green), (Color(hex: 0xDDF6F5), Color(hex: 0x0E8F8A))]
        let pick = palette[name.unicodeScalars.reduce(0) { $0 + Int($1.value) } % palette.count]
        let symbol: String? = entry.source == "social" ? "heart.fill" : entry.source == "sms" ? "message.fill" : entry.source == "call" ? "phone.fill" : nil
        return ZStack {
            Circle().fill(pick.0)
            if let symbol {
                Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(pick.1)
            } else {
                Text(Self.initials(name)).font(.system(size: 14, weight: .bold)).foregroundStyle(pick.1)
            }
        }
        .frame(width: 40, height: 40)
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { !$0.isLetter }).prefix(2)
        let s = words.compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return s.isEmpty ? "?" : s
    }

    private var when: String {
        guard let d = entry.date else { return "" }
        return Calendar.current.isDateInToday(d)
            ? d.formatted(date: .omitted, time: .shortened)
            : d.formatted(.dateTime.day().month(.defaultDigits))
    }
}
