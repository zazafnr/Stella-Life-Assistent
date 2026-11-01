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

    private enum Step: Hashable { case language, welcome, name, situation, freenotes, age, details, features, location, mail, tone, briefing, done }

    private struct SituationInfo: Identifiable {
        let id: String
        let symbol: String
    }

    private let situations = [
        SituationInfo(id: "school", symbol: "graduationcap.fill"), SituationInfo(id: "university", symbol: "books.vertical.fill"),
        SituationInfo(id: "work", symbol: "briefcase.fill"), SituationInfo(id: "apprenticeship", symbol: "wrench.and.screwdriver.fill"),
        SituationInfo(id: "other", symbol: "sparkles"),
    ]
    private let ages = ["u14", "14-17", "18-24", "25-34", "35-49", "50+"]
    /// Gespeichert wird weiterhin der deutsche Stufenname, angezeigt die Übersetzung
    private let levels: [(value: String, key: String)] = [("Unterstufe", "lower"), ("Mittelstufe", "middle"), ("Oberstufe", "upper"), ("Berufsschule", "vocational")]
    /// Montag = 1 … Sonntag = 7, Kurzname in der gewählten Sprache
    private func weekdayLabel(_ n: Int) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: I18n.shared.locale)
        return f.shortStandaloneWeekdaySymbols[n % 7]
    }
    private let dayIds = [1, 2, 3, 4, 5, 6, 7]
    private let featureOrder = ["planner", "mails", "homework", "shopping", "goals", "finance", "health"]
    private let featureSymbol: [String: String] = [
        "mails": "envelope.fill", "planner": "calendar", "homework": "book.fill", "shopping": "cart.fill", "goals": "star.fill",
        "finance": "eurosign.circle.fill", "health": "heart.fill",
    ]
    private let briefingTimes = ["06:30", "07:00", "07:30", "08:00"]

    @State private var index = 0
    @State private var started = false
    @State private var busy = false
    @State private var error: String?

    @State private var country = "AT"
    @State private var locationAnswer: String?
    @State private var notifyFreenotes = false
    @State private var locator = OneShotLocation()

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
        return [.language, .welcome, .name, .situation] + (situation == "school" ? [.freenotes] : []) + [.age] + (hasDetails ? [.details] : [])
            + [.features, .location, .mail, .tone, .briefing, .done]
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
            .accessibilityLabel(L("onboarding.step", ["n": index + 1, "total": steps.count]))
            Spacer()
            if step != .done {
                Button(L("common.skip")) { Task { await skip() } }
                    .font(.system(size: 15, weight: .semibold))
                    .disabled(busy)
            }
        }
        .padding(.top, 8)
    }

    private var navBar: some View {
        HStack {
            if index > 0 && step != .done {
                Button(L("common.back")) { go(-1) }
                    .buttonStyle(SoftButton(filled: false))
                    .disabled(busy)
            }
            Spacer()
            if step == .done {
                Button { Task { await finish() } } label: {
                    if busy { ProgressView().tint(.white) } else { Text(L("onboarding.done.start")) }
                }
                .buttonStyle(PrimaryButton())
                .disabled(busy || situation == nil)
            } else {
                Button(L("common.next")) { go(1) }
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
            case .language:
                heading(L("onboarding.language.title"))
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(I18n.supported, id: \.self) { l in languageCard(l) }
                }
                Picker(L("onboarding.country.label"), selection: $country) {
                    ForEach(I18n.countries, id: \.self) { c in Text(I18n.countryName(c, locale: I18n.shared.locale)).tag(c) }
                }
                .pickerStyle(.menu)
                paragraph(L("onboarding.country.sub") + " " + L("onboarding.language.sub"))
            case .welcome:
                HoppingStar(size: 44).frame(maxWidth: .infinity)
                heading(L("onboarding.welcome.title"))
                paragraph(L("onboarding.welcome.text"))
            case .name:
                heading(L("onboarding.name.title"))
                TextField(L("onboarding.name.label"), text: $name)
                    .textContentType(.givenName)
                    .modifier(InputStyle())
            case .situation:
                heading(L("onboarding.situation.title"))
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(situations) { s in situationCard(s) }
                }
            case .freenotes:
                heading(L("onboarding.freenotes.title", ["homework": homework]))
                NotebookMockup().accessibilityLabel(L("onboarding.freenotes.alt")).frame(maxWidth: .infinity)
                paragraph(L("onboarding.freenotes.text", ["homework": homework]))
                if let urlText = store.me?.flags?.freenotesUrl, let url = URL(string: urlText), !urlText.isEmpty {
                    Link(L("onboarding.freenotes.get"), destination: url).buttonStyle(PrimaryButton())
                } else if notifyFreenotes {
                    Label(L("onboarding.freenotes.notified"), systemImage: "checkmark").font(.system(size: 14)).foregroundStyle(Theme.muted)
                } else {
                    paragraph(L("onboarding.freenotes.soon"))
                    Button { notifyFreenotes = true; Haptics.soft() } label: { Label(L("onboarding.freenotes.notify"), systemImage: "bell") }
                        .buttonStyle(SoftButton(filled: false))
                }
            case .age:
                heading(L("onboarding.age.title"))
                paragraph(L("onboarding.age.sub"))
                FlowLayout {
                    ForEach(ages, id: \.self) { a in
                        OnbChip(title: a == "u14" ? L("onboarding.age.under14") : a.replacingOccurrences(of: "-", with: "–"), on: age == a) { age = age == a ? nil : a }
                    }
                }
            case .details:
                details
            case .features:
                heading(L("onboarding.features.title"))
                FlowLayout {
                    ForEach(featureOrder.filter { ($0 != "homework" || situation == "school") && ($0 != "finance" || store.me?.flags?.finance == true) }, id: \.self) { f in
                        OnbChip(title: f == "homework" ? homework.prefix(1).uppercased() + homework.dropFirst() : L("onboarding.feature.\(f)"), symbol: featureSymbol[f], on: features.contains(f)) {
                            if features.contains(f) { features.remove(f) } else { features.insert(f) }
                        }
                    }
                }
            case .location:
                heading(L("onboarding.location.title"))
                locationReason("mappin.and.ellipse", L("onboarding.location.r1"))
                locationReason("calendar", L("onboarding.location.r2"))
                locationReason("cloud.sun.fill", L("onboarding.location.r3"))
                Text(L("onboarding.location.fine")).font(.system(size: 13)).foregroundStyle(Theme.muted)
                if locationAnswer == "granted" {
                    Label(L("onboarding.location.granted"), systemImage: "checkmark").font(.system(size: 14)).foregroundStyle(Theme.muted)
                } else {
                    if locationAnswer == "denied" { paragraph(L("onboarding.location.denied")) }
                    HStack {
                        Button(L("onboarding.location.allow")) { Task { await askLocation() } }.buttonStyle(PrimaryButton())
                        Button(L("onboarding.location.later")) { locationAnswer = locationAnswer ?? "later"; go(1) }.buttonStyle(SoftButton(filled: false))
                    }
                }
            case .mail:
                heading(L("onboarding.mail.title"))
                paragraph(L("onboarding.mail.text"))
                paragraph(L("onboarding.mail.later"))
            case .tone:
                heading(L("onboarding.tone.title"))
                TonePicker(selected: tone) { tone = $0 }
            case .briefing:
                heading(L("onboarding.briefing.title"))
                FlowLayout {
                    ForEach(["auto"] + briefingTimes + ["off"], id: \.self) { b in
                        OnbChip(title: b == "auto" ? L("onboarding.briefing.auto") : (b == "off" ? L("onboarding.briefing.off") : b), on: briefing == b) { briefing = b }
                    }
                }
                paragraph(L("onboarding.briefing.sub"))
            case .done:
                HoppingStar(size: 44).frame(maxWidth: .infinity)
                heading(L("onboarding.done.title", ["name": name.split(separator: " ").first.map(String.init) ?? name]))
                paragraph(L("onboarding.done.lead"))
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
            heading(L("onboarding.level.title"))
            FlowLayout {
                ForEach(levels, id: \.value) { l in OnbChip(title: L("onboarding.level.\(l.key)"), on: level == l.value) { level = level == l.value ? "" : l.value } }
            }
            paragraph(L("onboarding.level.sub"))
        } else if situation == "university" {
            heading(L("onboarding.uni.title"))
            TextField(L("onboarding.uni.placeholder"), text: $uni).modifier(InputStyle())
            paragraph(L("onboarding.uni.sub"))
        } else {
            heading(L("onboarding.work.title"))
            FlowLayout {
                ForEach(dayIds, id: \.self) { d in
                    OnbChip(title: weekdayLabel(d), on: workDays.contains(d)) {
                        if workDays.contains(d) { workDays.remove(d) } else { workDays.insert(d) }
                    }
                }
            }
            HStack {
                DatePicker(L("onboarding.work.from"), selection: $from, displayedComponents: .hourAndMinute)
                DatePicker(L("onboarding.work.to"), selection: $to, displayedComponents: .hourAndMinute)
            }
            if toText <= fromText { Text(L("onboarding.work.endError")).font(.system(size: 13)).foregroundStyle(Theme.pinkText) }
            OnbChip(title: L("onboarding.work.commute"), on: commute) { commute.toggle() }
            paragraph(L("onboarding.work.sub", ["end": toText]))
        }
    }

    private var homework: String { I18n.homeworkPlural(locale: I18n.shared.locale, country: country) }

    private func languageCard(_ l: String) -> some View {
        let on = I18n.shared.locale == l
        return Button {
            I18n.shared.set(l)
            if I18n.countryLocale[country] != l { country = I18n.guessCountry(locale: l) }
            Task { try? await store.updateSettings(["locale": .string(l)]) }
            Haptics.soft()
        } label: {
            Text(I18n.names[l] ?? l)
                .font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.text)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .padding(.horizontal, 12)
                .background(on ? Theme.blueTint.opacity(0.7) : Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(on ? Theme.blue : Theme.border, lineWidth: 2))
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func locationReason(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Theme.blue).frame(width: 22)
            Text(text).font(.system(size: 15)).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
    }

    /** „Standort freigeben“: erst nach der Erklär-Folie löst iOS die Systemabfrage aus (iOS fragt nur einmal) */
    private func askLocation() async {
        do {
            _ = try await locator.request()
            locationAnswer = "granted"
        } catch {
            locationAnswer = "denied"
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
                Text(L("onboarding.situation.\(s.id).label")).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.text)
                Text(L("onboarding.situation.\(s.id).sub", ["homework": homework.prefix(1).uppercased() + homework.dropFirst()])).font(.system(size: 12)).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
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
        if situation == "school" { lines.append(L("onboarding.sum.school", ["homework": homework])) }
        if situation == "university" { lines.append(L("onboarding.sum.university")) }
        if isWork {
            let names = dayIds.filter { workDays.contains($0) }.map { weekdayLabel($0) }.joined(separator: ", ")
            lines.append(L("onboarding.sum.work", ["days": names, "start": fromText, "end": toText]))
        }
        if features.contains("mails") { lines.append(L("onboarding.sum.mails")) }
        if features.contains("shopping") { lines.append(L("onboarding.sum.shopping")) }
        if features.contains("goals") { lines.append(L("onboarding.sum.goals")) }
        if briefing != "off" {
            lines.append(L("onboarding.sum.briefing", ["when": briefing == "auto" ? L("onboarding.sum.briefingAuto") : L("onboarding.sum.briefingAt", ["time": briefing])]))
        }
        lines.append(L("onboarding.sum.tone", ["tone": L("tone.\(tone.rawValue)").lowercased()]))
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
        country = me.settings.country ?? I18n.guessCountry(locale: I18n.shared.locale)
        locationAnswer = me.settings.locationPermission
        notifyFreenotes = me.settings.notify?.freenotes == true
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
        if startAt == .situation { index = steps.firstIndex(of: .situation) ?? 0 }
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
            var patch: [String: SettingValue] = [
                "name": .string(name.trimmingCharacters(in: .whitespaces)), "tone": .string(tone.rawValue), "briefing": .string(briefing),
                "locale": .string(I18n.shared.locale), "country": .string(country), "notifyFreenotes": .bool(notifyFreenotes),
            ]
            if let locationAnswer { patch["locationPermission"] = .string(locationAnswer) }
            try await store.updateSettings(patch)
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
        try? await store.updateSettings(["locale": .string(I18n.shared.locale), "country": .string(country)])
        _ = try? await API.shared.send("POST", "/api/profile/skip", as: Me.self)
        await store.refreshMe()
        store.onboardingRequest = nil
        dismiss()
    }
}

/** Gestaltetes Mockup einer Heftseite mit Handschrift für die FreeNotes-Folie */
struct NotebookMockup: View {
    var body: some View {
        Canvas { ctx, size in
            let page = CGRect(origin: .zero, size: size).insetBy(dx: 2, dy: 2)
            ctx.fill(Path(roundedRect: page, cornerRadius: 10), with: .color(Color(red: 1, green: 0.99, blue: 0.97)))
            ctx.stroke(Path(roundedRect: page, cornerRadius: 10), with: .color(Color(red: 0.85, green: 0.83, blue: 0.77)), lineWidth: 1)
            for i in 0..<4 {
                let y = size.height * (0.27 + 0.17 * Double(i))
                var line = Path(); line.move(to: CGPoint(x: 16, y: y)); line.addLine(to: CGPoint(x: size.width - 16, y: y))
                ctx.stroke(line, with: .color(Color(red: 0.79, green: 0.86, blue: 0.95)), lineWidth: 1)
            }
            var margin = Path(); margin.move(to: CGPoint(x: 30, y: 6)); margin.addLine(to: CGPoint(x: 30, y: size.height - 6))
            ctx.stroke(margin, with: .color(Color(red: 0.94, green: 0.72, blue: 0.72)), lineWidth: 1)
            let ink = Color(red: 0.18, green: 0.29, blue: 0.54)
            for (row, length) in [(0, 0.78), (1, 0.7), (2, 0.4)] {
                let y = size.height * (0.25 + 0.17 * Double(row))
                var path = Path(); path.move(to: CGPoint(x: 40, y: y))
                var x = 40.0
                while x < 40 + (size.width - 70) * length {
                    path.addQuadCurve(to: CGPoint(x: x + 12, y: y), control: CGPoint(x: x + 6, y: y - (Int(x / 12) % 2 == 0 ? 10 : 5)))
                    x += 12
                }
                ctx.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            }
        }
        .frame(height: 140)
        .frame(maxWidth: 300)
        .accessibilityElement(children: .ignore)
    }
}
