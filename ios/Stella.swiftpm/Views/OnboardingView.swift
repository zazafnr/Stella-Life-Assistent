import SwiftUI

/** Bricht Chips in Zeilen um */
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/** Auswählbarer Chip */
struct OnbChip: View {
    var title: String
    var symbol: String? = nil
    var on: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13)) }
                Text(title)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(on ? .white : Theme.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(on ? Theme.blue : Theme.blueTint, in: Capsule())
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/** Einführung in ein paar Klicks: wer bist du, wobei soll Stella helfen. Jederzeit „Überspringen“. */
@MainActor
struct OnboardingView: View {
    var startAt: OnboardingStart
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum Step: Hashable { case welcome, name, situation, age, details, features, mail, tone, briefing, done }

    private struct Choice: Identifiable {
        let id: String
        let label: String
    }

    private struct DayChoice: Identifiable {
        let id: Int
        let label: String
    }

    private struct SituationInfo: Identifiable {
        let id: String
        let symbol: String
        let label: String
        let sub: String
    }

    private let situations = [
        SituationInfo(id: "school", symbol: "graduationcap.fill", label: "Schule", sub: "HÜs, Tests, Stundenplan"),
        SituationInfo(id: "university", symbol: "books.vertical.fill", label: "Studium", sub: "Lehrveranstaltungen, Prüfungen"),
        SituationInfo(id: "work", symbol: "briefcase.fill", label: "Job", sub: "Arbeitszeiten, Termine, Alltag"),
        SituationInfo(id: "apprenticeship", symbol: "wrench.and.screwdriver.fill", label: "Lehre", sub: "Betrieb und Berufsschule"),
        SituationInfo(id: "other", symbol: "sparkles", label: "Etwas anderes", sub: "Elternzeit, Pause, alles Mögliche"),
    ]
    private let ages = [Choice(id: "u14", label: "unter 14"), Choice(id: "14-17", label: "14–17"), Choice(id: "18-24", label: "18–24"),
                        Choice(id: "25-34", label: "25–34"), Choice(id: "35-49", label: "35–49"), Choice(id: "50+", label: "50+")]
    private let levels = ["Unterstufe", "Mittelstufe", "Oberstufe", "Berufsschule"]
    private let days = [DayChoice(id: 1, label: "Mo"), DayChoice(id: 2, label: "Di"), DayChoice(id: 3, label: "Mi"), DayChoice(id: 4, label: "Do"),
                        DayChoice(id: 5, label: "Fr"), DayChoice(id: 6, label: "Sa"), DayChoice(id: 7, label: "So")]
    private let featureOrder = ["planner", "mails", "homework", "shopping", "goals", "finance", "health"]
    private let featureInfo: [String: (symbol: String, label: String)] = [
        "mails": ("envelope.fill", "Mails sortieren"), "planner": ("calendar", "Planer & Erinnerungen"), "homework": ("book.fill", "Hausübungen"),
        "shopping": ("cart.fill", "Einkaufsliste"), "goals": ("star.fill", "Ziele"), "finance": ("eurosign.circle.fill", "Ausgaben"), "health": ("heart.fill", "Gesundheit"),
    ]
    private let briefings = [Choice(id: "auto", label: "Automatisch"), Choice(id: "06:30", label: "06:30"), Choice(id: "07:00", label: "07:00"),
                              Choice(id: "07:30", label: "07:30"), Choice(id: "08:00", label: "08:00"), Choice(id: "off", label: "Kein Briefing")]

    @State private var index = 0
    @State private var started = false
    @State private var busy = false
    @State private var error: String?

    @State private var name = ""
    @State private var situation: String?
    @State private var age: String?
    @State private var level = ""
    @State private var uni = ""
    @State private var workDays: Set<Int> = [1, 2, 3, 4, 5]
    @State private var from = OnboardingView.time("09:00")
    @State private var to = OnboardingView.time("17:00")
    @State private var commute = false
    @State private var features: Set<String> = []
    @State private var tone: Tone = .nett
    @State private var briefing = "auto"

    private static let hhmm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()
    private static func time(_ s: String) -> Date { hhmm.date(from: s) ?? Date() }
    private var fromText: String { Self.hhmm.string(from: from) }
    private var toText: String { Self.hhmm.string(from: to) }

    private var steps: [Step] {
        let hasDetails = ["school", "university", "work", "apprenticeship"].contains(situation ?? "")
        return [.welcome, .name, .situation, .age] + (hasDetails ? [.details] : []) + [.features, .mail, .tone, .briefing, .done]
    }
    private var step: Step { steps[min(index, steps.count - 1)] }
    private var isWork: Bool { situation == "work" || situation == "apprenticeship" }

    private var canNext: Bool {
        switch step {
        case .name: return !name.trimmingCharacters(in: .whitespaces).isEmpty
        case .situation: return situation != nil
        case .details: return isWork ? !workDays.isEmpty && toText > fromText : true
        default: return true
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            Sky(height: 360)
            VStack(spacing: 16) {
                topBar
                Spacer(minLength: 0)
                card
                    .id(step)
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                Spacer(minLength: 0)
                navBar
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            .frame(maxWidth: 560)
        }
        .onAppear(perform: load)
    }

    // MARK: Gerüst

    private var topBar: some View {
        HStack {
            HStack(spacing: 6) {
                ForEach(0..<steps.count, id: \.self) { i in
                    Capsule()
                        .fill(i == index ? Theme.blue : (i < index ? Theme.blue.opacity(0.5) : Theme.blue.opacity(0.2)))
                        .frame(width: i == index ? 22 : 8, height: 8)
                }
            }
            .animation(.spring(response: 0.3), value: index)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Schritt \(index + 1) von \(steps.count)")
            Spacer()
            if step != .done {
                Button("Überspringen") { Task { await skip() } }
                    .font(.system(size: 15, weight: .semibold))
                    .disabled(busy)
            }
        }
        .padding(.top, 8)
    }

    private var navBar: some View {
        HStack {
            if index > 0 && step != .done {
                Button("Zurück") { go(-1) }
                    .buttonStyle(SoftButton(filled: false))
                    .disabled(busy)
            }
            Spacer()
            if step == .done {
                Button { Task { await finish() } } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Los geht’s") }
                }
                .buttonStyle(PrimaryButton())
                .disabled(busy || situation == nil)
            } else {
                Button("Weiter") { go(1) }
                    .buttonStyle(PrimaryButton())
                    .disabled(!canNext)
            }
        }
    }

    private func go(_ delta: Int) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { index = max(0, min(steps.count - 1, index + delta)) }
    }

    // MARK: Schritte

    @ViewBuilder private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            switch step {
            case .welcome:
                HoppingStar(size: 44).frame(maxWidth: .infinity)
                heading("Schön, dass du da bist!")
                paragraph("Ich bin Stella und helfe dir im Alltag. Mit ein paar Klicks stelle ich mich auf dein Leben ein – das dauert eine Minute.")
            case .name:
                heading("Wie soll ich dich nennen?")
                TextField("Dein Name", text: $name)
                    .textContentType(.givenName)
                    .modifier(InputStyle())
            case .situation:
                heading("Was trifft auf dich zu?")
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(situations) { s in situationCard(s) }
                }
            case .age:
                heading("Wie alt bist du?")
                paragraph("Damit passe ich Ton und Vorschläge an. Du kannst das auch offen lassen.")
                FlowLayout {
                    ForEach(ages) { a in
                        OnbChip(title: a.label, on: age == a.id) { age = age == a.id ? nil : a.id }
                    }
                }
            case .details:
                details
            case .features:
                heading("Wobei soll Stella helfen?")
                FlowLayout {
                    ForEach(featureOrder.filter { $0 != "homework" || situation == "school" }, id: \.self) { f in
                        OnbChip(title: featureInfo[f]?.label ?? f, symbol: featureInfo[f]?.symbol, on: features.contains(f)) {
                            if features.contains(f) { features.remove(f) } else { features.insert(f) }
                        }
                    }
                }
            case .mail:
                heading("Postfach verbinden?")
                paragraph("Wenn du magst, sortiert Stella deine Mails in Wichtig, Neutral, Unwichtig und Werbung. Das geht mit Gmail (per „Mit Google anmelden“) oder iCloud.")
                paragraph("Du findest es später unter Einstellungen → Verbindungen.")
            case .tone:
                heading("Wie soll ich schreiben?")
                TonePicker(selected: tone) { tone = $0 }
            case .briefing:
                heading("Wann soll dein Morgen-Briefing kommen?")
                FlowLayout {
                    ForEach(briefings) { b in
                        OnbChip(title: b.label, on: briefing == b.id) { briefing = b.id }
                    }
                }
                paragraph("Ein kurzer Überblick über deinen Tag. „Automatisch“ richtet sich nach deinem Stundenplan, sonst nach dem Vormittag.")
            case .done:
                HoppingStar(size: 44).frame(maxWidth: .infinity)
                heading("Alles bereit, \(name.split(separator: " ").first.map(String.init) ?? name)!")
                paragraph("Das macht Stella jetzt für dich:")
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(summary, id: \.self) { line in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.green).padding(.top, 3)
                            Text(line).font(.system(size: 15)).foregroundStyle(Theme.text)
                        }
                    }
                }
                if let error { Text(error).font(.system(size: 14)).foregroundStyle(Theme.pinkText) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 24)
    }

    @ViewBuilder private var details: some View {
        if situation == "school" {
            heading("In welcher Stufe bist du?")
            FlowLayout {
                ForEach(levels, id: \.self) { l in OnbChip(title: l, on: level == l) { level = level == l ? "" : l } }
            }
            paragraph("WebUntis und deine Schulbücher richtest du danach in den Einstellungen unter „Verbindungen“ ein.")
        } else if situation == "university" {
            heading("Wo studierst du?")
            TextField("z. B. Uni Wien", text: $uni).modifier(InputStyle())
            paragraph("Deinen Stundenplan holst du dir als Kalender-Abo: Einstellungen → Health, SMS & Kalender (auf der Website).")
        } else {
            heading("Wann arbeitest du?")
            FlowLayout {
                ForEach(days) { d in
                    OnbChip(title: d.label, on: workDays.contains(d.id)) {
                        if workDays.contains(d.id) { workDays.remove(d.id) } else { workDays.insert(d.id) }
                    }
                }
            }
            HStack {
                DatePicker("von", selection: $from, displayedComponents: .hourAndMinute)
                DatePicker("bis", selection: $to, displayedComponents: .hourAndMinute)
            }
            if toText <= fromText { Text("Das Ende muss nach dem Beginn liegen.").font(.system(size: 13)).foregroundStyle(Theme.pinkText) }
            OnbChip(title: "Ich pendle", on: commute) { commute.toggle() }
            paragraph("In dieser Zeit plane ich nichts ein, und „nach der Arbeit“ heißt für mich \(toText).")
        }
    }

    private func situationCard(_ s: SituationInfo) -> some View {
        let on = situation == s.id
        return Button {
            if situation != s.id { features = Self.defaultFeatures[s.id] ?? [] }
            situation = s.id
            Haptics.soft()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: s.symbol)
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.blue)
                    .frame(width: 40, height: 40)
                    .background(Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(s.label).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.text)
                Text(s.sub).font(.system(size: 12)).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
            .padding(12)
            .background(on ? Theme.blueTint.opacity(0.7) : Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(on ? Theme.blue : Theme.border, lineWidth: 2))
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private static let defaultFeatures: [String: Set<String>] = [
        "school": ["planner", "homework", "mails", "health"],
        "university": ["planner", "mails", "goals", "health"],
        "work": ["planner", "mails", "shopping", "goals", "health"],
        "apprenticeship": ["planner", "mails", "shopping", "goals", "health"],
        "other": ["planner", "mails", "shopping", "goals"],
    ]

    private var summary: [String] {
        var lines: [String] = []
        if situation == "school" { lines.append("Stundenplan, HÜs und Tests im Blick – mit Lernplänen.") }
        if situation == "university" { lines.append("Prüfungen und Lernpläne im Blick.") }
        if isWork {
            let names = days.filter { workDays.contains($0.id) }.map(\.label).joined(separator: ", ")
            lines.append("Plant nie in deine Arbeitszeit (\(names) \(fromText)–\(toText)). „Nach der Arbeit“ heißt \(toText).")
        }
        if features.contains("mails") { lines.append("Sortiert deine Mails: wichtig, neutral, unwichtig, Werbung.") }
        if features.contains("shopping") { lines.append("Führt deine Einkaufsliste und erinnert an Erledigungen.") }
        if features.contains("goals") { lines.append("Hilft dir, Ziele im Auge zu behalten.") }
        if briefing != "off" { lines.append("Schickt dir ein Morgen-Briefing (\(briefing == "auto" ? "automatisch" : "um \(briefing)")).") }
        lines.append("Schreibt im Ton „\(tone.label.lowercased())“.")
        return lines
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(Theme.display(26)).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
    }

    private func paragraph(_ text: String) -> some View {
        Text(text).font(.system(size: 15)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Laden, Speichern

    private func load() {
        guard !started, let me = store.me else { return }
        started = true
        name = me.name
        tone = Tone(rawValue: me.settings.tone ?? "nett") ?? .nett
        briefing = me.settings.briefing ?? "auto"
        if let p = me.settings.profile {
            situation = p.situation
            age = p.ageGroup
            level = p.school?.level ?? ""
            uni = p.university?.name ?? ""
            features = Set(p.features)
            if let w = p.workHours {
                workDays = Set(w.days)
                from = Self.time(w.start)
                to = Self.time(w.end)
                commute = w.commute ?? false
            }
        }
        if startAt == .situation { index = 2 }
    }

    private func profile() -> UserProfile {
        UserProfile(
            situation: situation ?? "other", ageGroup: age,
            workHours: isWork ? WorkHours(days: workDays.sorted(), start: fromText, end: toText, commute: commute ? true : nil) : nil,
            school: situation == "school" && !level.isEmpty ? SchoolInfo(level: level) : nil,
            university: situation == "university" && !uni.trimmingCharacters(in: .whitespaces).isEmpty ? UniversityInfo(name: uni.trimmingCharacters(in: .whitespaces)) : nil,
            features: featureOrder.filter { features.contains($0) })
    }

    private func finish() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await store.updateSettings(["name": .string(name.trimmingCharacters(in: .whitespaces)), "tone": .string(tone.rawValue), "briefing": .string(briefing)])
            let _: Me = try await API.shared.send("PUT", "/api/profile", body: profile())
            await store.refreshMe()
            store.onboardingRequest = nil
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func skip() async {
        busy = true
        defer { busy = false }
        _ = try? await API.shared.send("POST", "/api/profile/skip", as: Me.self)
        await store.refreshMe()
        store.onboardingRequest = nil
        dismiss()
    }
}
