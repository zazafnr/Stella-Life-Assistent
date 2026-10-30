import SwiftUI

@MainActor
struct TodayView: View {
    var go: (Tab) -> Void
    @Environment(Store.self) private var store
    @State private var lessons: [Lesson]?
    @State private var steps: Int?
    @State private var inbox: [InboxEntry] = []
    @State private var showSettings = Demo.opens("settings")
    @State private var showHealth = false
    @State private var showFinance = Demo.opens("finance")
    @State private var showPlan = Demo.opens("plan")
    @State private var openItem: Item?

    private var today: String { Day.today }
    private var tomorrow: String { Day.add(1, to: today) }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Theme.bg.ignoresSafeArea()
                Sky()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header.rise(0)
                        BriefingCardView(onOpen: { tab in
                            if tab == "finance" { showFinance = true } else { go(tab == "inbox" ? .inbox : (tab == "goals" ? .goals : .chat)) }
                        })
                        if store.me?.has("shopping") == true { ShoppingCardView() }
                        StellaPlanCardView(open: { showPlan = true })
                        if store.me?.has("finance") == true { FinanceCardView(open: { showFinance = true }) }
                        if store.me?.has("goals") != false { GoalsCardView(go: { go(.goals) }) }
                        dueCard.rise(1)
                        HStack(spacing: 14) {
                            examCard
                            stepsCard
                        }
                        .rise(2)
                        lessonStrip.rise(3)
                        inboxRow.rise(4)
                        chatRow.rise(5)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await reload() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: $showHealth) { HealthSheet(goal: goal) }
            .sheet(isPresented: $showFinance) { FinanceSheet() }
            .sheet(isPresented: $showPlan) { NavigationStack { StellaPlanView(go: { go($0) }) } }
            .sheet(item: $openItem) { ItemDetail(item: $0) }
            .task { await reload() }
        }
    }

    // MARK: Teile

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Date().formatted(.dateTime.locale(Locale(identifier: "de_AT")).weekday(.wide).day().month(.wide)))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                Text("\(greeting), \(store.me?.firstName ?? "du")!")
                    .font(Theme.display(32))
                    .foregroundStyle(Theme.text)
                if !store.online {
                    Label("Offline – ich gleiche ab, sobald du wieder Netz hast.", systemImage: "wifi.slash")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 2)
                }
            }
            Spacer()
            Button { showSettings = true } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.85), in: Circle())
                    .shadow(color: Theme.blue.opacity(0.12), radius: 10, y: 4)
            }
            .accessibilityLabel("Einstellungen")
        }
        .padding(.top, 12)
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend"
    }

    private var due: (label: String, items: [Item]) {
        let all = store.visibleItems
        let dueTomorrow = all.filter { $0.due == tomorrow && $0.kind != "study" && $0.kind != "exam" }
        if !dueTomorrow.isEmpty { return ("Morgen fällig", dueTomorrow.sorted { $0.title < $1.title }) }
        let upcoming = all.filter { $0.isOpen && ($0.due ?? "") >= today && $0.kind != "study" }
            .sorted { ($0.due ?? "") < ($1.due ?? "") }
        return ("Als Nächstes", Array(upcoming.prefix(3)))
    }

    private var dueCard: some View {
        let d = due
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(d.label.uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button("Planer") { go(.planner) }
                    .font(.system(size: 14, weight: .semibold))
            }
            .padding(.bottom, 6)
            if d.items.isEmpty {
                HStack(spacing: 10) {
                    StarMark(size: 16)
                    Text("Nichts offen – genieß den Tag!")
                        .foregroundStyle(Theme.muted)
                }
                .padding(.vertical, 12)
            }
            ForEach(Array(d.items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { Divider().overlay(Theme.border) }
                Button { openItem = item } label: {
                    ItemRow(item: item, busy: store.busyItems.contains(item.id), showDue: d.label != "Morgen fällig")
                }
                .buttonStyle(PressableStyle())
            }
        }
        .card()
    }

    private var exam: Item? {
        store.visibleItems.filter { $0.kind == "exam" && $0.isOpen && ($0.due ?? "") >= today }
            .sorted { ($0.due ?? "") < ($1.due ?? "") }.first
    }

    private var examCard: some View {
        Group {
            if let exam, let due = exam.due {
                let days = Day.diff(from: today, to: due)
                Button { openItem = exam } label: {
                    VStack(alignment: .leading, spacing: 10) {
                        Ring(progress: 1 - Double(min(days, 21)) / 21, color: Theme.pink, label: "\(days)")
                            .frame(width: 58, height: 58)
                        Text(exam.title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                        Text(days == 0 ? "heute!" : days == 1 ? "morgen" : "in \(days) Tagen")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(PressableStyle())
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 34))
                        .foregroundStyle(Theme.greenBright)
                        .frame(width: 58, height: 58)
                    Text("Keine Tests")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("in Sicht")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .card()
    }

    private var goal: Int { store.me?.settings.stepGoal.flatMap { $0 > 0 ? $0 : nil } ?? 8000 }

    private var stepsCard: some View {
        Button { showHealth = true } label: {
            VStack(alignment: .leading, spacing: 10) {
                let s = steps ?? 0
                Ring(progress: Double(s) / Double(goal), color: Theme.greenBright,
                     label: steps == nil ? "–" : "\(min(100, s * 100 / max(goal, 1))) %")
                    .frame(width: 58, height: 58)
                Text(steps.map { "\($0.formatted(.number.locale(Locale(identifier: "de_AT")))) Schritte" } ?? "Schritte")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Ziel \(goal.formatted(.number.locale(Locale(identifier: "de_AT"))))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .card()
        }
        .buttonStyle(PressableStyle())
    }

    @ViewBuilder private var lessonStrip: some View {
        if let lessons, !lessons.isEmpty {
            let homework = Set(store.items(on: tomorrow).filter { $0.kind == "homework" }.compactMap(\.subject))
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Morgen in der Schule")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    Text(Day.long(tomorrow))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(lessons) { l in
                            LessonChip(lesson: l, hasHomework: homework.contains(l.name))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var inboxRow: some View {
        let since = Date().addingTimeInterval(-86_400)
        let recent = inbox.filter { ($0.date ?? .distantPast) > since }
        let important = recent.filter(\.important).count
        let social = recent.filter { $0.source == "social" }.count
        let trashed = recent.filter(\.trashed).count
        return Button { go(.inbox) } label: {
            HStack(spacing: 10) {
                Circle().fill(important > 0 ? Theme.pink : Theme.border).frame(width: 8, height: 8)
                (Text(important == 1 ? "1 wichtige Nachricht" : "\(important) wichtige Nachrichten").bold()
                 + Text(" · \(social) Social · \(trashed) Werbung gelöscht").foregroundStyle(Theme.muted))
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.faint)
            }
            .card()
        }
        .buttonStyle(PressableStyle())
    }

    private var chatRow: some View {
        Button { go(.chat) } label: {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.fill")
                    .foregroundStyle(Theme.blue)
                    .frame(width: 40, height: 40)
                    .background(Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Stella etwas sagen")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("„Latein HÜ S. 20 Nr. 3 Freitag“ oder einfach fragen")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.faint)
            }
            .card()
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: Laden

    private func reload() async {
        await store.sync()
        async let l: [Lesson]? = try? API.shared.get("/api/timetable?from=\(tomorrow)&to=\(tomorrow)")
        async let i: [InboxEntry]? = try? API.shared.get("/api/inbox?limit=150")
        async let h: [HealthDay]? = try? API.shared.get("/api/health?days=1")
        lessons = await l ?? lessons ?? []
        inbox = await i ?? inbox
        let serverSteps = await h?.first { $0.date == today }?.steps
        // iPhone: Schritte direkt vom Sensor und gleich an Stella melden
        if let ingest = store.me?.ingestUrl, let local = await Steps.shared.upload(ingestUrl: ingest) {
            steps = local
        } else {
            steps = serverSteps ?? steps
        }
    }
}

/** Zeile für einen Eintrag: Icon, Titel, Seite/Nr., Status */
struct ItemRow: View {
    var item: Item
    var busy: Bool
    var showDue = false

    var body: some View {
        HStack(spacing: 12) {
            KindIcon(kind: item.kind)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .strikethrough(item.isDone && !item.solvedInNotebook, color: Theme.faint)
                    .lineLimit(1)
                if busy {
                    ShimmerBar().frame(height: 5).padding(.top, 4)
                } else if let sub = subtitle {
                    Text(sub)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            ItemStatusPill(item: item, busy: busy)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var subtitle: String? {
        let parts = [showDue ? item.due.map(Day.relative) : nil, item.detail].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct ItemStatusPill: View {
    var item: Item
    var busy: Bool
    var body: some View {
        if item.isDone && item.solvedInNotebook {
            Pill(text: "Im Heft", icon: "checkmark", tone: .green)
        } else if item.isDone {
            Pill(text: "Erledigt", icon: "checkmark", tone: .green)
        } else if busy {
            Pill(text: "Stella löst …", tone: .blue)
        } else {
            Pill(text: "offen")
        }
    }
}

struct KindIcon: View {
    var kind: String
    var body: some View {
        let style = Self.style(kind)
        Image(systemName: style.symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(style.pink ? Theme.pinkText : Theme.blue)
            .frame(width: 40, height: 40)
            .background(style.pink ? Theme.pinkTint : Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    static func style(_ kind: String) -> (symbol: String, pink: Bool) {
        switch kind {
        case "homework": return ("book.closed.fill", true)
        case "exam": return ("pencil.and.list.clipboard", true)
        case "assignment": return ("doc.text.fill", false)
        case "event": return ("calendar", false)
        case "study": return ("sparkles", false)
        case "reminder": return ("bell.fill", true)
        default: return ("checkmark.circle", false)
        }
    }
}

/** wandernder Glanz, solange Stella an einer HÜ arbeitet */
struct ShimmerBar: View {
    @State private var phase: CGFloat = -1
    var body: some View {
        GeometryReader { geo in
            Capsule().fill(Theme.blueTint)
                .overlay(
                    Capsule()
                        .fill(LinearGradient(colors: [Theme.blue.opacity(0), Theme.blue, Theme.blue.opacity(0)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * 0.5)
                        .offset(x: phase * geo.size.width),
                    alignment: .leading
                )
                .clipShape(Capsule())
        }
        .onAppear { withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1 } }
    }
}

struct LessonChip: View {
    var lesson: Lesson
    var hasHomework: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(lesson.cancelled ? "\(lesson.start) · entfällt" : hasHomework ? "\(lesson.start) · HÜ" : lesson.start)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hasHomework ? Theme.pinkText : Theme.muted)
            Text(lesson.name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(lesson.cancelled ? Theme.faint : Theme.text)
                .strikethrough(lesson.cancelled)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(hasHomework ? Theme.pinkTint : Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(hasHomework ? Theme.pink.opacity(0.4) : Theme.border, style: StrokeStyle(lineWidth: 1, dash: lesson.cancelled ? [4, 3] : []))
        )
    }
}

/// Oben auf „Heute“: morgens der Überblick, den ganzen Tag „Mir ist aufgefallen“
@MainActor
struct BriefingCardView: View {
    var onOpen: (String) -> Void
    @Environment(Store.self) private var store
    @State private var briefing: Briefing?
    @State private var gone: Set<String> = []

    private let icons = ["school": "🏫", "due": "📌", "plan": "🗓️", "tomorrow": "🌙", "done": "✅", "inbox": "✉️", "goals": "🎯"]

    var body: some View {
        let morning = Calendar.current.component(.hour, from: Date()) < 12
        let sections = morning ? (briefing?.sections ?? []) : []
        let hints = (briefing?.hints ?? []).filter { !gone.contains($0.key) }
        Group {
            if !sections.isEmpty || !hints.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    if !sections.isEmpty {
                        Text("DEIN ÜBERBLICK").eyebrow()
                        ForEach(sections) { s in
                            HStack(alignment: .top, spacing: 12) {
                                Text(icons[s.id] ?? "•").font(.system(size: 18)).frame(width: 26)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                                    ForEach(Array(s.lines.enumerated()), id: \.offset) { _, line in
                                        Text(line).font(.system(size: 14)).foregroundStyle(Theme.muted)
                                    }
                                }
                            }
                        }
                    }
                    if !hints.isEmpty {
                        Text("MIR IST AUFGEFALLEN").eyebrow(color: Theme.pinkText).padding(.top, sections.isEmpty ? 0 : 4)
                        ForEach(hints) { h in
                            HintRowView(hint: h, onOpen: onOpen, onGone: { withAnimation(.spring) { _ = gone.insert(h.key) } })
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                .rise(1)
            }
        }
        .task(id: store.lastSync) { await load() }
    }

    private func load() async {
        if let b = try? await API.shared.get("/api/briefing", as: Briefing.self) { briefing = b }
    }
}

@MainActor
struct HintRowView: View {
    var hint: Hint
    var onOpen: (String) -> Void
    var onGone: () -> Void
    @Environment(Store.self) private var store
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Bubble.markdown(hint.text))
                .font(.system(size: 15))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if let id = hint.actionId, store.actions[id]?.proposed == true {
                    ActionCardView(id: id)
                } else if let label = hint.actionLabel {
                    Button(label) { Task { await accept(thenOpen: nil) } }
                        .buttonStyle(SmallButton())
                        .disabled(busy)
                } else if let open = hint.open {
                    Button(open.label) { Task { await accept(thenOpen: open.tab) } }
                        .buttonStyle(SmallButton())
                }
                Button {
                    onGone()
                    Task { _ = try? await API.shared.send("POST", "/api/hints/\(escaped)/dismiss", as: OK.self) }
                } label: {
                    Label("Passt schon", systemImage: "xmark").font(.system(size: 13, weight: .semibold))
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(hint.high ? Theme.pinkTint : Color(hex: 0xEEF4FD), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var escaped: String { hint.key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: ":/"))) ?? hint.key }

    private func accept(thenOpen tab: String?) async {
        busy = true
        defer { busy = false }
        struct Result: Decodable { var status: String }
        do {
            _ = try await API.shared.send("POST", "/api/hints/\(escaped)/accept", as: Result.self)
            if let tab { onOpen(tab) } else { Haptics.success(); onGone() }
            await store.sync()
        } catch {
            // „Antwort schreiben“ hat nichts anzunehmen – einfach hinführen
            if let tab { onOpen(tab) }
        }
    }
}

/** Kleiner blauer Knopf (Hinweise, Karten) */
struct SmallButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.blue, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}
