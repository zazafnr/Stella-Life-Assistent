import SwiftUI

@MainActor
struct PlannerView: View {
    @Environment(Store.self) private var store
    @State private var day = Day.today
    @State private var filter: Filter = .all
    @State private var lessons: [Lesson] = []
    @State private var openItem: Item?
    @State private var showAdd = false
    @State private var planning = Demo.opens("weekplan")

    /** HÜs nur in der Schule, Tests und Lernplan in Schule und Studium */
    private var availableFilters: [Filter] {
        let me = store.me
        return Filter.allCases.filter { f in
            switch f {
            case .homework: return me?.isSchool ?? true
            case .exams: return me?.isLearner ?? true
            default: return true
            }
        }
    }

    enum Filter: String, CaseIterable, Identifiable {
        case all = "Alles", homework = "HÜs", exams = "Tests", other = "Termine"
        var id: String { rawValue }
        func matches(_ i: Item) -> Bool {
            switch self {
            case .all: return true
            case .homework: return i.kind == "homework" || i.kind == "assignment"
            case .exams: return i.kind == "exam" || i.kind == "study"
            case .other: return i.kind == "event" || i.kind == "todo" || i.kind == "reminder"
            }
        }
    }

    private var today: String { Day.today }

    private var monday: String {
        guard let d = Day.parse(day) else { return day }
        let weekday = Day.calendar.component(.weekday, from: d) // 1 = Sonntag
        return Day.add(-((weekday + 5) % 7), to: day)
    }
    private var week: [String] { (0..<7).map { Day.add($0, to: monday) } }
    private var kw: Int { Day.parse(monday).map { Calendar(identifier: .iso8601).component(.weekOfYear, from: $0) } ?? 0 }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Theme.bg.ignoresSafeArea()
                Sky(clouds: false, height: 240)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        weekStrip
                        Button { planning = true } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Theme.pinkText)
                                    .frame(width: 40, height: 40)
                                    .background(Theme.pinkTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Woche planen").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text)
                                    Text("Stella verteilt Lernen und HÜs auf deine freien Zeiten")
                                        .font(.system(size: 13)).foregroundStyle(Theme.muted)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
                            }
                            .card(padding: 14)
                        }
                        .buttonStyle(PressableStyle())
                        Picker("Filter", selection: $filter) {
                            ForEach(availableFilters) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)

                        if !overdue.isEmpty {
                            Text("ÜBERFÄLLIG").eyebrow(color: Theme.pinkText)
                            ForEach(overdue) { card($0, showDue: true) }
                        }

                        Text(dayTitle.uppercased()).eyebrow()
                        timeline
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                    .animation(.spring(response: 0.4, dampingFraction: 0.85), value: day)
                    .animation(.spring(response: 0.4, dampingFraction: 0.85), value: filter)
                }
                .refreshable { await load() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(item: $openItem) { ItemDetail(item: $0) }
            .sheet(isPresented: $showAdd) { QuickAdd().presentationDetents([.height(260)]) }
            .sheet(isPresented: $planning) { WeekPlanSheet() }
            .task(id: monday) { await load() }
        }
    }

    // MARK: Kopf & Woche

    private var header: some View {
        HStack {
            Text("Planer").font(Theme.display(32)).foregroundStyle(Theme.text)
            Spacer()
            HStack(spacing: 4) {
                circleButton("chevron.left") { day = Day.add(-7, to: day) }
                Button("KW \(kw)") { day = today }
                    .font(.system(size: 14, weight: .semibold))
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(.white, in: Capsule())
                circleButton("chevron.right") { day = Day.add(7, to: day) }
                circleButton("plus", filled: true) { showAdd = true }
                    .padding(.leading, 6)
            }
        }
    }

    private func circleButton(_ symbol: String, filled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(filled ? .white : Theme.text)
                .frame(width: 36, height: 36)
                .background(filled ? Theme.blue : .white, in: Circle())
                .shadow(color: Theme.blue.opacity(filled ? 0.3 : 0.08), radius: 8, y: 3)
        }
    }

    private var weekStrip: some View {
        let busyDays = Set(store.visibleItems.compactMap(\.due))
        return HStack(spacing: 6) {
            ForEach(week, id: \.self) { d in
                let selected = d == day
                Button { day = d } label: {
                    VStack(spacing: 4) {
                        Text(Day.parse(d)?.formatted(.dateTime.locale(Locale(identifier: "de_AT")).weekday(.abbreviated)) ?? "")
                            .font(.system(size: 11, weight: .semibold))
                        Text(String(Int(d.suffix(2)) ?? 0))
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                        Circle()
                            .fill(busyDays.contains(d) ? (selected ? .white : Theme.pink) : .clear)
                            .frame(width: 5, height: 5)
                    }
                    .foregroundStyle(selected ? .white : d == today ? Theme.blue : Theme.text)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.blue)
                                .shadow(color: Theme.blue.opacity(0.3), radius: 10, y: 4)
                        } else {
                            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white.opacity(0.8))
                        }
                    }
                }
                .buttonStyle(PressableStyle())
            }
        }
        .sensoryFeedback(.selection, trigger: day)
    }

    private var dayTitle: String {
        let rel = Day.relative(day)
        let long = Day.long(day)
        return ["heute", "morgen", "übermorgen", "gestern"].contains(rel) ? "\(rel) · \(long)" : long
    }

    // MARK: Inhalt

    private var overdue: [Item] {
        guard day == today else { return [] }
        return store.visibleItems
            .filter { $0.isOpen && ($0.due ?? "9999") < today && $0.kind != "study" && filter.matches($0) }
            .sorted { ($0.due ?? "") < ($1.due ?? "") }
    }

    private enum Row: Identifiable {
        case lesson(Lesson, [Item])
        case item(Item)
        var id: String {
            switch self {
            case .lesson(let l, _): return "l-" + l.id
            case .item(let i): return i.id
            }
        }
        var sortKey: String {
            switch self {
            case .lesson(let l, _): return l.start
            case .item(let i): return i.time ?? "99:99"
            }
        }
    }

    private var rows: [Row] {
        let dayItems = store.items(on: day).filter { filter.matches($0) }
        let dayLessons = lessons.filter { $0.date == day }
        var used = Set<String>()
        var out: [Row] = []
        // HÜs und Tests hängen an der ersten Stunde des Fachs
        var seenSubjects = Set<String>()
        for l in dayLessons {
            var attached: [Item] = []
            if !seenSubjects.contains(l.name) {
                seenSubjects.insert(l.name)
                attached = dayItems.filter { $0.subject == l.name && $0.time == nil }
                attached.forEach { used.insert($0.id) }
            }
            if filter == .all || !attached.isEmpty { out.append(.lesson(l, attached)) }
        }
        for i in dayItems where !used.contains(i.id) { out.append(.item(i)) }
        return out.sorted { $0.sortKey < $1.sortKey }
    }

    @ViewBuilder private var timeline: some View {
        let list = rows
        if list.isEmpty {
            VStack(spacing: 12) {
                Cloud(width: 90).opacity(0.9)
                Text("Nichts geplant. Sag Stella im Chat, was ansteht.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(list.enumerated()), id: \.element.id) { index, row in
                    switch row {
                    case .lesson(let l, let attached):
                        TimelineRow(time: l.start, dot: attached.isEmpty ? Theme.border : Theme.pink) {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(l.name)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(l.cancelled ? Theme.faint : Theme.text)
                                        .strikethrough(l.cancelled)
                                    Spacer()
                                    if l.cancelled { Pill(text: "entfällt", tone: .pink) }
                                    else if let info = l.info, !info.isEmpty { Text(info).font(.system(size: 12)).foregroundStyle(Theme.muted) }
                                }
                                ForEach(attached) { card($0) }
                            }
                            .padding(12)
                            .background(.white.opacity(l.cancelled ? 0.5 : 0.75), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: l.cancelled ? [4, 3] : [])))
                        }
                        .rise(index)
                    case .item(let i):
                        TimelineRow(time: i.time ?? "", dot: i.isDone ? Theme.greenBright : (i.kind == "exam" || i.kind == "homework") ? Theme.pink : Theme.blue) {
                            card(i)
                        }
                        .rise(index)
                    }
                }
            }
            .id(day + filter.rawValue)
        }
    }

    private func card(_ item: Item, showDue: Bool = false) -> some View {
        PlannerCard(item: item, busy: store.busyItems.contains(item.id), showDue: showDue,
                    onOpen: { openItem = item },
                    onToggle: { Task { await store.setDone(item, !item.isDone) } })
    }

    private func load() async {
        await store.sync()
        if let l: [Lesson] = try? await API.shared.get("/api/timetable?from=\(monday)&to=\(Day.add(6, to: monday))") {
            lessons = l
        }
    }
}

struct TimelineRow<Content: View>: View {
    var time: String
    var dot: Color
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(time)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.muted)
                .frame(width: 42, alignment: .trailing)
                .padding(.top, 14)
            Circle().fill(dot).frame(width: 9, height: 9).padding(.top, 17)
            content
        }
    }
}

struct PlannerCard: View {
    var item: Item
    var busy: Bool
    var showDue = false
    var onOpen: () -> Void
    var onToggle: () -> Void
    @State private var burst = 0

    var body: some View {
        HStack(spacing: 12) {
            Button {
                if !item.isDone { burst += 1 }
                onToggle()
            } label: {
                ZStack {
                    Circle()
                        .stroke(item.isDone ? Theme.greenBright : Theme.border, lineWidth: 2)
                        .background(Circle().fill(item.isDone ? Theme.greenBright : .white))
                        .frame(width: 26, height: 26)
                    if item.isDone {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(.white)
                            .transition(.scale.combined(with: .opacity))
                    }
                    Confetti(trigger: burst)
                }
                .animation(.spring(response: 0.35, dampingFraction: 0.6), value: item.isDone)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.isDone ? "Wieder öffnen" : "Erledigt")

            Button(action: onOpen) {
                ItemRow(item: item, busy: busy, showDue: showDue)
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: Theme.blue.opacity(0.07), radius: 10, y: 4)
        .opacity(item.isDone && !item.solvedInNotebook ? 0.7 : 1)
    }
}

/** Schnell etwas eintragen – geht über den Chat, damit Stella es versteht */
@MainActor
struct QuickAdd: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Neu eintragen").font(.system(size: 20, weight: .bold)).foregroundStyle(Theme.text)
            TextField("z. B. Latein HÜ S. 20 Nr. 3 Freitag", text: $text)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
                .modifier(InputStyle())
            Text("Stella versteht Kurzschrift: HÜ, SA, Test, Referat, Datum oder Wochentag.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
            Button("Eintragen", action: save)
                .buttonStyle(PrimaryButton())
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(22)
        .onAppear { focused = true }
    }

    private func save() {
        let t = text
        guard !t.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        dismiss()
        Task { await store.send(text: t) }
    }
}

extension Text {
    func eyebrow(color: Color = Theme.muted) -> some View {
        self.font(.system(size: 12, weight: .bold)).tracking(0.6).foregroundStyle(color)
    }
}
