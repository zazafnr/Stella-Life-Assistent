import SwiftUI

/** Ziele: Fortschritt dieser Woche als schlichter Balken, Verlauf der letzten 8 Wochen, Notizen.
    Keine Punkte, keine Serien, keine Abzeichen. Stella legt Ziele auch im Chat an („ich will 3x pro Woche laufen gehen“). */
@MainActor
struct GoalsView: View {
    @State private var goals: [GoalProgress]?
    @State private var showNew = false
    @State private var editing: GoalProgress?
    @State private var logging: GoalProgress?
    @State private var error: String?

    private struct LogBody: Encodable { var value: Double; var note: String }
    private struct StatusBody: Encodable { var status: String }

    private var active: [GoalProgress] { goals?.filter(\.isActive) ?? [] }
    private var rest: [GoalProgress] { goals?.filter { !$0.isActive } ?? [] }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Theme.bg.ignoresSafeArea()
                Sky()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header.rise(0)
                        if goals == nil {
                            Text("Einen Moment …").foregroundStyle(Theme.muted)
                        }
                        if let list = goals, list.isEmpty {
                            emptyCard.rise(1)
                        }
                        ForEach(active) { goal in card(goal) }
                        if !rest.isEmpty {
                            Text("PAUSIERT UND ERREICHT")
                                .font(.system(size: 12, weight: .bold))
                                .tracking(0.8)
                                .foregroundStyle(Theme.muted)
                            ForEach(rest) { goal in card(goal) }
                        }
                        if let error { Text(error).font(.system(size: 13)).foregroundStyle(Theme.pinkText) }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await load() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showNew) { GoalFormSheet(goal: nil, onSaved: { upsert($0) }) }
            .sheet(item: $editing) { goal in GoalFormSheet(goal: goal, onSaved: { upsert($0) }) }
            .sheet(item: $logging) { goal in GoalLogSheet(goal: goal, onSaved: { upsert($0) }) }
            .task {
                await load()
                // alle 30 Sekunden neu, damit Einträge aus dem Chat gleich auftauchen
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    await load()
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ziele").font(.system(size: 32, weight: .heavy)).foregroundStyle(Theme.text)
                Text("Kleine Schritte, die zählen. Ohne Druck.").font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 8)
            Button { showNew = true } label: { Label("Neues Ziel", systemImage: "plus") }
                .buttonStyle(SoftButton(filled: true))
        }
    }

    private var emptyCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "target").font(.system(size: 26)).foregroundStyle(Theme.blue)
            Text("Noch keine Ziele. Sag Stella einfach im Chat: „Ich will 3x pro Woche laufen gehen“ – oder leg hier eins an.")
                .font(.system(size: 14)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Button("Erstes Ziel anlegen") { showNew = true }.buttonStyle(SoftButton(filled: true))
        }
        .frame(maxWidth: .infinity)
        .card(padding: 20)
    }

    private func card(_ goal: GoalProgress) -> some View {
        GoalCard(
            goal: goal,
            onQuick: { Task { await log(goal, value: 1, note: "") } },
            onMore: { logging = goal },
            onEdit: { editing = goal },
            onStatus: { status in Task { await setStatus(goal, status) } },
            onDelete: { Task { await remove(goal) } },
            onDropLog: { id in Task { await dropLog(id) } }
        )
    }

    private func upsert(_ goal: GoalProgress) {
        var list = goals ?? []
        if let i = list.firstIndex(where: { $0.id == goal.id }) { list[i] = goal } else { list.append(goal) }
        goals = list
    }

    private func load() async {
        do {
            let r: GoalsResponse = try await API.shared.get("/api/goals")
            goals = r.goals
            error = nil
        } catch {
            if goals == nil { self.error = error.localizedDescription }
        }
    }

    private func log(_ goal: GoalProgress, value: Double, note: String) async {
        do {
            let r: GoalResponse = try await API.shared.send("POST", "/api/goals/\(goal.id)/log", body: LogBody(value: value, note: note))
            upsert(r.goal)
            Haptics.soft()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func setStatus(_ goal: GoalProgress, _ status: String) async {
        do {
            let r: GoalResponse = try await API.shared.send("PATCH", "/api/goals/\(goal.id)", body: StatusBody(status: status))
            upsert(r.goal)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ goal: GoalProgress) async {
        do {
            let _: OkResponse = try await API.shared.send("DELETE", "/api/goals/\(goal.id)")
            goals = goals?.filter { $0.id != goal.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func dropLog(_ id: String) async {
        do {
            let _: OkResponse = try await API.shared.send("DELETE", "/api/goal-logs/\(id)")
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct OkResponse: Codable { var ok: Bool? }

/** Balken „diese Woche“ – schlicht, ohne Glanz */
struct GoalWeekBar: View {
    var value: Double
    var target: Double

    private var share: CGFloat { target > 0 ? CGFloat(min(1, value / target)) : 0 }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.blueTint)
                Capsule()
                    .fill(LinearGradient(colors: [Theme.blue.opacity(0.55), Theme.blue], startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * share)
            }
        }
        .frame(height: 10)
    }
}

/** Verlauf der letzten 8 Wochen als kleine Linie mit gestrichelter Ziellinie */
struct GoalTrend: View {
    var history: [Double]
    var target: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let top = max(target, history.max() ?? 0, 1)
            let step: CGFloat = history.count > 1 ? (w - 8) / CGFloat(history.count - 1) : 0
            let points: [CGPoint] = history.enumerated().map { pair in
                CGPoint(x: 4 + CGFloat(pair.offset) * step, y: h - 4 - CGFloat(pair.element / top) * (h - 8))
            }
            let targetY = h - 4 - CGFloat(target / top) * (h - 8)
            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: 4, y: targetY))
                    p.addLine(to: CGPoint(x: w - 4, y: targetY))
                }
                .stroke(Theme.faint.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                Path { p in
                    for pair in points.enumerated() {
                        if pair.offset == 0 { p.move(to: pair.element) } else { p.addLine(to: pair.element) }
                    }
                }
                .stroke(Theme.blue, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = points.last {
                    Circle().fill(Theme.blue).frame(width: 7, height: 7).position(last)
                }
            }
        }
        .frame(height: 36)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Verlauf der letzten 8 Wochen")
    }
}

struct GoalCard: View {
    var goal: GoalProgress
    var onQuick: () -> Void
    var onMore: () -> Void
    var onEdit: () -> Void
    var onStatus: (String) -> Void
    var onDelete: () -> Void
    var onDropLog: (String) -> Void
    @State private var expanded = false
    @State private var confirmDelete = false

    private var subtitle: String {
        var parts: [String] = [goal.rhythm]
        if let minutes = goal.minutes { parts.append("\(minutes) Min.") }
        if let checkIn = goal.checkIn { parts.append("Erinnerung \(checkIn)") }
        if goal.status == "paused" { parts.append("pausiert") }
        if goal.status == "done" { parts.append("erreicht") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { expanded.toggle() } } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(goal.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
                        Text(subtitle).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.faint)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(goal.title), \(subtitle)")
            .accessibilityHint(expanded ? "Details ausblenden" : "Details anzeigen")

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(goal.amount(goal.weekValue)).font(.system(size: 26, weight: .heavy)).foregroundStyle(Theme.text)
                Text("von \(goal.amount(goal.weekTarget)) diese Woche").font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            GoalWeekBar(value: goal.weekValue, target: goal.weekTarget)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(goal.title): \(goal.amount(goal.weekValue)) von \(goal.amount(goal.weekTarget)) diese Woche")

            if goal.isActive {
                HStack(spacing: 8) {
                    if goal.unit == "x" {
                        Button { onQuick() } label: { Label("Einmal gemacht", systemImage: "plus") }
                            .buttonStyle(SoftButton(filled: true))
                        Button("Mehr eintragen") { onMore() }.buttonStyle(SoftButton(filled: false))
                    } else {
                        Button { onMore() } label: { Label("Eintragen", systemImage: "plus") }
                            .buttonStyle(SoftButton(filled: true))
                    }
                }
                .padding(.top, 2)
            }

            if expanded {
                Divider()
                if let why = goal.why { Text("Warum: \(why)").font(.system(size: 13)).foregroundStyle(Theme.muted) }
                Text("LETZTE 8 WOCHEN").font(.system(size: 12, weight: .bold)).tracking(0.8).foregroundStyle(Theme.muted)
                GoalTrend(history: goal.history, target: goal.weekTarget)
                if !goal.recent.isEmpty {
                    Text("ZULETZT").font(.system(size: 12, weight: .bold)).tracking(0.8).foregroundStyle(Theme.muted)
                    ForEach(goal.recent.prefix(6)) { entry in
                        HStack(spacing: 8) {
                            Text(goal.amount(entry.value)).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                            Text(entryLine(entry)).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(2)
                            Spacer(minLength: 0)
                            Button { onDropLog(entry.id) } label: {
                                Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Theme.pinkText.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Eintrag löschen")
                        }
                    }
                }
                HStack(spacing: 8) {
                    Button("Bearbeiten") { onEdit() }.buttonStyle(SoftButton(filled: false))
                    if goal.status == "active" {
                        Button("Pausieren") { onStatus("paused") }.buttonStyle(SoftButton(filled: false))
                    } else {
                        Button("Fortsetzen") { onStatus("active") }.buttonStyle(SoftButton(filled: false))
                    }
                }
                HStack(spacing: 8) {
                    if goal.status != "done" { Button("Erreicht") { onStatus("done") }.buttonStyle(SoftButton(filled: false)) }
                    Button("Löschen") { confirmDelete = true }.foregroundStyle(Theme.pinkText).font(.system(size: 14, weight: .semibold))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
        .opacity(goal.isActive ? 1 : 0.75)
        .confirmationDialog("„\(goal.title)“ mit allen Einträgen löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { onDelete() }
            Button("Abbrechen", role: .cancel) {}
        }
    }

    private func entryLine(_ entry: GoalLogEntry) -> String {
        var line = "· \(Day.relative(entry.date))"
        if let note = entry.note, !note.isEmpty { line += " · \(note)" }
        return line
    }
}

/** Ziel anlegen oder bearbeiten */
@MainActor
struct GoalFormSheet: View {
    var goal: GoalProgress?
    var onSaved: (GoalProgress) -> Void
    @Environment(\.dismiss) private var dismiss

    enum Kind: Hashable { case weekly, daily, amount }

    @State private var title: String
    @State private var why: String
    @State private var kind: Kind
    @State private var count: String
    @State private var unit: String
    @State private var minutes: String
    @State private var remind: Bool
    @State private var day: String
    @State private var hour: Int
    @State private var minute: Int
    @State private var busy = false
    @State private var error: String?

    private struct Payload: Encodable {
        var title: String
        var why: String
        var cadence: String
        var target: Double
        var unit: String
        var metric: String
        var minutes: Int
        var checkIn: String
    }

    private static let days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

    init(goal: GoalProgress?, onSaved: @escaping (GoalProgress) -> Void) {
        self.goal = goal
        self.onSaved = onSaved
        var weekly: Int?
        if let g = goal, g.cadence.hasPrefix("weekly:") { weekly = Int(g.cadence.dropFirst(7)) }
        var dayValue = ""
        var hourValue = 18
        var minuteValue = 0
        if let checkIn = goal?.checkIn {
            var time = checkIn
            if checkIn.count > 5 {
                dayValue = String(checkIn.prefix(2))
                time = String(checkIn.suffix(5))
            }
            let parts = time.split(separator: ":")
            if parts.count == 2 {
                hourValue = Int(parts[0]) ?? 18
                minuteValue = Int(parts[1]) ?? 0
            }
        }
        _title = State(initialValue: goal?.title ?? "")
        _why = State(initialValue: goal?.why ?? "")
        let startKind: Kind = goal == nil ? Kind.weekly : (goal?.cadence == "daily" ? Kind.daily : (weekly != nil ? Kind.weekly : Kind.amount))
        _kind = State(initialValue: startKind)
        _count = State(initialValue: goal == nil ? "3" : GoalProgress.number(weekly.map { Double($0) } ?? goal?.target ?? 1))
        _unit = State(initialValue: (goal?.unit == nil || goal?.unit == "x") ? "km" : (goal?.unit ?? "km"))
        _minutes = State(initialValue: goal?.minutes.map { String($0) } ?? "")
        _remind = State(initialValue: goal?.checkIn != nil)
        _day = State(initialValue: dayValue)
        _hour = State(initialValue: hourValue)
        _minute = State(initialValue: minuteValue)
    }

    private var timeBinding: Binding<Date> {
        Binding(
            get: { Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date() },
            set: { value in
                let c = Calendar.current.dateComponents([.hour, .minute], from: value)
                hour = c.hour ?? 18
                minute = c.minute ?? 0
            }
        )
    }

    private var amountValue: Double {
        let v = Double(count.replacingOccurrences(of: ",", with: ".")) ?? 1
        return max(1, v)
    }

    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !busy }

    var body: some View {
        NavigationStack {
            Form {
                Section("Was möchtest du erreichen?") {
                    TextField("z. B. Laufen gehen", text: $title)
                }
                Section("Wie oft?") {
                    Picker("Rhythmus", selection: $kind) {
                        Text("Mal pro Woche").tag(Kind.weekly)
                        Text("Täglich").tag(Kind.daily)
                        Text("Menge").tag(Kind.amount)
                    }
                    .pickerStyle(.segmented)
                    if kind != .daily {
                        HStack {
                            Text(kind == .weekly ? "Einheiten pro Woche" : "Pro Woche")
                            Spacer()
                            TextField("3", text: $count).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 80)
                        }
                    }
                    if kind == .amount {
                        HStack {
                            Text("Einheit")
                            Spacer()
                            TextField("km, Seiten, Minuten …", text: $unit).multilineTextAlignment(.trailing)
                        }
                    }
                }
                Section {
                    HStack {
                        Text("Minuten pro Einheit")
                        Spacer()
                        TextField("z. B. 45", text: $minutes).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 80)
                    }
                } footer: {
                    Text("Optional – dann plant Stella Zeit dafür im Wochenplan ein.")
                }
                Section {
                    Toggle("Stella erinnert mich", isOn: $remind)
                    if remind {
                        Picker("Tag", selection: $day) {
                            Text("Jeden Tag").tag("")
                            ForEach(Self.days, id: \.self) { d in Text(d).tag(d) }
                        }
                        DatePicker("Uhrzeit", selection: timeBinding, displayedComponents: .hourAndMinute)
                    }
                }
                Section("Warum ist dir das wichtig?") {
                    TextField("optional, z. B. fitter werden", text: $why)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(goal == nil ? "Neues Ziel" : "Ziel bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(goal == nil ? "Anlegen" : "Speichern") { Task { await save() } }.disabled(!canSave) }
            }
        }
    }

    private func payloadFor(unit u: String, target: Double, cadence: String, metric: String) -> Payload {
        Payload(
            title: title.trimmingCharacters(in: .whitespaces), why: why.trimmingCharacters(in: .whitespaces), cadence: cadence, target: target,
            unit: u, metric: metric, minutes: Int(minutes) ?? 0,
            checkIn: remind ? "\(day.isEmpty ? "" : day + " ")\(String(format: "%02d:%02d", hour, minute))" : ""
        )
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let payload: Payload
        switch kind {
        case .daily:
            payload = payloadFor(unit: "x", target: 1, cadence: "daily", metric: "Einheiten")
        case .weekly:
            let n = max(1, Int(amountValue.rounded()))
            payload = payloadFor(unit: "x", target: Double(n), cadence: "weekly:\(n)", metric: "Einheiten")
        case .amount:
            let u = unit.trimmingCharacters(in: .whitespaces).isEmpty ? "x" : unit.trimmingCharacters(in: .whitespaces)
            payload = payloadFor(unit: u, target: amountValue, cadence: "custom", metric: u)
        }
        do {
            let r: GoalResponse
            if let goal {
                r = try await API.shared.send("PATCH", "/api/goals/\(goal.id)", body: payload)
            } else {
                r = try await API.shared.send("POST", "/api/goals", body: payload)
            }
            onSaved(r.goal)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** Fortschritt eintragen: Menge und optional eine Notiz */
@MainActor
struct GoalLogSheet: View {
    var goal: GoalProgress
    var onSaved: (GoalProgress) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var value = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    private struct Payload: Encodable { var value: Double; var note: String }

    private var amount: Double? { Double(value.replacingOccurrences(of: ",", with: ".")) }

    var body: some View {
        NavigationStack {
            Form {
                Section(goal.unit == "x" ? "Wie viele Einheiten?" : "Wie viel (\(goal.unit))?") {
                    TextField(goal.unit == "x" ? "1" : "z. B. 5", text: $value).keyboardType(.decimalPad)
                }
                Section("Notiz") {
                    TextField("optional, z. B. Runde um den See", text: $note)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(goal.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Eintragen") { Task { await save() } }.disabled((amount ?? 0) <= 0 || busy) }
            }
            .onAppear { if value.isEmpty && goal.unit == "x" { value = "1" } }
        }
    }

    private func save() async {
        guard let amount, amount > 0 else { return }
        busy = true
        defer { busy = false }
        do {
            let r: GoalResponse = try await API.shared.send("POST", "/api/goals/\(goal.id)/log", body: Payload(value: amount, note: note))
            onSaved(r.goal)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** Karte auf „Heute“: die aktiven Ziele mit Stand dieser Woche */
@MainActor
struct GoalsCardView: View {
    var go: () -> Void
    @State private var goals: [GoalProgress] = []

    var body: some View {
        if goals.isEmpty {
            Color.clear.frame(height: 0).task { await load() }
        } else {
            Button { go() } label: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Deine Ziele").font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
                    }
                    ForEach(goals.prefix(3)) { g in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(g.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                                Spacer()
                                Text("\(g.amount(g.weekValue)) von \(g.amount(g.weekTarget))").font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                            }
                            GoalWeekBar(value: g.weekValue, target: g.weekTarget)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(padding: 16)
            }
            .buttonStyle(PressableStyle())
            .task { await load() }
        }
    }

    private func load() async {
        if let r: GoalsResponse = try? await API.shared.get("/api/goals") {
            goals = r.goals.filter(\.isActive)
        }
    }
}
